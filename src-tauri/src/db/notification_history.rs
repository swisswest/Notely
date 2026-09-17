use rusqlite::{params, Connection};

use super::models::NotificationKind;
use super::now_utc;
use crate::error::AppResult;

/// Reserviert einen Benachrichtigungs-Slot. Der UNIQUE-Index sorgt dafür, dass
/// derselbe Task pro Zeitpunkt und Art genau einmal benachrichtigt wird - auch
/// wenn der Scheduler mehrfach in derselben Minute läuft.
pub fn claim(
    conn: &Connection,
    task_id: &str,
    kind: NotificationKind,
    fire_at: &str,
) -> AppResult<bool> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO notification_history (task_id, kind, fire_at, sent_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![task_id, kind.as_str(), fire_at, now_utc()],
    )?;
    Ok(changed == 1)
}

pub fn clear_for_task(conn: &Connection, task_id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM notification_history WHERE task_id = ?1",
        params![task_id],
    )?;
    Ok(())
}

/// Hält die Historie klein - ältere Einträge werden nicht mehr gebraucht.
pub fn prune(conn: &Connection, keep_days: i64) -> AppResult<usize> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(keep_days))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let removed = conn.execute(
        "DELETE FROM notification_history WHERE sent_at < ?1",
        params![cutoff],
    )?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::TaskDraft;
    use crate::db::{tasks, Db};

    fn seed_task(conn: &Connection) -> String {
        tasks::create(
            conn,
            &TaskDraft {
                title: "Migration".into(),
                description: String::new(),
                due_date: Some("2026-09-11".into()),
                due_time: Some("12:00".into()),
                source_note_id: None,
                folder_id: None,
                ai_generated: false,
                confidence: None,
                recurrence: None,
                priority: Default::default(),
            },
        )
        .expect("task")
        .id
    }

    #[test]
    fn second_claim_for_same_slot_is_rejected() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task_id = seed_task(conn);
            assert!(claim(
                conn,
                &task_id,
                NotificationKind::Due,
                "2026-09-11T12:00"
            )?);
            assert!(!claim(
                conn,
                &task_id,
                NotificationKind::Due,
                "2026-09-11T12:00"
            )?);
            assert!(!claim(
                conn,
                &task_id,
                NotificationKind::Due,
                "2026-09-11T12:00"
            )?);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn different_kind_or_slot_is_allowed() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task_id = seed_task(conn);
            assert!(claim(
                conn,
                &task_id,
                NotificationKind::Lead,
                "2026-09-11T11:00"
            )?);
            assert!(claim(
                conn,
                &task_id,
                NotificationKind::Due,
                "2026-09-11T12:00"
            )?);
            assert!(claim(
                conn,
                &task_id,
                NotificationKind::Overdue,
                "2026-09-11T13:00"
            )?);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn history_is_removed_with_the_task() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task_id = seed_task(conn);
            claim(conn, &task_id, NotificationKind::Due, "2026-09-11T12:00")?;
            tasks::purge(conn, &task_id)?;

            let remaining: i64 =
                conn.query_row("SELECT COUNT(*) FROM notification_history", [], |row| {
                    row.get(0)
                })?;
            assert_eq!(remaining, 0);
            Ok(())
        })
        .expect("operations");
    }
}
