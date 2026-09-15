use chrono::{DateTime, Local, NaiveDate};

use crate::db::models::{NotificationKind, Task};
use crate::domain::scheduling::PlannedNotification;
use crate::domain::settings::AppSettings;
use crate::domain::time;

/// Erzeugt Titel und Text der Benachrichtigung. Reine Funktion, damit der
/// Wortlaut testbar bleibt.
pub fn compose(
    task: &Task,
    planned: &PlannedNotification,
    settings: &AppSettings,
    now: DateTime<Local>,
) -> (String, String) {
    let due_label = describe_due(task, planned.due_at, now);

    let title = match planned.kind {
        NotificationKind::Lead => {
            let minutes = (planned.due_at - now).num_minutes().max(0);
            format!("Erinnerung - {}", humanize_lead(minutes))
        }
        NotificationKind::Due => "Task fällig".to_string(),
        NotificationKind::Overdue => "Task überfällig".to_string(),
        NotificationKind::Snooze => "Erinnerung (verschoben)".to_string(),
    };

    let mut body = format!("{}\n{}", task.title, due_label);
    if planned.kind == NotificationKind::Snooze {
        body.push_str(&format!(
            "\nErneut verschieben: {} Minuten",
            settings.notifications.default_snooze_minutes
        ));
    }

    (title, body)
}

fn humanize_lead(minutes: i64) -> String {
    match minutes {
        0 => "jetzt".to_string(),
        1 => "in 1 Minute".to_string(),
        m if m < 60 => format!("in {m} Minuten"),
        m if m < 120 => "in 1 Stunde".to_string(),
        m if m < 60 * 24 => format!("in {} Stunden", m / 60),
        m => format!("in {} Tagen", m / (60 * 24)),
    }
}

fn describe_due(task: &Task, due_at: DateTime<Local>, now: DateTime<Local>) -> String {
    let due_date = task
        .due_date
        .as_deref()
        .and_then(time::parse_date)
        .unwrap_or_else(|| due_at.date_naive());
    let day = describe_day(due_date, now.date_naive());

    match task.due_time.as_deref() {
        Some(clock) => format!("{day} um {clock}"),
        None => day,
    }
}

fn describe_day(date: NaiveDate, today: NaiveDate) -> String {
    let difference = (date - today).num_days();
    match difference {
        0 => "Heute".to_string(),
        1 => "Morgen".to_string(),
        -1 => "Gestern".to_string(),
        _ => date.format("%d.%m.%Y").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now_at(day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 9, day, hour, minute, 0)
            .single()
            .expect("zeitpunkt")
    }

    fn task(time_value: Option<&str>) -> Task {
        Task {
            id: "task-1".into(),
            title: "Datenbankmigration vorbereiten".into(),
            description: String::new(),
            created_at: "2026-09-10T09:36:00Z".into(),
            updated_at: "2026-09-10T09:36:00Z".into(),
            due_date: Some("2026-09-11".into()),
            due_time: time_value.map(str::to_string),
            completed: false,
            completed_at: None,
            source_note_id: None,
            ai_generated: true,
            confidence: Some(0.95),
            snoozed_until: None,
            deleted_at: None,
            recurrence: None,
            series_id: None,
        }
    }

    fn planned(kind: NotificationKind, day: u32, hour: u32, minute: u32) -> PlannedNotification {
        let due = now_at(day, hour, minute);
        PlannedNotification {
            kind,
            fire_at: due,
            due_at: due,
        }
    }

    #[test]
    fn due_notification_matches_expected_wording() {
        let (title, body) = compose(
            &task(Some("12:00")),
            &planned(NotificationKind::Due, 11, 12, 0),
            &AppSettings::default(),
            now_at(11, 12, 0),
        );
        assert_eq!(title, "Task fällig");
        assert_eq!(body, "Datenbankmigration vorbereiten\nHeute um 12:00");
    }

    #[test]
    fn lead_notification_mentions_remaining_time() {
        let (title, body) = compose(
            &task(Some("12:00")),
            &planned(NotificationKind::Lead, 11, 12, 0),
            &AppSettings::default(),
            now_at(11, 11, 0),
        );
        assert_eq!(title, "Erinnerung - in 1 Stunde");
        assert!(body.contains("Heute um 12:00"));
    }

    #[test]
    fn tomorrow_and_dates_are_labelled() {
        let (_, body) = compose(
            &task(Some("09:00")),
            &planned(NotificationKind::Lead, 11, 9, 0),
            &AppSettings::default(),
            now_at(10, 9, 0),
        );
        assert!(body.contains("Morgen um 09:00"));

        let (_, body) = compose(
            &task(Some("09:00")),
            &planned(NotificationKind::Overdue, 11, 9, 0),
            &AppSettings::default(),
            now_at(20, 9, 0),
        );
        assert!(body.contains("11.09.2026 um 09:00"));
    }

    #[test]
    fn tasks_without_time_omit_the_clock() {
        let (_, body) = compose(
            &task(None),
            &planned(NotificationKind::Overdue, 11, 23, 59),
            &AppSettings::default(),
            now_at(12, 8, 0),
        );
        assert_eq!(body, "Datenbankmigration vorbereiten\nGestern");
    }
}
