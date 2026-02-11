use super::error::VaultError;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageVariant {
    Original,
    High,
    Low,
    Thumbnail,
}

impl ImageVariant {
    pub fn filename(&self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::High => "high",
            Self::Low => "low",
            Self::Thumbnail => "thumbnail",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "original" => Some(Self::Original),
            "high" => Some(Self::High),
            "low" => Some(Self::Low),
            "thumbnail" => Some(Self::Thumbnail),
            _ => None,
        }
    }

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

impl ImageEntry {
    pub fn normalize_tag(tag: &str) -> Result<String, VaultError> {
        let normalized = tag.to_lowercase().trim().to_string();

        if normalized.is_empty() {
            return Err(VaultError::Corruption("Tag cannot be empty".into()));
        }
        if normalized.len() > 32 {
            return Err(VaultError::Corruption("Tag too long".into()));
        }
        if !normalized
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        {
            return Err(VaultError::Corruption("Invalid tag characters".into()));
        }

        Ok(normalized)
    }
}

#[derive(Clone)]
pub struct VaultMetadata {
    pub vault_version: u32,
    pub created_at: u64,
    pub vault_salt: Option<[u8; 16]>,
    pub master_key_check: Option<Vec<u8>>,
}
