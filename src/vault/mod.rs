mod crypto;
mod db;
mod error;
mod types;

pub use error::VaultError;
pub use types::{ImageEntry, ImageVariant, LinkedImage, mime_to_ext};

use crate::vault::db::Database;
use crate::vault::types::VaultMetadata;
use rayon::prelude::*;
use secrecy::{ExposeSecret, SecretBox};
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Write},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::fs;
use uuid::Uuid;
use zip::write::{SimpleFileOptions, ZipWriter};

const DATABASE_DIR: &str = "vault/db";
const DATA_DIR: &str = "vault/storage";
const SALT_PATH: &str = "vault/.salt";

#[derive(Clone)]
struct VaultData {
    // We keep the tag index in memory
    tag_index: HashMap<String, HashSet<Uuid>>,
    encryption_key: SecretBox<[u8]>,
}

#[derive(Clone)]
pub struct Vault {
    metadata: VaultMetadata,
    // Database handle is thread-safe and can be held outside the lock
    db: Database,
    // Only mutable in-memory state needs the lock
    data: Arc<RwLock<Option<VaultData>>>,
}

impl Vault {
    pub fn new() -> Result<Self, VaultError> {
        let db = Database::open(DATABASE_DIR)?;
        let metadata = db.load_or_init_metadata()?;
        std::fs::create_dir_all(DATA_DIR)?;

        Ok(Vault {
            metadata,
            db,
            data: Arc::new(RwLock::new(None)),
        })
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

        // Decrypt master key
        let master_key_bytes = crypto::decrypt(wrapping_key.expose_secret(), check_val, &[])?;
        if master_key_bytes.len() != 32 {
            return Err(VaultError::EncryptionError);
        }
        let master_key = SecretBox::from(master_key_bytes);

        // Run DB migration if needed (v1 → v2)
        let db_version = self.db.get_version()?;
        if db_version < 2 {
            self.db.migrate_v1_to_v2(master_key.expose_secret())?;
        }

        // Load all entries to build the tag index
        let all_entries = self.db.get_all_entries(master_key.expose_secret())?;
        let tag_index = Self::build_tag_index(&all_entries);

        let mut lock = self
            .data
            .write()
            .map_err(|_| VaultError::Corruption("Lock poisoned".into()))?;
        *lock = Some(VaultData {
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

        // DB Operations
        self.db.save_salt_and_check(&salt, &key_check)?;

        // File System Operations
        fs::write(SALT_PATH, &salt).await?;

        // Update Local State
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
        // 1. Prepare data (synchronous part)
        let (id, key, entry) = self.with_data(|data| {
            let id = Uuid::new_v4();
            let key = data.encryption_key.expose_secret().to_vec();

            let entry = ImageEntry {
                id,
                original_mime: original_mime.clone(),
                original_size: size,
                created_at: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
                variants: variants.iter().map(|(v, _)| *v).collect(),
                tags: Vec::new(),
                linked_images: Vec::new(),
            };
            Ok((id, key, entry))
        })?;

        // 2. Perform IO (File system + DB)
        // We do this outside the read lock so we don't block other readers during IO
        let dir_path = format!("{}/{}", DATA_DIR, id);
        fs::create_dir_all(&dir_path).await?;

        for (variant, bytes) in &variants {
            let aad = Self::make_aad(id, variant.filename());
            let encrypted = crypto::encrypt(&key, bytes, &aad)?;
            let path = format!("{}/{}.enc", dir_path, variant.filename());
            fs::write(&path, encrypted).await?;
        }

        // Save metadata to DB
        self.db.insert_entry(&key, &entry)?;

        Ok(entry)
    }

    pub async fn retrieve_image(
        &self,
        id: Uuid,
        variant: ImageVariant,
    ) -> Result<(Vec<u8>, String), VaultError> {
        // 1. Get Key and Metadata
        let (key_vec, mime) = self.with_data(|data| {
            let key = data.encryption_key.expose_secret();
            let entry = self.db.get_entry(key, id)?;

            if !entry.variants.contains(&variant) {
                return Err(VaultError::NotFound(format!("Variant missing: {}", id)));
            }
            Ok((key.to_vec(), entry.original_mime))
        })?;

        // 2. Read File
        let path = format!("{}/{}/{}.enc", DATA_DIR, id, variant.filename());
        let encrypted_data = fs::read(&path).await?;

        let aad = Self::make_aad(id, variant.filename());
        let decrypted = crypto::decrypt(&key_vec, &encrypted_data, &aad)?;

        Ok((decrypted, variant.mime(&mime)))
    }

    pub async fn delete_image(&self, id: Uuid) -> Result<(), VaultError> {
        // 1. Update Index and DB, collect linked image IDs
        let linked_ids = self.with_data_mut(|data| {
            let mut sub_ids = Vec::new();
            if let Ok(entry) = self.db.get_entry(data.encryption_key.expose_secret(), id) {
                sub_ids = entry.linked_images.iter().map(|l| l.id).collect();
                for tag in entry.tags {
                    if let Some(set) = data.tag_index.get_mut(&tag) {
                        set.remove(&id);
                        if set.is_empty() {
                            data.tag_index.remove(&tag);
                        }
                    }
                }
            }
            self.db.remove_entry(id)?;
            Ok(sub_ids)
        })?;

        // 2. Delete cover files
        let dir = format!("{}/{}", DATA_DIR, id);
        if let Err(e) = fs::remove_dir_all(&dir).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(e.into());
            }
        }

        // 3. Delete linked image files
        for sub_id in linked_ids {
            let sub_dir = format!("{}/{}", DATA_DIR, sub_id);
            if let Err(e) = fs::remove_dir_all(&sub_dir).await {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(e.into());
                }
            }
        }

