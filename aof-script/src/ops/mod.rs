use crate::ScriptContext;
use deno_core::error::AnyError;
use deno_core::{v8, JsRuntime};
use std::rc::Rc;

mod aof_req;
pub mod console;
mod fetch;

pub use fetch::USER_AGENT;

pub fn init(runtime: &mut JsRuntime, ctx: Rc<dyn ScriptContext>) -> Result<(), AnyError> {
    {
        let global_ctx = runtime.global_context();
        let s_ctx = global_ctx.get(runtime.v8_isolate());
        let global_ctx_2 = global_ctx.clone();
        let scope = &mut v8::HandleScope::with_context(runtime.v8_isolate(), global_ctx_2);
        let global = s_ctx.global(scope);
        console::init(Rc::clone(&ctx), global, scope)?;
    }

    deno_web::init(runtime);
    runtime.execute("deno_web_init.js", include_str!("deno_web_init.js"))?;
    console::init_rt(runtime)?;
    deno_dom::init(runtime)?;
    aof_req::init(runtime)?;
    fetch::init(runtime)?;
    Ok(())
}
