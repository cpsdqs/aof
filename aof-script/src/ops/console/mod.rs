use crate::ScriptContext;
use deno_core::error::AnyError;
use deno_core::include_js_files;
use deno_core::{v8, Extension};
use serde::{Deserialize, Serialize};
use std::convert::TryFrom;
use std::fmt;
use std::sync::Arc;
use thiserror::Error;

#[derive(Debug, Error)]
enum InitErr {
    #[error("console is not an object")]
    ConsoleNotObj,
}

struct ConsoleState {
    ctx: Arc<dyn ScriptContext>,
}

pub fn init_rt(
    ctx: Arc<dyn ScriptContext>,
    global: v8::Local<v8::Object>,
    scope: &mut v8::HandleScope<v8::Context>,
) -> Result<(), AnyError> {
    scope.set_slot(ConsoleState { ctx });

    let console_key = v8::String::new(scope, "console").unwrap();
    let console = global.get(scope, console_key.into());

    let console_obj = match console {
        Some(obj) if obj.is_object() => obj.to_object(scope).ok_or(InitErr::ConsoleNotObj)?,
        _ => {
            let obj = v8::Object::new(scope);
            global.set(scope, console_key.into(), obj.into());
            obj
        }
    };

    let debug_key = v8::String::new(scope, "debug").unwrap();
    let error_key = v8::String::new(scope, "error").unwrap();
    let info_key = v8::String::new(scope, "info").unwrap();
    let log_key = v8::String::new(scope, "log").unwrap();
    let warn_key = v8::String::new(scope, "warn").unwrap();
    let trace_key = v8::String::new(scope, "trace").unwrap();

    let debug_tmpl = v8::FunctionTemplate::new(scope, console_debug);
    let debug_val = debug_tmpl.get_function(scope).unwrap();
    console_obj.set(scope, debug_key.into(), debug_val.into());

    let log_tmpl = v8::FunctionTemplate::new(scope, console_log);
    let log_val = log_tmpl.get_function(scope).unwrap();
    console_obj.set(scope, log_key.into(), log_val.into());

    let error_tmpl = v8::FunctionTemplate::new(scope, console_error);
    let error_val = error_tmpl.get_function(scope).unwrap();
    console_obj.set(scope, error_key.into(), error_val.into());

    let info_tmpl = v8::FunctionTemplate::new(scope, console_info);
    let info_val = info_tmpl.get_function(scope).unwrap();
    console_obj.set(scope, info_key.into(), info_val.into());

    let warn_tmpl = v8::FunctionTemplate::new(scope, console_warn);
    let warn_val = warn_tmpl.get_function(scope).unwrap();
    console_obj.set(scope, warn_key.into(), warn_val.into());

    let trace_tmpl = v8::FunctionTemplate::new(scope, console_trace);
    let trace_val = trace_tmpl.get_function(scope).unwrap();
    console_obj.set(scope, trace_key.into(), trace_val.into());

    Ok(())
}