        Ok(())
    }

    // --- Tag Operations ---

    pub fn tag_image(&self, id: Uuid, tag: &str) -> Result<ImageEntry, VaultError> {
        let tag = ImageEntry::normalize_tag(tag)?;

        self.with_data_mut(|data| {
            let key = data.encryption_key.expose_secret();
            let mut entry = self.db.get_entry(key, id)?;

            if !entry.tags.contains(&tag) {
                entry.tags.push(tag.clone());
                self.db.insert_entry(key, &entry)?;
                data.tag_index.entry(tag).or_default().insert(id);
            }
            Ok(entry)
        })
    }

    pub fn untag_image(&self, id: Uuid, tag: &str) -> Result<ImageEntry, VaultError> {
        let tag = ImageEntry::normalize_tag(tag)?;

        self.with_data_mut(|data| {
            let key = data.encryption_key.expose_secret();
            let mut entry = self.db.get_entry(key, id)?;

            if let Some(pos) = entry.tags.iter().position(|t| t == &tag) {
                entry.tags.remove(pos);
                self.db.insert_entry(key, &entry)?;

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
                // We use get_entry from DB
                if let Ok(mut entry) = self.db.get_entry(key, *id) {
                    if let Some(pos) = entry.tags.iter().position(|t| t == &old_tag) {
                        entry.tags.remove(pos);
                        if !entry.tags.contains(&new_tag) {
                            entry.tags.push(new_tag.clone());
                        }
                        self.db.insert_entry(key, &entry)?;
                        count += 1;
                    }
                }
            }

            // Update Memory Index
            if let Some(old_ids) = data.tag_index.remove(&old_tag) {
                data.tag_index.entry(new_tag).or_default().extend(old_ids);
            }

            Ok(count)
        })
    }

    // --- Search/List ---

    pub fn get_entry(&self, id: Uuid) -> Result<ImageEntry, VaultError> {
        self.with_data(|data| self.db.get_entry(data.encryption_key.expose_secret(), id))
    }

    pub fn list_images(&self) -> Result<Vec<ImageEntry>, VaultError> {
        self.with_data(|data| self.db.get_all_entries(data.encryption_key.expose_secret()))
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
            let mut sets = Vec::new();
            for t in include {
                let normalized = ImageEntry::normalize_tag(t)?;
                let set = data.tag_index.get(&normalized).cloned().unwrap_or_default();
                sets.push(set);
            }

            // Filter logic (same as before)
            let mut candidates = if include.is_empty() {
                // If we have to search all, we fetch all from DB first
                let all = self
                    .db
                    .get_all_entries(data.encryption_key.expose_secret())?;
                all.into_iter().map(|e| e.id).collect::<HashSet<_>>()
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

            // Fetch specific entries
            let key = data.encryption_key.expose_secret();
            let candidate_list: Vec<Uuid> = candidates.into_iter().collect();
            let mut entries: Vec<ImageEntry> = candidate_list
                .par_iter()
                .filter_map(|&id| {
                    self.db.get_entry(key, id).ok()
                })
                .collect();

            entries.par_sort_unstable_by(|a, b| b.created_at.cmp(&a.created_at));
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

    // --- Linked Image Operations ---

    /// Adds a new image to an existing entry's linked set.
    pub async fn store_linked_image(
        &self,
        entry_id: Uuid,
        original_mime: String,
        size: u64,
        variants: Vec<(ImageVariant, Vec<u8>)>,
    ) -> Result<ImageEntry, VaultError> {
        let (key, mut entry) = self.with_data(|data| {
            let key = data.encryption_key.expose_secret().to_vec();
            let entry = self.db.get_entry(data.encryption_key.expose_secret(), entry_id)?;
            Ok((key, entry))
        })?;

        let sub_id = Uuid::new_v4();
        let dir_path = format!("{}/{}", DATA_DIR, sub_id);
        fs::create_dir_all(&dir_path).await?;

        for (variant, bytes) in &variants {
            let aad = Self::make_aad(sub_id, variant.filename());
            let encrypted = crypto::encrypt(&key, bytes, &aad)?;
            let path = format!("{}/{}.enc", dir_path, variant.filename());
            fs::write(&path, encrypted).await?;
        }

        let linked = LinkedImage {
            id: sub_id,
            original_mime,
            original_size: size,
            variants: variants.iter().map(|(v, _)| *v).collect(),
        };
        entry.linked_images.push(linked);
        self.db.insert_entry(&key, &entry)?;

        Ok(entry)
    }

    /// Removes a sub-image from a linked set.
    pub async fn remove_linked_image(
        &self,
        entry_id: Uuid,
        sub_id: Uuid,
    ) -> Result<ImageEntry, VaultError> {
        let (key, mut entry) = self.with_data(|data| {
            let key = data.encryption_key.expose_secret().to_vec();
            let entry = self.db.get_entry(data.encryption_key.expose_secret(), entry_id)?;
            Ok((key, entry))
        })?;

        let pos = entry
            .linked_images
            .iter()
            .position(|l| l.id == sub_id)
            .ok_or(VaultError::NotFound(format!(
                "Linked image {} not found",
                sub_id
            )))?;

        entry.linked_images.remove(pos);
        self.db.insert_entry(&key, &entry)?;

        // Delete sub-image files
        let dir = format!("{}/{}", DATA_DIR, sub_id);
        if let Err(e) = fs::remove_dir_all(&dir).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(e.into());
            }
        }

        Ok(entry)
    }

    /// Retrieves a specific variant of a linked sub-image.
    pub async fn retrieve_linked_image(
        &self,
        entry_id: Uuid,
        sub_id: Uuid,
        variant: ImageVariant,
    ) -> Result<(Vec<u8>, String), VaultError> {
        let (key_vec, mime) = self.with_data(|data| {
            let key = data.encryption_key.expose_secret();
            let entry = self.db.get_entry(key, entry_id)?;

            let linked = entry
                .linked_images
                .iter()
                .find(|l| l.id == sub_id)
                .ok_or(VaultError::NotFound(format!(
                    "Linked image {} not found in set {}",
                    sub_id, entry_id
                )))?;

            if !linked.variants.contains(&variant) {
                return Err(VaultError::NotFound(format!(
                    "Variant missing: {}",
                    sub_id
                )));
            }
            Ok((key.to_vec(), linked.original_mime.clone()))
        })?;

        let path = format!("{}/{}/{}.enc", DATA_DIR, sub_id, variant.filename());
        let encrypted_data = fs::read(&path).await?;
        let aad = Self::make_aad(sub_id, variant.filename());
        let decrypted = crypto::decrypt(&key_vec, &encrypted_data, &aad)?;

        Ok((decrypted, variant.mime(&mime)))
    }

    /// Downloads a linked set as a zip archive containing all original images.
    pub async fn download_linked_set(&self, id: Uuid) -> Result<Vec<u8>, VaultError> {
        let entry = self.get_entry(id)?;

        // Collect all original images
        let mut images: Vec<(String, Vec<u8>)> = Vec::new();

        // Cover image
        let (cover_data, _) = self.retrieve_image(id, ImageVariant::Original).await?;
        let ext = mime_to_ext(&entry.original_mime);
        images.push((format!("1_cover.{ext}"), cover_data));

        // Linked images
        for (i, linked) in entry.linked_images.iter().enumerate() {
            let (data, _) = self
                .retrieve_linked_image(id, linked.id, ImageVariant::Original)
                .await?;
            let lext = mime_to_ext(&linked.original_mime);
            images.push((format!("{}.{lext}", i + 2), data));
        }

        // Build zip synchronously
        let buf = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(buf);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

        for (name, data) in &images {
            zip.start_file(name, options)
                .map_err(|e| VaultError::Zip(e.to_string()))?;
            zip.write_all(data)
                .map_err(|e| VaultError::Zip(e.to_string()))?;
        }

        let result = zip
            .finish()
            .map_err(|e| VaultError::Zip(e.to_string()))?;
        Ok(result.into_inner())
    }

    // --- Core Helpers ---

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

    fn build_tag_index(entries: &[ImageEntry]) -> HashMap<String, HashSet<Uuid>> {
        let mut index = HashMap::new();
        for entry in entries {
            for tag in &entry.tags {
                index
                    .entry(tag.clone())
                    .or_insert_with(HashSet::new)
                    .insert(entry.id);
            }
        }
        index
    }
}
