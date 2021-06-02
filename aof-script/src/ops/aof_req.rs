use crate::OpStateExt;
use deno_core::error::AnyError;
use deno_core::serde_json::{self, Value};
use deno_core::{op_sync, Extension, OpState, ZeroCopyBuf};
use thiserror::Error;

#[derive(Debug, Error)]
#[error("No resource")]
struct NoResourceError;

pub fn init() -> Extension {
    Extension::builder()
        .ops(vec![
            ("aof_get_request", op_sync(op_get_request)),
            ("aof_set_response", op_sync(op_set_response)),
        ])
        .build()
}

fn op_get_request(
    state: &mut OpState,
    _args: Value,
    _data: Option<ZeroCopyBuf>,
) -> Result<Value, AnyError> {
    let ctx = state.script_ctx_arc().map_err(|()| NoResourceError)?;
    let request = ctx.get_aof_request();
    Ok(serde_json::to_value(request)?)
}

fn op_set_response(
    state: &mut OpState,
    args: Value,
    _data: Option<ZeroCopyBuf>,
) -> Result<Value, AnyError> {
    let ctx = state.script_ctx_arc().map_err(|()| NoResourceError)?;
    ctx.set_aof_response(args);
    Ok(serde_json::Value::Null)
}
