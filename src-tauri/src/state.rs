use crate::ai::ClaudeClient;
use crate::db::Db;

pub struct AppState {
    pub db: Db,
    pub claude: ClaudeClient,
}

impl AppState {
    pub fn new(db: Db, claude: ClaudeClient) -> Self {
        Self { db, claude }
    }
}

/// Events, die das Backend an das Frontend sendet.
pub mod events {
    pub const DATA_CHANGED: &str = "notely://data-changed";
    pub const NAVIGATE: &str = "notely://navigate";
    pub const NOTIFICATION_BLOCKED: &str = "notely://notifications-blocked";
    /// Schnellerfassung wurde geöffnet - das Eingabefeld setzt sich zurück.
    pub const QUICK_OPENED: &str = "notely://quick-opened";
    /// Vorschläge aus der Schnellerfassung, die im Hauptfenster zu bestätigen sind.
    pub const SUGGESTIONS: &str = "notely://suggestions";
}
