use crate::data::users::CreateUserError;
use crate::state::State;
use actix_web::{get, post, web, HttpResponse, Responder, Scope};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

pub fn scope() -> Scope {
    web::scope("/registration")
        .service(is_valid_token)
        .service(is_name_available)
        .service(register)
}

/// Verifies whether the given token is a valid registration token.
fn verify_token(state: &State, token: &str) -> bool {
    match state.data().lock().verify_registration_token(token) {
        Ok(valid) => valid,
        Err(err) => {
            warn!("Error verifying token {:?}: {}", token, err);
            false
        }
    }
}

/// Returns true if the username is taken.
fn check_name_taken(state: &State, name: &str) -> bool {
    match state.data().lock().is_user_name_taken(name) {
        Ok(taken) => taken,
        Err(err) => {
            warn!("Error checking if name {:?} is taken: {}", name, err);
            true
        }
    }
}

#[derive(Deserialize)]
struct TokenValidity {
    token: String,
}

#[get("/is_valid_token")]
async fn is_valid_token(
    data: web::Data<State>,
    query: web::Query<TokenValidity>,
) -> impl Responder {
    let validity = match verify_token(&data, &query.token) {
        true => "true",
        false => "false",
    };
    HttpResponse::Ok().body(validity)
}

#[derive(Deserialize)]
struct NameAvailability {
    token: String,
    name: String,
}

#[derive(Serialize)]
struct NameAvailabilityResult {
    available: bool,
    #[serde(skip_serializing_if = "str::is_empty")]
    error: &'static str,
}

#[get("/is_name_available")]
async fn is_name_available(
    data: web::Data<State>,
    query: web::Query<NameAvailability>,
) -> impl Responder {
    let result = if data.data().lock().is_valid_user_name(&query.name) {
        match verify_token(&data, &query.token) {
            true => match check_name_taken(&data, &query.name) {
                false => NameAvailabilityResult {
                    available: true,
                    error: "",
                },
                true => NameAvailabilityResult {
                    available: false,
                    error: "name_taken",
                },
            },
            false => NameAvailabilityResult {
                available: false,
                error: "invalid_token",
            },
        }
    } else {
        NameAvailabilityResult {
            available: false,
            error: "invalid_name",
        }
    };

    HttpResponse::Ok().json(result)
}

#[derive(Deserialize)]
struct Registration {
    token: String,
    name: String,
    password: String,
    secret_key: String,
}
#[derive(Serialize)]
struct RegistrationResult {
    success: bool,
    #[serde(skip_serializing_if = "str::is_empty")]
    error: &'static str,
}

#[post("/register")]
async fn register(data: web::Data<State>, req: web::Json<Registration>) -> impl Responder {
    if !verify_token(&data, &req.token) {
        return HttpResponse::Ok().json(RegistrationResult {
            success: false,
            error: "invalid_token",
        });
    }

    let name: String = req.name.nfc().collect();

    let data = data.data().lock();
    let res = match data.create_user(&name, &req.password, &req.secret_key) {
        Ok(()) => {
            info!("Successfully registered user {:?}", name);

            info!("Deleting registration token {:?}", req.token);
            match data.delete_registration_token(&req.token) {
                Ok(()) => (),
                Err(err) => {
                    error!(
                        "Failed to delete registration token {:?}: {}",
                        req.token, err
                    );
                }
            }

            RegistrationResult {
                success: true,
                error: "",
            }
        }
        Err(CreateUserError::InvalidName) => RegistrationResult {
            success: false,
            error: "invalid_name",
        },
        Err(CreateUserError::NameTaken) => RegistrationResult {
            success: false,
            error: "name_taken",
        },
        Err(CreateUserError::PasswordDerivationError) => RegistrationResult {
            success: false,
            error: "internal_error",
        },
        Err(CreateUserError::Data(err)) => {
            error!("Error creating user: {}", err);
            RegistrationResult {
                success: false,
                error: "internal_error",
            }
        }
    };
    HttpResponse::Ok().json(res)
}
