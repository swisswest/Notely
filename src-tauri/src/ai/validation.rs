use std::collections::HashSet;

use chrono::{DateTime, Duration, Local};

use super::schema::{RawTask, RawTaskList, MAX_TASKS_PER_NOTE};
use crate::db::models::TaskSuggestion;
use crate::domain::settings::AppSettings;
use crate::domain::time;

const MAX_TITLE_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 2000;
const MAX_PAST_DAYS: i64 = 365;
const MAX_FUTURE_DAYS: i64 = 365 * 5;

#[derive(Debug, Default)]
pub struct ValidationOutcome {
    pub suggestions: Vec<TaskSuggestion>,
    pub rejected: Vec<String>,
}

/// Claude-Ausgaben sind grundsätzlich nicht vertrauenswürdig. Hier wird jede
/// Struktur geprüft, Text bereinigt und die Uhrzeit lokal aus den Einstellungen
/// aufgelöst - das Modell liefert nur den Tageszeit-Schlüssel.
pub fn validate_and_resolve(
    raw: RawTaskList,
    settings: &AppSettings,
    now: DateTime<Local>,
) -> ValidationOutcome {
    let mut outcome = ValidationOutcome::default();
    let mut seen: HashSet<String> = HashSet::new();

    for (index, task) in raw.tasks.into_iter().enumerate() {
        if index >= MAX_TASKS_PER_NOTE {
            outcome
                .rejected
                .push(format!("Mehr als {MAX_TASKS_PER_NOTE} Vorschläge verworfen"));
            break;
        }

        match convert(task, settings, now) {
            Ok(suggestion) => {
                let fingerprint = format!(
                    "{}|{}|{}",
                    suggestion.title.to_lowercase(),
                    suggestion.due_date.clone().unwrap_or_default(),
                    suggestion.due_time.clone().unwrap_or_default()
                );
                if seen.insert(fingerprint) {
                    outcome.suggestions.push(suggestion);
                } else {
                    outcome
                        .rejected
                        .push(format!("Doppelter Vorschlag: {}", suggestion.title));
                }
            }
            Err(reason) => outcome.rejected.push(reason),
        }
    }

    outcome
}

fn convert(
    task: RawTask,
    settings: &AppSettings,
    now: DateTime<Local>,
) -> Result<TaskSuggestion, String> {
    let title = sanitize(task.title.unwrap_or_default().as_str(), MAX_TITLE_CHARS);
    if title.is_empty() {
        return Err("Vorschlag ohne Titel verworfen".to_string());
    }

    let description = sanitize(
        task.description.unwrap_or_default().as_str(),
        MAX_DESCRIPTION_CHARS,
    );

    let due_date = match task.due_date.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(value) => {
            let parsed = time::parse_date(value)
                .ok_or_else(|| format!("Ungültiges Datum '{value}' bei '{title}'"))?;
            let today = now.date_naive();
            if parsed < today - Duration::days(MAX_PAST_DAYS)
                || parsed > today + Duration::days(MAX_FUTURE_DAYS)
            {
                return Err(format!("Datum ausserhalb des gültigen Bereichs bei '{title}'"));
            }
            Some(parsed)
        }
    };

    let (due_time, daypart_key) = resolve_time(&task.time, settings, &title)?;

    if due_date.is_none() && due_time.is_some() {
        return Err(format!("Uhrzeit ohne Datum bei '{title}' verworfen"));
    }

    let confidence = match task.confidence {
        Some(value) if value.is_finite() => value.clamp(0.0, 1.0),
        Some(_) => return Err(format!("Ungültige Confidence bei '{title}'")),
        None => 0.5,
    };

    let in_past = match (due_date, due_time.as_deref()) {
        (Some(date), maybe_time) => {
            let parsed_time = maybe_time.and_then(time::parse_time);
            time::to_local(time::due_datetime(date, parsed_time)) < now
        }
        _ => false,
    };

    Ok(TaskSuggestion {
        title,
        description,
        due_date: due_date.map(time::format_date),
        due_time,
        confidence,
        daypart_key,
        in_past,
    })
}

