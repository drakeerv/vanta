use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHasher, SaltString},
};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use rand::{RngExt, rngs::StdRng};
use secrecy::{ExposeSecret, SecretBox};
use serde::{Deserialize, Serialize};
use sled::{Config, Db, Tree};
use std::{
    collections::{HashMap, HashSet},
    str::from_utf8,
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::fs;
use uuid::Uuid;

const CURRENT_VAULT_VERSION: u32 = 1;
const DATABASE_DIR: &str = "vault/db";
const DATA_DIR: &str = "vault/storage";
const SALT_PATH: &str = "vault/.salt";

#[derive(Error, Debug)]
pub enum VaultError {
    #[error("Database error")]
    Db(#[from] sled::Error),

    #[error("IO error")]
    Io(#[from] std::io::Error),

    #[error("Decryption failed")]
    EncryptionError,

    #[error("Data integrity error")]
    Corruption(String), // Internal details logged but not exposed to user

    #[error("Invalid vault version")]
    InvalidVersion { expected: u32, found: u32 },

    #[error("Authentication error")]
    Argon2(String), // Internal details logged but not exposed

    #[error("Entry not found")]
    NotFound(String), // Only expose generic "not found"

    #[error("Data error")]
    Serialization(#[from] postcard::Error),
}

impl From<std::string::FromUtf8Error> for VaultError {
    fn from(e: std::string::FromUtf8Error) -> Self {
        VaultError::Corruption(format!("Invalid UTF-8: {}", e))
    }
}

impl From<std::num::ParseIntError> for VaultError {
    fn from(e: std::num::ParseIntError) -> Self {
        VaultError::Corruption(format!("Invalid number format: {}", e))
    }
}

impl From<std::time::SystemTimeError> for VaultError {
    fn from(e: std::time::SystemTimeError) -> Self {
        VaultError::Corruption(format!("System time error: {}", e))
    }
}

impl From<std::str::Utf8Error> for VaultError {
    fn from(e: std::str::Utf8Error) -> Self {
        VaultError::Corruption(format!("Invalid UTF-8: {}", e))
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageVariant {
    Original,
    High,
    Low,
    Thumbnail,
}

impl ImageVariant {
    /// Returns the filename stem for this variant on disk.
    pub fn filename(&self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::High => "high",
            Self::Low => "low",
            Self::Thumbnail => "thumbnail",
        }
    }

    /// Parses a variant from a URL path segment.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "original" => Some(Self::Original),
            "high" => Some(Self::High),
            "low" => Some(Self::Low),
            "thumbnail" => Some(Self::Thumbnail),
            _ => None,
        }
    }

    /// Returns the MIME type for this variant.
    pub fn mime(&self, original_mime: &str) -> String {
        match self {
            Self::Original => original_mime.to_string(),
            _ => "image/webp".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageEntry {
    pub id: Uuid,
    pub original_mime: String,
    pub original_size: u64,
    pub created_at: u64,
    pub variants: Vec<ImageVariant>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone)]
pub struct VaultMetadata {
    vault_version: u32,
    created_at: u64,
    vault_salt: Option<[u8; 16]>,
    master_key_check: Option<Vec<u8>>,
}

#[derive(Clone)]
pub struct VaultData {
    entries: Tree,
    /// In-memory tag index: tag name -> set of image UUIDs
    /// Built from decrypted entries on unlock, never stored on disk
    tag_index: HashMap<String, HashSet<Uuid>>,
    encryption_key: SecretBox<[u8]>,
}

#[derive(Clone)]
pub struct Vault {
    /// The vault metadata is stored in the database and can be loaded on demand
    metadata: VaultMetadata,
    /// This gets updated when the vault is unlocked and the data is loaded into memory
    data: Arc<RwLock<Option<VaultData>>>,
    /// The sled database instance for the vault
    db: Db,
}

impl Vault {
    /// Initializes the vault by opening a connection to the database and setting up necessary structures.
    pub fn new() -> Result<Self, VaultError> {
        // Create db and vault
        let config = Config::new().path(DATABASE_DIR);
        let db = config.open()?;
        let vault = Self::load_vault(&db)?;

        // Create data directory if it doesn't exist
        std::fs::create_dir_all(DATA_DIR)?;

        Ok(vault)
    }

    /// Unlocks the vault by verifying the user password and loading the encrypted data into memory.
    pub fn unlock(&self, password: &str) -> Result<(), VaultError> {
        // Get salt and check-value from metadata
        let salt = self
            .metadata
            .vault_salt
            .ok_or(VaultError::EncryptionError)?;
        let combined = self
            .metadata
            .master_key_check
            .as_ref()
            .ok_or(VaultError::EncryptionError)?;

        // Derive the wrapping key from the user password
        let wrapping_key = self.derive_wrapping_key(password, &salt)?;

        // Decrypt the master key (this verifies the password)
        if combined.len() < 24 {
            return Err(VaultError::Corruption("Key check too short".into()));
        }
        let (nonce_bytes, ciphertext) = combined.split_at(24);
        let nonce = XNonce::from_slice(nonce_bytes);
        let cipher = XChaCha20Poly1305::new_from_slice(wrapping_key.expose_secret())
            .map_err(|_| VaultError::EncryptionError)?;

        let decrypted_master_key = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| VaultError::EncryptionError)?; // Wrong password triggers this

        if decrypted_master_key.len() != 32 {
            return Err(VaultError::EncryptionError);
        }
        let master_key = SecretBox::from(decrypted_master_key);

        // Initialize the data structures in RAM
        let entries = self.db.open_tree("entries")?;

        // Build the tag index in memory from decrypted entries
        // This avoids storing tag metadata on disk (privacy protection)
        let tag_index = Self::build_tag_index(&entries, master_key.expose_secret())?;

        let mut data_lock = self
            .data
            .write()
            .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
        *data_lock = Some(VaultData {
            entries,
            tag_index,
            encryption_key: master_key,
        });

        Ok(())
    }

    /// Builds the in-memory tag index by scanning all decrypted entries.
    /// Called once during unlock.
    fn build_tag_index(
        entries: &Tree,
        key: &[u8],
    ) -> Result<HashMap<String, HashSet<Uuid>>, VaultError> {
        let mut index: HashMap<String, HashSet<Uuid>> = HashMap::new();

        for result in entries.iter() {
            let (key_bytes, encrypted_metadata) = result?;
            if let Ok(id) = Uuid::from_slice(&key_bytes) {
                if let Ok(entry) = Self::decrypt_metadata(key, id, &encrypted_metadata) {
                    for tag in &entry.tags {
                        index
                            .entry(tag.clone())
                            .or_default()
                            .insert(id);
                    }
                }
            }
        }

        Ok(index)
    }

    // Setups up the vault with a master password
    pub async fn setup(&mut self, master_password: &str) -> Result<(), VaultError> {
        // Sanity check to ensure vault isn't already set up
        if !self.needs_setup() {
            return Err(VaultError::Corruption("Vault already set up".into()));
        }

        // Generate a random master key for encryption
        let master_key = SecretBox::from(rand::random::<[u8; 32]>().to_vec());

        // Set up the vault encryption with the generated master key and user password
        self.setup_vault_encryption(&master_key, master_password).await?;

        Ok(())
    }

    /// Creates a new vault by initializing the database and setting up the initial metadata.
    fn create_vault(db: &Db) -> Result<VaultMetadata, VaultError> {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
        db.insert(
            "vault_version",
            CURRENT_VAULT_VERSION.to_string().as_bytes(),
        )?;
        db.insert("created_at", timestamp.to_string().as_bytes())?;

        // Flush it to disk so we can be sure it's there before we try to load it later
        db.flush()?;

        Ok(VaultMetadata {
            vault_version: CURRENT_VAULT_VERSION,
            created_at: timestamp,
            vault_salt: None,
            master_key_check: None,
        })
    }

    /// Sets up the database by creating necessary trees or performing migrations.
    fn load_vault(db: &Db) -> Result<Self, VaultError> {
        let vault_metadata = match db.get("vault_version")? {
            // Our vault has already been created and migrate if needed
            Some(v) => {
                let version_str = String::from_utf8(v.to_vec())?.parse::<u32>()?;

                if version_str != CURRENT_VAULT_VERSION {
                    return Err(VaultError::InvalidVersion {
                        expected: CURRENT_VAULT_VERSION,
                        found: version_str,
                    });
                }

                // Now we can assume we have a valid vault and load all the metadata
                let created_at =
                    from_utf8(&db.get("created_at")?.ok_or_else(|| {
                        VaultError::Corruption("Missing created_at".to_string())
                    })?)?
                    .parse::<u64>()?;
                let vault_salt = db
                    .get("vault_salt")?
                    .and_then(|v| v.as_ref().try_into().ok());
                let master_key_check = db.get("master_key_check")?.map(|v| v.to_vec());

                VaultMetadata {
                    vault_version: version_str,
                    created_at,
                    vault_salt,
                    master_key_check,
                }
            }
            // Our vault is being created for the first time, initialize it
            None => Self::create_vault(db)?,
        };

        let vault = Vault {
            metadata: vault_metadata,
            data: Arc::new(RwLock::new(None)),
            db: db.clone(),
        };

        Ok(vault)
    }

    /// Sets up the vault encryption by deriving the encryption key from the master key and user password.
    pub async fn setup_vault_encryption(
        &mut self,
        master_key: &SecretBox<[u8]>,
        user_password: &str,
    ) -> Result<(), VaultError> {
        // Generate and save a unique salt for this vault
        let salt = rand::random::<[u8; 16]>();
        self.db.insert("vault_salt", &salt)?;
        self.metadata.vault_salt = Some(salt);
        fs::write(SALT_PATH, &salt).await?;

        // Derive a "Wrapping Key" from the user's password using Argon2
        // This key is used to encrypt the master_key for storage on disk
        let wrapping_key = self.derive_wrapping_key(user_password, &salt)?;

        // Create the master_key_check value by encrypting the master key with the wrapping key
        let check_ciphertext = self.encrypt_key_check(master_key, &wrapping_key)?;
        self.db
            .insert("master_key_check", check_ciphertext.clone())?;
        self.metadata.master_key_check = Some(check_ciphertext);

        // Flush it to disk so we can be sure it's there before we try to load it later
        self.db.flush()?;

        Ok(())
    }

    /// Derives a wrapping key from the user's password and the vault salt using Argon2.
    fn derive_wrapping_key(
        &self,
        user_password: &str,
        salt: &[u8; 16],
    ) -> Result<SecretBox<[u8]>, VaultError> {
        // Configure Argon2 parameters
        let params = Params::new(65536, 3, 4, Some(32))
            .map_err(|e| VaultError::Argon2(format!("Argon2 params error: {}", e)))?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

        // Prepare the salt
        let salt_str = SaltString::encode_b64(salt)
            .map_err(|e| VaultError::Argon2(format!("Salt encoding error: {}", e)))?;

        // Hash the password
        let password_hash = argon2
            .hash_password(user_password.as_bytes(), &salt_str)
            .map_err(|e| VaultError::Argon2(format!("Password hashing error: {}", e)))?;

        // Extract the derived key from the hash output
        let mut key = [0u8; 32];
        let hash_output = password_hash
            .hash
            .ok_or(VaultError::Argon2("Missing hash output".to_string()))?;
        let hash_bytes = hash_output.as_bytes();

        // Sanity check to make sure we have enough bytes
        if hash_bytes.len() < 32 {
            return Err(VaultError::Argon2("Hash output too short".to_string()));
        }

        key.copy_from_slice(&hash_bytes[..32]);
        Ok(SecretBox::from(key.to_vec()))
    }

    /// Encrypts the master key for storage using the wrapping key
    fn encrypt_key_check(
        &self,
        master_key: &SecretBox<[u8]>,
        wrapping_key: &SecretBox<[u8]>,
    ) -> Result<Vec<u8>, VaultError> {
        let cipher = XChaCha20Poly1305::new_from_slice(wrapping_key.expose_secret())
            .map_err(|_| VaultError::EncryptionError)?;

        // Generate a random 24-byte nonce for the key check encryption
        let mut nonce_bytes = [0u8; 24];
        rand::make_rng::<StdRng>().fill(&mut nonce_bytes);
        let nonce = XNonce::from_slice(&nonce_bytes);

        // Encrypt the master key
        let ciphertext = cipher
            .encrypt(nonce, master_key.expose_secret())
            .map_err(|_| VaultError::EncryptionError)?;

        // Store the Nonce + Ciphertext together (24 bytes + ciphertext)
        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);

        Ok(combined)
    }

    /// Verifies the password without loading the vault data.
    pub fn verify_password(&self, password: &str) -> Result<(), VaultError> {
        // Get salt and check-value from metadata
        let salt = self
            .metadata
            .vault_salt
            .ok_or(VaultError::EncryptionError)?;
        let combined = self
            .metadata
            .master_key_check
            .as_ref()
            .ok_or(VaultError::EncryptionError)?;

        // Derive the wrapping key from the user password
        let wrapping_key = self.derive_wrapping_key(password, &salt)?;

        // Decrypt the master key (this verifies the password)
        if combined.len() < 24 {
            return Err(VaultError::Corruption("Key check too short".into()));
        }
        let (nonce_bytes, ciphertext) = combined.split_at(24);
        let nonce = XNonce::from_slice(nonce_bytes);
        let cipher = XChaCha20Poly1305::new_from_slice(wrapping_key.expose_secret())
            .map_err(|_| VaultError::EncryptionError)?;

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| VaultError::EncryptionError)?; // Wrong password triggers this

        Ok(())
    }

    /// Stores a new image with multiple pre-processed variants.
    /// Each variant is encrypted and stored in `{DATA_DIR}/{uuid}/{variant}.enc`.
    /// Metadata is encrypted and stored in sled.
    pub async fn store_image(
        &self,
        original_mime: String,
        original_size: u64,
        variants: Vec<(ImageVariant, Vec<u8>)>,
    ) -> Result<ImageEntry, VaultError> {
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        let vault_data = {
            let data_guard = self
                .data
                .read()
                .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
            data_guard
                .as_ref()
                .ok_or(VaultError::EncryptionError)?
                .clone()
        };

        let encryption_key = vault_data.encryption_key;
        let entries = vault_data.entries;
        let id = Uuid::new_v4();

        // Create the UUID subdirectory
        let dir_path = format!("{DATA_DIR}/{}", id);
        fs::create_dir_all(&dir_path).await?;

        let cipher = XChaCha20Poly1305::new_from_slice(encryption_key.expose_secret())
            .map_err(|_| VaultError::EncryptionError)?;

        // Encrypt and store each variant file
        let mut stored_variants = Vec::new();
        for (variant, data) in &variants {
            let mut nonce_bytes = [0u8; 24];
            rand::make_rng::<StdRng>().fill(&mut nonce_bytes);
            let nonce = XNonce::from_slice(&nonce_bytes);

            // AAD binds ciphertext to this specific UUID + variant
            let mut aad = id.as_bytes().to_vec();
            aad.extend_from_slice(variant.filename().as_bytes());

            let ciphertext = cipher
                .encrypt(nonce, Payload { msg: data.as_slice(), aad: &aad })
                .map_err(|_| VaultError::EncryptionError)?;

            let mut raw_file = nonce_bytes.to_vec();
            raw_file.extend_from_slice(&ciphertext);

            let file_path = format!("{}/{}.enc", dir_path, variant.filename());
            fs::write(&file_path, &raw_file).await?;

            stored_variants.push(*variant);
        }

        // Build the metadata entry
        let entry = ImageEntry {
            id,
            original_mime,
            original_size,
            created_at: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
            variants: stored_variants,
            tags: Vec::new(),
        };

        // Encrypt and store the metadata in sled
        let entry_bytes = postcard::to_stdvec(&entry)?;
        let mut meta_nonce_bytes = [0u8; 24];
        rand::make_rng::<StdRng>().fill(&mut meta_nonce_bytes);
        let meta_nonce = XNonce::from_slice(&meta_nonce_bytes);

        let encrypted_metadata = cipher
            .encrypt(
                meta_nonce,
                Payload {
                    msg: &entry_bytes,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| VaultError::EncryptionError)?;

        let mut stored_metadata = meta_nonce_bytes.to_vec();
        stored_metadata.extend_from_slice(&encrypted_metadata);

        entries.insert(id.as_bytes(), stored_metadata)?;
        entries.flush()?;

        Ok(entry)
    }

    fn decrypt_metadata(key: &[u8], id: Uuid, data: &[u8]) -> Result<ImageEntry, VaultError> {
        if data.len() < 24 {
            return Err(VaultError::Corruption("Metadata too short".into()));
        }
        let (nonce_bytes, ciphertext) = data.split_at(24);
        
        let cipher = XChaCha20Poly1305::new_from_slice(key)
            .map_err(|_| VaultError::EncryptionError)?;

        let decrypted = cipher
            .decrypt(
                XNonce::from_slice(nonce_bytes),
                Payload {
                    msg: ciphertext,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| VaultError::Corruption("Metadata integrity check failed".into()))?;

        Ok(postcard::from_bytes(&decrypted)?)
    }

    /// Retrieves and decrypts a specific variant of an image from the vault.
    pub async fn retrieve_image(
        &self,
        id: Uuid,
        variant: ImageVariant,
    ) -> Result<(Vec<u8>, String), VaultError> {
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        let vault_data = {
            let data_guard = self
                .data
                .read()
                .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
            data_guard
                .as_ref()
                .ok_or(VaultError::EncryptionError)?
                .clone()
        };

        let entries = vault_data.entries;

        // Decrypt metadata to verify the entry and check variant exists
        let encrypted_metadata = entries
            .get(id.as_bytes())?
            .ok_or_else(|| VaultError::NotFound(id.to_string()))?;

        let entry = Self::decrypt_metadata(
            vault_data.encryption_key.expose_secret(),
            id,
            &encrypted_metadata,
        )?;

        if !entry.variants.contains(&variant) {
            return Err(VaultError::NotFound(format!(
                "Variant '{}' not found for image {}",
                variant.filename(),
                id
            )));
        }

        // Load the encrypted variant file
        let file_path = format!("{DATA_DIR}/{}/{}.enc", id, variant.filename());
        let raw_file = fs::read(&file_path).await?;

        if raw_file.len() < 24 {
            return Err(VaultError::Corruption(
                "File too short to contain nonce".into(),
            ));
        }
        let (nonce_bytes, ciphertext) = raw_file.split_at(24);

        // AAD binds to UUID + variant name
        let mut aad = id.as_bytes().to_vec();
        aad.extend_from_slice(variant.filename().as_bytes());

        let cipher = XChaCha20Poly1305::new_from_slice(vault_data.encryption_key.expose_secret())
            .map_err(|_| VaultError::EncryptionError)?;
        let decrypted = cipher
            .decrypt(
                XNonce::from_slice(nonce_bytes),
                Payload {
                    msg: ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| VaultError::EncryptionError)?;

        let mime = variant.mime(&entry.original_mime);
        Ok((decrypted, mime))
    }

    /// Deletes an image and all its variants from the vault.
    pub async fn delete_image(&self, id: Uuid) -> Result<(), VaultError> {
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        // Scope to hold the lock only during synchronous DB operations
        {
            // Get write lock to update tag index
            let mut data_lock = self
                .data
                .write()
                .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
            let vault_data = data_lock
                .as_mut()
                .ok_or(VaultError::EncryptionError)?;

            let entries = &vault_data.entries;

            // Verify metadata exists and is valid before deleting
            let encrypted_metadata = entries
                .get(id.as_bytes())?
                .ok_or_else(|| VaultError::NotFound(id.to_string()))?;

            // Decrypt to get tags for cleanup
            if let Ok(entry) = Self::decrypt_metadata(
                vault_data.encryption_key.expose_secret(),
                id,
                &encrypted_metadata,
            ) {
                // Clean up tag index before deleting the image
                Self::cleanup_tags_for_image_in_index(&mut vault_data.tag_index, &entry);
            }

            // Remove metadata from sled
            entries.remove(id.as_bytes())?;
            entries.flush()?;
        } // Lock is dropped here, so we don't hold it across the await below

        // Remove the entire UUID directory and all variant files
        let dir_path = format!("{DATA_DIR}/{}", id);
        if let Err(e) = fs::remove_dir_all(&dir_path).await {
            // If the directory is already gone, that's fine. Otherwise return error.
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(VaultError::Io(e));
            }
        }

        Ok(())
    }

    /// Lists all image entries in the vault by fetching the metadata from the database and returning it as a vector.
    pub fn list_images(&self) -> Result<Vec<ImageEntry>, VaultError> {
        // Sanity check to ensure vault is unlocked
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        // Get the encryption key from the loaded vault data
        let vault_data = {
            let data_guard = self
                .data
                .read()
                .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
            data_guard
                .as_ref()
                .ok_or(VaultError::EncryptionError)?
                .clone()
        };

        let entries = vault_data.entries;

        // Iterate over all entries in sled and decrypt them into ImageEntry structs
        let mut read_entries = Vec::new();
        for result in entries.iter() {
            let (key, value) = result?;
            
            // The key is the UUID bytes
            if let Ok(id) = Uuid::from_slice(&key) {
                match Self::decrypt_metadata(vault_data.encryption_key.expose_secret(), id, &value) {
                    Ok(entry) => read_entries.push(entry),
                    Err(_) => continue, // Skip corrupted/invalid entries
                }
            }
        }

        // Sort by created_at descending (newest first)
        read_entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(read_entries)
    }

    /// Checks if the vault is currently unlocked by checking if the data is loaded into memory.
    pub fn is_unlocked(&self) -> bool {
        self.data.read().map(|d| d.is_some()).unwrap_or(false)
    }

    /// Checks if the vault needs to be set up by verifying if the vault salt and master key check values are present in the metadata.
    pub fn needs_setup(&self) -> bool {
        self.metadata.vault_salt.is_none() || self.metadata.master_key_check.is_none()
    }

    /// Locks the database by clearing the loaded data from memory
    pub fn lock(&self) {
        if let Ok(mut data_lock) = self.data.write() {
             *data_lock = None;
        }
    }

    /// Shutdown the vault by flushing the database and clearing the loaded data from memory
    pub fn shutdown(&self) -> Result<(), VaultError> {
        self.db.flush()?;
        self.lock();
        Ok(())
    }

    /// Validates and normalizes a tag string.
    /// Tags are lowercased, trimmed, and limited to 32 alphanumeric characters (plus hyphens/underscores).
    fn normalize_tag(tag: &str) -> Result<String, VaultError> {
        let normalized = tag.to_lowercase().trim().to_string();
        
        if normalized.is_empty() {
            return Err(VaultError::Corruption("Tag cannot be empty".into()));
        }
        
        if normalized.len() > 32 {
            return Err(VaultError::Corruption("Tag cannot exceed 32 characters".into()));
        }
        
        // Only allow alphanumeric, hyphens, and underscores
        if !normalized.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return Err(VaultError::Corruption("Tag can only contain letters, numbers, hyphens, and underscores".into()));
        }
        
        Ok(normalized)
    }

    /// Helper to re-encrypt and store an updated ImageEntry
    fn store_entry_metadata(&self, entry: &ImageEntry, entries: &Tree, key: &[u8]) -> Result<(), VaultError> {
        let entry_bytes = postcard::to_stdvec(entry)?;
        let mut meta_nonce_bytes = [0u8; 24];
        rand::make_rng::<StdRng>().fill(&mut meta_nonce_bytes);
        let meta_nonce = XNonce::from_slice(&meta_nonce_bytes);

        let cipher = XChaCha20Poly1305::new_from_slice(key)
            .map_err(|_| VaultError::EncryptionError)?;

        let encrypted_metadata = cipher
            .encrypt(
                meta_nonce,
                Payload {
                    msg: &entry_bytes,
                    aad: entry.id.as_bytes(),
                },
            )
            .map_err(|_| VaultError::EncryptionError)?;

        let mut stored_metadata = meta_nonce_bytes.to_vec();
        stored_metadata.extend_from_slice(&encrypted_metadata);

        entries.insert(entry.id.as_bytes(), stored_metadata)?;
        Ok(())
    }

    /// Adds a tag to an image. Updates both the ImageEntry and the in-memory tag index.
    pub fn tag_image(&self, image_id: Uuid, tag: &str) -> Result<ImageEntry, VaultError> {
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        let tag = Self::normalize_tag(tag)?;

        // Get write lock to update tag index
        let mut data_lock = self
            .data
            .write()
            .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
        let vault_data = data_lock
            .as_mut()
            .ok_or(VaultError::EncryptionError)?;

        let entries = &vault_data.entries;
        let key = vault_data.encryption_key.expose_secret();

        // 1. Get and update the ImageEntry
        let encrypted_metadata = entries
            .get(image_id.as_bytes())?
            .ok_or_else(|| VaultError::NotFound(image_id.to_string()))?;

        let mut entry = Self::decrypt_metadata(key, image_id, &encrypted_metadata)?;

        if !entry.tags.contains(&tag) {
            entry.tags.push(tag.clone());
            self.store_entry_metadata(&entry, entries, key)?;

            // 2. Update the in-memory tag index
            vault_data.tag_index
                .entry(tag)
                .or_default()
                .insert(image_id);
        }

        self.db.flush()?;
        Ok(entry)
    }

    /// Removes a tag from an image. Updates both the ImageEntry and the in-memory tag index.
    pub fn untag_image(&self, image_id: Uuid, tag: &str) -> Result<ImageEntry, VaultError> {
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        let tag = Self::normalize_tag(tag)?;

        // Get write lock to update tag index
        let mut data_lock = self
            .data
            .write()
            .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
        let vault_data = data_lock
            .as_mut()
            .ok_or(VaultError::EncryptionError)?;

        let entries = &vault_data.entries;
        let key = vault_data.encryption_key.expose_secret();

        // 1. Get and update the ImageEntry
        let encrypted_metadata = entries
            .get(image_id.as_bytes())?
            .ok_or_else(|| VaultError::NotFound(image_id.to_string()))?;

        let mut entry = Self::decrypt_metadata(key, image_id, &encrypted_metadata)?;

        if let Some(pos) = entry.tags.iter().position(|t| t == &tag) {
            entry.tags.remove(pos);
            self.store_entry_metadata(&entry, entries, key)?;

            // 2. Update the in-memory tag index
            if let Some(tag_set) = vault_data.tag_index.get_mut(&tag) {
                tag_set.remove(&image_id);
                if tag_set.is_empty() {
                    vault_data.tag_index.remove(&tag);
                }
            }
        }

        self.db.flush()?;
        Ok(entry)
    }

    /// Advanced tag search: include tags (AND) and exclude tags (NOT).
    /// Optimizes by starting with the smallest tag set for include tags.
    pub fn search_by_tags(
        &self,
        include_tags: &[String],
        exclude_tags: &[String],
    ) -> Result<Vec<ImageEntry>, VaultError> {
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        // If no include tags, start with all images
        if include_tags.is_empty() && exclude_tags.is_empty() {
            return self.list_images();
        }

        let vault_data = {
            let data_guard = self
                .data
                .read()
                .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
            data_guard
                .as_ref()
                .ok_or(VaultError::EncryptionError)?
                .clone()
        };

        let entries = &vault_data.entries;
        let tag_index = &vault_data.tag_index;
        let key = vault_data.encryption_key.expose_secret();

        // Get image sets for each include tag with their counts
        let mut tag_sets: Vec<(String, HashSet<Uuid>)> = Vec::new();
        for tag in include_tags {
            let normalized = Self::normalize_tag(tag)?;
            let ids: HashSet<Uuid> = tag_index
                .get(&normalized)
                .cloned()
                .unwrap_or_default();
            if ids.is_empty() {
                return Ok(Vec::new()); // Tag doesn't exist, no matches
            }
            tag_sets.push((normalized, ids));
        }

        // Sort by count (smallest first) for optimization
        tag_sets.sort_by_key(|(_, ids)| ids.len());

        // Get exclude tag sets
        let mut exclude_ids: HashSet<Uuid> = HashSet::new();
        for tag in exclude_tags {
            let normalized = Self::normalize_tag(tag)?;
            if let Some(ids) = tag_index.get(&normalized) {
                exclude_ids.extend(ids);
            }
        }

        // Start with smallest include set or all images
        let mut candidate_ids: HashSet<Uuid> = if tag_sets.is_empty() {
            // No include tags, start with all images
            entries
                .iter()
                .filter_map(|r| r.ok())
                .filter_map(|(k, _)| Uuid::from_slice(&k).ok())
                .collect()
        } else {
            tag_sets[0].1.clone()
        };

        // Intersect with remaining include sets
        for (_, ids) in tag_sets.iter().skip(1) {
            candidate_ids = candidate_ids.intersection(ids).copied().collect();
            if candidate_ids.is_empty() {
                return Ok(Vec::new());
            }
        }

        // Remove excluded
        candidate_ids = candidate_ids.difference(&exclude_ids).copied().collect();

        // Fetch entries
        let mut results = Vec::new();
        for id in candidate_ids {
            if let Some(encrypted_metadata) = entries.get(id.as_bytes())? {
                if let Ok(entry) = Self::decrypt_metadata(key, id, &encrypted_metadata) {
                    results.push(entry);
                }
            }
        }

        // Sort by created_at descending for consistent ordering
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(results)
    }

    /// Returns all unique tags in the vault.
    pub fn list_tags(&self) -> Result<Vec<String>, VaultError> {
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        let vault_data = {
            let data_guard = self
                .data
                .read()
                .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
            data_guard
                .as_ref()
                .ok_or(VaultError::EncryptionError)?
                .clone()
        };

        let mut tags: Vec<String> = vault_data.tag_index.keys().cloned().collect();
        tags.sort();
        Ok(tags)
    }

    /// Renames a tag across all images in the vault.
    pub fn rename_tag(&self, old_tag: &str, new_tag: &str) -> Result<u32, VaultError> {
        if !self.is_unlocked() {
            return Err(VaultError::EncryptionError);
        }

        let old_tag = Self::normalize_tag(old_tag)?;
        let new_tag = Self::normalize_tag(new_tag)?;

        if old_tag == new_tag {
            return Ok(0);
        }

        let mut data_lock = self
            .data
            .write()
            .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
        let vault_data = data_lock
            .as_mut()
            .ok_or(VaultError::EncryptionError)?;

        let entries = &vault_data.entries;
        let key = vault_data.encryption_key.expose_secret();

        // Get all image IDs that have the old tag
        let image_ids: Vec<Uuid> = vault_data
            .tag_index
            .get(&old_tag)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect();

        if image_ids.is_empty() {
            return Ok(0);
        }

        let mut count = 0u32;

        for image_id in &image_ids {
            let encrypted_metadata = entries
                .get(image_id.as_bytes())?
                .ok_or_else(|| VaultError::NotFound(image_id.to_string()))?;

            let mut entry = Self::decrypt_metadata(key, *image_id, &encrypted_metadata)?;

            // Remove old tag, add new tag if not already present
            if let Some(pos) = entry.tags.iter().position(|t| t == &old_tag) {
                entry.tags.remove(pos);
                if !entry.tags.contains(&new_tag) {
                    entry.tags.push(new_tag.clone());
                }
                self.store_entry_metadata(&entry, entries, key)?;
                count += 1;
            }
        }

        // Update tag index: remove old, merge into new
        let old_ids = vault_data.tag_index.remove(&old_tag).unwrap_or_default();
        vault_data
            .tag_index
            .entry(new_tag)
            .or_default()
            .extend(old_ids);

        self.db.flush()?;
        Ok(count)
    }

    /// Helper to clean up tag index when deleting an image.
    /// Must be called with write lock held on vault_data.
    fn cleanup_tags_for_image_in_index(
        tag_index: &mut HashMap<String, HashSet<Uuid>>,
        entry: &ImageEntry,
    ) {
        for tag in &entry.tags {
            if let Some(tag_set) = tag_index.get_mut(tag) {
                tag_set.remove(&entry.id);
                if tag_set.is_empty() {
                    tag_index.remove(tag);
                }
            }
        }
    }
}
