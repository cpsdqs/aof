use aof_script::console::{ConsoleMessage, MessageType, MsgFrag};
use aof_script::reqwest;
use aof_script::url::{self, Url};
use aof_script::{AofRequest, InnerScript, ScriptContext};
use ipc_channel::ipc::{IpcOneShotServer, IpcReceiver, IpcSender};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::io::Read;
use std::net::{SocketAddr, ToSocketAddrs};
use std::rc::Rc;
use std::thread;
use std::time::{Duration, Instant};
use thiserror::Error;

const SCRIPT_EXEC_TIME: Duration = Duration::from_secs(6);
const MONITOR_SLEEP_TIME: Duration = Duration::from_millis(50);
const MONITOR_EXIT_WAIT_TIME: Duration = Duration::from_millis(50);

#[derive(Debug, Error, Deserialize, Serialize)]
pub enum ScriptError {
    #[error("script execution took too long (infinite loop?)")]
    Timeout,
    #[error("script ended without result")]
    NoResult,
    #[error("fatal: {0}")]
    Fatal(String),
    #[error("script execution error: {0}")]
    Exec(String),
}

/// Inner struct for time metrics in a fetch context.
struct FetchTimeMetrics {
    start_time: Instant,
    fetch_time: Duration,
    current_fetch_start: Option<Instant>,
}

/// Time since beginning.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FetchTime {
    /// Real elapsed time.
    pub real: Duration,
    /// Time spent executing the script itself.
    pub script: Duration,
    /// Time spent fetching data.
    pub fetch: Duration,
}

/// Console message with optional timestamp.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FetchMsg {
    pub time: Option<FetchTime>,
    pub msg: ConsoleMessage,
}

impl FetchTimeMetrics {
    /// Returns the current time in the fetch context.
    fn get_time(&self) -> FetchTime {
        let real = self.start_time.elapsed();
        // FIXME: use when stable
        // let script = real.saturating_sub(self.fetch_time);
        let script = real
            .checked_sub(self.fetch_time)
            .unwrap_or(Duration::from_secs(0));
        let fetch = self.fetch_time;

        FetchTime {
            real,
            script,
            fetch,
        }
    }
}

/// ScriptContext implementor.
struct FetchContext {
    request: AofRequest,
    sender: IpcSender<ScriptMsg>,
    msg_sender: IpcSender<FetchMsg>,
    time: RefCell<FetchTimeMetrics>,
}

impl FetchContext {
    fn new(request: AofRequest, send: IpcSender<ScriptMsg>, msg_send: IpcSender<FetchMsg>) -> Self {
        FetchContext {
            request,
            sender: send,
            msg_sender: msg_send,
            time: RefCell::new(FetchTimeMetrics {
                start_time: Instant::now(),
                fetch_time: Duration::from_secs(0),
                current_fetch_start: None,
            }),
        }
    }
}

// FIXME: delete when is_global is stable
trait IpExt {
    fn is_global(&self) -> bool;
}
impl IpExt for std::net::Ipv4Addr {
    fn is_global(&self) -> bool {
        // crude approximation
        !self.is_loopback()
            && !self.is_private()
            && !self.is_link_local()
            && !self.is_multicast()
            && !self.is_broadcast()
    }
}
impl IpExt for std::net::Ipv6Addr {
    fn is_global(&self) -> bool {
        // cruder approximation
        !self.is_loopback() && !self.is_multicast()
    }
}

fn add_fake_port(s: &str) -> String {
    let mut s = String::from(s);
    s += ":443";
    s
}

pub fn request_fetch_permission<F>(url: &Url, on_direct_ip_access: F) -> Result<(), String>
where
    F: FnOnce(std::net::IpAddr),
{
    match url.scheme() {
        "http" | "https" => match url.host() {
            Some(url::Host::Domain(domain)) => match add_fake_port(domain).to_socket_addrs() {
                Ok(addrs) => {
                    for addr in addrs {
                        let is_global = match addr {
                            SocketAddr::V4(addr) => IpExt::is_global(addr.ip()),
                            SocketAddr::V6(addr) => IpExt::is_global(addr.ip()),
                        };
                        if !is_global {
                            return Err(format!(
                                "error resolving host {:?}: accessing {:?} is not allowed",
                                domain,
                                match addr {
                                    SocketAddr::V4(addr) => addr.ip().to_string(),
                                    SocketAddr::V6(addr) => addr.ip().to_string(),
                                }
                            ));
                        }
                    }
                    Ok(())
                }
                Err(err) => Err(format!("could not resolve host {:?}: {}", domain, err)),
            },
            Some(url::Host::Ipv4(addr)) => {
                if !IpExt::is_global(&addr) {
                    Err(format!("accessing {:?} is not allowed", addr))
                } else {
                    on_direct_ip_access(std::net::IpAddr::V4(addr));
                    Ok(())
                }
            }
            Some(url::Host::Ipv6(addr)) => {
                if !IpExt::is_global(&addr) {
                    Err(format!("accessing {:?} is not allowed", addr))
                } else {
                    on_direct_ip_access(std::net::IpAddr::V6(addr));
                    Ok(())
                }
            }
            None => Err(format!("URL has no host")),
        },
        scheme => Err(format!("URL scheme {:?} not allowed", scheme)),
    }
}

