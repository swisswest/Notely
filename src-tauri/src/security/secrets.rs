use keyring::Entry;

use crate::error::{AppError, AppResult};

/// So heisst der Eintrag im Windows Credential Manager. Bewusst lesbar - das
/// ist die einzige Stelle, an der ein Benutzer dem Namen jemals begegnet.
const SERVICE: &str = "Notely";
/// Frueherer Name. Wird nur noch gelesen, damit ein bestehender Key beim
/// ersten Zugriff automatisch mitwandert.
const LEGACY_SERVICE: &str = "ch.westcon.notely";
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

    fn legacy_entry() -> AppResult<Entry> {
        Entry::new(LEGACY_SERVICE, ACCOUNT).map_err(|err| AppError::SecretStore(err.to_string()))
    }

    /// Holt einen Key aus dem alten Eintrag und legt ihn unter dem neuen Namen
    /// ab. Der alte Eintrag wird geleert, nicht geloescht - so bleibt das
    /// Verhalten identisch zu `clear_api_key` und es gibt keinen Pfad, auf dem
    /// der Key doppelt herumliegt.
    fn adopt_legacy_key() -> AppResult<Option<String>> {
        let value = match Self::legacy_entry()?.get_password() {
            Ok(value) if !value.trim().is_empty() => value,
            Ok(_) => return Ok(None),
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(err) => return Err(AppError::SecretStore(err.to_string())),
        };

        Self::entry()?
            .set_password(&value)
            .map_err(|err| AppError::SecretStore(err.to_string()))?;
        let _ = Self::legacy_entry()?.set_password("");
        crate::logging::info("security", "API-Key in den neuen Eintrag uebernommen");
        Ok(Some(value))
    }

    pub fn set_api_key(value: &str) -> AppResult<()> {
        let trimmed = value.trim();
        if trimmed.len() < MIN_KEY_LENGTH || trimmed.len() > MAX_KEY_LENGTH {
            return Err(AppError::validation("Der API-Key hat kein gültiges Format"));
        }
        if !trimmed.is_ascii() || trimmed.chars().any(|c| c.is_ascii_whitespace()) {
            return Err(AppError::validation(
                "Der API-Key enthält ungültige Zeichen",
            ));
        }

        Self::entry()?
            .set_password(trimmed)
            .map_err(|err| AppError::SecretStore(err.to_string()))
    }

    pub fn api_key() -> AppResult<Option<String>> {
        match Self::entry()?.get_password() {
            // Leer heisst "bewusst entfernt" - dann wird der alte Eintrag
            // nicht wieder hervorgeholt.
            Ok(value) if value.trim().is_empty() => Ok(None),
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Self::adopt_legacy_key(),
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
