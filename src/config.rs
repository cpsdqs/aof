use lazy_static::lazy_static;
use serde::Deserialize;
use std::fs::File;
use std::io::Read;
use std::sync::{RwLock, RwLockReadGuard};
use thiserror::Error;

lazy_static! {
    static ref GLOBAL_CONFIG: RwLock<Config> = RwLock::new(Config::default());
}

#[derive(Default, Deserialize)]
pub struct AutoFetcherConfig {
    pub fetcher_count: u64,
    pub minor_interval: u64,
    pub minor_item_interval: u64,
    pub major_interval: u64,
}

#[derive(Default, Deserialize)]
pub struct Config {
    pub bind_addr: String,
    pub database: String,
    pub private_key: String,
    pub base_path: String,
    pub auto_fetcher: Option<AutoFetcherConfig>,
}

#[derive(Debug, Error)]
pub enum ConfigReadError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Toml(#[from] toml::de::Error),
}

impl Config {
    pub fn read_from_file(path: &str) -> Result<Config, ConfigReadError> {
        let mut file = File::open(path)?;
        let mut str = String::new();
        file.read_to_string(&mut str)?;

        Ok(toml::from_str(&str)?)
    }

    pub fn shared() -> RwLockReadGuard<'static, Config> {
        GLOBAL_CONFIG
            .read()
            .expect("failed to read shared config object")
    }

    pub fn set_global_config(config: Config) {
        *GLOBAL_CONFIG
            .write()
            .expect("failed to write shared config object") = config;
    }

    pub fn is_dev(&self) -> bool {
        self.private_key.is_empty()
    }
}
