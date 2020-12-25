use crate::data;
use crate::data::domains::UpdateDomainError;
use crate::data::sources::{canonicalize_uri, SubscribeError};
use crate::data::users::{ModifyUserError, UserAuthError, UserId};
use crate::data::DataError;
use crate::fetcher::FetchRequest;
use crate::session::protocol::{
    self, ClientMsg, Request, RequestId, Response, SimpleResult, UserCreateDomainResult,
};
use crate::session::{UserConn, UserConnMsg};
use crate::state::State;
use actix::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;

/// Manages user actors.
pub struct UserManager {
    users: HashMap<UserId, Addr<User>>,
}

impl UserManager {
    pub fn new(_: &mut Context<Self>) -> Self {
        UserManager {
            users: HashMap::new(),
        }
    }
}

impl Actor for UserManager {
    type Context = Context<Self>;
}

/// Gets a User actor, creating one if needed.
#[derive(Message)]
#[rtype(result = "Addr<User>")]
pub struct UserManagerGetUser(pub Arc<State>, pub UserId);

impl Handler<UserManagerGetUser> for UserManager {
    type Result = Addr<User>;

    fn handle(&mut self, msg: UserManagerGetUser, ctx: &mut Context<Self>) -> Self::Result {
        let UserManagerGetUser(state, uid) = msg;
        if let Some(addr) = self.users.get(&uid) {
            addr.clone()
        } else {
            let self_addr = ctx.address();
            debug!(
                "User manager: user {} does not have an actor; creating",
                uid
            );
            let addr = User::create(|_| User::new(state, self_addr, uid));
            self.users.insert(uid, addr.clone());
            addr
        }
    }
}

#[derive(Message)]
#[rtype(result = "()")]
enum UserMgrMsg {
    Stopped(UserId),
}
impl Handler<UserMgrMsg> for UserManager {
    type Result = ();
    fn handle(&mut self, msg: UserMgrMsg, _: &mut Context<Self>) -> Self::Result {
        match msg {
            UserMgrMsg::Stopped(uid) => {
                debug!("User manager: removing user {}", uid);
                self.users.remove(&uid);
            }
        }
    }
}

#[derive(Message)]
#[rtype(result = "()")]
pub struct UserMgrDispatchEvent(pub UserId, pub DispatchUserEvent);

impl Handler<UserMgrDispatchEvent> for UserManager {
    type Result = ();
    fn handle(&mut self, msg: UserMgrDispatchEvent, _: &mut Context<Self>) -> Self::Result {
        let UserMgrDispatchEvent(uid, evt) = msg;
        if let Some(user) = self.users.get(&uid) {
            user.do_send(evt);
        }
    }
}

/// An active user. There can be at most one per user account.
pub struct User {
    state: Arc<State>,
    user_id: UserId,
    user_mgr: Addr<UserManager>,
    conns: HashMap<Addr<UserConn>, Instant>,
}

impl User {
    fn new(state: Arc<State>, user_mgr: Addr<UserManager>, user_id: UserId) -> Self {
        User {
            state,
            user_id,
            user_mgr,
            conns: HashMap::new(),
        }
    }

    fn handle_client_message(
        &self,
        conn: Addr<UserConn>,
        ctx: &mut Context<Self>,
        message: ClientMsg,
    ) {
        match message {
            ClientMsg::Request(id, req) => {
                if let Err(err) = self.handle_client_request(conn.clone(), ctx, id, req) {
                    error!("Error handling client request: {}", err);
                    conn.do_send(UserConnMsg::ErrorResponse { id });
                }
            }
        }
    }

