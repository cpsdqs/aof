use super::{models, schema, Data, DataError};
use crate::data::users::UserId;
use crate::session::protocol;
use crate::session::users::{DispatchUserEvent, UserMgrDispatchEvent};
use crate::session::UserConn;
use actix::Addr;
use aof_script::url::Url;
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use libflate::gzip;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::collections::BTreeMap;
use std::io;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CreateVersionError {
    #[error("invalid uri")]
    InvalidUri,
    #[error("encode error: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
    #[error("io error: {0}")]
    IoError(#[from] std::io::Error),
    #[error(transparent)]
    Data(#[from] DataError),
}

#[derive(Debug, Error)]
pub enum SubscribeError {
    #[error("invalid uri")]
    InvalidUri,
    #[error("already in requested state")]
    AlreadyInState,
    #[error(transparent)]
    Data(#[from] DataError),
}

pub fn canonicalize_uri(uri: &str) -> Result<Url, ()> {
    let uri = Url::parse(uri).map_err(|_| ())?;

    let mut out = String::from(uri.scheme());
    out.push_str("://");
    out.push_str(uri.path());
    Url::parse(&out).map_err(|_| ())
}

macro_rules! with_user_source {
    ($table:ident, $conn:expr, $user_id:expr, $uri:expr, $target:ident; $exec:block) => {
        $conn.transaction::<_, DataError, _>(|| {
            use schema::$table::dsl;
            let $target = dsl::$table
                .filter(dsl::user_id.eq($user_id))
                .filter(dsl::uri.eq($uri));

            if $target.count().get_result::<i64>($conn)? == 0 {
                diesel::insert_into(dsl::$table)
                    .values((dsl::user_id.eq($user_id), dsl::uri.eq($uri)))
                    .execute($conn)?;
            }

            $exec

            Ok(())
        })?;
    };
}

impl Data {
    pub fn source_by_hash(&self, hash: &str) -> Result<Option<SourceVersionSnapshot>, DataError> {
        use schema::source_versions::dsl;
        let res = dsl::source_versions
            .filter(dsl::hash.eq(hash))
            .first::<models::SourceVersion>(&self.conn)
            .optional()?;
        Ok(res.map(SourceVersionSnapshot::from))
    }

    pub fn source_item_by_hash(
        &self,
        hash: &str,
    ) -> Result<Option<SourceItemVersionSnapshot>, DataError> {
        use schema::source_item_versions::dsl;
        let res = dsl::source_item_versions
            .filter(dsl::hash.eq(hash))
            .first::<models::SourceItemVersion>(&self.conn)
            .optional()?;
        Ok(res.map(SourceItemVersionSnapshot::from))
    }

    /// Creates a new source version and returns the hash.
    ///
    /// Will do nothing if the hash already exists.
    pub fn create_source_version(
        &self,
        uri: &str,
        metadata: &SourceMetadata,
        items: &SourceItems,
        date_updated: Option<&str>,
    ) -> Result<String, CreateVersionError> {
        use schema::source_versions::dsl;

        // TODO: validate

        let parsed_url = match Url::parse(uri) {
            Ok(url) => url,
            Err(_) => return Err(CreateVersionError::InvalidUri),
        };
        let domain = parsed_url.scheme();

        let hash = get_source_hash(metadata, items, date_updated)?;

        let metadata_enc = rmp_serde::encode::to_vec(metadata)?;
        let items_enc = rmp_serde::encode::to_vec(items)?;

        let mut item_uris = Vec::new();
        for item in items {
            let mut item_uri = String::from(domain);
            item_uri.push_str("://");
            item_uri.push_str(&item.path);
            let item_uri =
                canonicalize_uri(&item_uri).map_err(|_| CreateVersionError::InvalidUri)?;
            item_uris.push(item_uri.to_string());
        }

        diesel::insert_or_ignore_into(dsl::source_versions)
            .values((
                dsl::hash.eq(&hash),
                dsl::uri.eq(uri),
                dsl::metadata.eq(metadata_enc),
                dsl::date_updated.eq(date_updated),
                dsl::items.eq(items_enc),
            ))
            .execute(&self.conn)
            .map_err(DataError::from)?;

        {
            use schema::source_version_associated_items::dsl;

            self.conn.transaction::<_, DataError, _>(|| {
                for item_uri in item_uris {
                    diesel::insert_or_ignore_into(dsl::source_version_associated_items)
                        .values((
                            dsl::source_uri.eq(uri),
                            dsl::source_hash.eq(&hash),
                            dsl::item_uri.eq(&item_uri),
                        ))
                        .execute(&self.conn)
                        .map_err(DataError::from)?;
                }
                Ok(())
            })?;
        }

        Ok(hash)
    }

    /// Creates a new source version and returns the hash.
    ///
    /// Will do nothing if the hash already exists.
    pub fn create_source_item_version(
        &self,
        uri: &str,
        contents: SourceItemData,
        date_updated: Option<&str>,
    ) -> Result<String, CreateVersionError> {
        use schema::source_item_versions::dsl;

        if let Err(_) = Url::parse(uri) {
            return Err(CreateVersionError::InvalidUri);
        }

        let hash = get_source_item_hash(&contents, date_updated)?;

        let mut contents_enc = gzip::Encoder::new(Vec::new())?;
        rmp_serde::encode::write(&mut contents_enc, &contents)?;
        let contents_enc = contents_enc.finish().into_result()?;

        diesel::insert_or_ignore_into(dsl::source_item_versions)
            .values((
                dsl::uri.eq(uri),
                dsl::hash.eq(&hash),
                dsl::date_updated.eq(date_updated),
                dsl::data.eq(contents_enc),
            ))
            .execute(&self.conn)
            .map_err(DataError::from)?;

        Ok(hash)
    }

    pub fn user_source(
        &self,
        user_id: UserId,
        uri: &str,
    ) -> Result<Option<UserSourceSnapshot>, DataError> {
        use schema::user_sources::dsl;

        let source = dsl::user_sources
            .filter(dsl::user_id.eq(user_id))
            .filter(dsl::uri.eq(uri))
            .first::<models::UserSource>(&self.conn)
            .optional()?;

        Ok(source.map(UserSourceSnapshot::from))
    }

    pub fn user_source_item(
        &self,
        user_id: UserId,
        uri: &str,
    ) -> Result<Option<UserSourceItemSnapshot>, DataError> {
        use schema::user_source_items::dsl;

        let source = dsl::user_source_items
            .filter(dsl::user_id.eq(user_id))
            .filter(dsl::uri.eq(uri))
            .first::<models::UserSourceItem>(&self.conn)
            .optional()?;

        Ok(source.map(UserSourceItemSnapshot::from))
    }

    /// Updates the version of a user source.
    pub fn user_update_source(
        &self,
        user_id: UserId,
        uri: &str,
        version_date: DateTime<Utc>,
        version_hash: &str,
    ) -> Result<(), DataError> {
        with_user_source!(user_sources, &self.conn, user_id, uri, target; {
            diesel::update(target)
                .set((
                    dsl::version_date.eq(&version_date.to_rfc3339()),
                    dsl::version_hash.eq(version_hash),
                ))
                .execute(&self.conn)?;
        });

        self.users.do_send(UserMgrDispatchEvent(
            user_id,
            DispatchUserEvent::new(protocol::Event::SubscribedSourceDidUpdate {
                source: uri.to_string(),
                update_type: protocol::UpdateType::Update,
            }),
        ));

        Ok(())
    }

    /// Updates the version of a user source item.
    pub fn user_update_source_item(
        &self,
        user_id: UserId,
        uri: &str,
        version_date: DateTime<Utc>,
        version_hash: &str,
    ) -> Result<(), DataError> {
        with_user_source!(user_source_items, &self.conn, user_id, uri, target; {
            diesel::update(target)
                .set((
                    dsl::version_date.eq(&version_date.to_rfc3339()),
                    dsl::version_hash.eq(version_hash),
                ))
                .execute(&self.conn)?;
        });

        self.users.do_send(UserMgrDispatchEvent(
            user_id,
            DispatchUserEvent::new(protocol::Event::SubscribedSourceItemDidUpdate {
                source_item: uri.to_string(),
                update_type: protocol::UpdateType::Update,
            }),
        ));

        Ok(())
    }

    /// Updates the user data of a source.
    pub fn user_update_source_data(
        &self,
        user_id: UserId,
        uri: &str,
        data: Vec<u8>,
        source_conn: Option<Addr<UserConn>>,
    ) -> Result<(), DataError> {
        with_user_source!(user_sources, &self.conn, user_id, uri, target; {
            diesel::update(target)
                .set(dsl::user_data.eq(data))
                .execute(&self.conn)?;
        });

        self.users.do_send(UserMgrDispatchEvent(
            user_id,
            DispatchUserEvent::new_excluding(
                protocol::Event::SourceUserDataDidUpdate {
                    source: uri.to_string(),
                },
                source_conn,
            ),
        ));

        Ok(())
    }

    /// Updates the user data of a source.
    pub fn user_update_source_item_data(
        &self,
        user_id: UserId,
        uri: &str,
        data: Vec<u8>,
        source_conn: Option<Addr<UserConn>>,
    ) -> Result<(), DataError> {
        with_user_source!(user_source_items, &self.conn, user_id, uri, target; {
            diesel::update(target)
                .set(dsl::user_data.eq(data))
                .execute(&self.conn)?;
        });

        self.users.do_send(UserMgrDispatchEvent(
            user_id,
            DispatchUserEvent::new_excluding(
                protocol::Event::SourceItemUserDataDidUpdate {
                    source_item: uri.to_string(),
                },
                source_conn,
            ),
        ));

        Ok(())
    }

    /// Deletes the source version, but not the user data.
    pub fn user_delete_source(&self, user_id: UserId, uri: &str) -> Result<(), DataError> {
        use schema::user_sources::dsl;

        diesel::update(
            dsl::user_sources
                .filter(dsl::user_id.eq(user_id))
                .filter(dsl::uri.eq(uri)),
        )
        .set((
            dsl::version_date.eq::<Option<&str>>(None),
            dsl::version_hash.eq::<Option<&str>>(None),
        ))
        .execute(&self.conn)?;

        // TODO: delete source items too

        self.users.do_send(UserMgrDispatchEvent(
            user_id,
            DispatchUserEvent::new(protocol::Event::SubscribedSourceDidUpdate {
                source: uri.to_string(),
                update_type: protocol::UpdateType::Delete,
            }),
        ));

        Ok(())
    }

    /// Deletes the source item version, but not the user data.
    pub fn user_delete_source_item(&self, user_id: UserId, uri: &str) -> Result<(), DataError> {
        use schema::user_source_items::dsl;

        diesel::update(
            dsl::user_source_items
                .filter(dsl::user_id.eq(user_id))
                .filter(dsl::uri.eq(uri)),
        )
        .set((
            dsl::version_date.eq::<Option<&str>>(None),
            dsl::version_hash.eq::<Option<&str>>(None),
        ))
        .execute(&self.conn)?;

        self.users.do_send(UserMgrDispatchEvent(
            user_id,
            DispatchUserEvent::new(protocol::Event::SubscribedSourceItemDidUpdate {
                source_item: uri.to_string(),
                update_type: protocol::UpdateType::Delete,
            }),
        ));

        Ok(())
    }

    pub fn is_user_subscribed_to_source(
        &self,
        user_id: UserId,
        uri: &str,
    ) -> Result<bool, DataError> {
        use schema::user_source_subscriptions::dsl;

        let count = dsl::user_source_subscriptions
            .filter(dsl::user_id.eq(user_id))
            .filter(dsl::uri.eq(uri))
            .count()
            .get_result::<i64>(&self.conn)?;

        Ok(count > 0)
    }

    pub fn user_source_subscriptions(&self, user_id: UserId) -> Result<Vec<String>, DataError> {
        use schema::user_source_subscriptions::dsl;

        let res = dsl::user_source_subscriptions
            .filter(dsl::user_id.eq(user_id))
            .select(dsl::uri)
            .get_results(&self.conn)?;

        Ok(res)
    }

    /// Adds a subscription.
    pub fn user_subscribe_source(&self, user_id: UserId, uri: &str) -> Result<(), SubscribeError> {
        use schema::user_source_subscriptions::dsl;

        if let Err(_) = Url::parse(uri) {
            return Err(SubscribeError::InvalidUri);
        }

        if self
            .is_user_subscribed_to_source(user_id, uri)
            .map_err(DataError::from)?
        {
            return Err(SubscribeError::AlreadyInState);
        }

        diesel::insert_into(dsl::user_source_subscriptions)
            .values((dsl::user_id.eq(user_id), dsl::uri.eq(uri)))
            .execute(&self.conn)
            .map_err(DataError::from)?;

        self.users.do_send(UserMgrDispatchEvent(
            user_id,
            DispatchUserEvent::new(protocol::Event::UserDidSubscribeSource {
                source: uri.to_string(),
            }),
        ));

        Ok(())
    }

    /// Removes a subscription.
    pub fn user_unsubscribe_source(
        &self,
        user_id: UserId,
        uri: &str,
    ) -> Result<(), SubscribeError> {
        use schema::user_source_subscriptions::dsl;

        if let Err(_) = Url::parse(uri) {
            return Err(SubscribeError::InvalidUri);
        }

        if !self
            .is_user_subscribed_to_source(user_id, uri)
            .map_err(DataError::from)?
        {
            return Err(SubscribeError::AlreadyInState);
        }

        diesel::delete(dsl::user_source_subscriptions)
            .filter(dsl::user_id.eq(user_id))
            .filter(dsl::uri.eq(uri))
            .execute(&self.conn)
            .map_err(DataError::from)?;

        self.users.do_send(UserMgrDispatchEvent(
            user_id,
            DispatchUserEvent::new(protocol::Event::UserDidUnsubscribeSource {
                source: uri.to_string(),
            }),
        ));

        Ok(())
    }

    /// Gets all users subscribed to a source.
    pub fn source_get_subscribed_users(&self, uri: &str) -> Result<Vec<UserId>, DataError> {
        use schema::user_source_subscriptions::dsl;

        let res = dsl::user_source_subscriptions
            .filter(dsl::uri.eq(uri))
            .select(dsl::user_id)
            .get_results(&self.conn)?;

        Ok(res)
    }

    /// Gets all users subscribed to a source items.
    pub fn source_item_get_subscribed_users(&self, uri: &str) -> Result<Vec<UserId>, DataError> {
        use schema::source_version_associated_items::dsl;
        use schema::user_source_subscriptions::dsl as udsl;

        let res = udsl::user_source_subscriptions
            .filter(
                udsl::uri.eq_any(
                    dsl::source_version_associated_items
                        .filter(dsl::item_uri.eq(uri))
                        .select(dsl::source_uri),
                ),
            )
            .select(udsl::user_id)
            .get_results(&self.conn)?;

        Ok(res)
    }

    /// Performs garbage-collection.
    ///
    /// - Deletes source versions that are not referenced in any user sources
    /// - Deletes source item versions that are not referenced in any user source items
    /// - Deletes any user sources and user source items with no data
    ///
    /// This garbage collection does not need to be stop-the-world, since it is extremely unlikely
    /// that a source version would be recycled.
    pub fn garbage_collect_sources(&self) -> Result<(), DataError> {
        use schema::source_item_resource_dependencies::dsl as sird;
        use schema::source_item_versions::dsl as siv;
        use schema::source_resources::dsl as sr;
        use schema::source_version_associated_items::dsl as svai;
        use schema::source_versions::dsl as sv;
        use schema::user_source_items::dsl as usi;
        use schema::user_sources::dsl as us;

        // delete all source versions with no user source
        // comparing nullable hash to non-null version hash; idk how to assert that version hash
        // really is non-null
        diesel::delete(
            sv::source_versions.filter(
                sv::hash.nullable().ne_all(
                    us::user_sources
                        .filter(us::version_hash.is_not_null())
                        .select(us::version_hash),
                ),
            ),
        )
        .execute(&self.conn)?;

        // delete all source items with no user source item
        // see above for issue with nullables
        diesel::delete(
            siv::source_item_versions.filter(
                siv::hash.nullable().ne_all(
                    usi::user_source_items
                        .filter(usi::version_hash.is_not_null())
                        .select(usi::version_hash),
                ),
            ),
        )
        .execute(&self.conn)?;

        // delete all associated item entries with no source or no source item
        diesel::delete(
            svai::source_version_associated_items
                .filter(svai::source_hash.ne_all(sv::source_versions.select(sv::hash)))
                .or_filter(svai::item_uri.ne_all(siv::source_item_versions.select(siv::hash))),
        )
        .execute(&self.conn)?;

        // delete all resource dependencies with no source item
        diesel::delete(
            sird::source_item_resource_dependencies
                .filter(sird::source_item_hash.ne_all(siv::source_item_versions.select(siv::hash))),
        )
        .execute(&self.conn)?;

        // delete all resources with no dependents
        diesel::delete(sr::source_resources.filter(
            sr::hash.ne_all(sird::source_item_resource_dependencies.select(sird::resource_hash)),
        ))
        .execute(&self.conn)?;

        Ok(())
    }

    /// Returns all sources that users are subscribed to.
    pub fn all_user_subscribed_sources(&self) -> Result<Vec<String>, DataError> {
        use schema::user_source_subscriptions::dsl;

        Ok(dsl::user_source_subscriptions
            .select(dsl::uri)
            .get_results(&self.conn)?)
    }

    /// Returns the source version hash which corresponds to the newest fetch date according to an
    /// associated user source (belonging to any user).
    pub fn latest_user_source_version(&self, uri: &str) -> Result<Option<String>, DataError> {
        use schema::user_sources::dsl;

        let hash = dsl::user_sources
            .filter(dsl::uri.eq(uri))
            .order(dsl::version_date.desc())
            .select(dsl::version_hash)
            .first::<Option<String>>(&self.conn)
            .optional()?;

        Ok(hash.flatten())
    }

    pub fn source_item_has_versionless_user(
        &self,
        source_uri: &str,
        item_uri: &str,
    ) -> Result<bool, DataError> {
        use schema::user_source_items::dsl as usi;
        use schema::user_source_subscriptions::dsl as us;

        let res = us::user_source_subscriptions
            .filter(us::uri.eq(source_uri))
            .filter(
                us::user_id.ne_all(
                    usi::user_source_items
                        .filter(usi::uri.eq(item_uri))
                        .filter(usi::version_hash.is_not_null())
                        .select(usi::user_id),
                ),
            )
            .count()
            .get_result::<i64>(&self.conn)?;
        Ok(res > 0)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SourceMetadata {
    pub tags: BTreeMap<String, serde_json::Value>,
}

pub type SourceItems = Vec<SourceMetaItem>;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SourceMetaItem {
    pub path: String,
    #[serde(rename = "virtual", default)]
    pub is_virtual: bool,
    #[serde(default)]
    pub tags: BTreeMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SourceItemData {
    pub tags: BTreeMap<String, serde_json::Value>,
}

fn get_source_hash(
    meta: &SourceMetadata,
    items: &SourceItems,
    date_updated: Option<&str>,
) -> Result<String, rmp_serde::encode::Error> {
    let mut hash = sha2::Sha512::default();
    rmp_serde::encode::write(&mut hash, meta)?;
    rmp_serde::encode::write(&mut hash, items)?;
    rmp_serde::encode::write(&mut hash, &date_updated)?;

    let res = hash.finalize();
    Ok(hex::encode(res.as_slice()))
}

fn get_source_item_hash(
    data: &SourceItemData,
    date_updated: Option<&str>,
) -> Result<String, rmp_serde::encode::Error> {
    let mut hash = sha2::Sha512::default();
    rmp_serde::encode::write(&mut hash, data)?;
    rmp_serde::encode::write(&mut hash, &date_updated)?;

    let res = hash.finalize();
    Ok(hex::encode(res.as_slice()))
}

pub struct SourceVersionSnapshot {
    inner: models::SourceVersion,
}

impl SourceVersionSnapshot {
    pub fn date_updated(&self) -> Option<&str> {
        self.inner.date_updated.as_ref().map(|s| &**s)
    }

    pub fn tags(&self) -> Result<BTreeMap<String, serde_json::Value>, rmp_serde::decode::Error> {
        let meta: SourceMetadata =
            rmp_serde::decode::from_read(io::Cursor::new(&self.inner.metadata))?;
        Ok(meta.tags)
    }

    pub fn items(&self) -> Result<Vec<SourceMetaItem>, rmp_serde::decode::Error> {
        rmp_serde::decode::from_read(io::Cursor::new(&self.inner.items))
    }
}

impl From<models::SourceVersion> for SourceVersionSnapshot {
    fn from(this: models::SourceVersion) -> Self {
        SourceVersionSnapshot { inner: this }
    }
}

pub struct SourceItemVersionSnapshot {
    inner: models::SourceItemVersion,
}

impl SourceItemVersionSnapshot {
    pub fn date_updated(&self) -> Option<&str> {
        self.inner.date_updated.as_ref().map(|s| &**s)
    }

    pub fn get_data(&self) -> Result<SourceItemData, DataError> {
        let mut content_dec = gzip::Decoder::new(io::Cursor::new(&self.inner.data))?;
        let content = rmp_serde::decode::from_read(content_dec)?;

        Ok(content)
    }
}

impl From<models::SourceItemVersion> for SourceItemVersionSnapshot {
    fn from(this: models::SourceItemVersion) -> Self {
        SourceItemVersionSnapshot { inner: this }
    }
}

pub struct UserSourceSnapshot {
    inner: models::UserSource,
}

impl UserSourceSnapshot {
    pub fn version_date_hash(&self) -> Option<(&str, &str)> {
        match (&self.inner.version_date, &self.inner.version_hash) {
            (Some(date), Some(hash)) => Some((&*date, &*hash)),
            _ => None,
        }
    }

    pub fn user_data(&self) -> &[u8] {
        self.inner
            .user_data
            .as_ref()
            .map(|v| &**v)
            .unwrap_or_default()
    }
}

impl From<models::UserSource> for UserSourceSnapshot {
    fn from(this: models::UserSource) -> Self {
        UserSourceSnapshot { inner: this }
    }
}

pub struct UserSourceItemSnapshot {
    inner: models::UserSourceItem,
}

impl UserSourceItemSnapshot {
    pub fn version_date_hash(&self) -> Option<(&str, &str)> {
        match (&self.inner.version_date, &self.inner.version_hash) {
            (Some(date), Some(hash)) => Some((&*date, &*hash)),
            _ => None,
        }
    }

    pub fn user_data(&self) -> &[u8] {
        self.inner
            .user_data
            .as_ref()
            .map(|v| &**v)
            .unwrap_or_default()
    }
}

impl From<models::UserSourceItem> for UserSourceItemSnapshot {
    fn from(this: models::UserSourceItem) -> Self {
        UserSourceItemSnapshot { inner: this }
    }
}
