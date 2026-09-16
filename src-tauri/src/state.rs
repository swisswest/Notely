use crate::ai::ClaudeClient;
use crate::db::Db;

pub struct AppState {
    pub db: Db,
    pub claude: ClaudeClient,
    /// Kennung des Profils, dessen Datenbank in `db` offen ist. Sie wird beim
    /// Start festgelegt und aendert sich zur Laufzeit nie - ein Profilwechsel
    /// startet die App neu.
    pub profile: String,
}

impl AppState {
    pub fn new(db: Db, claude: ClaudeClient, profile: String) -> Self {
        Self {
            db,
            claude,
            profile,
        }
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
    /// Beim Start wurde eine neuere Version gefunden.
    pub const UPDATE_AVAILABLE: &str = "notely://update-available";
}
