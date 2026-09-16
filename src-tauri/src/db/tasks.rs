use rusqlite::{params, Connection, Row, ToSql};

use super::labels;
use super::models::{Priority, Task, TaskDraft, TaskEdit};
use super::{new_id, now_utc};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, title, description, created_at, updated_at, due_date, due_time,
                       completed, completed_at, source_note_id, ai_generated, confidence,
                       snoozed_until, deleted_at, recurrence, series_id, priority";

pub const MAX_BULK: usize = 500;

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
        deleted_at: row.get(13)?,
        recurrence: row.get(14)?,
        series_id: row.get(15)?,
        priority: Priority::from_i64(row.get(16)?),
        labels: Vec::new(),
    })
}

/// Haengt die Label-IDs an eine Liste. Eine Abfrage statt N - die
/// Zuordnungstabelle ist klein.
fn attach_labels(conn: &Connection, tasks: &mut [Task]) -> AppResult<()> {
    if tasks.is_empty() {
        return Ok(());
    }
    let mut by_task = labels::by_task(conn)?;
    for task in tasks.iter_mut() {
        task.labels = by_task.remove(&task.id).unwrap_or_default();
    }
    Ok(())
}

pub fn create(conn: &Connection, draft: &TaskDraft) -> AppResult<Task> {
    let now = now_utc();
    let id = new_id();
    // Eine Serie bekommt sofort eine eigene ID, damit alle Folgeaufgaben
    // zusammengehören - auch wenn die erste später gelöscht wird.
    let series_id = draft.recurrence.as_ref().map(|_| new_id());
    conn.execute(
        "INSERT INTO tasks
           (id, title, description, created_at, updated_at, due_date, due_time,
            completed, source_note_id, ai_generated, confidence, recurrence, series_id,
            priority)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11, ?12)",
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
            draft.recurrence,
            series_id,
            draft.priority.as_i64(),
        ],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Task> {
    let sql = format!("SELECT {COLUMNS} FROM tasks WHERE id = ?1");
    let mut task = conn
        .query_row(&sql, params![id], map)
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Task {id}")),
            other => AppError::from(other),
        })?;
    task.labels = labels::by_task(conn)?.remove(id).unwrap_or_default();
    Ok(task)
}

/// Offene Tasks vollständig, erledigte nur begrenzt - die Oberfläche
/// gruppiert selbst nach Heute/Morgen/Diese Woche/Überfällig.
pub fn list(
    conn: &Connection,
    include_completed: bool,
    completed_limit: u32,
) -> AppResult<Vec<Task>> {
    let mut result = Vec::new();

    let open_sql = format!(
        "SELECT {COLUMNS} FROM tasks WHERE completed = 0 AND deleted_at IS NULL
         ORDER BY due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC,
                  priority DESC, created_at ASC"
    );
    let mut stmt = conn.prepare(&open_sql)?;
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }

    if include_completed {
        let done_sql = format!(
            "SELECT {COLUMNS} FROM tasks WHERE completed = 1 AND deleted_at IS NULL
             ORDER BY completed_at DESC LIMIT ?1"
        );
        let mut stmt = conn.prepare(&done_sql)?;
        for row in stmt.query_map(params![completed_limit.clamp(1, 500)], map)? {
            result.push(row?);
        }
    }

    attach_labels(conn, &mut result)?;
    Ok(result)
}

pub fn list_by_note(conn: &Connection, note_id: &str) -> AppResult<Vec<Task>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM tasks WHERE source_note_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![note_id], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

/// Kandidaten für den Notification-Scheduler: offen, nicht gelöscht, mit Termin.
pub fn list_schedulable(conn: &Connection) -> AppResult<Vec<Task>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM tasks
         WHERE completed = 0 AND deleted_at IS NULL AND due_date IS NOT NULL
         ORDER BY due_date ASC, due_time IS NULL, due_time ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }
    Ok(result)
}