    fn handle_client_request(
        &self,
        conn: Addr<UserConn>,
        _ctx: &mut Context<Self>,
        id: RequestId,
        req: Request,
    ) -> Result<(), RequestError> {
        let data = self.state.data().lock();
        let user = match data.user(self.user_id)? {
            Some(user) => user,
            None => {
                // user doesn't exist; close the connection
                conn.do_send(UserConnMsg::ForceStop);
                return Ok(());
            }
        };

        match req {
            Request::UserClientKey => {
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserClientKey(user.client_key().to_owned()),
                });
                Ok(())
            }
            Request::UserSecretKey => {
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserSecretKey(user.secret_key().to_owned()),
                });
                Ok(())
            }
            Request::UserTokens => {
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserTokens(user.tokens()),
                });
                Ok(())
            }
            Request::UserChangeName { new_name } => {
                let res = match data.change_user_name(&user, &new_name) {
                    Ok(()) => SimpleResult::Ok,
                    Err(ModifyUserError::NameTaken) => SimpleResult::Err {
                        error: "name_taken",
                    },
                    Err(ModifyUserError::InvalidName) => SimpleResult::Err {
                        error: "invalid_name",
                    },
                    Err(err) => {
                        error!("Error changing user name: {}", err);
                        SimpleResult::Err {
                            error: "internal_error",
                        }
                    }
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserChangeName(res),
                });
                Ok(())
            }
            Request::UserChangePassword {
                password,
                new_password,
            } => {
                let res = if user.auth(&password)? {
                    match data.change_user_password(&user, &new_password) {
                        Ok(()) => SimpleResult::Ok,
                        Err(err) => {
                            error!("Error changing user password: {}", err);
                            SimpleResult::Err {
                                error: "internal_error",
                            }
                        }
                    }
                } else {
                    SimpleResult::Err { error: "invalid" }
                };

                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserChangePassword(res),
                });
                Ok(())
            }
            Request::UserChangeSecretKey {
                password,
                new_secret_key,
            } => {
                let res = if user.auth(&password)? {
                    match data.change_user_secret_key(&user, &new_secret_key) {
                        Ok(()) => SimpleResult::Ok,
                        Err(err) => {
                            error!("Error changing user secret key: {}", err);
                            SimpleResult::Err {
                                error: "internal_error",
                            }
                        }
                    }
                } else {
                    SimpleResult::Err { error: "invalid" }
                };

                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserChangeSecretKey(res),
                });
                Ok(())
            }
            Request::UserDelete { password } => {
                let res = if user.auth(&password)? {
                    info!("Deleting user {} on user request", user.id());
                    match data.delete_user(user.id()) {
                        Ok(()) => SimpleResult::Ok,
                        Err(err) => {
                            error!("Failed to delete user {}: {}", user.id(), err);
                            SimpleResult::Err {
                                error: "internal_error",
                            }
                        }
                    }
                } else {
                    SimpleResult::Err { error: "invalid" }
                };

                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserDelete(res),
                });
                conn.do_send(UserConnMsg::ForceStop);
                Ok(())
            }
            Request::UserRegenClientKey => {
                data.user_regen_client_key(&user)?;
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserRegenClientKey(()),
                });
                Ok(())
            }

            Request::UserDomains => {
                let ids = data.user_full_domain_ids(user.id())?;
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserDomains(ids),
                });
                Ok(())
            }
            Request::PublicDomains => {
                let ids = data.public_domain_ids()?;
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserDomains(ids),
                });
                Ok(())
            }
            Request::Domain { id: domain_id } => {
                let res = if let Some(domain) = data.domain_by_domain_id(&domain_id)? {
                    Some(protocol::ResponseDomain {
                        abbrev: domain.abbrev().into(),
                        name: domain.name().into(),
                        description: domain.description().into(),
                        is_public: domain.is_public().into(),
                        editable: domain.owner_id() == user.id(),
                    })
                } else {
                    None
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::Domain(res),
                });
                Ok(())
            }
            Request::DomainScript { id: domain_id } => {
                let res = if let Some(domain) = data.domain_by_domain_id(&domain_id)? {
                    protocol::DomainScriptResult {
                        success: true,
                        script: Some(domain.script().into()),
                        error: None,
                    }
                } else {
                    protocol::DomainScriptResult {
                        success: false,
                        script: None,
                        error: Some("not_found"),
                    }
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::DomainScript(res),
                });
                Ok(())
            }
            Request::UserCreateDomain { abbrev, name } => {
                let res = match data.create_domain(user.id(), &abbrev, &name) {
                    Ok(id) => UserCreateDomainResult {
                        success: true,
                        id,
                        error: "",
                    },
                    Err(UpdateDomainError::AbbrevTooShort) => UserCreateDomainResult {
                        success: false,
                        id: "".into(),
                        error: "abbrev_too_short",
                    },
                    Err(UpdateDomainError::AbbrevTooLong) => UserCreateDomainResult {
                        success: false,
                        id: "".into(),
                        error: "abbrev_too_long",
                    },
                    Err(UpdateDomainError::NameTooShort) => UserCreateDomainResult {
                        success: false,
                        id: "".into(),
                        error: "name_too_short",
                    },
                    Err(UpdateDomainError::NameTooLong) => UserCreateDomainResult {
                        success: false,
                        id: "".into(),
                        error: "name_too_long",
                    },
                    Err(UpdateDomainError::Data(err)) => Err(err)?,
                    Err(_) => Err(RequestError::InternalError)?,
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserCreateDomain(res),
                });
                Ok(())
            }
            Request::UserUpdateDomain {
                id: d_id,
                abbrev,
                name,
                description,
                is_public,
                script,
            } => {
                let res = if let Some(mut domain) = data.domain_by_domain_id(&d_id)? {
                    if domain.owner_id() == user.id() {
                        match domain.update(&*data, abbrev, name, description, is_public, script) {
                            Ok(()) => SimpleResult::Ok,
                            Err(UpdateDomainError::AbbrevTooShort) => SimpleResult::Err {
                                error: "abbrev_too_short",
                            },
                            Err(UpdateDomainError::AbbrevTooLong) => SimpleResult::Err {
                                error: "abbrev_too_long",
                            },
                            Err(UpdateDomainError::NameTooShort) => SimpleResult::Err {
                                error: "name_too_short",
                            },
                            Err(UpdateDomainError::NameTooLong) => SimpleResult::Err {
                                error: "name_too_long",
                            },
                            Err(UpdateDomainError::DescriptionTooLong) => SimpleResult::Err {
                                error: "description_too_long",
                            },
                            Err(UpdateDomainError::ScriptTooLong) => SimpleResult::Err {
                                error: "script_too_long",
                            },
                            Err(UpdateDomainError::Data(err)) => Err(err)?,
                        }
                    } else {
                        SimpleResult::Err { error: "forbidden" }
                    }
                } else {
                    SimpleResult::Err { error: "not_found" }
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserUpdateDomain(res),
                });
                // TODO: emit events
                Ok(())
            }
            Request::UserDeleteDomain { id: d_id } => {
                let res = if let Some(domain) = data.domain_by_domain_id(&d_id)? {
                    if domain.owner_id() == user.id() {
                        data.delete_domain(&domain)?;
                        SimpleResult::Ok
                    } else {
                        SimpleResult::Err { error: "forbidden" }
                    }
                } else {
                    SimpleResult::Err { error: "not_found" }
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserDeleteDomain(res),
                });
                // TODO: emit events
                Ok(())
            }
            Request::UserSubscribeDomain { id: domain_id } => {
                let res = if let Some(domain) = data.domain_by_domain_id(&domain_id)? {
                    if domain.owner_id() == user.id() {
                        SimpleResult::Err { error: "is_owner" }
                    } else if data.is_user_subscribed(user.id(), &domain)? {
                        SimpleResult::Err {
                            error: "already_subscribed",
                        }
                    } else {
                        data.user_subscribe_domain(user.id(), &domain)?;
                        SimpleResult::Ok
                    }
                } else {
                    SimpleResult::Err { error: "not_found" }
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserSubscribeDomain(res),
                });
                // TODO: emit events
                Ok(())
            }
            Request::UserUnsubscribeDomain { id: domain_id } => {
                let res = if let Some(domain) = data.domain_by_domain_id(&domain_id)? {
                    if domain.owner_id() == user.id() {
                        SimpleResult::Err { error: "is_owner" }
                    } else if !data.is_user_subscribed(user.id(), &domain)? {
                        SimpleResult::Err {
                            error: "not_subscribed",
                        }
                    } else {
                        data.user_unsubscribe_domain(user.id(), &domain)?;
                        SimpleResult::Ok
                    }
                } else {
                    SimpleResult::Err { error: "not_found" }
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserSubscribeDomain(res),
                });
                // TODO: emit events
                Ok(())
            }
            Request::UserSources => {
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserSources(data.user_source_subscriptions(user.id())?),
                });
                Ok(())
            }
            Request::UserSubscribeSource { uri } => {
                let res = match data.user_subscribe_source(user.id(), &uri) {
                    Ok(()) => SimpleResult::Ok,
                    Err(SubscribeError::InvalidUri) => SimpleResult::Err {
                        error: "invalid_uri",
                    },
                    Err(SubscribeError::AlreadyInState) => SimpleResult::Err {
                        error: "already_subscribed",
                    },
                    Err(SubscribeError::Data(error)) => {
                        error!("Failed to subscribe user to source: {}", error);
                        return Err(error.into());
                    }
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserSubscribeSource(res),
                });
                // TODO: emit events
                Ok(())
            }
            Request::UserUnsubscribeSource { uri } => {
                let res = match data.user_unsubscribe_source(user.id(), &uri) {
                    Ok(()) => SimpleResult::Ok,
                    Err(SubscribeError::InvalidUri) => SimpleResult::Err {
                        error: "invalid_uri",
                    },
                    Err(SubscribeError::AlreadyInState) => SimpleResult::Err {
                        error: "not_subscribed",
                    },
                    Err(SubscribeError::Data(error)) => {
                        error!("Failed to unsubscribe user from source: {}", error);
                        return Err(error.into());
                    }
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserUnsubscribeSource(res),
                });
                // TODO: emit events
                Ok(())
            }
            Request::UserDeleteSource { uri } => {
                data.user_delete_source(user.id(), &uri)?;
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserDeleteSource(SimpleResult::Ok),
                });
                // TODO: emit events
                Ok(())
            }
            Request::UserRequestSource { uri } => {
                self.state
                    .fetcher()
                    .do_send(FetchRequest::Source(Some(user.id()), uri));
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserRequestSource(SimpleResult::Ok),
                });
                Ok(())
            }
            Request::UserRequestSourceItem { uri } => {
                self.state
                    .fetcher()
                    .do_send(FetchRequest::SourceItem(Some(user.id()), uri));
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::UserRequestSourceItem(SimpleResult::Ok),
                });
                Ok(())
            }
            Request::Source { uri } => {
                let source = data.user_source(user.id(), &uri)?;
                let data = if let Some(source) = source {
                    if let Some((date, hash)) = source.version_date_hash() {
                        if let Some(source) = data.source_by_hash(hash)? {
                            Some(protocol::SourceResultData {
                                last_fetched: date.into(),
                                last_updated: source.date_updated().map(|s| s.to_string()),
                                data: source.tags().map_err(DataError::from)?,
                                items: source.items().map_err(DataError::from)?,
                            })
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::Source(protocol::SourceResult {
                        loaded: data.is_some(),
                        data,
                    }),
                });
                Ok(())
            }
            Request::SourceItem { uri } => {
                let source_item = data.user_source_item(user.id(), &uri)?;
                let data = if let Some(source_item) = source_item {
                    if let Some((date, hash)) = source_item.version_date_hash() {
                        if let Some(source_item) = data.source_item_by_hash(hash)? {
                            Some(protocol::SourceItemResultData {
                                last_fetched: date.into(),
                                last_updated: source_item.date_updated().map(|s| s.to_string()),
                            })
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::SourceItem(protocol::SourceItemResult {
                        loaded: data.is_some(),
                        data,
                    }),
                });
                Ok(())
            }
            Request::SourceItemData { uri } => {
                let source_item = data.user_source_item(user.id(), &uri)?;
                let data = if let Some(source_item) = source_item {
                    if let Some((_, hash)) = source_item.version_date_hash() {
                        if let Some(source_item) = data.source_item_by_hash(hash)? {
                            Some(source_item.get_data()?)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::SourceItemData(data.map(|d| d.tags)),
                });
                Ok(())
            }
            Request::SourceUserData { uri } => {
                let source = data.user_source(user.id(), &uri)?;
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::SourceUserData(source.map(|s| s.user_data().to_vec())),
                });
                Ok(())
            }
            Request::SourceItemUserData { uri } => {
                let source = data.user_source_item(user.id(), &uri)?;
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::SourceItemUserData(source.map(|s| s.user_data().to_vec())),
                });
                Ok(())
            }
            Request::SetSourceUserData {
                uri,
                data: user_data,
            } => {
                if let Err(()) = canonicalize_uri(&uri) {
                    conn.do_send(UserConnMsg::Response {
                        id,
                        data: Response::SetSourceUserData(SimpleResult::Err {
                            error: "invalid_uri",
                        }),
                    });
                    return Ok(());
                }
                let src_conn = Some(conn.clone());
                data.user_update_source_data(user.id(), &uri, user_data, src_conn)?;
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::SetSourceUserData(SimpleResult::Ok),
                });
                Ok(())
            }
            Request::SetSourceItemUserData {
                uri,
                data: user_data,
            } => {
                if let Err(()) = canonicalize_uri(&uri) {
                    conn.do_send(UserConnMsg::Response {
                        id,
                        data: Response::SetSourceItemUserData(SimpleResult::Err {
                            error: "invalid_uri",
                        }),
                    });
                    return Ok(());
                }
                let src_conn = Some(conn.clone());
                data.user_update_source_item_data(user.id(), &uri, user_data, src_conn)?;
                conn.do_send(UserConnMsg::Response {
                    id,
                    data: Response::SetSourceItemUserData(SimpleResult::Ok),
                });
                Ok(())
            }
            _ => Ok(()), // TODO
        }
    }

    fn dispatch_event(&self, event: protocol::Event, exclude: Option<Addr<UserConn>>) {
        for conn in self.conns.keys() {
            if exclude.as_ref().map(|c| c == conn).unwrap_or(false) {
                continue;
            }

            conn.do_send(UserConnMsg::Event {
                event: event.clone(),
            });
        }
    }
}