impl ScriptContext for FetchContext {
    fn request_permission(&self, _method: &reqwest::Method, url: &Url) -> Result<(), String> {
        request_fetch_permission(url, |addr| {
            self.msg_sender
                .send(FetchMsg {
                    time: Some(self.time.borrow().get_time()),
                    msg: ConsoleMessage {
                        msg_type: MessageType::Warn,
                        message: vec![MsgFrag::Log(format!(
                            "Direct access of ip address {:?}",
                            addr
                        ))],
                    },
                })
                .unwrap();
        })
    }

    fn fetch_did_start(&self) {
        let mut time = self.time.borrow_mut();
        time.current_fetch_start = Some(Instant::now());

        self.sender.send(ScriptMsg::PauseTimer).unwrap();
    }
    fn fetch_did_end(&self) {
        let mut time = self.time.borrow_mut();
        let start = time
            .current_fetch_start
            .take()
            .expect("fetch ended without starting");
        time.fetch_time += start.elapsed();

        self.sender.send(ScriptMsg::ContinueTimer).unwrap();
    }

    fn on_console_message(&self, msg: ConsoleMessage) {
        let time = self.time.borrow().get_time();

        self.msg_sender
            .send(FetchMsg {
                time: Some(time),
                msg,
            })
            .unwrap();
    }

    fn get_aof_request(&self) -> AofRequest {
        self.request.clone()
    }

    fn set_aof_response(&self, data: Value) {
        self.sender
            .send(ScriptMsg::Result(serde_json::to_string(&data).unwrap()))
            .unwrap();
    }
}

#[derive(Serialize, Deserialize)]
pub enum Fetch {
    Source {
        domain: String,
        script: String,
        path: String,
    },
    SourceItem {
        domain: String,
        script: String,
        path: String,
    },
}

#[derive(Serialize, Deserialize)]
enum ScriptMsg {
    PauseTimer,
    ContinueTimer,
    FatalError(String),
    ErrResult(ScriptError),
    Result(String),
    Done,
}

async fn run_inner_request(
    request: Fetch,
    send: IpcSender<ScriptMsg>,
    msg_send: IpcSender<FetchMsg>,
) -> Result<(), ScriptError> {
    let (request, domain, script) = match request {
        Fetch::Source {
            domain,
            script,
            path,
        } => (AofRequest::Source { path }, domain, script),
        Fetch::SourceItem {
            domain,
            script,
            path,
        } => (AofRequest::SourceItem { path }, domain, script),
    };

    let ctx = Rc::new(FetchContext::new(request, send, msg_send));
    let mut script = InnerScript::create(ctx, &domain, &script)
        .map_err(|e| ScriptError::Exec(format!("{}", e)))?;
    script
        .run()
        .await
        .map_err(|e| ScriptError::Exec(format!("{}", e)))?;
    Ok(())
}

pub fn run_ipc_fork(ipc_server_name: &str) {
    // HACK: do this in a new thread because the new tokio runtime conflicts with the existing one
    // FIXME: don't do this
    let ipc_server_name = ipc_server_name.to_string();
    thread::spawn(|| {
        let oneshot_send = IpcSender::connect(ipc_server_name).unwrap();
        let (msg_send, msg_recv) = ipc_channel::ipc::channel().unwrap();
        let (send, recv) = ipc_channel::ipc::channel().unwrap();
        let (req_send, req_recv) = ipc_channel::ipc::channel().unwrap();
        oneshot_send.send((req_send, recv, msg_recv)).unwrap();

        let request = req_recv.recv().unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(run_inner_request(request, send.clone(), msg_send));

        if let Err(err) = res {
            send.send(ScriptMsg::ErrResult(err)).unwrap();
        }
        send.send(ScriptMsg::Done).unwrap();
    })
    .join()
    .unwrap();
}

