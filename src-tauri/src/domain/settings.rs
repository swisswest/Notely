use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const DEFAULT_MODEL: &str = "claude-sonnet-4-5";
const MAX_LEAD_ENTRIES: usize = 5;
const MAX_LEAD_MINUTES: u32 = 7 * 24 * 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Daypart {
    /// Stabiler Schlüssel, den auch das AI-Schema verwendet.
    pub key: String,
    /// Anzeigename, frei durch den Benutzer änderbar.
    pub label: String,
    /// Lokale Uhrzeit im Format HH:MM.
    pub time: String,
}

impl Daypart {
    fn new(key: &str, label: &str, time: &str) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            time: time.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClaudeSettings {
    pub model: String,
    pub max_output_tokens: u32,
}

impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_string(),
            max_output_tokens: 2048,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationSettings {
    pub enabled: bool,
    /// Vorlaufzeiten in Minuten, z. B. [60, 15].
    pub lead_minutes: Vec<u32>,
    pub notify_at_due: bool,
    pub remind_overdue: bool,
    pub overdue_interval_minutes: u32,
    pub default_snooze_minutes: u32,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            lead_minutes: vec![60, 15],
            notify_at_due: true,
            remind_overdue: true,
            overdue_interval_minutes: 60,
            default_snooze_minutes: 15,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowsSettings {
    pub autostart: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
}

impl Default for WindowsSettings {
    fn default() -> Self {
        Self {
            autostart: false,
            start_minimized: true,
            close_to_tray: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    pub auto_analyze_on_save: bool,
    pub confirm_before_create: bool,
    /// Vorschläge unterhalb dieser Schwelle werden nie automatisch angelegt.
    pub auto_create_min_confidence: f64,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            auto_analyze_on_save: false,
            confirm_before_create: true,
            auto_create_min_confidence: 0.7,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    pub theme: ThemeMode,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: ThemeMode::System,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub claude: ClaudeSettings,
    pub dayparts: Vec<Daypart>,
    pub notifications: NotificationSettings,
    pub windows: WindowsSettings,
    pub ai: AiSettings,
    pub appearance: AppearanceSettings,
    pub backup: BackupSettings,
    pub quick_capture: QuickCaptureSettings,
    pub review: ReviewSettings,
    /// IANA-Zeitzone, vom Frontend beim Start gemeldet.
    pub timezone: String,
    pub onboarding_completed: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            claude: ClaudeSettings::default(),
            dayparts: default_dayparts(),
            notifications: NotificationSettings::default(),
            windows: WindowsSettings::default(),
            ai: AiSettings::default(),
            appearance: AppearanceSettings::default(),
            backup: BackupSettings::default(),
            quick_capture: QuickCaptureSettings::default(),
            review: ReviewSettings::default(),
            timezone: String::new(),
            onboarding_completed: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupSettings {
    /// Beim Start sichern, wenn das letzte Backup älter als 20 Stunden ist.
    pub enabled: bool,
    /// Leer = Standardordner (Dokumente/Notely Backups).
    pub directory: String,
    /// Wie viele Sicherungen aufbewahrt werden.
    pub keep: u32,
    pub last_backup_at: Option<String>,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            directory: String::new(),
            keep: 14,
            last_backup_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuickCaptureSettings {
    pub enabled: bool,
    /// Systemweites Kürzel, z. B. "Ctrl+Alt+N".
    pub shortcut: String,
    /// Nach dem Erfassen direkt analysieren, falls ein API-Key hinterlegt ist.
    pub analyze: bool,
}

impl Default for QuickCaptureSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            shortcut: "Ctrl+Alt+N".to_string(),
            analyze: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReviewSettings {
    pub enabled: bool,
    /// Ab dieser Uhrzeit gilt der Tagesabschluss als fällig.
    pub time: String,
    /// Letzter Tag, an dem der Abschluss abgeschlossen wurde (YYYY-MM-DD).
    pub last_completed_date: Option<String>,
    /// Letzter Tag, an dem dafür benachrichtigt wurde.
    pub last_notified_date: Option<String>,
}

impl Default for ReviewSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            time: "18:00".to_string(),
            last_completed_date: None,
            last_notified_date: None,
        }
    }
}

/// Grobe Formatprüfung. Ob das Kürzel tatsächlich frei ist, zeigt erst die
/// Registrierung beim Betriebssystem.
pub fn is_valid_shortcut(shortcut: &str) -> bool {
    let parts: Vec<&str> = shortcut.split('+').map(str::trim).collect();
    if parts.len() < 2 || parts.len() > 4 {
        return false;
    }
    parts.iter().all(|part| {
        !part.is_empty()
            && part.len() <= 12
            && part.chars().all(|c| c.is_ascii_alphanumeric())
    })
}

pub fn default_dayparts() -> Vec<Daypart> {
    vec![
        Daypart::new("morning", "Morgen", "07:00"),
        Daypart::new("noon", "Mittag", "12:00"),
        Daypart::new("afternoon", "Nachmittag", "15:00"),
        Daypart::new("evening", "Abend", "18:00"),
        Daypart::new("night", "Nacht", "22:00"),
    ]
}

impl AppSettings {
    pub fn daypart(&self, key: &str) -> Option<&Daypart> {
        self.dayparts.iter().find(|part| part.key == key)
    }

    pub fn validate(&self) -> AppResult<()> {
        if self.claude.model.trim().is_empty() {
            return Err(AppError::validation("Modellname darf nicht leer sein"));
        }
        if self.claude.model.len() > 100
            || !self
                .claude
                .model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
        {
            return Err(AppError::validation("Modellname enthält ungültige Zeichen"));
        }
        if !(256..=8192).contains(&self.claude.max_output_tokens) {
            return Err(AppError::validation(
                "max_output_tokens muss zwischen 256 und 8192 liegen",
            ));
        }
        if self.dayparts.is_empty() {
            return Err(AppError::validation("Mindestens eine Tageszeit ist nötig"));
        }
        if self.dayparts.len() > 12 {
            return Err(AppError::validation("Maximal 12 Tageszeiten"));
        }

        let mut keys = std::collections::HashSet::new();
        for part in &self.dayparts {
            if !is_valid_key(&part.key) {
                return Err(AppError::validation(format!(
                    "Ungültiger Tageszeit-Schlüssel: {}",
                    part.key
                )));
            }
            if !keys.insert(part.key.as_str()) {
                return Err(AppError::validation(format!(
                    "Tageszeit-Schlüssel doppelt vergeben: {}",
                    part.key
                )));
            }
            if part.label.trim().is_empty() || part.label.chars().count() > 40 {
                return Err(AppError::validation("Tageszeit-Bezeichnung ist ungültig"));
            }
            crate::domain::time::parse_time(&part.time).ok_or_else(|| {
                AppError::validation(format!("Ungültige Uhrzeit für {}: {}", part.key, part.time))
            })?;
        }

        if self.notifications.lead_minutes.len() > MAX_LEAD_ENTRIES {
            return Err(AppError::validation(format!(
                "Maximal {MAX_LEAD_ENTRIES} Vorlaufzeiten"
            )));
        }
        if self
            .notifications
            .lead_minutes
            .iter()
            .any(|minutes| *minutes == 0 || *minutes > MAX_LEAD_MINUTES)
        {
            return Err(AppError::validation(
                "Vorlaufzeit muss zwischen 1 Minute und 7 Tagen liegen",
            ));
        }
        if !(5..=1440).contains(&self.notifications.overdue_interval_minutes) {
            return Err(AppError::validation(
                "Intervall für überfällige Tasks muss zwischen 5 und 1440 Minuten liegen",
            ));
        }
        if !(1..=1440).contains(&self.notifications.default_snooze_minutes) {
            return Err(AppError::validation(
                "Snooze muss zwischen 1 und 1440 Minuten liegen",
            ));
        }
        if !(0.0..=1.0).contains(&self.ai.auto_create_min_confidence) {
            return Err(AppError::validation(
                "Confidence-Schwelle muss zwischen 0 und 1 liegen",
            ));
        }
        if self.timezone.len() > 64 {
            return Err(AppError::validation("Zeitzone ist ungültig"));
        }

        if !(1..=200).contains(&self.backup.keep) {
            return Err(AppError::validation(
                "Anzahl aufbewahrter Sicherungen muss zwischen 1 und 200 liegen",
            ));
        }
        if self.backup.directory.len() > 400 {
            return Err(AppError::validation("Backup-Pfad ist zu lang"));
        }
        if crate::domain::time::parse_time(&self.review.time).is_none() {
            return Err(AppError::validation(
                "Uhrzeit für den Tagesabschluss ist ungültig",
            ));
        }
        if self.quick_capture.enabled && !is_valid_shortcut(&self.quick_capture.shortcut) {
            return Err(AppError::validation(
                "Kürzel muss die Form \"Ctrl+Alt+N\" haben",
            ));
        }

        Ok(())
    }

    /// Doppelte oder unsortierte Vorlaufzeiten bereinigen, damit der Scheduler
    /// deterministisch arbeitet.
    pub fn normalized(mut self) -> Self {
        self.notifications.lead_minutes.sort_unstable();
        self.notifications.lead_minutes.dedup();
        self.notifications.lead_minutes.reverse();
        self.claude.model = self.claude.model.trim().to_string();
        self.backup.directory = self.backup.directory.trim().to_string();
        self.quick_capture.shortcut = self
            .quick_capture
            .shortcut
            .split('+')
            .map(str::trim)
            .collect::<Vec<_>>()
            .join("+");
        self
    }
}

fn is_valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 32
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        AppSettings::default().validate().expect("defaults valid");
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings: AppSettings = serde_json::from_str("{}").expect("parse");
        assert_eq!(settings.dayparts.len(), 5);
        assert_eq!(settings.claude.model, DEFAULT_MODEL);
        assert!(settings.notifications.enabled);
    }

    #[test]
    fn partial_json_keeps_known_values() {
        let settings: AppSettings =
            serde_json::from_str(r#"{"claude":{"model":"claude-haiku-4-5"}}"#).expect("parse");
        assert_eq!(settings.claude.model, "claude-haiku-4-5");
        assert_eq!(settings.claude.max_output_tokens, 2048);
    }

    #[test]
    fn rejects_broken_daypart_time() {
        let mut settings = AppSettings::default();
        settings.dayparts[0].time = "25:00".into();
        assert!(settings.validate().is_err());
    }

    #[test]
    fn rejects_duplicate_keys() {
        let mut settings = AppSettings::default();
        settings.dayparts[1].key = settings.dayparts[0].key.clone();
        assert!(settings.validate().is_err());
    }

    #[test]
    fn shortcut_format_is_checked() {
        assert!(is_valid_shortcut("Ctrl+Alt+N"));
        assert!(is_valid_shortcut("Ctrl+Shift+Alt+K"));
        assert!(!is_valid_shortcut("N"));
        assert!(!is_valid_shortcut("Ctrl+"));
        assert!(!is_valid_shortcut("Ctrl + Alt + ;"));
        assert!(!is_valid_shortcut(""));
    }

    #[test]
    fn rejects_broken_shortcut_only_when_enabled() {
        let mut settings = AppSettings::default();
        settings.quick_capture.shortcut = "kaputt".into();
        assert!(settings.validate().is_err());

        settings.quick_capture.enabled = false;
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn normalizes_lead_minutes_descending_and_unique() {
        let mut settings = AppSettings::default();
        settings.notifications.lead_minutes = vec![15, 60, 15, 5];
        let normalized = settings.normalized();
        assert_eq!(normalized.notifications.lead_minutes, vec![60, 15, 5]);
    }
}
