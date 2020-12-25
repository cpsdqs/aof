use rand::prelude::*;
use wasm_bindgen::prelude::*;
use rand::rngs::OsRng;
use hmac::Hmac;
use sha2::Sha512;
use aes_gcm::{Aes256Gcm, NewAead, AeadInPlace};
use aes_gcm::aead::generic_array::GenericArray;

const SALT_LEN: usize = 32;
const SECRET_KEY_LEN: usize = 32;
const DECRYPTION_KEY_LEN: usize = 32;
const PBKDF2_ITERATIONS: u32 = 150_000;

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
pub fn create_secret_key(password: String) -> Result<String, JsValue> {
    let mut random = OsRng::default();
    let mut salt = [0; SALT_LEN];
    random.try_fill(&mut salt).map_err(|_| "random")?;

    let derived_key = derive_decryption_key(&salt, &password);

    let mut secret_key = Vec::new();
    secret_key.resize(SECRET_KEY_LEN, 0);
    random.try_fill(&mut *secret_key).map_err(|_| "random")?;

    let cipher = Aes256Gcm::new(GenericArray::from_slice(&derived_key));
    let mut nonce = [0; 12];
    random.try_fill(&mut nonce).map_err(|_| "random")?;
    let nonce = GenericArray::from_slice(&nonce);

    cipher.encrypt_in_place(&nonce, &[], &mut secret_key).map_err(|_| "encrypt")?;

    let b_salt = base64::encode(&salt);
    let mut b_secret_key = Vec::with_capacity(nonce.len() + secret_key.len());
    b_secret_key.extend_from_slice(&nonce);
    b_secret_key.extend_from_slice(&secret_key);
    let b_secret_key = base64::encode(&b_secret_key);

    Ok(format!("{}${}", b_salt, b_secret_key))
}