pub fn run_request(request: Fetch, messages: &mut Vec<FetchMsg>) -> Result<Value, ScriptError> {
    let (ipc_server, ipc_server_name) = IpcOneShotServer::<(
        IpcSender<Fetch>,
        IpcReceiver<ScriptMsg>,
        IpcReceiver<FetchMsg>,
    )>::new()
    .map_err(|e| ScriptError::Fatal(format!("failed to open IPC server: {}", e)))?;
    let mut child_pid = {
        use std::process::{Command, Stdio};

        let bin_path = std::env::current_exe().map_err(|_| {
            ScriptError::Fatal("failed to fork: could not find current executable".into())
        })?;
        Command::new(bin_path)
            .args(&["--fetcher-ipc-fork", &ipc_server_name])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| ScriptError::Fatal(format!("failed to spawn child: {}", e)))?
    };

    let (_, (req_send, recv, msg_recv)) = ipc_server
        .accept()
        .map_err(|e| ScriptError::Fatal(format!("Could not accept IPC connection: {}", e)))?;

    req_send
        .send(request)
        .map_err(|e| ScriptError::Fatal(format!("failed to send request: {}", e)))?;

    macro_rules! drain_messages {
        () => {
            loop {
                match msg_recv.try_recv() {
                    Ok(msg) => messages.push(msg),
                    Err(_) => break,
                }
            }
        };
    }

    let (_recv, result) = {
        let mut time_left = SCRIPT_EXEC_TIME;
        let mut timer_running = true;
        let mut cycle_start = Instant::now();
        let result = loop {
            thread::sleep(MONITOR_SLEEP_TIME);

            if timer_running {
                let elapsed = cycle_start.elapsed();
                if elapsed >= time_left {
                    break Err(ScriptError::Timeout);
                } else {
                    time_left -= elapsed;
                }
            }
            cycle_start = Instant::now();

            drain_messages!();

            match recv.try_recv() {
                Ok(ScriptMsg::PauseTimer) => {
                    timer_running = false;
                }
                Ok(ScriptMsg::ContinueTimer) => {
                    timer_running = true;
                }
                Ok(ScriptMsg::Result(result)) => match serde_json::from_str(&result) {
                    Ok(result) => break Ok(result),
                    Err(err) => {
                        break Err(ScriptError::Fatal(format!(
                            "Failed to deserialize result: {}",
                            err
                        )))
                    }
                },
                Ok(ScriptMsg::ErrResult(err)) => {
                    break Err(err);
                }
                Ok(ScriptMsg::FatalError(error)) => {
                    break Err(ScriptError::Fatal(error));
                }
                Ok(ScriptMsg::Done) => {
                    break Err(ScriptError::NoResult);
                }
                Err(ipc_channel::ipc::TryRecvError::Empty) => (),
                Err(e) => break Err(ScriptError::Fatal(format!("IPC channel error: {:?}", e))),
            }
        };

        thread::sleep(MONITOR_EXIT_WAIT_TIME);

        (recv, result)
    };

    let script_status = child_pid
        .try_wait()
        .map_err(|e| ScriptError::Fatal(format!("failed to wait for child: {}", e)))?;
    if script_status.is_none() {
        debug!("Killing fetcher because it's out of time");
        let result = child_pid.kill();
        if let Err(e) = result {
            match e.kind() {
                std::io::ErrorKind::InvalidInput => (),
                _ => {
                    error!("Failed to kill fetcher: {}", e);
                }
            }
        }
    }

    child_pid
        .wait()
        .map_err(|e| ScriptError::Fatal(format!("failed to wait for child: {}", e)))?;

    drain_messages!();

    let mut stdout = child_pid.stdout.take().unwrap();
    let mut stderr = child_pid.stderr.take().unwrap();
    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    stdout
        .read_to_end(&mut stdout_buf)
        .map_err(|e| ScriptError::Fatal(format!("failed to read child stdout: {}", e)))?;
    stderr
        .read_to_end(&mut stderr_buf)
        .map_err(|e| ScriptError::Fatal(format!("failed to read child stderr: {}", e)))?;
    let stdout = String::from_utf8_lossy(&stdout_buf).to_string();
    let stderr = String::from_utf8_lossy(&stderr_buf).to_string();

    if !stdout.is_empty() {
        messages.push(FetchMsg {
            time: None,
            msg: ConsoleMessage {
                msg_type: MessageType::Stdout,
                message: vec![MsgFrag::Log(stdout)],
            },
        });
    }

    if !stderr.is_empty() {
        messages.push(FetchMsg {
            time: None,
            msg: ConsoleMessage {
                msg_type: MessageType::Stderr,
                message: vec![MsgFrag::Log(stderr)],
            },
        });
    }

    result
}
