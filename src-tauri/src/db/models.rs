use serde::{Deserialize, Serialize};

pub const ANALYSIS_STATUS_OK: &str = "ok";
pub const ANALYSIS_STATUS_EMPTY: &str = "empty";
pub const ANALYSIS_STATUS_FAILED: &str = "failed";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub analyzed_at: Option<String>,
    pub last_analysis_status: Option<String>,
    /// Eine Notiz liegt in höchstens einem Ordner.
    pub folder_id: Option<String>,
    /// Label-IDs; die Bezeichnungen löst die Oberfläche selbst auf.
    #[serde(default)]
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: String,
}

/// Welche Notizen eine Abfrage liefern soll.
#[derive(Debug, Clone, Default)]
pub struct NoteFilter {
    pub search: Option<String>,
    pub folder: FolderFilter,
    pub label_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum FolderFilter {
    #[default]
    All,
    Unfiled,
    Id(String),
}

impl FolderFilter {
    /// "all" und "none" sind reserviert, alles andere gilt als Ordner-ID.
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            None | Some("") | Some("all") => FolderFilter::All,
            Some("none") => FolderFilter::Unfiled,
            Some(id) => FolderFilter::Id(id.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    /// Lokales Kalenderdatum im Format YYYY-MM-DD.
    pub due_date: Option<String>,
    /// Lokale Uhrzeit im Format HH:MM.
    pub due_time: Option<String>,
    pub completed: bool,
    pub completed_at: Option<String>,
    pub source_note_id: Option<String>,
    pub ai_generated: bool,
    pub confidence: Option<f64>,
    /// RFC3339-Zeitpunkt, bis zu dem keine Benachrichtigung erzeugt wird.
    pub snoozed_until: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDraft {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub due_time: Option<String>,
    #[serde(default)]
    pub source_note_id: Option<String>,
    #[serde(default)]
    pub ai_generated: bool,
    #[serde(default)]
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEdit {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub due_time: Option<String>,
}

/// Ein von Claude vorgeschlagener Task, bereits validiert und mit lokal
/// aufgelöster Uhrzeit. Wird dem Benutzer zur Bestätigung angezeigt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSuggestion {
    pub title: String,
    pub description: String,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub confidence: f64,
    /// Welcher Tageszeit-Schlüssel die Uhrzeit erzeugt hat (falls vorhanden).
    pub daypart_key: Option<String>,
    pub in_past: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub note_id: String,
    pub suggestions: Vec<TaskSuggestion>,
    /// Verworfene Vorschläge inkl. Grund - für Transparenz im UI und im Log.
    pub rejected: Vec<String>,
    pub created_task_ids: Vec<String>,
    pub needs_confirmation: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationKind {
    Lead,
    Due,
    Overdue,
    Snooze,
}

impl NotificationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NotificationKind::Lead => "lead",
            NotificationKind::Due => "due",
            NotificationKind::Overdue => "overdue",
            NotificationKind::Snooze => "snooze",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::FolderFilter;

    #[test]
    fn folder_filter_reserves_all_and_none() {
        assert_eq!(FolderFilter::parse(None), FolderFilter::All);
        assert_eq!(FolderFilter::parse(Some("all")), FolderFilter::All);
        assert_eq!(FolderFilter::parse(Some("none")), FolderFilter::Unfiled);
        assert_eq!(
            FolderFilter::parse(Some("abc-123")),
            FolderFilter::Id("abc-123".into())
        );
    }
}
