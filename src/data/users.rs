use super::{models, schema, Data, DataError};
use diesel::prelude::*;
use hmac::Hmac;
use rand::rngs::OsRng;
use rand::Rng;
use sha2::Sha512;
use subtle::ConstantTimeEq;
use thiserror::Error;

pub const MAX_TOKEN_COUNT: u16 = 64;

pub type UserId = i32;

impl Data {
    pub fn user(&self, id: UserId) -> Result<Option<UserSnapshot>, DataError> {
        use schema::users::dsl;
        let res = dsl::users
            .filter(dsl::id.eq(id))
            .first::<models::User>(&self.conn)
            .optional()?;
        Ok(res.map(UserSnapshot::from))
    }

    /// Returns a user by name.
    pub fn user_by_name(&self, name: &str) -> Result<Option<UserSnapshot>, DataError> {
        use schema::users::dsl;
        let res = dsl::users
            .filter(dsl::name.eq(name))
            .first::<models::User>(&self.conn)
            .optional()?;
        Ok(res.map(UserSnapshot::from))
    }

    /// Returns whether a username is taken.
    pub fn is_user_name_taken(&self, name: &str) -> Result<bool, DataError> {
        use schema::users::dsl;
        let res = dsl::users
            .filter(dsl::name.eq(name))
            .count()
            .get_result::<i64>(&self.conn)?;
        Ok(res > 0)
    }

    /// Returns whether a string is a valid username.
    pub fn is_valid_user_name(&self, name: &str) -> bool {
        if name.len() < 3 || name.len() > 32 {
            return false;
        }
        let mut valid = true;
        for c in name.chars() {
            if !c.is_alphanumeric() {
                valid = false;
                break;
            }
        }
        valid
    }

    /// Creates a new user.
    pub fn create_user(
        &self,
        name: &str,
        password: &str,
        secret_key: &str,
    ) -> Result<(), CreateUserError> {
        if !self.is_valid_user_name(name) {
            return Err(CreateUserError::InvalidName);
        }
        if self
            .is_user_name_taken(name)
            .map_err(CreateUserError::Data)?
        {
            return Err(CreateUserError::NameTaken);
        }

        let password = Password::create(password)
            .map_err(|_| CreateUserError::PasswordDerivationError)?
            .to_string();

        let mut client_key = [0; 32];
        OsRng::default().fill(&mut client_key);

        let values = models::NewUser {
            name,
            password: &password,
            client_key: &client_key,
            secret_key,
            tokens: &(MAX_TOKEN_COUNT as i32),
        };

        diesel::insert_into(schema::users::table)
            .values(&values)
            .execute(&self.conn)
            .map_err(DataError::from)?;

        Ok(())
    }

    pub fn user_regen_client_key(&self, user: &UserSnapshot) -> Result<(), DataError> {
        use schema::users::dsl;

        let mut client_key = [0_u8; 32];
        OsRng::default().fill(&mut client_key);
        diesel::update(schema::users::table.filter(dsl::id.eq(user.id())))
            .set(dsl::client_key.eq(&client_key as &[u8]))
            .execute(&self.conn)?;
        Ok(())
    }

    pub fn change_user_name(
        &self,
        user: &UserSnapshot,
        new_name: &str,
    ) -> Result<(), ModifyUserError> {
        if !self.is_valid_user_name(new_name) {
            return Err(ModifyUserError::InvalidName);
        }

        if self
            .is_user_name_taken(new_name)
            .map_err(ModifyUserError::Data)?
        {
            return Err(ModifyUserError::NameTaken);
        }

        use schema::users::dsl;
        diesel::update(&user.model)
            .set(dsl::name.eq(new_name))
            .execute(&self.conn)
            .map_err(DataError::from)?;
        Ok(())
    }

    pub fn change_user_password(
        &self,
        user: &UserSnapshot,
        new_password: &str,
    ) -> Result<(), ModifyUserError> {
        let password = Password::create(new_password)
            .map_err(|_| ModifyUserError::PasswordDerivationError)?
            .to_string();

        use schema::users::dsl;
        diesel::update(&user.model)
            .set(dsl::password.eq(password))
            .execute(&self.conn)
            .map_err(DataError::from)?;
        Ok(())
    }

    pub fn change_user_secret_key(
        &self,
        user: &UserSnapshot,
        new_secret_key: &str,
    ) -> Result<(), DataError> {
        use schema::users::dsl;
        diesel::update(&user.model)
            .set(dsl::secret_key.eq(new_secret_key))
            .execute(&self.conn)?;
        Ok(())
    }

