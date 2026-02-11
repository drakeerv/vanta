use thiserror::Error;

#[derive(Error, Debug)]
pub enum VaultError {
    #[error("Database error: {0}")]
    Db(#[from] sled::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Decryption failed")]
    EncryptionError,

    #[error("Data integrity error: {0}")]
    Corruption(String),

    #[error("Invalid vault version: expected {expected}, found {found}")]
    InvalidVersion { expected: u32, found: u32 },

    #[error("Authentication error: {0}")]
    Argon2(String),

    #[error("Entry not found: {0}")]
    NotFound(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] postcard::Error),

    // Handles String::from_utf8
    #[error("UTF-8 error: {0}")]
    Utf8String(#[from] std::string::FromUtf8Error),

    // Handles str::from_utf8
    #[error("UTF-8 error: {0}")]
    Utf8Str(#[from] std::str::Utf8Error),

    #[error("Integer parse error: {0}")]
    ParseInt(#[from] std::num::ParseIntError),

    #[error("System time error: {0}")]
    Time(#[from] std::time::SystemTimeError),
}
