use crate::OpStateExt;
use deno_core::error::AnyError;
use deno_core::include_js_files;
use deno_core::serde_json::{self, Value};
use deno_core::url::{self, Url};
use deno_core::{op_sync, Extension, OpState, ZeroCopyBuf};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::{Duration, Instant};
use thiserror::Error;

const MIN_FETCH_TIME: Duration = Duration::from_millis(200);
pub const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.72 Safari/537.36";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

const MAX_RESPONSE_SIZE: usize = 256 * 1024 * 1024; // 256 MiB

pub fn init() -> Extension {
    Extension::builder()
        .ops(vec![("aof_fetch", op_sync(op_fetch))])
        .js(include_js_files! {
            prefix "deno:aof/fetch",
            "fetch.js",
        })
        .build()
}

#[derive(Debug, Error)]
enum FetchError {
    #[error("failed to acquire fetch resource")]
    NoResource,
    #[error("failed to read body")]
    NoBody,
    #[error("failed to parse url: {0}")]
    Url(url::ParseError),
    #[error("permission denied: {0}")]
    Permission(String),
    #[error("invalid http request method")]
    InvalidMethod,
    #[error("invalid redirect policy")]
    InvalidRedirectPolicy,
    #[error("response is too large")]
    ResponseTooLarge,
    #[error("request error: {0}")]
    Req(#[from] reqwest::Error),
}

enum RedirectPolicy {
    Follow,
    Error,
    Manual,
}

/// Implements the fetch operation. Note that this will block the thread!
fn op_fetch(
    state: &mut OpState,
    args: Value,
    data: Option<ZeroCopyBuf>,
) -> Result<Value, AnyError> {
    #[derive(Deserialize)]
    struct Args {
        url: String,
        method: String,
        headers: Vec<(String, String)>,
        redirect: String,
        referrer: String,
    }
    let args: Args = serde_json::from_value(args)?;
    let body = match data {
        Some(body) => body,
        None => Err(FetchError::NoBody)?,
    };

    let method = match &*args.method {
        "GET" => reqwest::Method::GET,
        "HEAD" => reqwest::Method::HEAD,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "TRACE" => reqwest::Method::TRACE,
        "DELETE" => reqwest::Method::DELETE,
        "OPTIONS" => reqwest::Method::OPTIONS,
        "CONNECT" => reqwest::Method::CONNECT,
        _ => Err(FetchError::InvalidMethod)?,
    };

    let redirect_policy = match &*args.redirect {
        "follow" => RedirectPolicy::Follow,
        "error" => RedirectPolicy::Error,
        "manual" => RedirectPolicy::Manual,
        _ => Err(FetchError::InvalidRedirectPolicy)?,
    };

    let guard = state.script_ctx_arc().map_err(|_| FetchError::NoResource)?;

    guard.fetch_did_start();

    let url = Url::parse(&args.url).map_err(FetchError::Url)?;
    guard
        .request_permission(&method, &url)
        .map_err(FetchError::Permission)?;

    let method2 = method.clone();
    let guard2 = Arc::clone(&**state.script_ctx_arc().map_err(|_| FetchError::NoResource)?);
    let redirect_count = Mutex::new(0);

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(match redirect_policy {
            RedirectPolicy::Follow => reqwest::redirect::Policy::custom(move |attempt| {
                let url = attempt.url();
                // FIXME: does the method stay the same upon redirect?
                match guard2.request_permission(&method2, &url) {
                    Ok(()) => {
                        let mut redirect_count = redirect_count.lock().unwrap();
                        *redirect_count += 1;
                        if *redirect_count < 10 {
                            attempt.follow()
                        } else {
                            attempt.stop()
                        }
                    }
                    Err(err) => attempt.error(err),
                }
            }),
            RedirectPolicy::Manual => reqwest::redirect::Policy::none(),
            RedirectPolicy::Error => reqwest::redirect::Policy::custom(|attempt| {
                attempt.error("redirect policy does not allow redirects")
            }),
        })
        .timeout(REQUEST_TIMEOUT)
        .build()?;

    let mut req = client.request(method, url);
    for (k, v) in args.headers {
        req = req.header(reqwest::header::HeaderName::from_bytes(k.as_bytes())?, v);
    }

    if !args.referrer.is_empty() {
        req = req.header("Referer", args.referrer);
    }

    if !body.is_empty() {
        req = req.body(body.as_ref().to_owned());
    }

    #[derive(Serialize)]
    struct Response {
        status: u16,
        status_text: String,
        url: String,
        redirected: bool,
        headers: Vec<(String, Vec<u8>)>,
        body: Vec<u8>,
    }

    async fn do_req(r: reqwest::RequestBuilder) -> Result<Response, FetchError> {
        use futures::StreamExt;

        let response = r.send().await?;
        if response
            .content_length()
            .map_or(false, |l| l > MAX_RESPONSE_SIZE as u64)
        {
            Err(FetchError::ResponseTooLarge)?;
        }

        let mut headers = Vec::new();
        for (k, v) in response.headers() {
            headers.push((k.to_string(), v.as_bytes().to_owned()));
        }

        let mut p_response = Response {
            status: response.status().as_u16(),
            status_text: response.status().to_string(),
            url: response.url().to_string(),
            redirected: false, // FIXME: reqwest response does not have this field
            headers,
            body: Vec::with_capacity(0),
        };

        let mut stream = response.bytes_stream();
        let mut res_len = 0;
        let mut chunks = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            res_len += chunk.len();
            if res_len > MAX_RESPONSE_SIZE {
                Err(FetchError::ResponseTooLarge)?;
            }
            chunks.push(chunk);
        }

        let mut res_buf = Vec::with_capacity(res_len);
        for chunk in chunks {
            res_buf.extend_from_slice(chunk.as_ref());
        }

        p_response.body = res_buf;

        Ok(p_response)
    }

    let end_time = Instant::now() + MIN_FETCH_TIME;

    let response = {
        let mut rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(do_req(req))?
    };

    if let Some(time_left) = end_time.checked_duration_since(Instant::now()) {
        sleep(time_left);
    }

    guard.fetch_did_end();

    Ok(serde_json::to_value(response)?)
}
