//! This code is loosely based on actix-session, and exists because actix-session does not
//! support having per-cookie max-age
//! >> https://github.com/actix/actix-extras/blob/76429602c6545bde0f9094665705f52334360e72/actix-session/src/cookie.rs

use actix_web::cookie::{Cookie, CookieJar, Key, SameSite};
use actix_web::dev::{Extensions, Payload, Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::http::{self, HeaderValue};
use actix_web::{Error, FromRequest, HttpMessage, HttpRequest};
use futures::future::{ok, LocalBoxFuture, Ready};
use futures::FutureExt;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::rc::Rc;
use std::task::{Context, Poll};
use time::{Duration, OffsetDateTime};

#[derive(Debug, Deserialize, Serialize)]
struct CookieData {
    data: String,
    max_age: i32,
}

struct InnerCookieSession {
    key: Key,
    name: String,
    path: String,
    secure: bool,
}

impl InnerCookieSession {
    fn new(key: &[u8], name: String, path: String, secure: bool) -> Self {
        Self {
            key: Key::derive_from(key),
            name,
            path,
            secure,
        }
    }

    fn set_cookie<B>(
        &self,
        res: &mut ServiceResponse<B>,
        data: String,
        max_age: Option<Duration>,
    ) -> Result<(), Error> {
        let data = CookieData {
            data,
            max_age: max_age.map(|d| d.whole_seconds() as i32).unwrap_or(0),
        };
        let data = serde_json::to_string(&data)?;

        let mut cookie = Cookie::build(self.name.clone(), data)
            .path(self.path.clone())
            .secure(self.secure)
            .http_only(true)
            .same_site(SameSite::Lax)
            .finish();

        if let Some(max_age) = max_age {
            cookie.set_max_age(max_age);
        }

        let mut jar = CookieJar::new();
        jar.private(&self.key).add(cookie);

        for cookie in jar.delta() {
            let header = HeaderValue::from_str(&cookie.encoded().to_string())?;
            res.headers_mut().append(http::header::SET_COOKIE, header);
        }

        Ok(())
    }

    fn remove_cookie<B>(&self, res: &mut ServiceResponse<B>) -> Result<(), Error> {
        let cookie = Cookie::build(&self.name, "")
            .path(self.path.clone())
            .secure(self.secure)
            .http_only(true)
            .same_site(SameSite::Lax)
            .expires(OffsetDateTime::now_utc() - time::Duration::days(365))
            .finish();

        let header = HeaderValue::from_str(&cookie.encoded().to_string())?;
        res.headers_mut().append(http::header::SET_COOKIE, header);
        Ok(())
    }

    fn load(&self, req: &ServiceRequest) -> (bool, String, Option<Duration>) {
        if let Ok(cookies) = req.cookies() {
            for cookie in cookies.iter() {
                if cookie.name() == self.name {
                    let mut jar = CookieJar::new();
                    jar.add_original(cookie.clone());
                    if let Some(cookie) = jar.private(&self.key).get(&self.name) {
                        let value = cookie.value();
                        if let Ok(value) = serde_json::from_str::<CookieData>(value) {
                            let max_age = if value.max_age == 0 {
                                None
                            } else {
                                Some(Duration::seconds(value.max_age as i64))
                            };
                            return (false, value.data, max_age);
                        }
                    }
                }
            }
        }
        (true, String::new(), None)
    }
}

pub struct CookieSession {
    inner: Rc<InnerCookieSession>,
}

impl CookieSession {
    pub fn new(key: &[u8], name: String, path: String, secure: bool) -> Self {
        Self {
            inner: Rc::new(InnerCookieSession::new(key, name, path, secure)),
        }
    }
}

impl<S, B: 'static> Transform<S> for CookieSession
where
    S: Service<Request = ServiceRequest, Response = ServiceResponse<B>>,
    S::Future: 'static,
    S::Error: 'static,
{
    type Request = ServiceRequest;
    type Response = ServiceResponse<B>;
    type Error = S::Error;
    type InitError = ();
    type Transform = CookieSessionMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(CookieSessionMiddleware {
            service,
            inner: self.inner.clone(),
        })
    }
}

