use super::{models, schema, Data, DataError};
use crate::data::users::UserId;
use diesel::prelude::*;

impl Data {
    pub fn rss_auth_key(&self, key: &str) -> Result<Option<RssAuthKey>, DataError> {
        use schema::user_rss_auth_keys::dsl;
        let res = dsl::user_rss_auth_keys
            .filter(dsl::auth_key.eq(key))
            .first::<models::RssAuthKey>(&self.conn)
            .optional()?;
        Ok(res.map(RssAuthKey::from))
    }

    pub fn user_rss_auth_keys(&self, user_id: UserId) -> Result<Vec<RssAuthKey>, DataError> {
        use schema::user_rss_auth_keys::dsl;
        let res = dsl::user_rss_auth_keys
            .filter(dsl::user_id.eq(user_id))
            .get_results::<models::RssAuthKey>(&self.conn)?;
        Ok(res.into_iter().map(RssAuthKey::from).collect())
    }

    pub fn user_create_rss_auth_key(
        &self,
        user_id: UserId,
        auth_key: &str,
        label: Option<&str>,
    ) -> Result<(), DataError> {
        use schema::user_rss_auth_keys::dsl;
        diesel::insert_into(dsl::user_rss_auth_keys)
            .values((
                dsl::user_id.eq(user_id),
                dsl::auth_key.eq(auth_key),
                dsl::label.eq(label),
            ))
            .execute(&self.conn)?;
        Ok(())
    }

    pub fn user_delete_rss_auth_key(
        &self,
        user_id: UserId,
        auth_key: &str,
    ) -> Result<(), DataError> {
        use schema::user_rss_auth_keys::dsl;
        diesel::delete(
            dsl::user_rss_auth_keys
                .filter(dsl::user_id.eq(user_id))
                .filter(dsl::auth_key.eq(auth_key)),
        )
        .execute(&self.conn)?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct RssAuthKey {
    model: models::RssAuthKey,
}

impl RssAuthKey {
    pub fn user_id(&self) -> UserId {
        self.model.user_id.into()
    }
    pub fn label(&self) -> Option<&str> {
        self.model.label.as_ref().map(|s| &**s)
    }
    pub fn auth_key(&self) -> &str {
        &self.model.auth_key
    }
}

impl From<models::RssAuthKey> for RssAuthKey {
    fn from(model: models::RssAuthKey) -> Self {
        RssAuthKey { model }
    }
}
