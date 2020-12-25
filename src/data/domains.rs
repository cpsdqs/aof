use super::{models, schema, Data, DataError};
use crate::data::users::UserId;
use diesel::prelude::*;
use thiserror::Error;
use unicode_segmentation::UnicodeSegmentation;

pub type DomainId = i32;
pub const DOMAIN_ID_CHARS: &[char] = &[
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'l', 'k', 'm', 'n', 'o', 'p', 'q', 'r', 's',
    't', 'u', 'v', 'w', 'x', 'y', 'z',
];
pub const DOMAIN_ID_LEN: usize = 8;

/// Max len of the abbrev in grapheme clusters.
pub const DOMAIN_ABBREV_MAX_LEN: usize = 6;

/// Max len of the name in grapheme clusters.
pub const DOMAIN_NAME_MAX_LEN: usize = 128;

/// Max len of the description in grapheme clusters.
pub const DESCRIPTION_MAX_LEN: usize = 2048;

/// Max len of the script in bytes.
pub const SCRIPT_MAX_LEN: usize = 262_144;

pub const DEFAULT_SCRIPT: &str = r#"// write your script here

export async function loadSource(path) {
    // ...
    throw new Error('not implemented');
}

export async function loadSourceItem(path) {
    // ...
    throw new Error('not implemented');
}"#;

fn gen_domain_id() -> String {
    (0..DOMAIN_ID_LEN)
        .map(|_| rand::random::<usize>() % DOMAIN_ID_CHARS.len())
        .map(|r| DOMAIN_ID_CHARS[r])
        .collect()
}

#[derive(Debug, Error)]
pub enum UpdateDomainError {
    #[error("abbrev is too short")]
    AbbrevTooShort,
    #[error("abbrev is too long")]
    AbbrevTooLong,
    #[error("name is too short")]
    NameTooShort,
    #[error("name is too long")]
    NameTooLong,
    #[error("description is too long")]
    DescriptionTooLong,
    #[error("script is too long")]
    ScriptTooLong,
    #[error(transparent)]
    Data(#[from] DataError),
}

impl Data {
    pub fn domain(&self, id: DomainId) -> Result<Option<DomainSnapshot>, DataError> {
        use schema::source_domains::dsl;
        let res = dsl::source_domains
            .filter(dsl::id.eq(id))
            .first::<models::SourceDomain>(&self.conn)
            .optional()?;
        Ok(res.map(DomainSnapshot::from))
    }

    pub fn domain_by_domain_id(&self, id: &str) -> Result<Option<DomainSnapshot>, DataError> {
        use schema::source_domains::dsl;
        let res = dsl::source_domains
            .filter(dsl::domain.eq(id))
            .first::<models::SourceDomain>(&self.conn)
            .optional()?;
        Ok(res.map(DomainSnapshot::from))
    }

    /// Returns true if the given domain id is currently taken.
    fn is_domain_id_taken(&self, name: &str) -> Result<bool, DataError> {
        use schema::source_domains::dsl;
        let res = dsl::source_domains
            .filter(dsl::domain.eq(name))
            .count()
            .get_result::<i64>(&self.conn)?;
        Ok(res > 0)
    }

    /// Generates a new, almost certainly unique domain id,
    pub fn gen_domain_id(&self) -> Result<String, DataError> {
        loop {
            let id = gen_domain_id();
            if !self.is_domain_id_taken(&id)? {
                break Ok(id);
            }
        }
    }

    /// Creates a new domain and returns its id.
    pub fn create_domain(
        &self,
        owner_id: UserId,
        abbrev: &str,
        name: &str,
    ) -> Result<String, UpdateDomainError> {
        if abbrev.graphemes(true).count() < 1 {
            return Err(UpdateDomainError::AbbrevTooShort);
        }
        if abbrev.graphemes(true).count() > DOMAIN_ABBREV_MAX_LEN {
            return Err(UpdateDomainError::AbbrevTooLong);
        }
        if name.graphemes(true).count() < 1 {
            return Err(UpdateDomainError::NameTooShort);
        }
        if name.graphemes(true).count() > DOMAIN_NAME_MAX_LEN {
            return Err(UpdateDomainError::NameTooLong);
        }

        let id = self.gen_domain_id()?;
        let domain = models::NewSourceDomain {
            domain: &id,
            abbrev: &abbrev,
            name: &name,
            description: "",
            owner_id: &owner_id,
            is_public: &false,
            script: DEFAULT_SCRIPT,
        };
        diesel::insert_into(schema::source_domains::table)
            .values(&domain)
            .execute(&self.conn)
            .map_err(DataError::from)?;
        Ok(id)
    }

    pub fn delete_domain(&self, domain: &DomainSnapshot) -> Result<(), DataError> {
        diesel::delete(&domain.inner).execute(&self.conn)?;
        Ok(())
    }

