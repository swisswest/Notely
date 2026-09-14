use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "ch.westcon.notely";
const ACCOUNT: &str = "claude-api-key";
const MIN_KEY_LENGTH: usize = 20;
const MAX_KEY_LENGTH: usize = 512;

/// Der API-Key liegt ausschliesslich im Windows Credential Manager.
/// Er verlässt den Rust-Prozess nie in Richtung Frontend und wird nie geloggt.
pub struct SecretStore;

impl SecretStore {
    fn entry() -> AppResult<Entry> {
        Entry::new(SERVICE, ACCOUNT).map_err(|err| AppError::SecretStore(err.to_string()))
    }

    pub fn set_api_key(value: &str) -> AppResult<()> {
        let trimmed = value.trim();
        if trimmed.len() < MIN_KEY_LENGTH || trimmed.len() > MAX_KEY_LENGTH {
            return Err(AppError::validation("Der API-Key hat kein gültiges Format"));
        }
        if !trimmed.is_ascii() || trimmed.chars().any(|c| c.is_ascii_whitespace()) {
            return Err(AppError::validation("Der API-Key enthält ungültige Zeichen"));
        }

        Self::entry()?
            .set_password(trimmed)
            .map_err(|err| AppError::SecretStore(err.to_string()))
    }

    pub fn api_key() -> AppResult<Option<String>> {
        match Self::entry()?.get_password() {
            Ok(value) if value.trim().is_empty() => Ok(None),
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(AppError::SecretStore(err.to_string())),
        }
    }

    pub fn require_api_key() -> AppResult<String> {
        Self::api_key()?.ok_or(AppError::ApiKeyMissing)
    }

    /// Löscht den Key, indem der Eintrag geleert wird. Ein leerer Eintrag gilt
    /// überall als "nicht gesetzt".
    pub fn clear_api_key() -> AppResult<()> {
        Self::entry()?
            .set_password("")
            .map_err(|err| AppError::SecretStore(err.to_string()))
    }

    pub fn has_api_key() -> bool {
        matches!(Self::api_key(), Ok(Some(_)))
    }

    /// Maskierte Darstellung für das UI, z. B. "sk-a...9f2c".
    pub fn masked_hint() -> AppResult<Option<String>> {
        let Some(key) = Self::api_key()? else {
            return Ok(None);
        };
        let chars: Vec<char> = key.chars().collect();
        if chars.len() <= 12 {
            return Ok(Some("*".repeat(chars.len())));
        }
        let head: String = chars.iter().take(6).collect();
        let tail: String = chars.iter().skip(chars.len() - 4).collect();
        Ok(Some(format!("{head}...{tail}")))
    }
}
