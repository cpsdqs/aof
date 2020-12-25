use crate::OpStateExt;
use deno_core::error::AnyError;
use deno_core::serde_json::{self, Value};
use deno_core::{json_op_sync, JsRuntime, OpState, ZeroCopyBuf};
use thiserror::Error;

#[derive(Debug, Error)]
#[error("No resource")]
struct NoResourceError;

pub fn init(rt: &mut JsRuntime) -> Result<(), AnyError> {
    rt.register_op("aof_get_request", json_op_sync(op_get_request));
    rt.register_op("aof_set_response", json_op_sync(op_set_response));
    Ok(())
}

fn op_get_request(
    state: &mut OpState,
    _args: Value,
    _data: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let ctx = state.script_ctx().map_err(|()| NoResourceError)?;
    let request = ctx.get_aof_request();
    Ok(serde_json::to_value(request)?)
}

fn op_set_response(
    state: &mut OpState,
    args: Value,
    _data: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let ctx = state.script_ctx().map_err(|()| NoResourceError)?;
    ctx.set_aof_response(args);
    Ok(serde_json::Value::Null)
}
