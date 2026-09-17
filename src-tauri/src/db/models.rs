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
    /// Gesetzt, solange die Notiz im Papierkorb liegt.
    #[serde(default)]
    pub deleted_at: Option<String>,
    /// Label-IDs; die Bezeichnungen löst die Oberfläche selbst auf.
    #[serde(default)]
    pub labels: Vec<String>,
}

/// Eine gesicherte Fassung einer Notiz. Der Originaltext geht damit selbst
/// dann nicht verloren, wenn jemand versehentlich alles ueberschreibt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersion {
    pub id: i64,
    pub note_id: String,
    pub content: String,
    pub created_at: String,
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
    /// Ordner der Ursprungsnotiz, beim Anlegen uebernommen.
    #[serde(default)]
    pub folder_id: Option<String>,
    pub ai_generated: bool,
    pub confidence: Option<f64>,
    /// RFC3339-Zeitpunkt, bis zu dem keine Benachrichtigung erzeugt wird.
    pub snoozed_until: Option<String>,
    /// Gesetzt, solange der Task im Papierkorb liegt.
    #[serde(default)]
    pub deleted_at: Option<String>,
    pub priority: Priority,
    /// Label-IDs; die Bezeichnungen loest die Oberflaeche selbst auf.
    #[serde(default)]
    pub labels: Vec<String>,
    /// Wiederholungsregel in Textform, siehe `domain::recurrence`.
    #[serde(default)]
    pub recurrence: Option<String>,
    /// Klammert alle Aufgaben einer Serie. Gesetzt, sobald eine Wiederholung
    /// existiert - auch bei der ersten Aufgabe.
    #[serde(default)]
    pub series_id: Option<String>,
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
    pub folder_id: Option<String>,
    #[serde(default)]
    pub ai_generated: bool,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub recurrence: Option<String>,
    #[serde(default)]
    pub priority: Priority,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEdit {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub due_time: Option<String>,
    #[serde(default)]
    pub recurrence: Option<String>,
    #[serde(default)]
    pub priority: Priority,
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

/// Was der Benutzer mit einem Vorschlag gemacht hat. Wird aus dem Vergleich
/// von Vorschlag und Übernahme abgeleitet, nicht vom Frontend behauptet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    Accepted,
    Edited,
    Rejected,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Accepted => "accepted",
            Verdict::Edited => "edited",
            Verdict::Rejected => "rejected",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "accepted" => Some(Verdict::Accepted),
            "edited" => Some(Verdict::Edited),
            "rejected" => Some(Verdict::Rejected),
            _ => None,
        }
    }
}

/// Dringlichkeit einer Aufgabe. Bewusst nur drei Stufen - mehr wird in der
/// Praxis nicht konsequent gepflegt und hilft dann beim Sortieren nicht mehr.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    Low,
    #[default]
    Normal,
    High,
}

impl Priority {
    pub fn as_i64(self) -> i64 {
        match self {
            Priority::Low => 0,
            Priority::Normal => 1,
            Priority::High => 2,
        }
    }

    /// Unbekannte Werte aus der Datenbank gelten als normal, damit ein
    /// kaputter Eintrag nie eine ganze Liste unlesbar macht.
    pub fn from_i64(value: i64) -> Self {
        match value {
            0 => Priority::Low,
            2 => Priority::High,
            _ => Priority::Normal,
        }
    }
}

/// Wie viel Notiztext bei einer Rückmeldung als Kontext mitgespeichert wird.
pub const MAX_EXCERPT_CHARS: usize = 200;

/// Eine Entscheidung des Benutzers im Vorschlagsdialog. `accepted` trägt den
/// Stand, der tatsächlich übernommen werden soll - er kann vom Vorschlag
/// abweichen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionDecision {
    pub original: TaskSuggestion,
    #[serde(default)]
    pub accepted: Option<TaskSuggestion>,
}

impl SuggestionDecision {
    pub fn verdict(&self) -> Verdict {
        match &self.accepted {
            None => Verdict::Rejected,
            Some(value) if value == &self.original => Verdict::Accepted,
            Some(_) => Verdict::Edited,
        }
    }
}

/// Ein abgelegter Datensatz für die Qualitätsauswertung. Bleibt vollständig
/// lokal - es gibt keinen Weg, der ihn irgendwohin sendet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackEntry {
    pub id: i64,
    pub created_at: String,
    pub note_id: Option<String>,
    pub model: String,
    pub verdict: Verdict,
    pub note_excerpt: String,
    pub suggested: TaskSuggestion,
    pub corrected: Option<TaskSuggestion>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackCounts {
    pub accepted: u32,
    pub edited: u32,
    pub rejected: u32,
}

impl FeedbackCounts {
    pub fn total(&self) -> u32 {
        self.accepted + self.edited + self.rejected
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSummary {
    /// Alles, was jemals erfasst wurde.
    pub total: FeedbackCounts,
    /// Nur die letzten 30 Tage - zeigt, ob eine Prompt-Änderung gewirkt hat.
    pub recent: FeedbackCounts,
    /// Die jüngsten Fälle, bei denen der Vorschlag nicht gepasst hat.
    pub misses: Vec<FeedbackEntry>,
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
    use super::{FolderFilter, SuggestionDecision, TaskSuggestion, Verdict};

    fn suggestion(title: &str) -> TaskSuggestion {
        TaskSuggestion {
            title: title.into(),
            description: String::new(),
            due_date: Some("2026-09-16".into()),
            due_time: Some("12:00".into()),
            confidence: 0.9,
            daypart_key: Some("noon".into()),
            in_past: false,
        }
    }

    #[test]
    fn verdict_follows_from_the_comparison() {
        let original = suggestion("Rechnung zahlen");

        let rejected = SuggestionDecision {
            original: original.clone(),
            accepted: None,
        };
        assert_eq!(rejected.verdict(), Verdict::Rejected);

        let untouched = SuggestionDecision {
            original: original.clone(),
            accepted: Some(original.clone()),
        };
        assert_eq!(untouched.verdict(), Verdict::Accepted);

        let mut changed = original.clone();
        changed.due_time = Some("09:00".into());
        let edited = SuggestionDecision {
            original,
            accepted: Some(changed),
        };
        assert_eq!(edited.verdict(), Verdict::Edited);
    }

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