/// Alle aktiven Tasks ohne Limit - Grundlage für Sicherungen.
pub fn list_all(conn: &Connection) -> AppResult<Vec<Task>> {
    let sql =
        format!("SELECT {COLUMNS} FROM tasks WHERE deleted_at IS NULL ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

pub fn list_deleted(conn: &Connection, limit: u32) -> AppResult<Vec<Task>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM tasks WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![limit.clamp(1, 1000)], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

pub fn search(conn: &Connection, term: &str, limit: u32) -> AppResult<Vec<Task>> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let escaped = trimmed
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");

    let sql = format!(
        "SELECT {COLUMNS} FROM tasks
         WHERE deleted_at IS NULL
           AND (title LIKE '%' || ?1 || '%' ESCAPE '\\'
                OR description LIKE '%' || ?1 || '%' ESCAPE '\\')
         ORDER BY completed ASC, due_date IS NULL, due_date ASC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![escaped, limit.clamp(1, 100)], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

pub fn update(conn: &Connection, edit: &TaskEdit) -> AppResult<Task> {
    let existing = get(conn, &edit.id)?;
    // Wird aus einer einmaligen Aufgabe eine Serie, braucht sie eine Serien-ID.
    let series_id = match (&edit.recurrence, existing.series_id) {
        (Some(_), None) => Some(new_id()),
        (Some(_), Some(current)) => Some(current),
        (None, current) => current,
    };

    let changed = conn.execute(
        "UPDATE tasks
            SET title = ?2, description = ?3, due_date = ?4, due_time = ?5,
                recurrence = ?6, series_id = ?7, priority = ?8, updated_at = ?9
          WHERE id = ?1 AND deleted_at IS NULL",
        params![
            edit.id,
            edit.title,
            edit.description,
            edit.due_date,
            edit.due_time,
            edit.recurrence,
            series_id,
            edit.priority.as_i64(),
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
        "UPDATE tasks SET completed = ?2, completed_at = ?3, updated_at = ?4
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, i64::from(completed), completed_at, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Task {id}")));
    }
    get(conn, id)
}

/// Legt die nächste Aufgabe einer Serie an. `None`, wenn es keine Wiederholung
/// gibt oder die Serie ausgelaufen ist.
///
/// Eine kaputte Regel bricht das Abhaken nicht ab - sie landet im Log und die
/// Serie endet. Alles andere würde eine Aufgabe unerledigbar machen.
pub fn advance_series(conn: &Connection, task: &Task) -> AppResult<Option<Task>> {
    let (Some(rule_text), Some(due_date)) = (task.recurrence.as_deref(), task.due_date.as_deref())
    else {
        return Ok(None);
    };

    let rule = match crate::domain::recurrence::Recurrence::parse(rule_text) {
        Ok(rule) => rule,
        Err(err) => {
            crate::logging::warn(
                "tasks",
                format!("Wiederholung von Task {} nicht lesbar: {err}", task.id),
            );
            return Ok(None);
        }
    };

    let Some(current) = crate::domain::time::parse_date(due_date) else {
        return Ok(None);
    };
    let Some(next) = rule.next(current) else {
        return Ok(None);
    };
    let next_date = crate::domain::time::format_date(next);

    // Zweimal abhaken darf keine zweite Folgeaufgabe erzeugen.
    if let Some(series_id) = task.series_id.as_deref() {
        let existing: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE series_id = ?1 AND due_date = ?2 AND deleted_at IS NULL",
            params![series_id, next_date],
            |row| row.get(0),
        )?;
        if existing > 0 {
            return Ok(None);
        }
    }

    let now = now_utc();
    let id = new_id();
    let series_id = task.series_id.clone().unwrap_or_else(new_id);
    conn.execute(
        "INSERT INTO tasks
           (id, title, description, created_at, updated_at, due_date, due_time,
            completed, source_note_id, ai_generated, confidence, recurrence, series_id,
            priority)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            task.title,
            task.description,
            now,
            next_date,
            task.due_time,
            task.source_note_id,
            i64::from(task.ai_generated),
            task.confidence,
            rule.to_rule(),
            series_id,
            task.priority.as_i64(),
        ],
    )?;

    // Die Folgeaufgabe erbt auch die Labels - sonst waere die Serie nach dem
    // ersten Abhaken nicht mehr wiederzufinden.
    let inherited = labels::by_task(conn)?.remove(&task.id).unwrap_or_default();
    if !inherited.is_empty() {
        labels::set_for_task(conn, &id, &inherited)?;
    }

    get(conn, &id).map(Some)
}

pub fn set_snoozed_until(conn: &Connection, id: &str, until: Option<&str>) -> AppResult<Task> {
    let changed = conn.execute(
        "UPDATE tasks SET snoozed_until = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, until, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Task {id}")));
    }
    get(conn, id)
}

pub fn soft_delete(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE tasks SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Task {id}")));
    }
    conn.execute(
        "DELETE FROM notification_history WHERE task_id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str) -> AppResult<Task> {
    let changed = conn.execute(
        "UPDATE tasks SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Task {id}")));
    }
    get(conn, id)
}

