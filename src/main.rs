#[macro_use]
extern crate diesel;
#[macro_use]
extern crate log;

mod auto_fetcher;
mod config;
mod data;
mod fetcher;
mod http_api;
mod session;
mod state;
mod static_files;

use crate::config::Config;
use crate::state::State;
use actix_web::{web, App, HttpServer};
use std::process;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let matches = clap::App::new("AOF Server")
        .version(clap::crate_version!())
        .author(clap::crate_authors!())
        .about(clap::crate_description!())
        .arg(
            clap::Arg::with_name("config")
                .short("c")
                .long("config")
                .value_name("FILE")
                .help("Sets config file path")
                .takes_value(true)
                .default_value("aof.toml"),
        )
        .arg(
            clap::Arg::with_name("debug")
                .short("d")
                .long("debug")
                .help("Enables logging debug messages"),
        )
        .arg(
            clap::Arg::with_name("create_token")
                .long("create-token")
                .help("Create a new registration token"),
        )
        .subcommand(
            clap::SubCommand::with_name("fetcher-ipc-fork")
                .about("Internal command, please ignore")
                .arg(
                    clap::Arg::with_name("server_name")
                        .takes_value(true)
                        .required(true),
                ),
        )
        .subcommand(
            clap::SubCommand::with_name("generate-config")
                .about("Generates a new configuration file")
                .arg(
                    clap::Arg::with_name("file")
                        .value_name("FILE")
                        .help("Config file destination")
                        .takes_value(true)
                        .required(true),
                ),
        )
        .get_matches();

    {
        let colors = fern::colors::ColoredLevelConfig::new();
        let log_debug = matches.is_present("debug");

        fern::Dispatch::new()
            .format(move |out, msg, record| {
                out.finish(format_args!(
                    "\x1b[{}m{}\x1b[{}m[{} {}] {}\x1b[m",
                    fern::colors::Color::BrightBlack.to_fg_str(),
                    chrono::Local::now().format("[%Y-%m-%d %H:%M:%S %z]"),
                    colors.get_color(&record.level()).to_fg_str(),
                    record.level(),
                    record.target(),
                    msg
                ))
            })
            .level(if log_debug {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            })
            .chain(std::io::stdout())
            .apply()
            .expect("Failed to initialize logging");
    }

    match matches.subcommand() {
        ("generate-config", Some(sc)) => {
            generate_config(sc.value_of("file").unwrap());
        }
        ("fetcher-ipc-fork", Some(sc)) => {
            run_fetcher_ipc_fork(sc.value_of("server_name").unwrap());
        }
        _ => (),
    }

    {
        let config_file_path = matches.value_of("config").unwrap();
        let config = match Config::read_from_file(config_file_path) {
            Ok(cfg) => cfg,
            Err(err) => {
                error!(target: "config", "failed to read config file at {}: {}", config_file_path,
                       err);
                error!(target: "config", "you may want to generate a config file (see --help)");
                process::exit(-1);
            }
        };
        Config::set_global_config(config);
    }

    let db_url = Config::shared().database.clone();
    let pool = State::create_pool(&db_url);
    let state = web::Data::new(State::new(pool));

    if matches.is_present("create_token") {
        create_registration_token(&state);
    }

    let bind_addr = Config::shared().bind_addr.clone();
    let private_key = {
        let data = Config::shared().private_key.clone().into_bytes();
        if data.is_empty() {
            warn!(target: "config", "WARNING!!");
            warn!(target: "config", "The private_key is not set in the configuration file.");
            warn!(target: "config", "Assuming this is a development server and disabling security features.");
            let mut data = Vec::with_capacity(32);
            data.resize(32, 0);
            data
        } else if data.len() < 32 {
            error!(target: "config", "private_key must be at least 32 bytes long");
            process::exit(-1);
        } else {
            data
        }
    };

    start_gc(state.clone());
    auto_fetcher::start((*state).clone());

    let base_path = Config::shared().base_path.clone();
    let server = HttpServer::new(move || {
        App::new().service(
            web::scope(&base_path)
                .wrap(session::cookie::CookieSession::new(
                    &private_key,
                    "aof_session".into(),
                    Config::shared().base_path.clone(),
                    !Config::shared().is_dev(),
                ))
                .app_data(state.clone())
                .configure(static_files::create)
                .service(http_api::create())
                .default_service(http_api::not_found()),
        )
    });

    match server.bind(&bind_addr) {
        Ok(bound) => bound.run().await,
        Err(err) => {
            error!("Failed to bind to {}: {}", bind_addr, err);
            process::exit(1);
        }
    }
}

