use std::sync::Arc;
use tokio::sync::RwLock;

use crate::vault::{Vault, VaultError};

#[derive(Clone)]
pub struct AppState {
    pub vault: Arc<RwLock<Vault>>,
}

impl AppState {
    pub fn new() -> Result<Self, VaultError> {
        let vault = Vault::new()?;
        Ok(AppState {
            vault: Arc::new(RwLock::new(vault)),
        })
    }
}
