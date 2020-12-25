use super::{schema, Data, DataError};
use chrono::prelude::*;
use diesel::prelude::*;
use thiserror::Error;

#[derive(Queryable)]
struct RegistrationToken {
    _id: Option<i32>,
    _token: String,
    valid_until: String,
}

#[derive(Debug, Error)]
pub enum TokenVerError {
    #[error(transparent)]
    Data(DataError),
    #[error("invalid registration token date format")]
    InvalidDateFormat,
}

impl Data {
    /// Returns the registration token if available.
    fn registration_token(&self, token: &str) -> Result<Option<RegistrationToken>, DataError> {
        use schema::registration_tokens::dsl;

        let token = dsl::registration_tokens
            .filter(dsl::token.eq(token))
            .first::<RegistrationToken>(&self.conn)
            .optional()?;
        Ok(token)
    }

    /// Deletes the registration token, if it exists.
    pub fn delete_registration_token(&self, token: &str) -> Result<(), DataError> {
        use schema::registration_tokens::dsl;

        diesel::delete(dsl::registration_tokens.filter(dsl::token.eq(token)))
            .execute(&self.conn)?;
        Ok(())
    }

    /// Returns true if the registration token is valid.
    pub fn verify_registration_token(&self, token: &str) -> Result<bool, TokenVerError> {
        if let Some(token) = self
            .registration_token(token)
            .map_err(TokenVerError::Data)?
        {
            match DateTime::parse_from_rfc3339(&token.valid_until) {
                Ok(valid_until) => {
                    let valid_until: DateTime<Utc> = valid_until.into();
                    let now: DateTime<Utc> = Utc::now();
                    let diff = now - valid_until;
                    Ok(diff.num_seconds() < 0)
                }
                Err(_) => Err(TokenVerError::InvalidDateFormat),
            }
        } else {
            Ok(false)
        }
    }

    pub fn create_registration_token(
        &self,
        token: &str,
        valid_until: DateTime<Utc>,
    ) -> Result<(), DataError> {
        use schema::registration_tokens::dsl;

        diesel::insert_into(dsl::registration_tokens)
            .values((
                dsl::token.eq(token),
                dsl::valid_until.eq(valid_until.to_rfc3339()),
            ))
            .execute(&self.conn)?;
        Ok(())
    }
}