pub fn purge(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn purge_expired(conn: &Connection, days: i64) -> AppResult<usize> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let removed = conn.execute(
        "DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )?;
    Ok(removed)
}

/// Mehrere Tasks in einem Rutsch. Der Aufrufer hat die IDs bereits geprüft.
/// Serien laufen dabei genauso weiter wie beim einzelnen Abhaken.
pub fn bulk_set_completed(conn: &Connection, ids: &[String], completed: bool) -> AppResult<usize> {
    let now = now_utc();
    let completed_at = if completed { Some(now.clone()) } else { None };
    let mut changed = 0;
    for id in ids.iter().take(MAX_BULK) {
        let affected = conn.execute(
            "UPDATE tasks SET completed = ?2, completed_at = ?3, updated_at = ?4
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id, i64::from(completed), completed_at, now],
        )?;
        changed += affected;
        if affected > 0 && completed {
            if let Ok(task) = get(conn, id) {
                advance_series(conn, &task)?;
            }
        }
    }
    Ok(changed)
}

pub fn bulk_reschedule(
    conn: &Connection,
    ids: &[String],
    due_date: Option<&str>,
    due_time: Option<&str>,
) -> AppResult<usize> {
    let now = now_utc();
    let mut changed = 0;
    for id in ids.iter().take(MAX_BULK) {
        changed += conn.execute(
            "UPDATE tasks SET due_date = ?2, due_time = ?3, updated_at = ?4
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id, due_date, due_time, now],
        )?;
        conn.execute(
            "DELETE FROM notification_history WHERE task_id = ?1",
            params![id],
        )?;
    }
    Ok(changed)
}

pub fn bulk_delete(conn: &Connection, ids: &[String]) -> AppResult<usize> {
    let mut changed = 0;
    for id in ids.iter().take(MAX_BULK) {
        if soft_delete(conn, id).is_ok() {
            changed += 1;
        }
    }
    Ok(changed)
}

/// Offene Tasks eines Tages - Basis für den Tagesabschluss.
pub fn list_due_on(conn: &Connection, date: &str) -> AppResult<Vec<Task>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM tasks
         WHERE completed = 0 AND deleted_at IS NULL AND due_date = ?1
         ORDER BY due_time IS NULL, due_time ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![date], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

