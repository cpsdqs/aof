use crate::config::Config;
use actix_files::{Files, NamedFile};
use actix_web::{get, http, web, HttpRequest, HttpResponse, Responder};
use std::fs;
use std::io::Read;
use std::path::PathBuf;

const STATIC_PATH: &'static str = "./static";
const JS_CLIENT_PATH: &'static str = "./static/client";

fn static_path(file: &str) -> PathBuf {
    let mut buf = PathBuf::from(STATIC_PATH);
    buf.push(file);
    buf
}

pub fn create(cfg: &mut web::ServiceConfig) {
    cfg.service(index)
        .service(terms)
        .service(privacy)
        .service(contact)
        .service(documentation)
        .service(favicon)
        .service(static_files())
        .service(web_client());
}

pub async fn not_found_page() -> HttpResponse {
    not_found_page_inner("")
}

pub async fn template_file(name: &str) -> HttpResponse {
    template_file_inner(name)
}

fn not_found_page_inner(name: &str) -> HttpResponse {
    if name == "not_found" {
        HttpResponse::NotFound().body("Not found")
    } else {
        template_file_inner("not_found.html")
    }
}

fn template_file_inner(name: &str) -> HttpResponse {
    let mut template_path = PathBuf::from(STATIC_PATH);
    template_path.push("index.html");
    let mut content_path = PathBuf::from(STATIC_PATH);
    content_path.push("static");
    content_path.push(name);

    if content_path
        .components()
        .find(|c| match c {
            std::path::Component::ParentDir => true,
            _ => false,
        })
        .is_some()
    {
        return HttpResponse::BadRequest().body("Bad Request");
    }

    fn no_template() -> HttpResponse {
        HttpResponse::InternalServerError().body("HTML template not found")
    }

    let mut template = String::new();
    match fs::File::open(template_path) {
        Ok(mut file) => match file.read_to_string(&mut template) {
            Ok(_) => (),
            Err(_) => return no_template(),
        },
        Err(_) => return no_template(),
    }

    let mut contents = String::new();
    match fs::File::open(content_path) {
        Ok(mut file) => match file.read_to_string(&mut contents) {
            Ok(_) => (),
            Err(_) => return not_found_page_inner(name),
        },
        Err(_) => return not_found_page_inner(name),
    }

    HttpResponse::Ok()
        .header(http::header::CONTENT_TYPE, "text/html")
        .body(
            template
                .replace("{{BASE}}", &Config::shared().base_path)
                .replace("{{CONTENTS}}", &contents),
        )
}

#[get("")]
async fn index() -> impl Responder {
    template_file("index.html").await
}

#[get("/terms")]
async fn terms() -> impl Responder {
    template_file("terms.html").await
}

#[get("/privacy")]
async fn privacy() -> impl Responder {
    template_file("privacy.html").await
}

#[get("/contact")]
async fn contact() -> impl Responder {
    template_file("contact.html").await
}

#[get("/docs/{tail:.*}")]
async fn documentation(req: HttpRequest) -> impl Responder {
    let mut path: PathBuf = match req.match_info().query("tail").parse() {
        Ok(path) => path,
        Err(_) => return HttpResponse::BadRequest().body("Bad request"),
    };
    if path.components().count() == 0 {
        path.push("/index");
    } else if path.is_dir() {
        path.push("index");
    }
    template_file(&format!("docs/{}.html", path.display())).await
}

#[get("/favicon.ico")]
async fn favicon() -> impl Responder {
    NamedFile::open(static_path("favicon.ico"))
}

fn static_files() -> Files {
    Files::new("/static", static_path("static"))
        .index_file("index.html")
        .redirect_to_slash_directory()
        .use_last_modified(false)
        .prefer_utf8(true)
}

fn web_client() -> Files {
    Files::new("/web", JS_CLIENT_PATH)
        .index_file("index.html")
        .redirect_to_slash_directory()
        .use_last_modified(false)
        .prefer_utf8(true)
}
