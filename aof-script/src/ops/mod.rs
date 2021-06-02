use crate::ScriptContext;
use deno_core::error::AnyError;
use deno_core::include_js_files;
use deno_core::{v8, Extension, JsRuntime};
use std::sync::Arc;

mod aof_req;
pub mod console;
mod fetch;

pub use fetch::USER_AGENT;

pub fn init() -> Vec<Extension> {
    let init = Extension::builder()
        .js(include_js_files! {
            prefix "deno:aof/init",
            "deno_init.js",
        })
        .build();

    vec![
        deno_webidl::init(),
        deno_url::init(),
        deno_web::init(),
        console::init(),
        deno_dom::init(),
        aof_req::init(),
        fetch::init(),
        init,
    ]
}

pub fn init_rt(runtime: &mut JsRuntime, ctx: Arc<dyn ScriptContext>) -> Result<(), AnyError> {
    let global_ctx = runtime.global_context();
    let s_ctx = global_ctx.get(runtime.v8_isolate());
    let global_ctx_2 = global_ctx.clone();
    let scope = &mut v8::HandleScope::with_context(runtime.v8_isolate(), global_ctx_2);
    let global = s_ctx.global(scope);
    console::init_rt(Arc::clone(&ctx), global, scope)?;
    Ok(())
}