fn resolve_time(
    raw: &Option<super::schema::RawTime>,
    settings: &AppSettings,
    title: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let Some(raw) = raw else {
        return Ok((None, None));
    };

    match raw.kind.as_deref().unwrap_or("none") {
        "none" => Ok((None, None)),
        "daypart" => {
            let key = raw
                .daypart
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("Tageszeit fehlt bei '{title}'"))?;
            let daypart = settings
                .daypart(key)
                .ok_or_else(|| format!("Unbekannte Tageszeit '{key}' bei '{title}'"))?;
            // Die Uhrzeit kommt immer aus den Einstellungen, nie aus dem Modell.
            Ok((Some(daypart.time.clone()), Some(daypart.key.clone())))
        }
        "exact" => {
            let value = raw
                .exact
                .as_deref()
                .map(str::trim)
                .ok_or_else(|| format!("Uhrzeit fehlt bei '{title}'"))?;
            let parsed = time::parse_time(value)
                .ok_or_else(|| format!("Ungültige Uhrzeit '{value}' bei '{title}'"))?;
            Ok((Some(time::format_time(parsed)), None))
        }
        other => Err(format!("Unbekannter Zeittyp '{other}' bei '{title}'")),
    }
}

/// Entfernt Steuerzeichen, normalisiert Whitespace und begrenzt die Länge.
fn sanitize(input: &str, max_chars: usize) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(max_chars).collect::<String>().trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::settings::AppSettings;
    use chrono::TimeZone;

    fn now_at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .single()
            .expect("eindeutiger Zeitpunkt")
    }

    fn parse(json: &str) -> RawTaskList {
        serde_json::from_str(json).expect("valides Test-JSON")
    }

    #[test]
    fn resolves_daypart_from_settings() {
        // Aktuell: 10.09.2026 09:36, "Morgen Mittag Datenbank prüfen"
        let settings = AppSettings::default();
        let raw = parse(
            r#"{"tasks":[{"title":"Datenbank prüfen","dueDate":"2026-09-11",
                 "time":{"kind":"daypart","daypart":"noon"},"confidence":0.95}]}"#,
        );

        let outcome = validate_and_resolve(raw, &settings, now_at(2026, 9, 10, 9, 36));

        assert_eq!(outcome.suggestions.len(), 1);
        let suggestion = &outcome.suggestions[0];
        assert_eq!(suggestion.due_date.as_deref(), Some("2026-09-11"));
        assert_eq!(suggestion.due_time.as_deref(), Some("12:00"));
        assert_eq!(suggestion.daypart_key.as_deref(), Some("noon"));
        assert!(!suggestion.in_past);
    }

    #[test]
    fn daypart_follows_changed_setting() {
        // Evening auf 18:30 gestellt, "heute Abend Nico schreiben"
        let mut settings = AppSettings::default();
        let evening = settings
            .dayparts
            .iter_mut()
            .find(|part| part.key == "evening")
            .expect("evening");
        evening.time = "18:30".into();

        let raw = parse(
            r#"{"tasks":[{"title":"Nico schreiben","dueDate":"2026-09-10",
                 "time":{"kind":"daypart","daypart":"evening"},"confidence":0.9}]}"#,
        );

        let outcome = validate_and_resolve(raw, &settings, now_at(2026, 9, 10, 9, 36));

        assert_eq!(outcome.suggestions[0].due_date.as_deref(), Some("2026-09-10"));
        assert_eq!(outcome.suggestions[0].due_time.as_deref(), Some("18:30"));
    }

    #[test]
    fn accepts_exact_time() {
        let raw = parse(
            r#"{"tasks":[{"title":"Call","dueDate":"2026-09-10",
                 "time":{"kind":"exact","exact":"11:36"},"confidence":0.8}]}"#,
        );
        let outcome = validate_and_resolve(raw, &AppSettings::default(), now_at(2026, 9, 10, 9, 36));
        assert_eq!(outcome.suggestions[0].due_time.as_deref(), Some("11:36"));
        assert!(outcome.suggestions[0].daypart_key.is_none());
    }

    #[test]
    fn marks_past_due_dates() {
        let raw = parse(
            r#"{"tasks":[{"title":"Rückblick","dueDate":"2026-09-09",
                 "time":{"kind":"exact","exact":"08:00"},"confidence":0.9}]}"#,
        );
        let outcome = validate_and_resolve(raw, &AppSettings::default(), now_at(2026, 9, 10, 9, 36));
        assert!(outcome.suggestions[0].in_past);
    }

    #[test]
    fn rejects_unknown_daypart() {
        let raw = parse(
            r#"{"tasks":[{"title":"X","dueDate":"2026-09-11",
                 "time":{"kind":"daypart","daypart":"teatime"},"confidence":0.9}]}"#,
        );
        let outcome = validate_and_resolve(raw, &AppSettings::default(), now_at(2026, 9, 10, 9, 36));
        assert!(outcome.suggestions.is_empty());
        assert_eq!(outcome.rejected.len(), 1);
    }

    #[test]
    fn rejects_broken_date_and_time() {
        let raw = parse(
            r#"{"tasks":[
                {"title":"A","dueDate":"11.09.2026","time":{"kind":"none"},"confidence":0.9},
                {"title":"B","dueDate":"2026-09-11","time":{"kind":"exact","exact":"25:00"},"confidence":0.9}
            ]}"#,
        );
        let outcome = validate_and_resolve(raw, &AppSettings::default(), now_at(2026, 9, 10, 9, 36));
        assert!(outcome.suggestions.is_empty());
        assert_eq!(outcome.rejected.len(), 2);
    }

    #[test]
    fn empty_task_list_is_valid() {
        let outcome = validate_and_resolve(
            parse(r#"{"tasks":[]}"#),
            &AppSettings::default(),
            now_at(2026, 9, 10, 9, 36),
        );
        assert!(outcome.suggestions.is_empty());
        assert!(outcome.rejected.is_empty());
    }

    #[test]
    fn drops_duplicates_and_empty_titles() {
        let raw = parse(
            r#"{"tasks":[
                {"title":"Nico informieren","dueDate":"2026-09-11","time":{"kind":"daypart","daypart":"evening"},"confidence":0.9},
                {"title":"nico informieren","dueDate":"2026-09-11","time":{"kind":"daypart","daypart":"evening"},"confidence":0.4},
                {"title":"   ","dueDate":null,"time":{"kind":"none"},"confidence":0.9}
            ]}"#,
        );
        let outcome = validate_and_resolve(raw, &AppSettings::default(), now_at(2026, 9, 10, 9, 36));
        assert_eq!(outcome.suggestions.len(), 1);
        assert_eq!(outcome.rejected.len(), 2);
    }

    #[test]
    fn sanitizes_control_characters_and_length() {
        let long_title = "a".repeat(500);
        let raw: RawTaskList = serde_json::from_value(serde_json::json!({
            "tasks": [{
                "title": format!("Zeile1\nZeile2\t{long_title}"),
                "dueDate": null,
                "time": {"kind": "none"},
                "confidence": 1.5
            }]
        }))
        .expect("json");

        let outcome = validate_and_resolve(raw, &AppSettings::default(), now_at(2026, 9, 10, 9, 36));
        let suggestion = &outcome.suggestions[0];
        assert!(!suggestion.title.contains('\n'));
        assert_eq!(suggestion.title.chars().count(), MAX_TITLE_CHARS);
        assert_eq!(suggestion.confidence, 1.0);
    }

    #[test]
    fn time_without_date_is_rejected() {
        let raw = parse(
            r#"{"tasks":[{"title":"X","dueDate":null,"time":{"kind":"exact","exact":"09:00"},"confidence":0.9}]}"#,
        );
        let outcome = validate_and_resolve(raw, &AppSettings::default(), now_at(2026, 9, 10, 9, 36));
        assert!(outcome.suggestions.is_empty());
    }

    #[test]
    fn missing_confidence_defaults_to_uncertain() {
        let raw = parse(r#"{"tasks":[{"title":"X","dueDate":null,"time":{"kind":"none"}}]}"#);
        let outcome = validate_and_resolve(raw, &AppSettings::default(), now_at(2026, 9, 10, 9, 36));
        assert_eq!(outcome.suggestions[0].confidence, 0.5);
    }
}
