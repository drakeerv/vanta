mod crypto;
mod error;
mod types;

pub use error::VaultError;
pub use types::{ImageEntry, ImageVariant};

use crate::vault::types::VaultMetadata;
use secrecy::{ExposeSecret, SecretBox};
use sled::{Config, Db, Tree};
use std::{
    collections::{HashMap, HashSet},
    str::from_utf8,
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::fs;
use uuid::Uuid;

const CURRENT_VAULT_VERSION: u32 = 1;
const DATABASE_DIR: &str = "vault/db";
const DATA_DIR: &str = "vault/storage";
const SALT_PATH: &str = "vault/.salt";

#[derive(Clone)]
struct VaultData {
    entries: Tree,
    tag_index: HashMap<String, HashSet<Uuid>>,
    encryption_key: SecretBox<[u8]>,
}

#[derive(Clone)]
pub struct Vault {
    metadata: VaultMetadata,
    data: Arc<RwLock<Option<VaultData>>>,
    db: Db,
}

impl Vault {
    pub fn new() -> Result<Self, VaultError> {
        let config = Config::new().path(DATABASE_DIR);
        let db = config.open()?;
        let vault = Self::load_metadata(&db)?;
        std::fs::create_dir_all(DATA_DIR)?;
        Ok(vault)
    }

    // --- Core Lifecycle ---

    pub fn unlock(&self, password: &str) -> Result<(), VaultError> {
        let salt = self
            .metadata
            .vault_salt
            .as_ref()
            .ok_or(VaultError::EncryptionError)?;
        let check_val = self
            .metadata
            .master_key_check
            .as_ref()
            .ok_or(VaultError::EncryptionError)?;

        let wrapping_key = crypto::derive_key(password, salt)?;

        // Decrypt the master key
        let master_key_bytes = crypto::decrypt(wrapping_key.expose_secret(), check_val, &[])?;
        if master_key_bytes.len() != 32 {
            return Err(VaultError::EncryptionError);
        }
        let master_key = SecretBox::from(master_key_bytes);

        // Load DB Tree
        let entries = self.db.open_tree("entries")?;
        let tag_index = Self::build_tag_index(&entries, master_key.expose_secret())?;

        let mut lock = self
            .data
            .write()
            .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
        *lock = Some(VaultData {
            entries,
            tag_index,
            encryption_key: master_key,
        });

        Ok(())
    }

    pub fn verify_password(&self, password: &str) -> Result<(), VaultError> {
        let salt = self
            .metadata
            .vault_salt
            .as_ref()
            .ok_or(VaultError::EncryptionError)?;
        let check_val = self
            .metadata
            .master_key_check
            .as_ref()
            .ok_or(VaultError::EncryptionError)?;

        let wrapping_key = crypto::derive_key(password, salt)?;
        crypto::decrypt(wrapping_key.expose_secret(), check_val, &[])?;

        Ok(())
    }

    pub fn lock(&self) {
        if let Ok(mut lock) = self.data.write() {
            *lock = None;
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.data.read().map(|d| d.is_some()).unwrap_or(false)
    }

    pub fn shutdown(&self) -> Result<(), VaultError> {
        self.db.flush()?;
        self.lock();
        Ok(())
    }

    // --- Setup ---

    pub async fn setup(&mut self, master_password: &str) -> Result<(), VaultError> {
        if !self.needs_setup() {
            return Err(VaultError::Corruption("Vault already set up".into()));
        }

        let master_key = SecretBox::from(rand::random::<[u8; 32]>().to_vec());
        let salt = rand::random::<[u8; 16]>();

        let wrapping_key = crypto::derive_key(master_password, &salt)?;
        let key_check = crypto::encrypt(
            wrapping_key.expose_secret(),
            master_key.expose_secret(),
            &[],
        )?;

        // Update DB
        self.db.insert("vault_salt", &salt)?;
        // FIX: Remove & so it implements Into<IVec>
        self.db.insert("master_key_check", key_check.clone())?;
        self.db.flush()?;

        // Update FS and InMemory
        fs::write(SALT_PATH, &salt).await?;
        self.metadata.vault_salt = Some(salt);
        self.metadata.master_key_check = Some(key_check);

        Ok(())
    }

    pub fn needs_setup(&self) -> bool {
        self.metadata.vault_salt.is_none() || self.metadata.master_key_check.is_none()
    }

    // --- Image Operations ---

    pub async fn store_image(
        &self,
        original_mime: String,
        size: u64,
        variants: Vec<(ImageVariant, Vec<u8>)>,
    ) -> Result<ImageEntry, VaultError> {
        self.with_data(|data| {
            let id = Uuid::new_v4();
            let key = data.encryption_key.expose_secret();
            Ok((id, key.to_vec(), data.entries.clone()))
        })
        .and_then(|(id, key, entries)| {
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(async move {
                    let dir_path = format!("{}/{}", DATA_DIR, id);
                    fs::create_dir_all(&dir_path).await?;

                    let mut stored_variants = Vec::new();

                    for (variant, bytes) in &variants {
                        let aad = Self::make_aad(id, variant.filename());
                        let encrypted = crypto::encrypt(&key, bytes, &aad)?;
                        let path = format!("{}/{}.enc", dir_path, variant.filename());
                        fs::write(&path, encrypted).await?;
                        stored_variants.push(*variant);
                    }

                    let entry = ImageEntry {
                        id,
                        original_mime,
                        original_size: size,
                        created_at: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
                        variants: stored_variants,
                        tags: Vec::new(),
                    };

                    Self::save_entry(&entries, &key, &entry)?;
                    Ok(entry)
                })
            })
        })
    }

    pub async fn retrieve_image(
        &self,
        id: Uuid,
        variant: ImageVariant,
    ) -> Result<(Vec<u8>, String), VaultError> {
        let (key_vec, mime) = self.with_data(|data| {
            let key = data.encryption_key.expose_secret();
            let entry = Self::get_entry(&data.entries, key, id)?;
            if !entry.variants.contains(&variant) {
                return Err(VaultError::NotFound(format!("Variant missing: {}", id)));
            }
            // FIX: clone mime before returning to avoid partial move issues
            let m = entry.original_mime.clone();
            Ok((key.to_vec(), m))
        })?;

        let path = format!("{}/{}/{}.enc", DATA_DIR, id, variant.filename());
        let encrypted_data = fs::read(&path).await?;

        let aad = Self::make_aad(id, variant.filename());
        let decrypted = crypto::decrypt(&key_vec, &encrypted_data, &aad)?;

        Ok((decrypted, variant.mime(&mime)))
    }

    pub async fn delete_image(&self, id: Uuid) -> Result<(), VaultError> {
        self.with_data_mut(|data| {
            let key = data.encryption_key.expose_secret();

            // Cleanup Index
            if let Ok(entry) = Self::get_entry(&data.entries, key, id) {
                for tag in entry.tags {
                    if let Some(set) = data.tag_index.get_mut(&tag) {
                        set.remove(&id);
                        if set.is_empty() {
                            data.tag_index.remove(&tag);
                        }
                    }
                }
            }
            data.entries.remove(id.as_bytes())?;
            Ok(())
        })?;

        let dir = format!("{}/{}", DATA_DIR, id);
        if let Err(e) = fs::remove_dir_all(dir).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(e.into());
            }
        }
        Ok(())
    }

    // --- Tag Operations ---

    pub fn tag_image(&self, id: Uuid, tag: &str) -> Result<ImageEntry, VaultError> {
        let tag = ImageEntry::normalize_tag(tag)?;

        self.with_data_mut(|data| {
            let key = data.encryption_key.expose_secret();
            let mut entry = Self::get_entry(&data.entries, key, id)?;

            if !entry.tags.contains(&tag) {
                entry.tags.push(tag.clone());
                Self::save_entry(&data.entries, key, &entry)?;
                data.tag_index.entry(tag).or_default().insert(id);
            }
            Ok(entry)
        })
    }

    pub fn untag_image(&self, id: Uuid, tag: &str) -> Result<ImageEntry, VaultError> {
        let tag = ImageEntry::normalize_tag(tag)?;

        self.with_data_mut(|data| {
            let key = data.encryption_key.expose_secret();
            let mut entry = Self::get_entry(&data.entries, key, id)?;

            if let Some(pos) = entry.tags.iter().position(|t| t == &tag) {
                entry.tags.remove(pos);
                Self::save_entry(&data.entries, key, &entry)?;

                if let Some(set) = data.tag_index.get_mut(&tag) {
                    set.remove(&id);
                    if set.is_empty() {
                        data.tag_index.remove(&tag);
                    }
                }
            }
            Ok(entry)
        })
    }

    pub fn rename_tag(&self, old_tag: &str, new_tag: &str) -> Result<u32, VaultError> {
        let old_tag = ImageEntry::normalize_tag(old_tag)?;
        let new_tag = ImageEntry::normalize_tag(new_tag)?;

        if old_tag == new_tag {
            return Ok(0);
        }

        self.with_data_mut(|data| {
            let image_ids: Vec<Uuid> = data
                .tag_index
                .get(&old_tag)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .collect();
            if image_ids.is_empty() {
                return Ok(0);
            }

            let key = data.encryption_key.expose_secret();
            let mut count = 0;

            for id in &image_ids {
                if let Ok(mut entry) = Self::get_entry(&data.entries, key, *id) {
                    if let Some(pos) = entry.tags.iter().position(|t| t == &old_tag) {
                        entry.tags.remove(pos);
                        if !entry.tags.contains(&new_tag) {
                            entry.tags.push(new_tag.clone());
                        }
                        Self::save_entry(&data.entries, key, &entry)?;
                        count += 1;
                    }
                }
            }

            // Update Index
            if let Some(old_ids) = data.tag_index.remove(&old_tag) {
                data.tag_index.entry(new_tag).or_default().extend(old_ids);
            }

            Ok(count)
        })
    }

    pub fn list_images(&self) -> Result<Vec<ImageEntry>, VaultError> {
        self.with_data(|data| {
            let key = data.encryption_key.expose_secret();
            let mut list = Vec::new();
            for res in data.entries.iter() {
                let (k, v) = res?;
                if let Ok(id) = Uuid::from_slice(&k) {
                    if let Ok(entry) = Self::decrypt_entry_bytes(key, id, &v) {
                        list.push(entry);
                    }
                }
            }
            list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            Ok(list)
        })
    }

    pub fn search_by_tags(
        &self,
        include: &[String],
        exclude: &[String],
    ) -> Result<Vec<ImageEntry>, VaultError> {
        if include.is_empty() && exclude.is_empty() {
            return self.list_images();
        }

        self.with_data(|data| {
            // FIX: Unroll map to handle ? safely
            let mut sets = Vec::new();
            for t in include {
                let normalized = ImageEntry::normalize_tag(t)?;
                let set = data.tag_index.get(&normalized).cloned().unwrap_or_default();
                sets.push(set);
            }

            let mut candidates = if include.is_empty() {
                data.entries
                    .iter()
                    .filter_map(|r| r.ok())
                    .filter_map(|(k, _)| Uuid::from_slice(&k).ok())
                    .collect::<HashSet<_>>()
            } else {
                sets.sort_by_key(|s| s.len());
                if sets[0].is_empty() {
                    return Ok(Vec::new());
                }

                let mut res = sets[0].clone();
                for set in sets.iter().skip(1) {
                    res.retain(|id| set.contains(id));
                    if res.is_empty() {
                        return Ok(Vec::new());
                    }
                }
                res
            };

            for tag in exclude {
                let normalized = ImageEntry::normalize_tag(tag)?;
                if let Some(set) = data.tag_index.get(&normalized) {
                    candidates.retain(|id| !set.contains(id));
                }
            }

            let key = data.encryption_key.expose_secret();
            let mut entries = Vec::new();
            for id in candidates {
                if let Ok(entry) = Self::get_entry(&data.entries, key, id) {
                    entries.push(entry);
                }
            }
            entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            Ok(entries)
        })
    }

    pub fn list_tags(&self) -> Result<Vec<String>, VaultError> {
        self.with_data(|data| {
            let mut tags: Vec<String> = data.tag_index.keys().cloned().collect();
            tags.sort();
            Ok(tags)
        })
    }

    // --- Helpers ---

    fn with_data<F, R>(&self, f: F) -> Result<R, VaultError>
    where
        F: FnOnce(&VaultData) -> Result<R, VaultError>,
    {
        let lock = self
            .data
            .read()
            .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
        match lock.as_ref() {
            Some(data) => f(data),
            None => Err(VaultError::EncryptionError),
        }
    }

    fn with_data_mut<F, R>(&self, f: F) -> Result<R, VaultError>
    where
        F: FnOnce(&mut VaultData) -> Result<R, VaultError>,
    {
        let mut lock = self
            .data
            .write()
            .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
        match lock.as_mut() {
            Some(data) => f(data),
            None => Err(VaultError::EncryptionError),
        }
    }

    fn make_aad(id: Uuid, variant: &str) -> Vec<u8> {
        let mut aad = id.as_bytes().to_vec();
        aad.extend_from_slice(variant.as_bytes());
        aad
    }

    fn get_entry(tree: &Tree, key: &[u8], id: Uuid) -> Result<ImageEntry, VaultError> {
        let bytes = tree
            .get(id.as_bytes())?
            .ok_or_else(|| VaultError::NotFound(id.to_string()))?;
        Self::decrypt_entry_bytes(key, id, &bytes)
    }

    fn decrypt_entry_bytes(key: &[u8], id: Uuid, bytes: &[u8]) -> Result<ImageEntry, VaultError> {
        let decrypted = crypto::decrypt(key, bytes, id.as_bytes())?;
        Ok(postcard::from_bytes(&decrypted)?)
    }

    fn save_entry(tree: &Tree, key: &[u8], entry: &ImageEntry) -> Result<(), VaultError> {
        let bytes = postcard::to_stdvec(entry)?;
        let encrypted = crypto::encrypt(key, &bytes, entry.id.as_bytes())?;
        tree.insert(entry.id.as_bytes(), encrypted)?;
        Ok(())
    }

    fn build_tag_index(
        entries: &Tree,
        key: &[u8],
    ) -> Result<HashMap<String, HashSet<Uuid>>, VaultError> {
        let mut index = HashMap::new();
        for res in entries.iter() {
            let (k, v) = res?;
            if let Ok(id) = Uuid::from_slice(&k) {
                if let Ok(entry) = Self::decrypt_entry_bytes(key, id, &v) {
                    for tag in entry.tags {
                        index.entry(tag).or_insert_with(HashSet::new).insert(id);
                    }
                }
            }
        }
        Ok(index)
    }

    fn load_metadata(db: &Db) -> Result<Self, VaultError> {
        let meta = match db.get("vault_version")? {
            Some(v) => {
                let ver = from_utf8(&v)?.parse::<u32>()?;
                if ver != CURRENT_VAULT_VERSION {
                    return Err(VaultError::InvalidVersion {
                        expected: CURRENT_VAULT_VERSION,
                        found: ver,
                    });
                }

                // Read created_at safely
                let created_at_bytes = db
                    .get("created_at")?
                    .ok_or(VaultError::Corruption("No date".into()))?;
                let created_at_str = from_utf8(&created_at_bytes)?;
                let created_at = created_at_str.parse::<u64>()?;

                VaultMetadata {
                    vault_version: ver,
                    created_at,
                    vault_salt: db
                        .get("vault_salt")?
                        .and_then(|x| x.as_ref().try_into().ok()),
                    master_key_check: db.get("master_key_check")?.map(|x| x.to_vec()),
                }
            }
            None => {
                let ts = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
                db.insert(
                    "vault_version",
                    CURRENT_VAULT_VERSION.to_string().as_bytes(),
                )?;
                db.insert("created_at", ts.to_string().as_bytes())?;
                db.flush()?;
                VaultMetadata {
                    vault_version: CURRENT_VAULT_VERSION,
                    created_at: ts,
                    vault_salt: None,
                    master_key_check: None,
                }
            }
        };
        Ok(Vault {
            metadata: meta,
            data: Arc::new(RwLock::new(None)),
            db: db.clone(),
        })
    }
}
