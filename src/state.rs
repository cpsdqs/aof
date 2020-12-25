use crate::data::Data;
use crate::fetcher::Fetcher;
use crate::session::users::UserManager;
use actix::{Actor, Addr};
use diesel::connection::SimpleConnection;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;
use std::ops::{Deref, DerefMut};

type DatabasePool = Pool<ConnectionManager<SqliteConnection>>;

/// Shared app state.
pub struct State {
    data: SharedData,
    users: Addr<UserManager>,
    fetcher: Addr<Fetcher>,
}

#[derive(Debug)]
struct ConnectionSettings;
impl diesel::r2d2::CustomizeConnection<SqliteConnection, diesel::r2d2::Error>
    for ConnectionSettings
{
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), diesel::r2d2::Error> {
        conn.batch_execute(
            "PRAGMA journal_mode = WAL;\
        PRAGMA synchronous = NORMAL;\
        PRAGMA busy_timeout = 3000;",
        )
        .map_err(diesel::r2d2::Error::QueryError)
    }
}

impl State {
    pub fn create_pool(db_url: &str) -> DatabasePool {
        let mgr = ConnectionManager::new(db_url);
        Pool::builder()
            .connection_customizer(Box::new(ConnectionSettings))
            .build(mgr)
            .expect("Failed to create database pool")
    }

    pub fn new(db_pool: DatabasePool) -> Self {
        let users = UserManager::create(UserManager::new);

        let shared_data = SharedData {
            pool: db_pool,
            users: users.clone(),
            thing: (),
        };

        let data2 = shared_data.clone();
        let fetcher = Fetcher::create(move |_| Fetcher::new(data2));

        State {
            data: shared_data,
            users,
            fetcher,
        }
    }

    pub fn users(&self) -> &Addr<UserManager> {
        &self.users
    }

    pub fn fetcher(&self) -> &Addr<Fetcher> {
        &self.fetcher
    }

    pub fn data(&self) -> &SharedData {
        &self.data
    }
}

/// This exists because this used to be a mutex lock.
#[derive(Clone)]
pub struct SharedData {
    pool: DatabasePool,
    users: Addr<UserManager>,
    thing: (),
}

impl SharedData {
    pub fn lock(&self) -> AccessGuard<Data> {
        // TODO: better error handling? (when would these errors even occur?)
        AccessGuard {
            inner: Data::new(
                self.pool.get().expect("Failed to get DB connection"),
                self.users.clone(),
            ),
            _lifetime_binding: &self.thing,
        }
    }

    pub fn users(&self) -> &Addr<UserManager> {
        &self.users
    }
}

/// MutexGuard-like structure.
pub struct AccessGuard<'a, T> {
    inner: T,
    _lifetime_binding: &'a (),
}

impl<'a, T> Deref for AccessGuard<'a, T> {
    type Target = T;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}
impl<'a, T> DerefMut for AccessGuard<'a, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}
