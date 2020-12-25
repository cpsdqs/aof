use actix_web::{web, Route, Scope};

mod login;
mod registration;
mod resources;

pub fn not_found() -> Route {
    web::route().to(crate::static_files::not_found_page)
}

pub fn create() -> Scope {
    web::scope("/api")
        .service(registration::scope())
        .service(resources::scope())
        .configure(login::init)
}
