use crate::data::users::{UserId, UserSnapshot};
use crate::session;
use crate::session::cookie::Session;
use crate::state::State;
use actix_web::{delete, get, post, web, Error, HttpRequest, HttpResponse, Responder};
use actix_web_actors::ws;
use async_std::task::sleep;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use unicode_normalization::UnicodeNormalization;

// Max-Age for the cookie if "persist" is selected when logging in
// this will be renewed periodically
const MAX_AGE_PERSIST: time::Duration = time::Duration::days(30);

pub fn init(cfg: &mut web::ServiceConfig) {
    cfg.service(user_session)
        .service(get_login)
        .service(post_login)
        .service(delete_login);
}

/// Session data stored on the client in a cookie.
#[derive(Debug, Deserialize, Serialize)]
struct SessionData {
    user_id: UserId,
}

pub enum SessionError {
    NoSession,
    InternalError,
}

pub fn get_user_session(data: &State, session_data: &str) -> Result<UserSnapshot, SessionError> {
    // if data deserialization fails, we can assume the data to be corrupt and just pretend there
    // never was a session to begin with
    let session_data: SessionData =
        serde_json::from_str(session_data).map_err(|_| SessionError::NoSession)?;

    let data = data.data().lock();
    match data.user(session_data.user_id) {
        Ok(Some(user)) => Ok(user),
        Ok(None) => Err(SessionError::NoSession),
        Err(err) => {
            error!(
                "Internal error attempting to get user session for id {:?}: {}",
                session_data.user_id, err
            );
            Err(SessionError::InternalError)
        }
    }
}

fn set_user_session(
    session: &Session,
    user: &UserSnapshot,
    max_age: Option<time::Duration>,
) -> Result<(), serde_json::Error> {
    let data = SessionData { user_id: user.id() };
    session.set(serde_json::to_string(&data)?);
    session.set_max_age(max_age);
    Ok(())
}

#[derive(Serialize)]
struct AuthResponseSuccess {
    auth: bool,
    name: String,
    secret_key: String,
}

#[derive(Serialize)]
struct AuthResponseFailure {
    auth: bool,
    error: &'static str,
}
impl AuthResponseFailure {
    const NO_SESSION: Self = Self {
        auth: false,
        error: "no_session",
    };
    const INTERNAL_ERROR: Self = Self {
        auth: false,
        error: "internal_error",
    };
}

#[get("/login")]
async fn get_login(data: web::Data<State>, session: Session) -> impl Responder {
    match get_user_session(&data, &session.get()) {
        Ok(user) => {
            // I was originally going to have this renew only if the cookie was old, but we don't
            // actually know when the cookie will expire (since Max-Age is a duration)
            // TODO: store date in cookie, renew only if it's older than X
            session.renew();
            HttpResponse::Ok().json(AuthResponseSuccess {
                auth: true,
                name: user.name().into(),
                secret_key: user.secret_key().into(),
            })
        }
        Err(SessionError::NoSession) => HttpResponse::Ok().json(AuthResponseFailure::NO_SESSION),
        Err(SessionError::InternalError) => {
            HttpResponse::Ok().json(AuthResponseFailure::INTERNAL_ERROR)
        }
    }
}

#[derive(Deserialize)]
struct LoginRequest {
    name: String,
    password: String,
    persist: bool,
}

#[derive(Serialize)]
struct LoginResponseSuccess {
    success: bool,
    name: String,
    secret_key: String,
}
#[derive(Serialize)]
struct LoginResponseFailure {
    success: bool,
    error: &'static str,
}
impl LoginResponseFailure {
    const INTERNAL_ERROR: Self = Self {
        success: false,
        error: "internal_error",
    };
    const LOGGED_IN: Self = Self {
        success: false,
        error: "logged_in",
    };
    const INVALID: Self = Self {
        success: false,
        error: "invalid",
    };
}

const MIN_AUTH_DURATION_MS: f64 = 1000.;
const AUTH_DURATION_EXTEND_MS: f64 = 1000.;

/// Used to determine an earliest allowed response time for unsuccessful login
fn get_earliest_response_time() -> Instant {
    let sleep_ms = MIN_AUTH_DURATION_MS + rand::random::<f64>() * AUTH_DURATION_EXTEND_MS;
    let sleep_duration = Duration::from_millis(sleep_ms as u64);
    Instant::now() + sleep_duration
}
async fn sleep_until(instant: Instant) {
    let now = Instant::now();
    match instant.checked_duration_since(now) {
        Some(duration) => sleep(duration).await,
        None => (), // it's in the past; nothing to do
    }
}

