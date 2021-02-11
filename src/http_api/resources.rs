use super::login::{get_user_session, SessionError};
use crate::fetcher::request_fetch_permission;
use crate::session::cookie::Session;
use crate::state::State;
use actix::prelude::Stream;
use actix_web::body::{Body, BodySize, MessageBody};
use actix_web::http::HeaderValue;
use actix_web::web::Bytes;
use actix_web::{get, web, Error, HttpResponse, Responder, Scope};
use aof_script::url::Url;
use aof_script::USER_AGENT;
use futures::task::{Context, Poll};
use serde::Deserialize;
use std::convert::TryFrom;
use tokio::macros::support::Pin;

pub fn scope() -> Scope {
    web::scope("/resources").service(camo)
}

#[derive(Deserialize)]
struct CamoRequest {
    url: String,
    referrer: Option<String>,
}

struct MsgBody<S>(awc::ClientResponse<S>);
impl<S> MessageBody for MsgBody<S>
where
    S: Stream<Item = Result<Bytes, awc::error::PayloadError>> + Unpin,
{
    fn size(&self) -> BodySize {
        BodySize::Stream
    }

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Result<Bytes, Error>>> {
        // SAFETY: PIN PROJECTION
        // this is safe because if self is pinned then so is ClientResponse
        // (...I hope)
        let inner = unsafe { Pin::new_unchecked(&mut self.get_unchecked_mut().0) };
        inner
            .poll_next(cx)
            .map(|x| x.map(|x| x.map_err(actix_web::Error::from)))
    }
}

const FORWARDED_HEADER_WHITE_LIST: &[&str] = &[
    "accept",
    "accept-charset",
    "accept-encoding",
    "accept-language",
    "cache-control",
    "if-match",
    "if-none-match",
    "if-modified-since",
    "if-unmodified-since",
    "range",
    "if-range",
    "connection",
    "pragma",
];
const RECEIVED_HEADER_WHITE_LIST: &[&str] = &[
    "content-type",
    "content-length",
    "content-encoding",
    "content-language",
    "content-location",
    "accept-ranges",
    "content-range",
    "forwarded",
    "location",
    "date",
    "age",
    "cache-control",
    "expires",
    "vary",
    "pragma",
    "last-modified",
    "etag",
    "server",
    "transfer-encoding",
];

#[get("/camo")]
async fn camo(
    data: web::Data<State>,
    session: Session,
    request: web::HttpRequest,
    query: web::Query<CamoRequest>,
) -> impl Responder {
    match get_user_session(&data, &session.get()) {
        Ok(_) => {
            let url = match Url::parse(&query.url) {
                Ok(url) => url,
                Err(_) => {
                    return HttpResponse::BadRequest().body("bad url");
                }
            };
            if let Err(reason) = request_fetch_permission(&url, |_| {}) {
                return HttpResponse::BadRequest().body(format!("bad url: {}", reason));
            }

            let client = awc::Client::new();
            let mut req = client.get(&query.url);
            for (k, v) in request.headers() {
                let forward = FORWARDED_HEADER_WHITE_LIST
                    .iter()
                    .find(|l| k == **l)
                    .is_some();
                if forward {
                    req.headers_mut().append(k.clone(), v.clone());
                }
            }
            req = req.header("User-Agent", USER_AGENT);
            if let Some(referrer) = &query.referrer {
                req = req.header("Referer", referrer.clone());
            }
            match req.send().await {
                Ok(inner_res) => {
                    let mut res = HttpResponse::new(inner_res.status());

                    let res_headers = res.headers_mut();
                    for (k, v) in inner_res.headers() {
                        if k == "location" {
                            // fix Location header in redirects
                            match url.join(v.to_str().unwrap_or("")).map(|x| x.to_string()) {
                                Ok(resolved) => {
                                    let mut resource_url = String::from(request.path());

                                    let mut dummy_url = Url::parse("https://example.com").unwrap();
                                    dummy_url.query_pairs_mut().append_pair("url", &resolved);
                                    if let Some(referrer) = &query.referrer {
                                        dummy_url
                                            .query_pairs_mut()
                                            .append_pair("referrer", referrer);
                                    }
                                    resource_url.push_str("?");
                                    resource_url.push_str(dummy_url.query().unwrap_or(""));

                                    if let Ok(value) = HeaderValue::try_from(resource_url) {
                                        res_headers.append(k.clone(), value);
                                    }
                                }
                                _ => {
                                    // FIXME: do something maybe?
                                }
                            }
                        } else if RECEIVED_HEADER_WHITE_LIST
                            .iter()
                            .find(|l| k == **l)
                            .is_some()
                        {
                            res_headers.append(k.clone(), v.clone());
                        }
                    }

                    res.set_body(Body::Message(Box::new(MsgBody(inner_res))))
                }
                Err(err) => HttpResponse::BadGateway().body("bad gateway"),
            }
        }
        Err(SessionError::InternalError) => {
            HttpResponse::InternalServerError().body("internal server error")
        }
        Err(SessionError::NoSession) => HttpResponse::NotFound().body("no session"),
    }
}
