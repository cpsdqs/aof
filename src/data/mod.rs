use crate::session::users::UserManager;
use actix::Addr;
use diesel::r2d2::{ConnectionManager, PooledConnection};
use diesel::sqlite::SqliteConnection;
use std::io;
use thiserror::Error;

pub mod domains;
mod models;
mod registration;
mod rss_auth_keys;
mod schema;
pub mod sources;
pub mod users;

/// Data interface.
pub struct Data {
    conn: PooledConnection<ConnectionManager<SqliteConnection>>,
    users: Addr<UserManager>,
}

/// Some connection error.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ConnError {
    #[error("database connection error: {0}")]
    Diesel(#[from] diesel::result::ConnectionError),
}

/// A data fetch error. This is always an unexpected error.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum DataError {
    #[error("database error: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("data decode error: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

impl Data {
    /// Creates a new Data wrapper.
    pub fn new(
        conn: PooledConnection<ConnectionManager<SqliteConnection>>,
        users: Addr<UserManager>,
    ) -> Self {
        Data { conn, users }
    }

    pub fn users(&self) -> &Addr<UserManager> {
        &self.users
    }
}
