use rusqlite::{params, Connection, Row, ToSql};

use super::labels;
use super::models::{FolderFilter, Note, NoteFilter};
use super::{new_id, now_utc};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, content, created_at, updated_at, analyzed_at, last_analysis_status,
                       folder_id, deleted_at";

fn map(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        content: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        analyzed_at: row.get(4)?,
        last_analysis_status: row.get(5)?,
        folder_id: row.get(6)?,
        deleted_at: row.get(7)?,
        labels: Vec::new(),
    })
}

pub fn create(conn: &Connection, content: &str, folder_id: Option<&str>) -> AppResult<Note> {
    let now = now_utc();
    let id = new_id();
    conn.execute(
        "INSERT INTO notes (id, content, created_at, updated_at, folder_id)
         VALUES (?1, ?2, ?3, ?3, ?4)",
        params![id, content, now, folder_id],
    )?;
    get(conn, &id)
}

pub fn update_content(conn: &Connection, id: &str, content: &str) -> AppResult<Note> {
    let changed = conn.execute(
        "UPDATE notes SET content = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, content, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    get(conn, id)
}

pub fn set_folder(conn: &Connection, id: &str, folder_id: Option<&str>) -> AppResult<Note> {
    let changed = conn.execute(
        "UPDATE notes SET folder_id = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, folder_id, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    get(conn, id)
}

/// Löschen heisst zunächst nur: als gelöscht markieren. Erst `purge` entfernt
/// die Zeile wirklich - so ist jedes Versehen umkehrbar.
pub fn soft_delete(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE notes SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    Ok(())
}

pub fn restore(conn: &Connection, id: &str) -> AppResult<Note> {
    let changed = conn.execute(
        "UPDATE notes SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    get(conn, id)
}

pub fn purge(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

/// Entfernt endgültig, was länger als `days` im Papierkorb liegt.
pub fn purge_expired(conn: &Connection, days: i64) -> AppResult<usize> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let removed = conn.execute(
        "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )?;
    Ok(removed)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Note> {
    let sql = format!("SELECT {COLUMNS} FROM notes WHERE id = ?1");
    let mut note = conn
        .query_row(&sql, params![id], map)
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Notiz {id}")),
            other => AppError::from(other),
        })?;
    note.labels = labels::by_note(conn)?.remove(id).unwrap_or_default();
    Ok(note)
}

/// Gefilterte Notizliste. Alle Werte werden gebunden - im SQL landen nur
/// generierte Platzhalter, nie Benutzereingaben.
pub fn list(conn: &Connection, filter: &NoteFilter, limit: u32) -> AppResult<Vec<Note>> {
    let limit = limit.clamp(1, 1000);
    let mut clauses: Vec<String> = vec!["deleted_at IS NULL".to_string()];
    let mut values: Vec<Box<dyn ToSql>> = Vec::new();

    if let Some(term) = filter.search.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        clauses.push("content LIKE '%' || ? || '%' ESCAPE '\\'".to_string());
        values.push(Box::new(escape_like(term)));
    }

    match &filter.folder {
        FolderFilter::All => {}
        FolderFilter::Unfiled => clauses.push("folder_id IS NULL".to_string()),
        FolderFilter::Id(id) => {
            clauses.push("folder_id = ?".to_string());
            values.push(Box::new(id.clone()));
        }
    }

    if !filter.label_ids.is_empty() {
        // Alle gewählten Labels müssen gesetzt sein (UND-Verknüpfung).
        let placeholders = vec!["?"; filter.label_ids.len()].join(", ");
        clauses.push(format!(
            "id IN (SELECT note_id FROM note_labels WHERE label_id IN ({placeholders})
                    GROUP BY note_id HAVING COUNT(DISTINCT label_id) = ?)"
        ));
        for label_id in &filter.label_ids {
            values.push(Box::new(label_id.clone()));
        }
        values.push(Box::new(filter.label_ids.len() as i64));
    }

    let sql = format!(
        "SELECT {COLUMNS} FROM notes WHERE {} ORDER BY updated_at DESC LIMIT ?",
        clauses.join(" AND ")
    );
    values.push(Box::new(limit));

    let params: Vec<&dyn ToSql> = values.iter().map(|value| value.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params.as_slice(), map)? {
        result.push(row?);
    }

    attach_labels(conn, &mut result)?;
    Ok(result)
}

/// Inhalt der Notizen im Papierkorb, neueste Löschung zuerst.
pub fn list_deleted(conn: &Connection, limit: u32) -> AppResult<Vec<Note>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM notes WHERE deleted_at IS NOT NULL
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

pub fn search(conn: &Connection, term: &str, limit: u32) -> AppResult<Vec<Note>> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let sql = format!(
        "SELECT {COLUMNS} FROM notes
         WHERE deleted_at IS NULL AND content LIKE '%' || ?1 || '%' ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![escape_like(trimmed), limit.clamp(1, 100)], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

/// Alle aktiven Notizen ohne Filter und Limit - Grundlage für Sicherungen.
pub fn list_all(conn: &Connection) -> AppResult<Vec<Note>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM notes WHERE deleted_at IS NULL ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

pub fn set_analysis_status(conn: &Connection, id: &str, status: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE notes SET analyzed_at = ?2, last_analysis_status = ?3 WHERE id = ?1",
        params![id, now_utc(), status],
    )?;
    Ok(())
}

fn attach_labels(conn: &Connection, notes: &mut [Note]) -> AppResult<()> {
    let mut assignments = labels::by_note(conn)?;
    for note in notes.iter_mut() {
        note.labels = assignments.remove(&note.id).unwrap_or_default();
    }
    Ok(())
}

fn escape_like(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{folders, labels, Db};

    fn filter() -> NoteFilter {
        NoteFilter::default()
    }

    #[test]
    fn create_update_search_delete() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = create(conn, "Morgen Mittag Datenbankmigration", None)?;
            assert!(note.folder_id.is_none());

            let updated = update_content(conn, &note.id, "Neuer Text")?;
            assert_eq!(updated.content, "Neuer Text");

            let mut search_filter = filter();
            search_filter.search = Some("Neuer".into());
            assert_eq!(list(conn, &search_filter, 50)?.len(), 1);

            soft_delete(conn, &note.id)?;
            assert_eq!(list(conn, &filter(), 50)?.len(), 0);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn deleted_notes_land_in_the_trash_and_come_back() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = create(conn, "Versehen", None)?;
            soft_delete(conn, &note.id)?;

            assert!(list(conn, &filter(), 50)?.is_empty());
            assert_eq!(list_deleted(conn, 50)?.len(), 1);

            let restored = restore(conn, &note.id)?;
            assert!(restored.deleted_at.is_none());
            assert_eq!(list(conn, &filter(), 50)?.len(), 1);
            assert!(list_deleted(conn, 50)?.is_empty());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn deleting_twice_is_rejected() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = create(conn, "Inhalt", None)?;
            soft_delete(conn, &note.id)?;
            assert!(soft_delete(conn, &note.id).is_err());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn expired_trash_is_purged() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let fresh = create(conn, "frisch", None)?;
            let old = create(conn, "alt", None)?;
            soft_delete(conn, &fresh.id)?;
            conn.execute(
                "UPDATE notes SET deleted_at = '2020-01-01T00:00:00Z' WHERE id = ?1",
                params![old.id],
            )?;

            assert_eq!(purge_expired(conn, 30)?, 1);
            assert_eq!(list_deleted(conn, 50)?.len(), 1);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn backups_and_search_ignore_the_trash() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let visible = create(conn, "sichtbare Migration", None)?;
            let hidden = create(conn, "geloeschte Migration", None)?;
            soft_delete(conn, &hidden.id)?;

            assert_eq!(list_all(conn)?.len(), 1);
            let found = search(conn, "Migration", 20)?;
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].id, visible.id);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn like_wildcards_are_escaped() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "echter text", None)?;
            let mut search_filter = filter();
            search_filter.search = Some("%".into());
            assert_eq!(list(conn, &search_filter, 50)?.len(), 0);
            assert_eq!(search(conn, "%", 20)?.len(), 0);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn filters_by_folder() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let arbeit = folders::create(conn, "Arbeit")?;
            create(conn, "mit Ordner", Some(&arbeit.id))?;
            create(conn, "ohne Ordner", None)?;

            let mut in_folder = filter();
            in_folder.folder = FolderFilter::Id(arbeit.id.clone());
            assert_eq!(list(conn, &in_folder, 50)?.len(), 1);

            let mut unfiled = filter();
            unfiled.folder = FolderFilter::Unfiled;
            assert_eq!(list(conn, &unfiled, 50)?.len(), 1);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn filters_by_all_selected_labels() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let privat = labels::create(conn, "Privat", "blue")?;
            let dringend = labels::create(conn, "Dringend", "red")?;

            let both = create(conn, "beide", None)?;
            let one = create(conn, "nur eins", None)?;
            create(conn, "keins", None)?;

            labels::set_for_note(conn, &both.id, &[privat.id.clone(), dringend.id.clone()])?;
            labels::set_for_note(conn, &one.id, &[privat.id.clone()])?;

            let mut single = filter();
            single.label_ids = vec![privat.id.clone()];
            assert_eq!(list(conn, &single, 50)?.len(), 2);

            let mut combined = filter();
            combined.label_ids = vec![privat.id, dringend.id];
            let found = list(conn, &combined, 50)?;
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].content, "beide");
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn deleting_a_folder_keeps_its_notes() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let arbeit = folders::create(conn, "Arbeit")?;
            let note = create(conn, "bleibt", Some(&arbeit.id))?;

            folders::delete(conn, &arbeit.id)?;

            let reloaded = get(conn, &note.id)?;
            assert_eq!(reloaded.content, "bleibt");
            assert!(reloaded.folder_id.is_none());
            Ok(())
        })
        .expect("operations");
    }
}
