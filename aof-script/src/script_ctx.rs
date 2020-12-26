use crate::ops::console::ConsoleMessage;
use deno_core::url::Url;
use deno_core::{JsRuntime, OpState};
use serde::Serialize;
use std::sync::Arc;

/// The execution context of a script.
pub trait ScriptContext: Send + Sync {
    /// Requests permission to access a URL.
    fn request_permission(&self, _method: &reqwest::Method, _url: &Url) -> Result<(), String> {
        Ok(())
    }

    /// Notifies the script context that a fetch operation has started.
    /// This may be used to pause any timer limiting script execution time.
    fn fetch_did_start(&self) {}

    /// Notifies the script context that a fetch operation has ended.
    /// This may be used to continue any timer limiting script execution time.
    fn fetch_did_end(&self) {}

    /// Called on every console message.
    fn on_console_message(&self, msg: crate::console::ConsoleMessage);

    /// Returns the current request.
    fn get_aof_request(&self) -> AofRequest;

    /// Sets the response to the current request.
    fn set_aof_response(&self, _data: deno_core::serde_json::Value) {}
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum AofRequest {
    #[serde(rename = "source")]
    Source { path: String },
    #[serde(rename = "source-item")]
    SourceItem { path: String },
}

const RNAME_CTX: &str = "aof_ctx";
pub(crate) fn init_rt(rt: &mut JsRuntime, ctx: Arc<dyn ScriptContext>) {
    rt.op_state()
        .borrow_mut()
        .resource_table
        .add(RNAME_CTX, Box::new(ctx));
}

pub(crate) trait OpStateExt {
    fn script_ctx(&self) -> Result<&dyn ScriptContext, ()>;
    fn script_ctx_arc(&self) -> Result<&Arc<dyn ScriptContext>, ()>;
}

fn get_script_ctx_rid(state: &OpState) -> Result<u32, ()> {
    let rid = state
        .resource_table
        .entries()
        .iter()
        .find(|(_, name)| **name == RNAME_CTX)
        .map(|(rid, _)| *rid);

    match rid {
        Some(rid) => Ok(rid),
        None => Err(()),
    }
}

impl OpStateExt for OpState {
    fn script_ctx(&self) -> Result<&dyn ScriptContext, ()> {
        self.script_ctx_arc().map(|s| &**s)
    }
    fn script_ctx_arc(&self) -> Result<&Arc<dyn ScriptContext>, ()> {
        match self
            .resource_table
            .get::<Arc<dyn ScriptContext>>(get_script_ctx_rid(self)?)
        {
            Some(res) => Ok(res),
            None => Err(()),
        }
    }
}

/// This execution context does not impose any restrictions on script execution.
pub struct UnrestrictedContext;
impl ScriptContext for UnrestrictedContext {
    fn on_console_message(&self, msg: ConsoleMessage) {
        println!("[JS] {}", msg);
    }
    fn get_aof_request(&self) -> AofRequest {
        AofRequest::Source {
            path: String::new(),
        }
    }
}
