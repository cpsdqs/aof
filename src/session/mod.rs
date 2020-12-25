use crate::data::users::UserId;
use crate::session::protocol::RequestId;
use crate::State;
use actix::prelude::*;
use actix_web_actors::ws::{self, CloseCode, CloseReason};
use byteorder::WriteBytesExt;
use rand::Rng;
use std::io;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;

pub mod cookie;
pub mod protocol;
pub mod users;

/// Pings will be sent in this interval
const PING_INTERVAL: Duration = Duration::from_secs(30);

/// Time after a ping was sent before the connection will be closed if the client doesn't respond
const PING_TIMEOUT: Duration = Duration::from_secs(60);

/// Interval in which response chunks will be sent.
const CHUNK_SEND_INTERVAL: Duration = Duration::from_millis(100);

type PingMsg = [u8; 12];

type Ctx = ws::WebsocketContext<UserConn>;

/// User connection websocket handler.
pub struct UserConn {
    /// Peer address in an unspecified format.
    peer_addr: String,
    /// User actor address.
    user: Addr<users::User>,
    /// Currently pending ping message.
    pending_ping: Option<(Instant, PingMsg)>,
}

#[derive(Debug, Error)]
pub enum UserConnError {
    #[error(transparent)]
    Actix(#[from] actix::MailboxError),
}

impl UserConn {
    pub async fn new(
        peer_addr: String,
        user_id: UserId,
        state: Arc<State>,
    ) -> Result<Self, UserConnError> {
        let user = state
            .users()
            .send(users::UserManagerGetUser(Arc::clone(&state), user_id))
            .await?;

        Ok(Self {
            peer_addr,
            user,
            pending_ping: None,
        })
    }

    /// The connection's peer address in an unspecified format.
    pub fn peer_addr(&self) -> &str {
        &self.peer_addr
    }

    /// Closes the connection due to a protocol error.
    fn close_protocol_error(ctx: &mut Ctx, message: String) {
        let err = protocol::Event::ProtocolError { error: message };
        let mut msg = Vec::new();
        match err.write(&mut msg) {
            Ok(()) => ctx.binary(msg),
            Err(err) => warn!("Failed to serialize event: {}", err),
        }
        ctx.close(Some(CloseReason::from(CloseCode::Policy)));
        ctx.stop();
    }

    /// Receives a message from the client.
    fn recv_msg(&mut self, ctx: &mut Ctx, msg: &[u8]) {
        if msg.len() > protocol::MAX_MSG_SIZE {
            ctx.close(Some(CloseReason::from(CloseCode::Size)));
            ctx.stop();
            return;
        }

        match protocol::parse_message(io::Cursor::new(msg)) {
            Ok(msg) => {
                self.user.do_send(users::ConnMsg::Msg {
                    conn: ctx.address(),
                    message: msg,
                });
            }
            Err(err) => {
                Self::close_protocol_error(ctx, format!("{}", err));
            }
        }
    }

    /// Sends a ping.
    fn send_ping(&mut self, ctx: &mut Ctx) {
        // send a ping
        let mut ping_msg = PingMsg::default();
        rand::thread_rng().fill(&mut ping_msg);
        self.pending_ping = Some((Instant::now(), ping_msg));
        ctx.ping(&ping_msg);
    }

    /// Receives a pong message.
    fn recv_pong(&mut self, ctx: &mut Ctx, msg: &[u8]) {
        if let Some((_, ping_msg)) = self.pending_ping {
            if msg == ping_msg {
                // everything ok
                self.pending_ping = None;
            } else {
                info!(
                    "Got incorrect pong message from client {}; closing connection",
                    self.peer_addr()
                );
                Self::close_protocol_error(ctx, format!("Incorrect pong message"));
            }
        }
        // else: unexpected pong; ignore it
    }

    /// Called when client ping times out.
    fn ping_timed_out(&mut self, ctx: &mut Ctx) {
        ctx.stop();
    }

