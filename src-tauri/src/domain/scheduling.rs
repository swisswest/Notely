use chrono::{DateTime, Duration, Local};

use crate::db::models::{NotificationKind, Task};
use crate::domain::settings::AppSettings;
use crate::domain::time;

/// Wie lange eine verpasste Erinnerung noch nachgeholt wird. Verhindert, dass
/// nach einem längeren Aus-Zustand eine Welle alter Toasts erscheint.
pub const GRACE_MINUTES: i64 = 10;

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedNotification {
    pub kind: NotificationKind,
    pub fire_at: DateTime<Local>,
    pub due_at: DateTime<Local>,
}

impl PlannedNotification {
    /// Minutengenauer Schlüssel für die Dedupe-Tabelle.
    pub fn slot(&self) -> String {
        time::minute_key(self.fire_at)
    }
}

/// Ermittelt alle Benachrichtigungen, die für diesen Task gerade fällig sind.
/// Reine Funktion ohne Datenbank- oder Systemzugriff.
pub fn plan(task: &Task, settings: &AppSettings, now: DateTime<Local>) -> Vec<PlannedNotification> {
    let config = &settings.notifications;
    if !config.enabled || task.completed {
        return Vec::new();
    }

    if let Some(snoozed_until) = task.snoozed_until.as_deref().and_then(time::parse_rfc3339) {
        if snoozed_until > now {
            return Vec::new();
        }
        if now - snoozed_until <= Duration::minutes(GRACE_MINUTES) {
            return vec![PlannedNotification {
                kind: NotificationKind::Snooze,
                fire_at: snoozed_until,
                due_at: snoozed_until,
            }];
        }
    }

    let Some(date) = task.due_date.as_deref().and_then(time::parse_date) else {
        return Vec::new();
    };
    let parsed_time = task.due_time.as_deref().and_then(time::parse_time);
    let due_at = time::to_local(time::due_datetime(date, parsed_time));

    let mut planned = Vec::new();
    let grace = Duration::minutes(GRACE_MINUTES);

    if parsed_time.is_some() {
        for lead in &config.lead_minutes {
            let fire_at = due_at - Duration::minutes(i64::from(*lead));
            if fire_at <= now && now - fire_at <= grace && due_at > now {
                planned.push(PlannedNotification {
                    kind: NotificationKind::Lead,
                    fire_at,
                    due_at,
                });
            }
        }

        if config.notify_at_due && due_at <= now && now - due_at <= grace {
            planned.push(PlannedNotification {
                kind: NotificationKind::Due,
                fire_at: due_at,
                due_at,
            });
        }
    }

    if config.remind_overdue && now > due_at {
        let interval = i64::from(config.overdue_interval_minutes).max(5);
        let elapsed_minutes = (now - due_at).num_minutes();
        let slots = elapsed_minutes / interval;
        if slots >= 1 {
            let fire_at = due_at + Duration::minutes(slots * interval);
            planned.push(PlannedNotification {
                kind: NotificationKind::Overdue,
                fire_at,
                due_at,
            });
        }
    }

    planned
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now_at(hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 9, 11, hour, minute, 0)
            .single()
            .expect("zeitpunkt")
    }

    fn task_due(time: Option<&str>) -> Task {
        Task {
            id: "task-1".into(),
            title: "Datenbankmigration".into(),
            description: String::new(),
            created_at: "2026-09-10T09:36:00Z".into(),
            updated_at: "2026-09-10T09:36:00Z".into(),
            due_date: Some("2026-09-11".into()),
            due_time: time.map(str::to_string),
            completed: false,
            completed_at: None,
            source_note_id: None,
            ai_generated: true,
            confidence: Some(0.95),
            snoozed_until: None,
            deleted_at: None,
            recurrence: None,
            series_id: None,
            priority: Default::default(),
            labels: Vec::new(),
        }
    }

    #[test]
    fn lead_notification_fires_once_in_its_minute() {
        let settings = AppSettings::default(); // 60 und 15 Minuten Vorlauf
        let task = task_due(Some("12:00"));

        let planned = plan(&task, &settings, now_at(11, 0));
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].kind, NotificationKind::Lead);
        assert_eq!(planned[0].slot(), "2026-09-11T11:00");

        let planned = plan(&task, &settings, now_at(11, 45));
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].slot(), "2026-09-11T11:45");
    }

    #[test]
    fn nothing_fires_between_reminder_slots() {
        let settings = AppSettings::default();
        let task = task_due(Some("12:00"));
        assert!(plan(&task, &settings, now_at(11, 30)).is_empty());
    }

    #[test]
    fn due_notification_fires_at_due_time() {
        let settings = AppSettings::default();
        let task = task_due(Some("12:00"));
        let planned = plan(&task, &settings, now_at(12, 0));
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].kind, NotificationKind::Due);
    }

    #[test]
    fn missed_reminders_are_not_replayed_after_the_grace_window() {
        let settings = AppSettings::default();
        let task = task_due(Some("12:00"));
        let planned = plan(&task, &settings, now_at(12, 30));
        assert!(planned
            .iter()
            .all(|item| item.kind == NotificationKind::Overdue));
    }

    #[test]
    fn overdue_reminder_repeats_per_interval_slot() {
        let mut settings = AppSettings::default();
        settings.notifications.overdue_interval_minutes = 60;
        let task = task_due(Some("12:00"));

        let first = plan(&task, &settings, now_at(13, 5));
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].slot(), "2026-09-11T13:00");

        let same_slot = plan(&task, &settings, now_at(13, 50));
        assert_eq!(same_slot[0].slot(), "2026-09-11T13:00");

        let next_slot = plan(&task, &settings, now_at(14, 10));
        assert_eq!(next_slot[0].slot(), "2026-09-11T14:00");
    }

    #[test]
    fn tasks_without_time_only_become_overdue_after_the_day() {
        let settings = AppSettings::default();
        let task = task_due(None);
        assert!(plan(&task, &settings, now_at(12, 0)).is_empty());
        assert!(plan(&task, &settings, now_at(23, 58)).is_empty());
    }

    #[test]
    fn completed_disabled_and_snoozed_tasks_stay_silent() {
        let settings = AppSettings::default();

        let mut done = task_due(Some("12:00"));
        done.completed = true;
        assert!(plan(&done, &settings, now_at(12, 0)).is_empty());

        let mut off = settings.clone();
        off.notifications.enabled = false;
        assert!(plan(&task_due(Some("12:00")), &off, now_at(12, 0)).is_empty());

        let mut snoozed = task_due(Some("12:00"));
        snoozed.snoozed_until = Some(time::to_rfc3339(now_at(12, 30)));
        assert!(plan(&snoozed, &settings, now_at(12, 0)).is_empty());
    }

    #[test]
    fn snooze_fires_when_it_expires() {
        let settings = AppSettings::default();
        let mut task = task_due(Some("12:00"));
        task.snoozed_until = Some(time::to_rfc3339(now_at(12, 15)));

        let planned = plan(&task, &settings, now_at(12, 15));
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].kind, NotificationKind::Snooze);
    }
}
