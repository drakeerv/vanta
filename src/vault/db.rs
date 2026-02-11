use crate::vault::{
    crypto,
    error::VaultError,
    types::{ImageEntry, VaultMetadata},
};
use sled::{Config, Db, Tree};
use std::str::from_utf8;
use std::time::{SystemTime, UNIX_EPOCH};
use rayon::prelude::*;
use uuid::Uuid;

const CURRENT_VAULT_VERSION: u32 = 1;

#[derive(Clone)]
pub struct Database {
    db: Db,
    // The tree specifically for image entries
    entries_tree: Tree,
}

impl Database {
    pub fn open(path: &str) -> Result<Self, VaultError> {
        let config = Config::new().path(path);
        let db = config.open()?;
        let entries_tree = db.open_tree("entries")?;

        Ok(Self { db, entries_tree })
    }

    pub fn flush(&self) -> Result<(), VaultError> {
        self.db.flush()?;
        Ok(())
    }

    // --- Metadata Operations ---

    /// Loads metadata (version, salt, check) or creates it if new.
    pub fn load_or_init_metadata(&self) -> Result<VaultMetadata, VaultError> {
        match self.db.get("vault_version")? {
            Some(v) => {
                let ver = from_utf8(&v)?.parse::<u32>()?;
                if ver != CURRENT_VAULT_VERSION {
                    return Err(VaultError::InvalidVersion {
                        expected: CURRENT_VAULT_VERSION,
                        found: ver,
                    });
                }

                let created_at_bytes = self
                    .db
                    .get("created_at")?
                    .ok_or(VaultError::Corruption("No date".into()))?;
                let created_at = from_utf8(&created_at_bytes)?.parse::<u64>()?;

                Ok(VaultMetadata {
                    vault_version: ver,
                    created_at,
                    vault_salt: self
                        .db
                        .get("vault_salt")?
                        .and_then(|x| x.as_ref().try_into().ok()),
                    master_key_check: self.db.get("master_key_check")?.map(|x| x.to_vec()),
                })
            }
            None => {
                let ts = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
                self.db.insert(
                    "vault_version",
                    CURRENT_VAULT_VERSION.to_string().as_bytes(),
                )?;
                self.db.insert("created_at", ts.to_string().as_bytes())?;
                self.flush()?;

                Ok(VaultMetadata {
                    vault_version: CURRENT_VAULT_VERSION,
                    created_at: ts,
                    vault_salt: None,
                    master_key_check: None,
                })
            }
        }
    }

    pub fn save_salt_and_check(&self, salt: &[u8], check: &[u8]) -> Result<(), VaultError> {
        self.db.insert("vault_salt", salt)?;
        self.db.insert("master_key_check", check)?;
        self.flush()?;
        Ok(())
    }

    // --- Entry Operations (Encrypt/Decrypt + Read/Write) ---

    /// Serializes, Encrypts, and Saves an entry
    pub fn insert_entry(&self, key: &[u8], entry: &ImageEntry) -> Result<(), VaultError> {
        let bytes = postcard::to_stdvec(entry)?;
        // We use the ID as AAD (Additional Authenticated Data) to bind the encryption to this specific UUID
        let encrypted = crypto::encrypt(key, &bytes, entry.id.as_bytes())?;
        self.entries_tree.insert(entry.id.as_bytes(), encrypted)?;
        Ok(())
    }

    /// Reads, Decrypts, and Deserializes an entry
    pub fn get_entry(&self, key: &[u8], id: Uuid) -> Result<ImageEntry, VaultError> {
        let encrypted = self
            .entries_tree
            .get(id.as_bytes())?
            .ok_or_else(|| VaultError::NotFound(id.to_string()))?;

        let decrypted = crypto::decrypt(key, &encrypted, id.as_bytes())?;
        Ok(postcard::from_bytes(&decrypted)?)
    }

    pub fn remove_entry(&self, id: Uuid) -> Result<(), VaultError> {
        self.entries_tree.remove(id.as_bytes())?;
        Ok(())
    }

    /// Iterates over all entries, decrypting them. Skips corrupted ones.
    pub fn get_all_entries(&self, key: &[u8]) -> Result<Vec<ImageEntry>, VaultError> {
        // 1. I/O Phase: fast, sequential read from DB
        let raw_rows: Vec<_> = self
            .entries_tree
            .iter()
            .filter_map(|res| res.ok()) // Skip DB errors locally
            .collect();

        // 2. CPU Phase: Parallel decryption
        // This splits the work across all CPU cores
        let mut list: Vec<ImageEntry> = raw_rows
            .par_iter()
            .filter_map(|(k, v)| {
                if let Ok(id) = Uuid::from_slice(k) {
                    if let Ok(decrypted) = crypto::decrypt(key, v, id.as_bytes()) {
                        if let Ok(entry) = postcard::from_bytes::<ImageEntry>(&decrypted) {
                            return Some(entry);
                        }
                    }
                }
                None
            })
            .collect();

        // Sort by newest first (fast sort)
        list.par_sort_unstable_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(list)
    }
}
