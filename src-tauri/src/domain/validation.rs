use crate::db::models::{TaskDraft, TaskEdit};
use crate::domain::time;
use crate::error::{AppError, AppResult};

pub const MAX_NOTE_CHARS: usize = 100_000;
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_DESCRIPTION_CHARS: usize = 4000;

pub fn note_content(content: &str) -> AppResult<String> {
    if content.trim().is_empty() {
        return Err(AppError::validation("Die Notiz ist leer"));
    }
    if content.chars().count() > MAX_NOTE_CHARS {
        return Err(AppError::validation(format!(
            "Die Notiz ist länger als {MAX_NOTE_CHARS} Zeichen"
        )));
    }
    Ok(content.to_string())
}

pub const MAX_NAME_CHARS: usize = 60;

/// Namen für Ordner und Labels: sichtbarer Text, keine Steuerzeichen,
/// kein Zeilenumbruch, begrenzte Länge.
pub fn display_name(value: &str, label: &str) -> AppResult<String> {
    let cleaned = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if cleaned.is_empty() {
        return Err(AppError::validation(format!("{label} darf nicht leer sein")));
    }
    if cleaned.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::validation(format!(
            "{label} ist länger als {MAX_NAME_CHARS} Zeichen"
        )));
    }
    Ok(cleaned)
}

pub fn identifier(value: &str, label: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(AppError::validation(format!("Ungültige {label}")));
    }
    Ok(trimmed.to_string())
}

fn title(value: &str) -> AppResult<String> {
    let cleaned: String = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if cleaned.is_empty() {
        return Err(AppError::validation("Der Titel darf nicht leer sein"));
    }
    if cleaned.chars().count() > MAX_TITLE_CHARS {
        return Err(AppError::validation(format!(
            "Der Titel ist länger als {MAX_TITLE_CHARS} Zeichen"
        )));
    }
    Ok(cleaned)
}

fn description(value: &str) -> AppResult<String> {
    if value.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(AppError::validation(format!(
            "Die Beschreibung ist länger als {MAX_DESCRIPTION_CHARS} Zeichen"
        )));
    }
    Ok(value.trim().to_string())
}

fn due(date: Option<&str>, time_value: Option<&str>) -> AppResult<(Option<String>, Option<String>)> {
    let parsed_date = match date.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Some(
            time::parse_date(value)
                .ok_or_else(|| AppError::validation("Ungültiges Datum (erwartet YYYY-MM-DD)"))?,
        ),
        None => None,
    };

    let parsed_time = match time_value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Some(
            time::parse_time(value)
                .ok_or_else(|| AppError::validation("Ungültige Uhrzeit (erwartet HH:MM)"))?,
        ),
        None => None,
    };

    if parsed_date.is_none() && parsed_time.is_some() {
        return Err(AppError::validation("Eine Uhrzeit braucht auch ein Datum"));
    }

    Ok((
        parsed_date.map(time::format_date),
        parsed_time.map(time::format_time),
    ))
}

pub fn task_draft(mut draft: TaskDraft) -> AppResult<TaskDraft> {
    draft.title = title(&draft.title)?;
    draft.description = description(&draft.description)?;
    let (date, time_value) = due(draft.due_date.as_deref(), draft.due_time.as_deref())?;
    draft.due_date = date;
    draft.due_time = time_value;
    if let Some(confidence) = draft.confidence {
        if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
            return Err(AppError::validation("Ungültiger Confidence-Wert"));
        }
    }
    if let Some(note_id) = draft.source_note_id.as_deref() {
        draft.source_note_id = Some(identifier(note_id, "Notiz-ID")?);
    }
    Ok(draft)
}

pub fn task_edit(mut edit: TaskEdit) -> AppResult<TaskEdit> {
    edit.id = identifier(&edit.id, "Task-ID")?;
    edit.title = title(&edit.title)?;
    edit.description = description(&edit.description)?;
    let (date, time_value) = due(edit.due_date.as_deref(), edit.due_time.as_deref())?;
    edit.due_date = date;
    edit.due_time = time_value;
    Ok(edit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(title: &str, date: Option<&str>, time_value: Option<&str>) -> TaskDraft {
        TaskDraft {
            title: title.into(),
            description: String::new(),
            due_date: date.map(str::to_string),
            due_time: time_value.map(str::to_string),
            source_note_id: None,
            ai_generated: false,
            confidence: None,
        }
    }

    #[test]
    fn accepts_valid_input() {
        let valid = task_draft(draft("  Migration \n vorbereiten ", Some("2026-09-11"), Some("12:00")))
            .expect("gültig");
        assert_eq!(valid.title, "Migration vorbereiten");
        assert_eq!(valid.due_date.as_deref(), Some("2026-09-11"));
    }

    #[test]
    fn rejects_empty_title() {
        assert!(task_draft(draft("   ", None, None)).is_err());
    }

    #[test]
    fn rejects_time_without_date() {
        assert!(task_draft(draft("X", None, Some("12:00"))).is_err());
    }

    #[test]
    fn rejects_broken_date_formats() {
        assert!(task_draft(draft("X", Some("11.09.2026"), None)).is_err());
        assert!(task_draft(draft("X", Some("2026-13-01"), None)).is_err());
    }

    #[test]
    fn rejects_empty_notes() {
        assert!(note_content("   \n ").is_err());
        assert!(note_content("Inhalt").is_ok());
    }
}