#[derive(Debug, Error)]
enum RequestError {
    #[error(transparent)]
    UserAuth(#[from] UserAuthError),
    #[error(transparent)]
    Data(#[from] data::DataError),
    #[error("unspecified internal error")]
    InternalError,
}

impl Actor for User {
    type Context = Context<Self>;

    fn stopped(&mut self, _: &mut Context<Self>) {
        self.user_mgr.do_send(UserMgrMsg::Stopped(self.user_id));
    }
}

#[derive(Message)]
#[rtype(result = "()")]
pub enum SessionMsg {
    Add(Addr<UserConn>),
    Remove(Addr<UserConn>),
}

/// Max amount of simultaneous user sessions for a user.
const MAX_USER_SESSIONS: usize = 5;

impl Handler<SessionMsg> for User {
    type Result = ();

    fn handle(&mut self, msg: SessionMsg, ctx: &mut Context<Self>) -> Self::Result {
        match msg {
            SessionMsg::Add(conn) => {
                debug!("Adding a connection for user {}", self.user_id);
                self.conns.insert(conn, Instant::now());

                if self.conns.len() > MAX_USER_SESSIONS {
                    // kick the oldest connection
                    let mut oldest_conn = None;
                    let mut oldest_conn_time = Instant::now();
                    for (conn, conn_time) in &self.conns {
                        if *conn_time < oldest_conn_time {
                            oldest_conn = Some(conn);
                            oldest_conn_time = *conn_time;
                        }
                    }
                    if let Some(conn) = oldest_conn {
                        conn.do_send(UserConnMsg::ForceStop);
                    }
                }
            }
            SessionMsg::Remove(conn) => {
                debug!("Removing a connection for user {}", self.user_id);
                self.conns.remove(&conn);
                if self.conns.is_empty() {
                    debug!(
                        "Last connection for user {} was closed; stopping actor",
                        self.user_id
                    );
                    ctx.stop();
                }
            }
        }
    }
}

/// A message from a user connection.
#[derive(Message)]
#[rtype(result = "()")]
pub enum ConnMsg {
    Msg {
        conn: Addr<UserConn>,
        message: ClientMsg,
    },
}

impl Handler<ConnMsg> for User {
    type Result = ();
    fn handle(&mut self, msg: ConnMsg, ctx: &mut Context<Self>) -> Self::Result {
        match msg {
            ConnMsg::Msg { conn, message } => {
                self.handle_client_message(conn, ctx, message);
            }
        }
    }
}

#[derive(Message, Clone)]
#[rtype(result = "()")]
pub struct DispatchUserEvent {
    event: protocol::Event,
    exclude: Option<Addr<UserConn>>,
}

impl DispatchUserEvent {
    pub fn new(event: protocol::Event) -> Self {
        DispatchUserEvent {
            event,
            exclude: None,
        }
    }
    pub fn new_excluding(event: protocol::Event, exclude: Option<Addr<UserConn>>) -> Self {
        DispatchUserEvent { event, exclude }
    }
}

impl Handler<DispatchUserEvent> for User {
    type Result = ();
    fn handle(&mut self, msg: DispatchUserEvent, _: &mut Context<Self>) -> Self::Result {
        self.dispatch_event(msg.event, msg.exclude);
    }
}
