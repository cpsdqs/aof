use wasm_bindgen::prelude::*;
use hmac::Hmac;
use sha2::{Sha512, Digest};
use aes_gcm::{Aes256Gcm, NewAead};
use aes_gcm::aead::generic_array::GenericArray;
use serde::{Deserialize, Serialize};
use aes_gcm::aead::Aead;
use rand::rngs::OsRng;
use rand::Rng;

// FIXME: frankly I have no idea how secure it is to just dump the secret key decryption key in
// local storage

const DECRYPTION_KEY_LEN: usize = 32;
const PBKDF2_ITERATIONS: u32 = 150_000;

// also change in login.ts!
const STORE_VERSION: usize = 1;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn console_log(s: &str);
}
macro_rules! log {
    ($($t:tt)*) => (console_log(&format_args!($($t)*).to_string()));
}

#[wasm_bindgen]
pub fn create_session() -> Session {
    Session::new()
}

enum Persistence {
    None,
    Session,
    Local,
}

#[derive(Deserialize, Serialize)]
struct StorageData {
    ver: usize,
    ct_n: Vec<u8>,
    ct: Vec<u8>,
}

#[derive(Deserialize, Serialize)]
struct InnerStorageData {
    armor_hash: Vec<u8>,
    password: String,
}

fn read_storage(storage: &mut Storage) -> Result<Option<StorageData>, JsValue>{
    match storage.get() {
        Some(str) => {
            let data: StorageData = postcard::from_bytes(&base64::decode(str)
                .map_err(|_| "storage_read_error")?)
                .map_err(|_| "storage_read_error")?;

            if data.ver != STORE_VERSION {
                storage.remove();
                Ok(None)
            } else {
                Ok(Some(data))
            }
        }
        None => Ok(None),
    }
}

enum SecretKeyAccess {
    /// No password available.
    None,
    /// A decrypted secret key is available.
    Persistent {
        armor_hash: Vec<u8>,
        password: String,
    },
    /// The user's password is available.
    Password(String),
}

impl SecretKeyAccess {
    fn get_password(&self) -> Option<&str> {
        match self {
            SecretKeyAccess::None => None,
            SecretKeyAccess::Persistent { password, .. } => Some(password),
            SecretKeyAccess::Password(password) => Some(password),
        }
    }
}

#[wasm_bindgen]
pub struct Session {
    storage: StorageProxy,
    /// Client key sent from the server.
    client_key: Option<Vec<u8>>,
    /// Armored secret key sent from the server.
    secret_key_armored: Option<String>,
    /// Secret key access, supplied by the user or local storage.
    secret_key_access: SecretKeyAccess,
    /// The decrypted secret key.
    secret_key: Option<Vec<u8>>,
    /// Secret key persistence type.
    persistence: Persistence,
}

fn derive_decryption_key(salt: &[u8], password: &str) -> [u8; DECRYPTION_KEY_LEN] {
    let mut derived_key = [0; DECRYPTION_KEY_LEN];
    pbkdf2::pbkdf2::<Hmac<Sha512>>(
        password.as_bytes(),
        salt,
        PBKDF2_ITERATIONS,
        &mut derived_key,
    );
    derived_key
}

#[wasm_bindgen]
impl Session {
    /// Creates a new session.
    fn new() -> Session {
        Session {
            storage: StorageProxy::default(),
            client_key: None,
            secret_key_armored: None,
            secret_key_access: SecretKeyAccess::None,
            secret_key: None,
            persistence: Persistence::None,
        }
    }

    /// Sets data persistence type.
    pub fn set_persistence(&mut self, persistence: &str) -> Result<(), JsValue> {
        self.persistence = match persistence {
            "none" => Persistence::None,
            "session" => Persistence::Session,
            "local" => Persistence::Local,
            _ => return Err("expected one of 'none', 'session', 'local'".into()),
        };
        Ok(())
    }