    /// Starts the ping loop, which periodically sends and checks for pings.
    fn ping_loop(&mut self, ctx: &mut Ctx) {
        ctx.run_interval(PING_INTERVAL, |conn, ctx| {
            if let Some((ping_time, _)) = &conn.pending_ping {
                // still waiting for a ping response, so don't send a ping yet
                if ping_time.elapsed() > PING_TIMEOUT {
                    // timed out!
                    conn.ping_timed_out(ctx);
                }

                return;
            }

            conn.send_ping(ctx);
        });
    }
}

impl Actor for UserConn {
    type Context = Ctx;

    fn started(&mut self, ctx: &mut Ctx) {
        self.user.do_send(users::SessionMsg::Add(ctx.address()));
        self.ping_loop(ctx);
    }

    fn stopping(&mut self, ctx: &mut Ctx) -> Running {
        self.user.do_send(users::SessionMsg::Remove(ctx.address()));
        Running::Stop
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for UserConn {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Ctx) {
        match msg {
            Ok(ws::Message::Ping(msg)) => ctx.pong(&msg),
            Ok(ws::Message::Pong(msg)) => self.recv_pong(ctx, &msg),
            Ok(ws::Message::Binary(msg)) => self.recv_msg(ctx, &msg),
            Ok(ws::Message::Close(reason)) => {
                ctx.close(reason);
                ctx.stop();
            }
            Ok(ws::Message::Text(_)) => {
                // text not supported
                ctx.close(Some(CloseReason::from(CloseCode::Unsupported)));
                ctx.stop();
            }
            Ok(ws::Message::Continuation(_)) => {
                // continuations not supported
                ctx.close(Some(CloseReason::from(CloseCode::Unsupported)));
                ctx.stop();
            }
            Ok(ws::Message::Nop) => (),
            Err(err) => {
                info!(
                    "Closing connection for client {} due to error: {}",
                    self.peer_addr(),
                    err
                );
                ctx.close(Some(CloseReason::from(CloseCode::Error)));
                ctx.stop();
            }
        }
    }
}

#[derive(Message)]
#[rtype(result = "()")]
enum UserConnMsg {
    Response {
        id: RequestId,
        data: protocol::Response,
    },
    ErrorResponse {
        id: RequestId,
    },
    Event {
        event: protocol::Event,
    },
    ForceStop,
}

impl Handler<UserConnMsg> for UserConn {
    type Result = ();
    fn handle(&mut self, msg: UserConnMsg, ctx: &mut Ctx) -> Self::Result {
        match msg {
            UserConnMsg::Response { id, data } => match data.encode(id) {
                Ok(encoded) => send_chunked_response(encoded, ctx),
                Err(err) => {
                    error!("Error encoding response for user request {}: {}", id, err);
                    ctx.address().do_send(UserConnMsg::ErrorResponse { id });
                }
            },
            UserConnMsg::ErrorResponse { id } => {
                let mut buf = Vec::new();
                buf.write_u8(protocol::MSG_TYPE_SERVER_ERR_RES).unwrap();
                buf.write_u32::<byteorder::BE>(id).unwrap();
                ctx.binary(buf);
            }
            UserConnMsg::Event { event } => {
                let mut buf = Vec::new();
                match event.write(&mut buf) {
                    Ok(()) => ctx.binary(buf),
                    Err(e) => {
                        error!("Failed to serialize event: {}", e);
                    }
                }
            }
            UserConnMsg::ForceStop => ctx.stop(),
        }
    }
}

/// Sends a single response chunk and calls itself recursively until the whole message is sent.
fn send_chunked_response(mut encoded: protocol::EncodedResponse, ctx: &mut Ctx) {
    let mut buf = Vec::new();
    match encoded.write_chunk(&mut buf) {
        Ok(done) => {
            ctx.binary(buf);
            if !done {
                ctx.run_later(CHUNK_SEND_INTERVAL, move |_, ctx| {
                    send_chunked_response(encoded, ctx);
                });
            }
        }
        Err(err) => {
            error!(
                "Error writing response for user request {}: {}",
                encoded.id(),
                err
            );
            ctx.address()
                .do_send(UserConnMsg::ErrorResponse { id: encoded.id() });
        }
    }
}
