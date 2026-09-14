use rusqlite::{params, Connection, Row};

use super::models::{Task, TaskDraft, TaskEdit};
use super::{new_id, now_utc};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, title, description, created_at, updated_at, due_date, due_time,
                       completed, completed_at, source_note_id, ai_generated, confidence, snoozed_until";

fn map(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        due_date: row.get(5)?,
        due_time: row.get(6)?,
        completed: row.get::<_, i64>(7)? != 0,
        completed_at: row.get(8)?,
        source_note_id: row.get(9)?,
        ai_generated: row.get::<_, i64>(10)? != 0,
        confidence: row.get(11)?,
        snoozed_until: row.get(12)?,
    })
}

pub fn create(conn: &Connection, draft: &TaskDraft) -> AppResult<Task> {
    let now = now_utc();
    let id = new_id();
    conn.execute(
        "INSERT INTO tasks
           (id, title, description, created_at, updated_at, due_date, due_time,
            completed, source_note_id, ai_generated, confidence)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, 0, ?7, ?8, ?9)",
        params![
            id,
            draft.title,
            draft.description,
            now,
            draft.due_date,
            draft.due_time,
            draft.source_note_id,
            i64::from(draft.ai_generated),
            draft.confidence,
        ],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Task> {
    let sql = format!("SELECT {COLUMNS} FROM tasks WHERE id = ?1");
    conn.query_row(&sql, params![id], map)
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Task {id}")),
            other => other.into(),
        })
}

/// Offene Tasks vollständig, erledigte nur begrenzt - die Oberfläche
/// gruppiert selbst nach Heute/Morgen/Diese Woche/Überfällig.
pub fn list(conn: &Connection, include_completed: bool, completed_limit: u32) -> AppResult<Vec<Task>> {
    let mut result = Vec::new();

    let open_sql = format!(
        "SELECT {COLUMNS} FROM tasks WHERE completed = 0
         ORDER BY due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, created_at ASC"
    );
    let mut stmt = conn.prepare(&open_sql)?;
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }

    if include_completed {
        let done_sql = format!(
            "SELECT {COLUMNS} FROM tasks WHERE completed = 1
             ORDER BY completed_at DESC LIMIT ?1"
        );
        let mut stmt = conn.prepare(&done_sql)?;
        for row in stmt.query_map(params![completed_limit.clamp(1, 500)], map)? {
            result.push(row?);
        }
    }

    Ok(result)
}

/// Alle Tasks ohne Limit - Grundlage für Sicherungen.
pub fn list_all(conn: &Connection) -> AppResult<Vec<Task>> {
    let sql = format!("SELECT {COLUMNS} FROM tasks ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }
    Ok(result)
}

pub fn list_by_note(conn: &Connection, note_id: &str) -> AppResult<Vec<Task>> {
    let sql = format!("SELECT {COLUMNS} FROM tasks WHERE source_note_id = ?1 ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![note_id], map)? {
        result.push(row?);
    }
    Ok(result)
}

/// Kandidaten für den Notification-Scheduler: offen und mit Fälligkeitsdatum.
pub fn list_schedulable(conn: &Connection) -> AppResult<Vec<Task>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM tasks
         WHERE completed = 0 AND due_date IS NOT NULL
         ORDER BY due_date ASC, due_time IS NULL, due_time ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }
    Ok(result)
}

pub fn update(conn: &Connection, edit: &TaskEdit) -> AppResult<Task> {
    let changed = conn.execute(
        "UPDATE tasks
            SET title = ?2, description = ?3, due_date = ?4, due_time = ?5, updated_at = ?6
          WHERE id = ?1",
        params![
            edit.id,
            edit.title,
            edit.description,
            edit.due_date,
            edit.due_time,
            now_utc()
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Task {}", edit.id)));
    }
    // Termin geändert: bereits verschickte Erinnerungen dürfen erneut greifen.
    conn.execute(
        "DELETE FROM notification_history WHERE task_id = ?1",
        params![edit.id],
    )?;
    get(conn, &edit.id)
}

pub fn set_completed(conn: &Connection, id: &str, completed: bool) -> AppResult<Task> {
    let now = now_utc();
    let completed_at = if completed { Some(now.clone()) } else { None };
    let changed = conn.execute(
        "UPDATE tasks SET completed = ?2, completed_at = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, i64::from(completed), completed_at, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Task {id}")));
    }
    get(conn, id)
}

pub fn set_snoozed_until(conn: &Connection, id: &str, until: Option<&str>) -> AppResult<Task> {
    let changed = conn.execute(
        "UPDATE tasks SET snoozed_until = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, until, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Task {id}")));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Task {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn draft(title: &str, date: Option<&str>, time: Option<&str>) -> TaskDraft {
        TaskDraft {
            title: title.into(),
            description: String::new(),
            due_date: date.map(str::to_string),
            due_time: time.map(str::to_string),
            source_note_id: None,
            ai_generated: false,
            confidence: None,
        }
    }

    #[test]
    fn create_complete_reopen() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(conn, &draft("Migration", Some("2026-09-11"), Some("12:00")))?;
            assert!(!task.completed);

            let done = set_completed(conn, &task.id, true)?;
            assert!(done.completed);
            assert!(done.completed_at.is_some());

            let open = set_completed(conn, &task.id, false)?;
            assert!(!open.completed);
            assert!(open.completed_at.is_none());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn open_tasks_are_sorted_by_due_datetime() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, &draft("ohne Termin", None, None))?;
            create(conn, &draft("spät", Some("2026-09-11"), Some("18:00")))?;
            create(conn, &draft("früh", Some("2026-09-11"), Some("07:00")))?;

            let titles: Vec<String> = list(conn, false, 10)?.into_iter().map(|t| t.title).collect();
            assert_eq!(titles, vec!["früh", "spät", "ohne Termin"]);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn editing_the_due_date_clears_notification_history() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(conn, &draft("Migration", Some("2026-09-11"), Some("12:00")))?;
            conn.execute(
                "INSERT INTO notification_history (task_id, kind, fire_at, sent_at)
                 VALUES (?1, 'due', '2026-09-11T12:00', '2026-09-11T12:00:00Z')",
                params![task.id],
            )?;

            update(
                conn,
                &TaskEdit {
                    id: task.id.clone(),
                    title: "Migration".into(),
                    description: String::new(),
                    due_date: Some("2026-09-12".into()),
                    due_time: Some("09:00".into()),
                },
            )?;

            let remaining: i64 = conn.query_row(
                "SELECT COUNT(*) FROM notification_history WHERE task_id = ?1",
                params![task.id],
                |row| row.get(0),
            )?;
            assert_eq!(remaining, 0);
            Ok(())
        })
        .expect("operations");
    }
}
