use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Zentraler Fehlertyp. Jeder Fehler trägt einen stabilen Code, den das
/// Frontend auf eine Benutzermeldung abbildet. Fehlertexte enthalten niemals
/// Secrets - der API-Key wird nie in eine Fehlermeldung übernommen.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Datenbankfehler: {0}")]
    Db(String),

    #[error("Ungültige Eingabe: {0}")]
    Validation(String),

    #[error("Nicht gefunden: {0}")]
    NotFound(String),

    #[error("Es ist kein Claude API-Key hinterlegt")]
    ApiKeyMissing,

    #[error("Der Claude API-Key wurde abgelehnt")]
    Unauthorized,

    #[error("Rate Limit der Claude API erreicht")]
    RateLimited { retry_after_seconds: Option<u64> },

    #[error("Claude ist nicht erreichbar: {0}")]
    Network(String),

    #[error("Claude API Fehler ({status})")]
    Api { status: u16, message: String },

    #[error("Claude hat keine gültige Antwort geliefert: {0}")]
    InvalidAiResponse(String),

    #[error("Windows Credential Manager nicht verfügbar: {0}")]
    SecretStore(String),

    #[error("Interner Fehler: {0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Db(_) => "DB_ERROR",
            AppError::Validation(_) => "VALIDATION_ERROR",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::ApiKeyMissing => "API_KEY_MISSING",
            AppError::Unauthorized => "API_KEY_INVALID",
            AppError::RateLimited { .. } => "RATE_LIMITED",
            AppError::Network(_) => "NETWORK_ERROR",
            AppError::Api { .. } => "API_ERROR",
            AppError::InvalidAiResponse(_) => "INVALID_AI_RESPONSE",
            AppError::SecretStore(_) => "SECRET_STORE_ERROR",
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        AppError::Validation(message.into())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        AppError::Internal(message.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        let retry_after = match self {
            AppError::RateLimited {
                retry_after_seconds,
            } => *retry_after_seconds,
            _ => None,
        };
        state.serialize_field("retryAfterSeconds", &retry_after)?;
        state.end()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        AppError::Db(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        AppError::InvalidAiResponse(value.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(value: tauri::Error) -> Self {
        AppError::Internal(value.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