    pub fn delete_user(&self, user: UserId) -> Result<(), DataError> {
        {
            use schema::user_source_items::dsl;
            diesel::delete(dsl::user_source_items.filter(dsl::user_id.eq(user)))
                .execute(&self.conn)?;
        }
        {
            use schema::user_sources::dsl;
            diesel::delete(dsl::user_sources.filter(dsl::user_id.eq(user))).execute(&self.conn)?;
        }
        {
            use schema::source_domains::dsl;
            diesel::delete(dsl::source_domains.filter(dsl::owner_id.eq(user)))
                .execute(&self.conn)?;
        }
        {
            use schema::users::dsl;
            diesel::delete(dsl::users.filter(dsl::id.eq(user))).execute(&self.conn)?;
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum CreateUserError {
    #[error("username is taken")]
    NameTaken,
    #[error("invalid name")]
    InvalidName,
    #[error("failed to derive password")]
    PasswordDerivationError,
    #[error(transparent)]
    Data(#[from] DataError),
}

#[derive(Debug, Error)]
pub enum ModifyUserError {
    #[error("username is taken")]
    NameTaken,
    #[error("invalid name")]
    InvalidName,
    #[error("failed to derive password")]
    PasswordDerivationError,
    #[error(transparent)]
    Data(#[from] DataError),
}

/// A snapshot of a user's data.
#[derive(Debug, Clone)]
pub struct UserSnapshot {
    model: models::User,
}

impl From<models::User> for UserSnapshot {
    fn from(this: models::User) -> Self {
        UserSnapshot { model: this }
    }
}

pub type UserTokens = u16;

impl UserSnapshot {
    pub fn id(&self) -> UserId {
        self.model.id.expect("user has no id")
    }

    pub fn name(&self) -> &str {
        &self.model.name
    }

    /// Returns true if the password is correct.
    pub fn auth(&self, password: &str) -> Result<bool, UserAuthError> {
        let derived = Password::from_string(&self.model.password)?;
        Ok(derived.verify(password))
    }

    /// Returns the client key.
    pub fn client_key(&self) -> &[u8] {
        &self.model.client_key
    }

    /// Returns the encrypted secret key.
    pub fn secret_key(&self) -> &str {
        &self.model.secret_key
    }

    /// Returns the user's available number of tokens.
    pub fn tokens(&self) -> UserTokens {
        self.model.tokens as UserTokens
    }

    /// Sets the user's token count.
    pub fn set_tokens(&mut self, data: &Data, tokens: UserTokens) -> Result<(), DataError> {
        use schema::users::dsl;

        diesel::update(dsl::users.find(self.model.id))
            .set(dsl::tokens.eq(tokens as i32))
            .execute(&data.conn)?;
        self.model.tokens = tokens as i32;
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum UserAuthError {
    #[error("error parsing saved password: {0}")]
    PasswordParse(#[from] PasswordParseError),
}

#[derive(Debug, Error)]
pub enum PasswordParseError {
    #[error("no derived key")]
    NoDerivedKey,
    #[error("no salt")]
    NoSalt,
    #[error("invalid base64")]
    InvalidBase64,
}

struct Password {
    derived_key: Vec<u8>,
    salt: Vec<u8>,
}

const PASSWORD_SALT_LEN: usize = 32;
const PASSWORD_DERIVED_KEY_LEN: usize = 64;
const PBKDF2_ITERATIONS: u32 = 150_000;

impl Password {
    /// Tries to read this password from a string.
    fn from_string(s: &str) -> Result<Self, PasswordParseError> {
        let mut parts = s.split("$");
        let derived_key_string = parts.next().ok_or(PasswordParseError::NoDerivedKey)?;
        let salt_string = parts.next().ok_or(PasswordParseError::NoSalt)?;

        let derived_key =
            base64::decode(derived_key_string).map_err(|_| PasswordParseError::InvalidBase64)?;
        let salt = base64::decode(salt_string).map_err(|_| PasswordParseError::InvalidBase64)?;

        Ok(Password { derived_key, salt })
    }
    /// Creates a password.
    ///
    /// Returns an error e.g. if random number generation fails.
    fn create(password: &str) -> Result<Self, ()> {
        let mut salt = Vec::new();
        salt.resize(PASSWORD_SALT_LEN, 0);
        let mut random = OsRng::default();
        random.fill(salt.as_mut_slice());

        let mut derived_key = Vec::new();
        derived_key.resize(PASSWORD_DERIVED_KEY_LEN, 0);
        pbkdf2::pbkdf2::<Hmac<Sha512>>(
            password.as_bytes(),
            &salt,
            PBKDF2_ITERATIONS,
            &mut derived_key,
        );

        Ok(Password { derived_key, salt })
    }
    /// Verifies the given password string.
    fn verify(&self, password: &str) -> bool {
        let mut derived_key = Vec::new();
        derived_key.resize(PASSWORD_DERIVED_KEY_LEN, 0);
        pbkdf2::pbkdf2::<Hmac<Sha512>>(
            password.as_bytes(),
            &self.salt,
            PBKDF2_ITERATIONS,
            &mut derived_key,
        );

        derived_key.ct_eq(&self.derived_key).into()
    }
    /// Turns this password into a string.
    fn to_string(&self) -> String {
        let dk_str = base64::encode(&self.derived_key);
        let salt_str = base64::encode(&self.salt);

        format!("{}${}", dk_str, salt_str)
    }
}