    /// Sets the client key.
    pub fn set_client_key(&mut self, k: Vec<u8>) {
        if k.len() != 32 {
            log!("Error: client key is not 32 bytes!");
            return;
        }
        self.client_key = Some(k);
    }

    /// Sets the armored secret key.
    pub fn set_armored_secret_key(&mut self, sk: String) {
        self.secret_key_armored = Some(sk);
    }

    /// Sets the secret key password as supplied by the user.
    pub fn set_secret_key_password(&mut self, password: String) {
        self.secret_key_access = SecretKeyAccess::Password(password);
    }

    /// Attempts to decrypt the secret key.
    ///
    /// Possible errors:
    /// - no_secret_key: the secret key was not set
    /// - no_password: the user must supply a password
    /// - salt_read_error, ct_read_error, decryption: decryption errors
    pub fn decrypt_secret_key(&mut self) -> Result<(), JsValue> {
        let armored = match &self.secret_key_armored {
            Some(sk) => sk,
            None => return Err("no_secret_key".into()),
        };
        let password = match &self.secret_key_access {
            SecretKeyAccess::None => return Err("no_password".into()),
            SecretKeyAccess::Persistent { armor_hash, password } => {
                let new_armor_hash = Sha512::digest(&armored.as_bytes());

                if armor_hash.as_slice() != new_armor_hash.as_slice() {
                    return Err("no_password".into());
                }

                password
            },
            SecretKeyAccess::Password(pw) => pw,
        };

        let mut armored_parts = armored.split('$');
        let salt = match armored_parts.next().map(|s| base64::decode(s)) {
            Some(Ok(s)) => s,
            _ => return Err("salt_read_error".into()),
        };
        let sk_data = match armored_parts.next().map(|s| base64::decode(s)) {
            Some(Ok(s)) => s,
            _ => return Err("ct_read_error".into()),
        };
        if sk_data.len() < 13 {
            // 12 bytes nonce + at least 1 byte ciphertext
            return Err("ct_read_error".into());
        }

        let (nonce, ct) = sk_data.split_at(12);

        let derived_key = derive_decryption_key(&salt, password);
        let cipher = Aes256Gcm::new(GenericArray::from_slice(&derived_key));
        let ct = cipher.decrypt(GenericArray::from_slice(&nonce), ct).map_err(|_| "decryption")?;

        self.secret_key = Some(ct.to_owned());
        Ok(())
    }

    /// Saves the decryption key in persistent storage if requested.
    pub fn maybe_persist(&mut self) -> Result<(), JsValue> {
        let mut storage = match self.persistence {
            Persistence::None => return Ok(()),
            Persistence::Session => self.storage.get_session(),
            Persistence::Local => self.storage.get_local(),
        };

        let client_key = match &self.client_key {
            Some(key) => key,
            None => return Err("no_client_key".into()),
        };

        let inner_data = InnerStorageData {
            armor_hash: Sha512::digest(self.secret_key_armored.as_ref().ok_or("no_secret_key")?.as_bytes()).to_vec(),
            password: self.secret_key_access.get_password().ok_or("no_password")?.to_string(),
        };
        let inner_data = postcard::to_stdvec(&inner_data).map_err(|_| "encoding")?;
        let cipher = Aes256Gcm::new(GenericArray::from_slice(client_key));
        let mut nonce = [0; 12];
        OsRng::default().fill(&mut nonce);
        let inner_data = cipher.encrypt(GenericArray::from_slice(&nonce), &*inner_data)
            .map_err(|_| "encryption")?;

        let data = StorageData {
            ver: STORE_VERSION,
            ct_n: nonce.to_vec(),
            ct: inner_data,
        };

        let data = postcard::to_stdvec(&data).map_err(|_| "encoding")?;
        storage.set(base64::encode(data));

        Ok(())
    }