    pub fn is_user_subscribed(
        &self,
        user_id: UserId,
        domain: &DomainSnapshot,
    ) -> Result<bool, DataError> {
        use schema::user_source_domain_subscriptions::dsl;

        let count = dsl::user_source_domain_subscriptions
            .filter(dsl::user_id.eq(user_id))
            .filter(dsl::domain.eq(domain.id()))
            .count()
            .get_result::<i64>(&self.conn)?;
        Ok(count > 0)
    }

    pub fn user_subscribe_domain(
        &self,
        user_id: UserId,
        domain: &DomainSnapshot,
    ) -> Result<(), DataError> {
        use schema::user_source_domain_subscriptions::dsl;

        diesel::insert_into(dsl::user_source_domain_subscriptions)
            .values((dsl::user_id.eq(user_id), dsl::domain.eq(domain.id())))
            .execute(&self.conn)?;
        Ok(())
    }

    pub fn user_unsubscribe_domain(
        &self,
        user_id: UserId,
        domain: &DomainSnapshot,
    ) -> Result<(), DataError> {
        use schema::user_source_domain_subscriptions::dsl;

        diesel::delete(dsl::user_source_domain_subscriptions)
            .filter(dsl::user_id.eq(user_id))
            .filter(dsl::domain.eq(domain.id()))
            .execute(&self.conn)?;
        Ok(())
    }

    pub fn user_full_domain_ids(&self, user_id: UserId) -> Result<Vec<String>, DataError> {
        use schema::source_domains::dsl;
        use schema::user_source_domain_subscriptions::dsl as udsl;

        let res = dsl::source_domains
            .filter(dsl::owner_id.eq(user_id))
            .or_filter(
                dsl::domain.eq_any(
                    udsl::user_source_domain_subscriptions
                        .filter(udsl::user_id.eq(user_id))
                        .select(udsl::domain),
                ),
            )
            .order_by(dsl::abbrev)
            .select(dsl::domain)
            .get_results(&self.conn)?;

        Ok(res)
    }

    pub fn public_domain_ids(&self) -> Result<Vec<String>, DataError> {
        use schema::source_domains::dsl;

        let res = dsl::source_domains
            .filter(dsl::is_public.eq(true))
            .select(dsl::domain)
            .get_results(&self.conn)?;

        Ok(res)
    }
}

pub struct DomainSnapshot {
    inner: models::SourceDomain,
}

impl DomainSnapshot {
    pub fn id(&self) -> &str {
        &self.inner.domain
    }
    pub fn owner_id(&self) -> UserId {
        self.inner.owner_id
    }
    pub fn abbrev(&self) -> &str {
        &self.inner.abbrev
    }
    pub fn name(&self) -> &str {
        &self.inner.name
    }
    pub fn description(&self) -> &str {
        &self.inner.description
    }
    pub fn is_public(&self) -> bool {
        self.inner.is_public
    }
    pub fn script(&self) -> &str {
        &self.inner.script
    }

    pub fn update(
        &mut self,
        data: &Data,
        abbrev: String,
        name: String,
        description: String,
        is_public: bool,
        script: String,
    ) -> Result<(), UpdateDomainError> {
        if abbrev.graphemes(true).count() < 1 {
            return Err(UpdateDomainError::AbbrevTooShort);
        }
        if abbrev.graphemes(true).count() > DOMAIN_ABBREV_MAX_LEN {
            return Err(UpdateDomainError::AbbrevTooLong);
        }
        if name.graphemes(true).count() < 1 {
            return Err(UpdateDomainError::NameTooShort);
        }
        if name.graphemes(true).count() > DOMAIN_NAME_MAX_LEN {
            return Err(UpdateDomainError::NameTooLong);
        }
        if description.graphemes(true).count() > DESCRIPTION_MAX_LEN {
            return Err(UpdateDomainError::DescriptionTooLong);
        }
        if script.len() > SCRIPT_MAX_LEN {
            return Err(UpdateDomainError::ScriptTooLong);
        }

        use schema::source_domains::dsl;

        diesel::update(schema::source_domains::table)
            .filter(dsl::id.eq(self.inner.id))
            .set((
                dsl::abbrev.eq(&abbrev),
                dsl::name.eq(&name),
                dsl::description.eq(&description),
                dsl::is_public.eq(&is_public),
                dsl::script.eq(&script),
            ))
            .execute(&data.conn)
            .map_err(DataError::from)?;

        self.inner.abbrev = abbrev;
        self.inner.name = name;
        self.inner.description = description;
        self.inner.is_public = is_public;
        self.inner.script = script;
        Ok(())
    }
}

impl From<models::SourceDomain> for DomainSnapshot {
    fn from(this: models::SourceDomain) -> Self {
        Self { inner: this }
    }
}