pub fn init() -> Extension {
    Extension::builder()
        .js(include_js_files! {
            prefix "deno:aof/console",
            "console.js",
        })
        .build()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum MessageType {
    Debug,
    Error,
    Info,
    Log,
    Warn,
    Trace,
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ConsoleMessage {
    pub msg_type: MessageType,
    pub message: Vec<MsgFrag>,
}

impl fmt::Display for ConsoleMessage {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self.msg_type {
            MessageType::Debug => write!(f, "[DEBUG] ")?,
            MessageType::Error => write!(f, "[ERROR] ")?,
            MessageType::Info => write!(f, "[INFO] ")?,
            MessageType::Log => write!(f, "[LOG] ")?,
            MessageType::Warn => write!(f, "[WARN] ")?,
            MessageType::Trace => write!(f, "[TRACE] ")?,
            MessageType::Stdout => write!(f, "[STDOUT] ")?,
            MessageType::Stderr => write!(f, "[STDERR] ")?,
        }
        for frag in &self.message {
            write!(f, "{}", frag)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub enum MsgFrag {
    /// A top-level string argument
    Log(String),
    ClassName(String),
    ObjectStart,
    ErrorTrace(String),
    ObjectEnd,
    ArrayStart,
    ArrayEnd,
    ObjectMapsTo,
    ListSep,
    Truncated,
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Symbol(String),
    KeyString(String),
    KeySymbol(String),
    Circular,
    Function(String),
    Unknown,
    ArgSep,
}

impl fmt::Display for MsgFrag {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            MsgFrag::Log(str) => write!(f, "{}", str),
            MsgFrag::ClassName(str) => write!(f, "{} ", str),
            MsgFrag::ObjectStart => write!(f, "{{ "),
            MsgFrag::ErrorTrace(str) => write!(f, "{} ", str),
            MsgFrag::ObjectEnd => write!(f, " }}"),
            MsgFrag::ArrayStart => write!(f, "["),
            MsgFrag::ArrayEnd => write!(f, "]"),
            MsgFrag::ObjectMapsTo => write!(f, ": "),
            MsgFrag::ListSep => write!(f, ", "),
            MsgFrag::Truncated => write!(f, "..."),
            MsgFrag::Undefined => write!(f, "undefined"),
            MsgFrag::Null => write!(f, "null"),
            MsgFrag::Bool(b) => write!(f, "{}", b),
            MsgFrag::Number(num) => write!(f, "{}", num),
            MsgFrag::String(str) => write!(f, "{:?}", str),
            MsgFrag::Symbol(str) => write!(f, "Symbol({:?})", str),
            MsgFrag::KeyString(str) => write!(f, "{}", str),
            MsgFrag::KeySymbol(str) => write!(f, "[Symbol({:?})]", str),
            MsgFrag::Circular => write!(f, "[circular]"),
            MsgFrag::Function(str) => write!(f, "[function {}]", str),
            MsgFrag::Unknown => write!(f, "?"),
            MsgFrag::ArgSep => write!(f, " "),
        }
    }
}

// TODO: support typed arrays, maps, sets, class names, errors
fn obj_to_frag(
    scope: &mut v8::TryCatch<v8::HandleScope>,
    out: &mut Vec<MsgFrag>,
    depth: usize,
    obj: v8::Local<v8::Value>,
) {
    if depth > 5 {
        out.push(MsgFrag::Truncated);
        return;
    }

    if obj.is_undefined() {
        out.push(MsgFrag::Undefined);
    } else if obj.is_null() {
        out.push(MsgFrag::Null);
    } else if obj.is_number() {
        out.push(MsgFrag::Number(
            obj.number_value(scope).unwrap_or(std::f64::NAN),
        ));
    } else if obj.is_string() {
        out.push(MsgFrag::String(
            obj.to_string(scope)
                .map(|s| s.to_rust_string_lossy(scope))
                .unwrap_or_else(|| String::from("??")),
        ));
    } else if obj.is_symbol() {
        // TODO: get symbol description
        out.push(MsgFrag::Symbol(String::from("??")));
    } else if obj.is_boolean() {
        out.push(MsgFrag::Bool(obj.boolean_value(scope)));
    } else if obj.is_function() {
        let mut fn_name = String::from("anonymous");
        let name_key = v8::String::new(scope, "name").unwrap();
        if let Ok(fun) = v8::Local::<v8::Function>::try_from(obj) {
            if let Some(name) = fun
                .get(scope, name_key.into())
                .map_or(None, |s| s.to_string(scope))
            {
                fn_name = name.to_rust_string_lossy(scope);
            }
        }
        out.push(MsgFrag::Function(fn_name));
    } else if obj.is_array() {
        out.push(MsgFrag::ArrayStart);
        match v8::Local::<v8::Array>::try_from(obj) {
            Ok(arr) => {
                let mut is_first = true;
                for i in 0..arr.length().min(100) {
                    if is_first {
                        is_first = false;
                    } else {
                        out.push(MsgFrag::ListSep);
                    }

                    if arr.has_index(scope, i).unwrap_or(false) {
                        if let Some(item) = arr.get_index(scope, i) {
                            obj_to_frag(scope, out, depth + 1, item);
                        }
                    }
                }
                if arr.length() > 100 {
                    out.push(MsgFrag::ListSep);
                    out.push(MsgFrag::Truncated);
                }
            }
            Err(_) => out.push(MsgFrag::Unknown),
        }
        out.push(MsgFrag::ArrayEnd);
    } else if obj.is_object() {
        match v8::Local::<v8::Object>::try_from(obj) {
            Ok(obj) => {
                let mut is_error = false;

                let constructor_key = v8::String::new(scope, "constructor").unwrap();
                if let Some(constructor) = obj.get(scope, constructor_key.into()) {
                    if let Ok(fun) = v8::Local::<v8::Function>::try_from(constructor) {
                        let name_key = v8::String::new(scope, "name").unwrap();
                        if let Some(name) = fun
                            .get(scope, name_key.into())
                            .map_or(None, |s| s.to_string(scope))
                        {
                            let name = name.to_rust_string_lossy(scope);
                            if name != "Object" {
                                out.push(MsgFrag::ClassName(name));
                            }
                        }
                    }

                    if let Some(constructor) = constructor.to_object(scope) {
                        let error_key = v8::String::new(scope, "Error").unwrap();
                        if let Some(error_class) = scope
                            .get_current_context()
                            .global(scope)
                            .get(scope, error_key.into())
                        {
                            let mut cursor = constructor;
                            for _ in 0..32 {
                                if cursor == error_class {
                                    is_error = true;
                                    break;
                                }

                                if let Some(proto) = cursor.get_prototype(scope) {
                                    if proto == error_class {
                                        is_error = true;
                                    } else if let Some(proto) = proto.to_object(scope) {
                                        cursor = proto;
                                        continue;
                                    }
                                }
                                break;
                            }
                        }
                    }
                }

                out.push(MsgFrag::ObjectStart);

                if is_error {
                    let stack_key = v8::String::new(scope, "stack").unwrap();
                    if let Some(stack) = obj
                        .get(scope, stack_key.into())
                        .map_or(None, |s| s.to_string(scope))
                    {
                        out.push(MsgFrag::ErrorTrace(stack.to_rust_string_lossy(scope)));
                    }
                }

                if let Some(prop_names) = obj.get_property_names(scope) {
                    let mut is_first = true;
                    for i in 0..prop_names.length().min(100) {
                        if is_first {
                            is_first = false;
                        } else {
                            out.push(MsgFrag::ListSep);
                        }

                        if let Some(item) = prop_names.get_index(scope, i) {
                            if item.is_string() {
                                out.push(MsgFrag::KeyString(
                                    item.to_string(scope)
                                        .map(|s| s.to_rust_string_lossy(scope))
                                        .unwrap_or_else(|| String::from("??")),
                                ));
                            } else if item.is_symbol() {
                                // TODO: get symbol description
                                let mut sym_name = String::new();
                                let desc_key = v8::String::new(scope, "description").unwrap();
                                if let Some(desc) = item
                                    .to_object(scope)
                                    .map_or(None, |o| o.get(scope, desc_key.into()))
                                    .map_or(None, |s| s.to_string(scope))
                                {
                                    sym_name = desc.to_rust_string_lossy(scope);
                                }
                                out.push(MsgFrag::KeySymbol(sym_name));
                            } else {
                                obj_to_frag(scope, out, depth + 1, item);
                            }
                            out.push(MsgFrag::ObjectMapsTo);
                            if let Some(value) = obj.get(scope, item) {
                                obj_to_frag(scope, out, depth + 1, value);
                            }
                        }
                    }
                    if prop_names.length() > 100 {
                        out.push(MsgFrag::ListSep);
                        out.push(MsgFrag::Truncated);
                    }
                } else {
                    out.push(MsgFrag::ObjectStart);
                    out.push(MsgFrag::Unknown);
                }
            }
            Err(_) => {
                out.push(MsgFrag::ObjectStart);
                out.push(MsgFrag::Unknown)
            }
        }
        out.push(MsgFrag::ObjectEnd);
    } else {
        out.push(MsgFrag::Unknown);
    }
}

fn arg_to_frag<'a, 'b>(
    scope: &'a mut v8::TryCatch<v8::HandleScope<'b>>,
    out: &'a mut Vec<MsgFrag>,
    arg: v8::Local<v8::Value>,
) {
    if arg.is_string() {
        out.push(MsgFrag::Log(
            arg.to_string(scope)
                .map(|s| s.to_rust_string_lossy(scope))
                .unwrap_or_else(|| String::from("??")),
        ));
    } else {
        obj_to_frag(scope, out, 0, arg);
    }
}

fn console_msg(ty: MessageType, scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments) {
    let tc_scope = &mut v8::TryCatch::new(scope);

    let mut message = Vec::new();
    for i in 0..args.length() {
        if i != 0 {
            message.push(MsgFrag::ArgSep);
        }
        arg_to_frag(tc_scope, &mut message, args.get(i));
    }
    let state = tc_scope.get_slot::<ConsoleState>().unwrap();
    state.ctx.on_console_message(ConsoleMessage {
        msg_type: ty,
        message,
    });
}

fn console_debug(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _ret: v8::ReturnValue,
) {
    console_msg(MessageType::Debug, scope, args);
}

fn console_log(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _ret: v8::ReturnValue,
) {
    console_msg(MessageType::Log, scope, args);
}

fn console_error(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _ret: v8::ReturnValue,
) {
    console_msg(MessageType::Error, scope, args);
}

fn console_info(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _ret: v8::ReturnValue,
) {
    console_msg(MessageType::Info, scope, args);
}

fn console_warn(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _ret: v8::ReturnValue,
) {
    console_msg(MessageType::Warn, scope, args);
}

fn console_trace(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _ret: v8::ReturnValue,
) {
    // TODO: get trace
    console_msg(MessageType::Trace, scope, args);
}
