use deno_core::error::AnyError;
use deno_core::serde_json::Value;
use deno_core::{json_op_sync, JsRuntime, OpState, ZeroCopyBuf};
use deno_dom_core::parse as parse_rs;
use deno_dom_core::parse_frag as parse_frag_rs;

pub fn init(rt: &mut JsRuntime) -> Result<(), AnyError> {
    rt.register_op("denoDomParseSync", json_op_sync(op_parse));
    rt.register_op("denoDomParseFragSync", json_op_sync(op_parse_frag));
    rt.execute("deno_dom.js", include_str!("../deno-dom-js/deno_dom.js"))?;
    Ok(())
}

fn op_parse(_: &mut OpState, _: Value, data: &mut [ZeroCopyBuf]) -> Result<Value, AnyError> {
    let data_str = std::str::from_utf8(&data[0][..]).unwrap();
    let result = parse_rs(data_str.into());
    Ok(Value::String(result))
}

fn op_parse_frag(_: &mut OpState, _: Value, data: &mut [ZeroCopyBuf]) -> Result<Value, AnyError> {
    let data_str = std::str::from_utf8(&data[0][..]).unwrap();
    let result = parse_frag_rs(data_str.into());
    Ok(Value::String(result))
}