pub struct CookieSessionMiddleware<S> {
    service: S,
    inner: Rc<InnerCookieSession>,
}

impl<S, B: 'static> Service for CookieSessionMiddleware<S>
where
    S: Service<Request = ServiceRequest, Response = ServiceResponse<B>>,
    S::Future: 'static,
    S::Error: 'static,
{
    type Request = ServiceRequest;
    type Response = ServiceResponse<B>;
    type Error = S::Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&mut self, mut req: ServiceRequest) -> Self::Future {
        let inner = self.inner.clone();
        let (_, state, max_age) = self.inner.load(&req);

        Session::set_session(state, max_age, &mut req);

        let fut = self.service.call(req);

        async move {
            fut.await
                .map(|mut res| match Session::get_changes(&mut res) {
                    (SessionStatus::Changed, Some((state, max_age))) => {
                        res.checked_expr(|res| inner.set_cookie(res, state, max_age))
                    }
                    (SessionStatus::Unchanged, _) => res,
                    (SessionStatus::Removed, _) => res.checked_expr(|res| inner.remove_cookie(res)),
                    _ => res,
                })
        }
        .boxed_local()
    }
}

pub struct Session {
    inner: Rc<RefCell<SessionInner>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionStatus {
    Changed,
    Unchanged,
    Removed,
}

struct SessionInner {
    state: String,
    max_age: Option<Duration>,
    status: SessionStatus,
}

impl Session {
    pub fn get(&self) -> String {
        self.inner.borrow().state.clone()
    }
    pub fn set(&self, data: String) {
        let mut inner = self.inner.borrow_mut();
        if inner.status != SessionStatus::Removed {
            inner.status = SessionStatus::Changed;
            inner.state = data;
        }
    }
    pub fn set_max_age(&self, max_age: Option<Duration>) {
        let mut inner = self.inner.borrow_mut();
        if inner.status != SessionStatus::Removed {
            inner.status = SessionStatus::Changed;
            inner.max_age = max_age;
        }
    }
    pub fn renew(&self) {
        let mut inner = self.inner.borrow_mut();
        if inner.status != SessionStatus::Removed {
            inner.status = SessionStatus::Changed;
        }
    }
    pub fn delete(&self) {
        self.inner.borrow_mut().status = SessionStatus::Removed;
    }

    fn set_session(data: String, max_age: Option<Duration>, req: &mut ServiceRequest) {
        let session = Session::get_session(&mut *req.extensions_mut());
        session.inner.borrow_mut().state = data;
        session.inner.borrow_mut().max_age = max_age;
    }

    fn get_changes<B>(
        res: &mut ServiceResponse<B>,
    ) -> (SessionStatus, Option<(String, Option<Duration>)>) {
        if let Some(inner) = res
            .request()
            .extensions()
            .get::<Rc<RefCell<SessionInner>>>()
        {
            let state = std::mem::replace(&mut inner.borrow_mut().state, String::new());
            let max_age = inner.borrow_mut().max_age.take();
            (inner.borrow().status, Some((state, max_age)))
        } else {
            (SessionStatus::Unchanged, None)
        }
    }

    fn get_session(extensions: &mut Extensions) -> Session {
        if let Some(inner) = extensions.get::<Rc<RefCell<SessionInner>>>() {
            return Session {
                inner: Rc::clone(&inner),
            };
        }
        let inner = Rc::new(RefCell::new(SessionInner {
            state: String::new(),
            max_age: None,
            status: SessionStatus::Unchanged,
        }));
        extensions.insert(inner.clone());
        Session { inner }
    }
}

impl FromRequest for Session {
    type Error = Error;
    type Future = Ready<Result<Session, Error>>;
    type Config = ();

    #[inline]
    fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
        ok(Session::get_session(&mut *req.extensions_mut()))
    }
}