fn generate_config(target: &str) {
    let contents = include_bytes!("../resources/default_config.toml");
    let mut file = match std::fs::File::create(target) {
        Ok(f) => f,
        Err(e) => {
            println!("Failed to create file {}: {}", target, e);
            process::exit(-1);
        }
    };
    match std::io::Write::write_all(&mut file, contents) {
        Ok(()) => (),
        Err(e) => {
            println!("Failed to write file: {}", e);
            process::exit(-1);
        }
    }
    println!("Generated configuration file at {}", target);
    process::exit(0);
}

fn create_registration_token(state: &web::Data<State>) {
    use chrono::{DateTime, Duration, Utc};
    use rustyline::error::ReadlineError;
    use rustyline::Editor;

    let mut rl = Editor::<()>::new();
    println!("Enter a registration token (leave empty for a random token)");
    let mut token = match rl.readline("> ") {
        Ok(ln) => ln,
        Err(ReadlineError::Interrupted) | Err(ReadlineError::Eof) => {
            process::exit(-1);
        }
        Err(e) => Err(e).unwrap(),
    };

    if token.is_empty() {
        let token_chars: Vec<_> = "abcdefghijklmnopqrstuvwxyz".chars().collect();
        for _ in 0..8 {
            token.push(token_chars[(rand::random::<usize>() % token_chars.len())]);
        }
    }

    println!("Enter when this token should expire, either as an RFC3339 date or the number of seconds (leave empty for 1 day)");
    let expiry = loop {
        let expiry = match rl.readline("> ") {
            Ok(ln) => ln,
            Err(ReadlineError::Interrupted) | Err(ReadlineError::Eof) => {
                process::exit(-1);
            }
            Err(e) => Err(e).unwrap(),
        };

        if expiry.is_empty() {
            println!("Expiring in 1 day");
            break Utc::now() + Duration::days(1);
        } else if let Ok(secs) = expiry.parse::<i64>() {
            println!("Expiring in {} seconds", secs);
            break Utc::now() + Duration::seconds(secs);
        } else if let Ok(date) = DateTime::parse_from_rfc3339(&expiry) {
            if date < Utc::now() {
                println!("That’s in the past!");
            }
            break date.into();
        } else {
            println!("Please enter either a number or a date like “2020-12-31T12:24:01Z”");
        }
    };

    println!("Registration token: {:?}", token);
    println!("Valid until: {}", expiry);

    loop {
        let ok = match rl.readline("OK? [Y/n]: ") {
            Ok(ln) => ln,
            Err(ReadlineError::Interrupted) | Err(ReadlineError::Eof) => {
                process::exit(-1);
            }
            Err(e) => Err(e).unwrap(),
        };

        match &*ok {
            "" | "Y" | "y" => break,
            "N" | "n" => process::exit(-1),
            _ => println!("Please enter either Y or N"),
        }
    }

    state
        .data()
        .lock()
        .create_registration_token(&token, expiry)
        .unwrap();
    println!("Token created");
    process::exit(0);
}

fn run_fetcher_ipc_fork(server_name: &str) {
    crate::fetcher::run_ipc_fork(server_name);
    process::exit(0);
}

fn start_gc(state: web::Data<State>) {
    use std::thread;
    use std::time::Duration;

    thread::Builder::new()
        .name("gc-sources".into())
        .spawn(move || loop {
            let res = state.data().lock().garbage_collect_sources();
            if let Err(err) = res {
                error!(target: "gc", "Error during garbage collection: {}", err);
            } else {
                debug!(target: "gc", "Garbage collected successfully");
            }

            thread::sleep(Duration::from_secs(600));
        })
        .expect("Failed to create fetcher thread!");
}
