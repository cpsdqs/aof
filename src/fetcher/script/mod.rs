use crate::data::sources::SourceMetaItem;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use thiserror::Error;

mod script;

pub use script::{request_fetch_permission, run_ipc_fork, FetchMsg, FetchTime};

/// Source data output from a script.
#[derive(Deserialize, Debug, Clone)]
pub struct SourceFetchData {
    #[serde(default)]
    pub last_updated: Option<String>,
    pub tags: BTreeMap<String, Value>,
    #[serde(default)]
    pub items: Vec<SourceMetaItem>,
}

/// Source item data output from a script.
#[derive(Deserialize, Debug, Clone)]
pub struct SourceItemFetchData {
    #[serde(default)]
    pub last_updated: Option<String>,
    pub tags: BTreeMap<String, Value>,
}

/// Errors that may occur when running a script.
#[derive(Debug, Error)]
pub enum ScriptError {
    #[error("failed to parse data: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("script timed out (infinite loop?)")]
    Timeout,
    #[error("failed to run script: {0}")]
    Script(String),
}

/// Fetches a source.
pub fn fetch_source(
    domain: &str,
    script: &str,
    path: &str,
) -> (Vec<FetchMsg>, Result<SourceFetchData, ScriptError>) {
    let mut messages = Vec::new();
    let result = script::run_request(
        script::Fetch::Source {
            domain: domain.into(),
            script: script.into(),
            path: path.into(),
        },
        &mut messages,
    );

    let result = match result {
        Ok(data) => serde_json::from_value(data).map_err(ScriptError::from),
        Err(script::ScriptError::Timeout) => Err(ScriptError::Timeout),
        Err(script::ScriptError::NoResult) => Err(ScriptError::Script(String::from(
            "script execution ended with no result",
        ))),
        Err(script::ScriptError::Exec(err)) => Err(ScriptError::Script(err)),
        Err(script::ScriptError::Fatal(err)) => Err(ScriptError::Script(err)),
    };

    (messages, result)
}

/// Fetches a source item.
pub fn fetch_source_item(
    domain: &str,
    script: &str,
    path: &str,
) -> (Vec<FetchMsg>, Result<SourceItemFetchData, ScriptError>) {
    let mut messages = Vec::new();
    let result = script::run_request(
        script::Fetch::SourceItem {
            domain: domain.into(),
            script: script.into(),
            path: path.into(),
        },
        &mut messages,
    );

    let result = match result {
        Ok(data) => serde_json::from_value(data).map_err(ScriptError::from),
        Err(script::ScriptError::Timeout) => Err(ScriptError::Timeout),
        Err(script::ScriptError::NoResult) => Err(ScriptError::Script(String::from(
            "script completed with no result",
        ))),
        Err(script::ScriptError::Exec(err)) => Err(ScriptError::Script(err)),
        Err(script::ScriptError::Fatal(err)) => Err(ScriptError::Script(err)),
    };

    (messages, result)
}