#[post("/login")]
async fn post_login(
    data: web::Data<State>,
    session: Session,
    req: web::Json<LoginRequest>,
) -> impl Responder {
    let name: String = req.name.nfc().collect();
    let earliest_response = get_earliest_response_time();

    match get_user_session(&data, &session.get()) {
        Ok(_) => {
            return HttpResponse::Ok().json(LoginResponseFailure::LOGGED_IN);
        }
        Err(SessionError::InternalError) => {
            sleep_until(earliest_response).await;
            return HttpResponse::Ok().json(LoginResponseFailure::INTERNAL_ERROR);
        }
        _ => (),
    }

    match data.data().lock().user_by_name(&name) {
        Ok(Some(user)) => {
            let user2 = user.clone();
            let password = req.password.clone();
            let auth_task = web::block(move || user2.auth(&password));

            let max_age = if req.persist {
                Some(MAX_AGE_PERSIST)
            } else {
                None
            };

            match auth_task.await {
                Ok(true) => {
                    if let Err(err) = set_user_session(&session, &user, max_age) {
                        error!("Failed to set a user session: {}", err);
                        HttpResponse::Ok().json(LoginResponseFailure::INTERNAL_ERROR);
                    }
                    HttpResponse::Ok().json(LoginResponseSuccess {
                        success: true,
                        name: user.name().into(),
                        secret_key: user.secret_key().into(),
                    })
                }
                Ok(false) => {
                    sleep_until(earliest_response).await;
                    HttpResponse::Ok().json(LoginResponseFailure::INVALID)
                }
                Err(err) => {
                    error!("Failed authenticating user {:?}: {}", name, err);
                    HttpResponse::Ok().json(LoginResponseFailure::INTERNAL_ERROR)
                }
            }
        }
        Ok(None) => {
            sleep_until(earliest_response).await;
            HttpResponse::Ok().json(LoginResponseFailure::INVALID)
        }
        Err(err) => {
            error!("Internal error getting user {:?}: {}", name, err);
            HttpResponse::Ok().json(LoginResponseFailure::INTERNAL_ERROR)
        }
    }
}

#[derive(Serialize)]
struct LogoutResponse {
    success: bool,
    #[serde(skip_serializing_if = "str::is_empty")]
    error: &'static str,
}
impl LogoutResponse {
    const INTERNAL_ERROR: Self = Self {
        success: false,
        error: "internal_error",
    };
    const NO_SESSION: Self = Self {
        success: false,
        error: "no_session",
    };
    const SUCCESS: Self = Self {
        success: true,
        error: "",
    };
}

#[delete("/login")]
async fn delete_login(data: web::Data<State>, session: Session) -> impl Responder {
    match get_user_session(&data, &session.get()) {
        Ok(_) => {
            session.delete();
            HttpResponse::Ok().json(LogoutResponse::SUCCESS)
        }
        Err(SessionError::InternalError) => HttpResponse::Ok().json(LogoutResponse::INTERNAL_ERROR),
        Err(SessionError::NoSession) => HttpResponse::Ok().json(LogoutResponse::NO_SESSION),
    }
}

#[get("/session")]
async fn user_session(
    data: web::Data<State>,
    req: HttpRequest,
    session: Session,
    stream: web::Payload,
) -> Result<HttpResponse, Error> {
    match get_user_session(&data, &session.get()) {
        Ok(user) => {
            let conn_info = req.connection_info();
            let conn_info = conn_info
                .realip_remote_addr()
                .unwrap_or_else(|| conn_info.host())
                .to_string();

            let user_conn = session::UserConn::new(conn_info, user.id(), data.into_inner()).await;
            match user_conn {
                Ok(user_conn) => ws::start(user_conn, &req, stream),
                Err(err) => {
                    error!("Error creating user connection for web socket: {}", err);
                    Ok(HttpResponse::InternalServerError().body("Internal server error"))
                }
            }
        }
        Err(SessionError::InternalError) => {
            Ok(HttpResponse::InternalServerError().body("Internal server error"))
        }
        Err(SessionError::NoSession) => Ok(HttpResponse::NotFound().body("No session")),
    }
}
