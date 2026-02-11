use super::error::VaultError;
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHasher, SaltString},
};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use rand::{RngExt, rngs::StdRng};
use secrecy::SecretBox;

/// Derives a 32-byte key from a password and salt.
pub fn derive_key(password: &str, salt: &[u8; 16]) -> Result<SecretBox<[u8]>, VaultError> {
    let params =
        Params::new(65536, 3, 4, Some(32)).map_err(|e| VaultError::Argon2(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let salt_str = SaltString::encode_b64(salt).map_err(|e| VaultError::Argon2(e.to_string()))?;

    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt_str)
        .map_err(|e| VaultError::Argon2(e.to_string()))?;

    let hash_output = password_hash
        .hash
        .ok_or_else(|| VaultError::Argon2("No hash output".into()))?;

    let mut key = [0u8; 32];
    if hash_output.as_bytes().len() < 32 {
        return Err(VaultError::Argon2("Hash output too short".into()));
    }
    key.copy_from_slice(&hash_output.as_bytes()[..32]);

    Ok(SecretBox::from(key.to_vec()))
}

/// Encrypts data, prepending the 24-byte nonce to the output.
pub fn encrypt(key: &[u8], data: &[u8], aad: &[u8]) -> Result<Vec<u8>, VaultError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| VaultError::EncryptionError)?;

    let mut nonce_bytes = [0u8; 24];
    rand::make_rng::<StdRng>().fill(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, Payload { msg: data, aad })
        .map_err(|_| VaultError::EncryptionError)?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(combined)
}

/// Decrypts data that has a 24-byte nonce prepended.
pub fn decrypt(key: &[u8], data: &[u8], aad: &[u8]) -> Result<Vec<u8>, VaultError> {
    if data.len() < 24 {
        return Err(VaultError::Corruption("Data too short".into()));
    }

    let (nonce_bytes, ciphertext) = data.split_at(24);
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| VaultError::EncryptionError)?;

    cipher
        .decrypt(
            XNonce::from_slice(nonce_bytes),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| VaultError::EncryptionError)
}