/// Hilfsfunktion für Abfragen mit dynamischer ID-Liste.
pub fn by_ids(conn: &Connection, ids: &[String]) -> AppResult<Vec<Task>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len().min(MAX_BULK)].join(", ");
    let sql = format!("SELECT {COLUMNS} FROM tasks WHERE id IN ({placeholders})");
    let values: Vec<&dyn ToSql> = ids
        .iter()
        .take(MAX_BULK)
        .map(|id| id as &dyn ToSql)
        .collect();

    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(values.as_slice(), map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
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
            recurrence: None,
            priority: Default::default(),
        }
    }

    fn repeating(title: &str, date: &str, rule: &str) -> TaskDraft {
        let mut value = draft(title, Some(date), Some("08:00"));
        value.recurrence = Some(rule.into());
        value
    }

    #[test]
    fn create_complete_reopen() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(conn, &draft("Migration", Some("2026-09-11"), Some("12:00")))?;
            assert!(!task.completed);

            let done = set_completed(conn, &task.id, true)?;
            assert!(done.completed);

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
            create(conn, &draft("spaet", Some("2026-09-11"), Some("18:00")))?;
            create(conn, &draft("frueh", Some("2026-09-11"), Some("07:00")))?;

            let titles: Vec<String> = list(conn, false, 10)?
                .into_iter()
                .map(|t| t.title)
                .collect();
            assert_eq!(titles, vec!["frueh", "spaet", "ohne Termin"]);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn deleted_tasks_disappear_everywhere_but_the_trash() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(conn, &draft("Migration", Some("2026-09-11"), Some("12:00")))?;
            soft_delete(conn, &task.id)?;

            assert!(list(conn, true, 10)?.is_empty());
            assert!(list_schedulable(conn)?.is_empty());
            assert!(list_all(conn)?.is_empty());
            assert!(search(conn, "Migration", 10)?.is_empty());
            assert_eq!(list_deleted(conn, 10)?.len(), 1);

            restore(conn, &task.id)?;
            assert_eq!(list(conn, true, 10)?.len(), 1);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn bulk_operations_touch_every_task() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let first = create(conn, &draft("A", Some("2026-09-11"), Some("09:00")))?;
            let second = create(conn, &draft("B", Some("2026-09-11"), Some("10:00")))?;
            let ids = vec![first.id.clone(), second.id.clone()];

            assert_eq!(bulk_reschedule(conn, &ids, Some("2026-09-12"), None)?, 2);
            let moved = by_ids(conn, &ids)?;
            assert!(moved
                .iter()
                .all(|task| task.due_date.as_deref() == Some("2026-09-12")));
            assert!(moved.iter().all(|task| task.due_time.is_none()));

            assert_eq!(bulk_set_completed(conn, &ids, true)?, 2);
            assert!(by_ids(conn, &ids)?.iter().all(|task| task.completed));

            assert_eq!(bulk_delete(conn, &ids)?, 2);
            assert_eq!(list_deleted(conn, 10)?.len(), 2);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn search_covers_title_and_description() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let mut with_description = draft("Meeting", None, None);
            with_description.description = "Datenbankmigration besprechen".into();
            create(conn, &with_description)?;
            create(conn, &draft("Einkaufen", None, None))?;

            assert_eq!(search(conn, "Datenbank", 10)?.len(), 1);
            assert_eq!(search(conn, "Meeting", 10)?.len(), 1);
            assert_eq!(search(conn, "Urlaub", 10)?.len(), 0);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn tasks_due_on_a_day_are_listed_in_order() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, &draft("spaet", Some("2026-09-11"), Some("18:00")))?;
            create(conn, &draft("frueh", Some("2026-09-11"), Some("08:00")))?;
            create(
                conn,
                &draft("anderer Tag", Some("2026-09-12"), Some("08:00")),
            )?;

            let titles: Vec<String> = list_due_on(conn, "2026-09-11")?
                .into_iter()
                .map(|task| task.title)
                .collect();
            assert_eq!(titles, vec!["frueh", "spaet"]);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn completing_a_series_creates_exactly_one_follow_up() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(
                conn,
                &repeating("Muell rausstellen", "2026-09-15", "weekly:1"),
            )?;
            assert!(task.series_id.is_some());

            let done = set_completed(conn, &task.id, true)?;
            let next = advance_series(conn, &done)?.expect("Folgeaufgabe");
            assert_eq!(next.due_date.as_deref(), Some("2026-09-22"));
            assert_eq!(next.due_time.as_deref(), Some("08:00"));
            assert_eq!(next.series_id, task.series_id);
            assert!(!next.completed);

            // Ein zweiter Durchlauf darf keine Dublette erzeugen.
            assert!(advance_series(conn, &done)?.is_none());
            assert_eq!(list(conn, true, 10)?.len(), 2);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn a_series_without_recurrence_stays_a_single_task() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(conn, &draft("Einmalig", Some("2026-09-15"), None))?;
            assert!(task.series_id.is_none());
            let done = set_completed(conn, &task.id, true)?;
            assert!(advance_series(conn, &done)?.is_none());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn an_expired_series_stops() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(
                conn,
                &repeating("Kurz", "2026-09-15", "daily:1|until:2026-09-15"),
            )?;
            let done = set_completed(conn, &task.id, true)?;
            assert!(advance_series(conn, &done)?.is_none());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn a_broken_rule_does_not_block_completing() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(conn, &draft("Kaputt", Some("2026-09-15"), None))?;
            conn.execute(
                "UPDATE tasks SET recurrence = 'voellig-kaputt' WHERE id = ?1",
                params![task.id],
            )?;
            let stored = get(conn, &task.id)?;
            assert!(advance_series(conn, &stored)?.is_none());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn turning_a_task_into_a_series_assigns_an_id() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(conn, &draft("Wird Serie", Some("2026-09-15"), None))?;
            let updated = update(
                conn,
                &TaskEdit {
                    id: task.id.clone(),
                    title: "Wird Serie".into(),
                    description: String::new(),
                    due_date: Some("2026-09-15".into()),
                    due_time: None,
                    recurrence: Some("monthly:1".into()),
                    priority: Default::default(),
                },
            )?;
            assert!(updated.series_id.is_some());

            // Ein zweiter Edit behält dieselbe Serien-ID.
            let again = update(
                conn,
                &TaskEdit {
                    id: task.id.clone(),
                    title: "Wird Serie".into(),
                    description: String::new(),
                    due_date: Some("2026-09-15".into()),
                    due_time: None,
                    recurrence: Some("monthly:2".into()),
                    priority: Default::default(),
                },
            )?;
            assert_eq!(again.series_id, updated.series_id);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn bulk_completing_also_advances_series() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let task = create(conn, &repeating("Taeglich", "2026-09-15", "daily:1"))?;
            assert_eq!(bulk_set_completed(conn, &[task.id.clone()], true)?, 1);

            let open: Vec<String> = list(conn, false, 10)?
                .into_iter()
                .map(|task| task.due_date.unwrap_or_default())
                .collect();
            assert_eq!(open, vec!["2026-09-16"]);
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
                    recurrence: None,
                    priority: Default::default(),
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
