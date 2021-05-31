use crate::data::sources::{canonicalize_uri, CreateVersionError, SourceItemData, SourceMetadata};
use crate::data::users::UserId;
use crate::data::DataError;
use crate::session::protocol;
use crate::session::users::{DispatchUserEvent, UserMgrDispatchEvent};
use crate::state::SharedData;
use actix::prelude::*;
use actix_rt::blocking::BlockingError;
use actix_web::web;
use aof_script::console::{ConsoleMessage, MessageType, MsgFrag};
use chrono::Utc;
use thiserror::Error;

mod script;

pub use script::{request_fetch_permission, run_ipc_fork, FetchMsg, FetchTime};
use crate::session::protocol::UpdateType;

pub struct Fetcher {
    data: SharedData,
}

#[derive(Debug, Error)]
pub enum FetchError {
    #[error("invalid uri")]
    InvalidUri,
    #[error("no such domain")]
    DomainNotFound(String),
    #[error("failed to create source version: {0}")]
    Create(#[from] CreateVersionError),
    #[error(transparent)]
    Data(#[from] DataError),
}

impl Fetcher {
    pub fn new(data: SharedData) -> Self {
        Fetcher { data }
    }

    /// Fetches a source.
    ///
    /// `user_id` is the id of the user that initiated the fetch request.
    /// If this is `Some`, then *only* that user will know about the fetch.
    /// If this is `None`, the request is assumed to have been initiated by the global fetcher,
    /// so all subscribed users will be notified.
    pub fn fetch_source(
        shared_data: &SharedData,
        user_id: Option<UserId>,
        uri: &str,
    ) -> Result<(Vec<FetchMsg>, Option<String>), FetchError> {
        let uri = canonicalize_uri(uri).map_err(|_| FetchError::InvalidUri)?;

        let data = shared_data.lock();
        let domain_name = uri.scheme().to_string();
        let domain = match data.domain_by_domain_id(&domain_name)? {
            Some(domain) => domain,
            None => return Err(FetchError::DomainNotFound(domain_name)),
        };

        let evt_users = if let Some(user) = user_id {
            vec![user]
        } else {
            data.source_get_subscribed_users(&uri.to_string())?
        };

        drop(data);

        let evt = DispatchUserEvent::new(protocol::Event::SourceFetchDidBegin {
            source: uri.to_string(),
        });
        for user in &evt_users {
            shared_data
                .users()
                .do_send(UserMgrDispatchEvent(*user, evt.clone()));
        }

        let (msg, res) = script::fetch_source(&domain_name, domain.script(), uri.path());

        match res {
            Ok(mut source) => {
                let data = shared_data.lock();
                let uri = uri.to_string();
                let date = Utc::now();
                let hash = data.create_source_version(
                    &uri,
                    &SourceMetadata { tags: source.tags },
                    &source.items,
                    source.last_updated.as_ref().map(|s| &**s),
                )?;

                let evt = DispatchUserEvent::new(protocol::Event::SourceFetchDidEnd {
                    source: uri.clone(),
                    success: true,
                    log: msg.clone().into_iter().map(|x| x.into()).collect(),
                });
                for user in &evt_users {
                    data.user_update_source(*user, &uri, date, &hash)?;
                    shared_data
                        .users()
                        .do_send(UserMgrDispatchEvent(*user, evt.clone()));
                }

                if !source.item_data.is_empty() {
                    for meta_item in &source.items {
                        if let Some(source_item) = source.item_data.remove(&meta_item.path) {
                            let mut item_uri = String::from(&domain_name);
                            item_uri.push_str("://");
                            item_uri.push_str(&meta_item.path);
                            let item_uri = match canonicalize_uri(&item_uri) {
                                Ok(uri) => uri.to_string(),
                                Err(_) => continue,
                            };

                            let hash = data.create_source_item_version(
                                &item_uri,
                                SourceItemData {
                                    tags: source_item.tags,
                                },
                                source_item.last_updated.as_ref().map(|s| &**s),
                            )?;

                            let evt = DispatchUserEvent::new(protocol::Event::SubscribedSourceItemDidUpdate {
                                source_item: uri.clone(),
                                update_type: UpdateType::Update,
                            });
                            for user in &evt_users {
                                data.user_update_source_item(*user, &item_uri, date, &hash)?;
                                shared_data
                                    .users()
                                    .do_send(UserMgrDispatchEvent(*user, evt.clone()));
                            }
                        }
                    }
                }

                Ok((msg, Some(hash)))
            }
            Err(err) => {
                let mut msg = msg;
                msg.push(FetchMsg {
                    time: None,
                    msg: ConsoleMessage {
                        msg_type: MessageType::Error,
                        message: vec![MsgFrag::Log(format!("{}", err))],
                    },
                });

                let evt = DispatchUserEvent::new(protocol::Event::SourceFetchDidEnd {
                    source: uri.to_string(),
                    success: false,
                    log: msg.clone().into_iter().map(|x| x.into()).collect(),
                });
                for user in evt_users {
                    shared_data
                        .users()
                        .do_send(UserMgrDispatchEvent(user, evt.clone()));
                }

                Ok((msg, None))
            }
        }
    }
    pub fn fetch_source_item(
        shared_data: &SharedData,
        user_id: Option<UserId>,
        uri: &str,
    ) -> Result<(), FetchError> {
        let uri = canonicalize_uri(uri).map_err(|_| FetchError::InvalidUri)?;

        let data = shared_data.lock();
        let domain_name = uri.scheme().to_string();
        let domain = match data.domain_by_domain_id(&domain_name)? {
            Some(domain) => domain,
            None => return Err(FetchError::DomainNotFound(domain_name)),
        };

        let evt_users = if let Some(user) = user_id {
            vec![user]
        } else {
            data.source_item_get_subscribed_users(&uri.to_string())?
        };

        drop(data);

        let evt = DispatchUserEvent::new(protocol::Event::SourceItemFetchDidBegin {
            source_item: uri.to_string(),
        });
        for user in &evt_users {
            shared_data
                .users()
                .do_send(UserMgrDispatchEvent(*user, evt.clone()));
        }

        let (msg, res) = script::fetch_source_item(&domain_name, domain.script(), uri.path());

        match res {
            Ok(source_item) => {
                let data = shared_data.lock();
                let uri = uri.to_string();
                let date = Utc::now();
                let hash = data.create_source_item_version(
                    &uri,
                    SourceItemData {
                        tags: source_item.tags,
                    },
                    source_item.last_updated.as_ref().map(|s| &**s),
                )?;

                let users = if let Some(user) = user_id {
                    vec![user]
                } else {
                    data.source_item_get_subscribed_users(&uri)?
                };

                let evt = DispatchUserEvent::new(protocol::Event::SourceItemFetchDidEnd {
                    source_item: uri.clone(),
                    success: true,
                    log: msg.into_iter().map(|x| x.into()).collect(),
                });
                for user in users {
                    data.user_update_source_item(user, &uri, date, &hash)?;
                    shared_data
                        .users()
                        .do_send(UserMgrDispatchEvent(user, evt.clone()));
                }
            }
            Err(err) => {
                let mut msg = msg;
                msg.push(FetchMsg {
                    time: None,
                    msg: ConsoleMessage {
                        msg_type: MessageType::Error,
                        message: vec![MsgFrag::Log(format!("{}", err))],
                    },
                });

                let evt = DispatchUserEvent::new(protocol::Event::SourceItemFetchDidEnd {
                    source_item: uri.to_string(),
                    success: false,
                    log: msg.into_iter().map(|x| x.into()).collect(),
                });
                for user in evt_users {
                    shared_data
                        .users()
                        .do_send(UserMgrDispatchEvent(user, evt.clone()));
                }
            }
        }

        Ok(())
    }
}

impl Actor for Fetcher {
    type Context = Context<Self>;
}

#[derive(Message)]
#[rtype(result = "()")]
pub enum FetchRequest {
    Source(Option<UserId>, String),
    SourceItem(Option<UserId>, String),
}

impl Handler<FetchRequest> for Fetcher {
    type Result = ();

    fn handle(&mut self, msg: FetchRequest, ctx: &mut Context<Self>) -> Self::Result {
        let data = self.data.clone();

        match msg {
            FetchRequest::Source(u, s) => {
                ctx.spawn(
                    async move {
                        let s2 = s.clone();
                        let data2 = data.clone();
                        let res = web::block(move || Self::fetch_source(&data2, u, &s)).await;
                        match res {
                            Ok(_) => (),
                            Err(BlockingError::Error(err)) => {
                                if let Some(u) = u {
                                    data.users().do_send(UserMgrDispatchEvent(
                                        u,
                                        DispatchUserEvent::new(
                                            protocol::Event::SourceFetchDidBegin {
                                                source: s2.clone(),
                                            },
                                        ),
                                    ));
                                    data.users().do_send(UserMgrDispatchEvent(
                                        u,
                                        DispatchUserEvent::new(
                                            protocol::Event::SourceFetchDidEnd {
                                                source: s2.clone(),
                                                success: false,
                                                log: vec![FetchMsg {
                                                    time: None,
                                                    msg: ConsoleMessage {
                                                        msg_type: MessageType::Error,
                                                        message: vec![MsgFrag::Log(format!(
                                                            "{}",
                                                            err
                                                        ))],
                                                    },
                                                }
                                                .into()],
                                            },
                                        ),
                                    ));
                                } else {
                                    error!("Failed to fetch source {}: {}", s2, err);
                                }
                            }
                            Err(BlockingError::Canceled) => {
                                error!("Failed to fetch source {}: canceled", s2);
                            }
                        }
                    }
                    .into_actor(self),
                );
            }
            FetchRequest::SourceItem(u, s) => {
                ctx.spawn(
                    async move {
                        let s2 = s.clone();
                        let data2 = data.clone();
                        let res = web::block(move || Self::fetch_source_item(&data2, u, &s)).await;
                        match res {
                            Ok(()) => (),
                            Err(BlockingError::Error(err)) => {
                                if let Some(u) = u {
                                    data.users().do_send(UserMgrDispatchEvent(
                                        u,
                                        DispatchUserEvent::new(
                                            protocol::Event::SourceItemFetchDidBegin {
                                                source_item: s2.clone(),
                                            },
                                        ),
                                    ));
                                    data.users().do_send(UserMgrDispatchEvent(
                                        u,
                                        DispatchUserEvent::new(
                                            protocol::Event::SourceItemFetchDidEnd {
                                                source_item: s2.clone(),
                                                success: false,
                                                log: vec![FetchMsg {
                                                    time: None,
                                                    msg: ConsoleMessage {
                                                        msg_type: MessageType::Error,
                                                        message: vec![MsgFrag::Log(format!(
                                                            "{}",
                                                            err
                                                        ))],
                                                    },
                                                }
                                                .into()],
                                            },
                                        ),
                                    ));
                                } else {
                                    error!("Failed to fetch source item {}: {}", s2, err);
                                }
                            }
                            Err(BlockingError::Canceled) => {
                                error!("Failed to fetch source item {}: canceled", s2);
                            }
                        }
                    }
                    .into_actor(self),
                );
            }
        }
    }
}