    /// Attempts to decrypt persistent data and initialize the session.
    /// This does NOT mean that the user's password will not be required anymore, as the data may be
    /// out of date.
    fn init_from_data(&mut self, data: StorageData) -> bool {
        let client_key = match &self.client_key {
            Some(key) => key,
            None => return false,
        };

        let cipher = Aes256Gcm::new(GenericArray::from_slice(client_key));
        match cipher.decrypt(GenericArray::from_slice(&data.ct_n), data.ct.as_slice()) {
            Ok(data) => match postcard::from_bytes::<InnerStorageData>(&data) {
                Ok(data) => {
                    self.secret_key_access = SecretKeyAccess::Persistent {
                        armor_hash: data.armor_hash,
                        password: data.password,
                    };
                    true
                }
                Err(_) => false,
            }
            Err(_) => false,
        }
    }

    /// Attempts to read persistent data and returns success.
    pub fn init_from_persisted(&mut self) -> bool {
        // try local storage
        let data = read_storage(&mut self.storage.get_local()).ok().flatten();

        if let Some(data) = data {
            self.persistence = Persistence::Local;
            if self.init_from_data(data) {
                return true;
            }
        }

        // try session storage
        let data = read_storage(&mut self.storage.get_session()).ok().flatten();

        if let Some(data) = data {
            self.persistence = Persistence::Session;
            if self.init_from_data(data) {
                return true;
            }
        }

        // nothing left to try; no persistent storage
        self.persistence = Persistence::None;
        false
    }

    pub fn decrypt(&self, nonce: Vec<u8>, buf: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        let secret_key = match &self.secret_key {
            Some(sk) => sk,
            None => return Err("no_secret_key".into()),
        };
        if secret_key.len() != 32 {
            return Err("secret_key_length".into());
        }
        if nonce.len() != 12 {
            return Err("nonce_length".into());
        }

        let cipher = Aes256Gcm::new(GenericArray::from_slice(secret_key));
        Ok(cipher.decrypt(GenericArray::from_slice(&nonce), buf.as_slice())
            .map_err(|_| "decryption")?)
    }

    pub fn encrypt(&self, nonce: Vec<u8>, buf: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        let secret_key = match &self.secret_key {
            Some(sk) => sk,
            None => return Err("no_secret_key".into()),
        };
        if secret_key.len() != 32 {
            return Err("secret_key_length".into());
        }
        if nonce.len() != 12 {
            return Err("nonce_length".into());
        }

        let cipher = Aes256Gcm::new(GenericArray::from_slice(secret_key));
        Ok(cipher.encrypt(GenericArray::from_slice(&nonce), buf.as_slice())
            .map_err(|_| "encryption")?)
    }

    pub fn set_storage(&mut self, local: String, session: String) {
        self.storage.update(local, session);
    }
    pub fn get_storage_mutations(&mut self) -> JsValue {
        let (local, session) = self.storage.get_mutations();
        JsValue::from_serde(&vec![local, session]).unwrap()
    }
}

#[derive(Default)]
struct StorageProxy {
    local: (bool, String),
    session: (bool, String),
}
impl StorageProxy {
    fn update(&mut self, local: String, session: String) {
        self.local = (false, local);
        self.session = (false, session);
    }
    fn get_mutations(&self) -> (Option<String>, Option<String>) {
        let mut res = (None, None);
        if self.local.0 {
            res.0 = Some(self.local.1.clone());
        }
        if self.session.0 {
            res.1 = Some(self.session.1.clone());
        }
        res
    }

    fn get_local(&mut self) -> Storage {
        Storage { mutation: &mut self.local.0, value: &mut self.local.1 }
    }
    fn get_session(&mut self) -> Storage {
        Storage { mutation: &mut self.session.0, value: &mut self.session.1 }
    }
}

struct Storage<'a> {
    mutation: &'a mut bool,
    value: &'a mut String,
}
impl<'a> Storage<'a> {
    fn get(&self) -> Option<&str> {
        if self.value == "" {
            None
        } else {
            Some(&*self.value)
        }
    }
    fn set(&mut self, value: String) {
        *self.mutation = true;
        *self.value = value;
    }
    fn remove(&mut self) {
        *self.mutation = true;
        self.value.clear();
    }
}
