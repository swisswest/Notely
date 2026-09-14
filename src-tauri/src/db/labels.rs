use std::collections::HashMap;

use rusqlite::{params, Connection, Row};

use super::models::Label;
use super::{new_id, now_utc};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, name, color, created_at";
pub const MAX_LABELS: i64 = 200;
pub const MAX_LABELS_PER_NOTE: usize = 20;

/// Fester Farbvorrat. Das Frontend darf keine freien Werte setzen - so bleibt
/// die Darstellung konsistent und es landet nichts Unerwartetes im CSS.
pub const COLORS: &[&str] = &[
    "slate", "blue", "green", "amber", "red", "violet", "teal", "pink",
];

fn map(row: &Row<'_>) -> rusqlite::Result<Label> {
    Ok(Label {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: row.get(3)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Label>> {
    let sql = format!("SELECT {COLUMNS} FROM labels ORDER BY name COLLATE NOCASE ASC");
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }
    Ok(result)
}

pub fn create(conn: &Connection, name: &str, color: &str) -> AppResult<Label> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM labels", [], |row| row.get(0))?;
    if count >= MAX_LABELS {
        return Err(AppError::validation("Maximale Anzahl Labels erreicht"));
    }

    let id = new_id();
    conn.execute(
        "INSERT INTO labels (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, validate_color(color)?, now_utc()],
    )
    .map_err(duplicate_name)?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, name: &str, color: &str) -> AppResult<Label> {
    let changed = conn
        .execute(
            "UPDATE labels SET name = ?2, color = ?3 WHERE id = ?1",
            params![id, name, validate_color(color)?],
        )
        .map_err(duplicate_name)?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Label {id}")));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM labels WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Label {id}")));
    }
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Label> {
    let sql = format!("SELECT {COLUMNS} FROM labels WHERE id = ?1");
    conn.query_row(&sql, params![id], map)
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Label {id}")),
            other => other.into(),
        })
}

/// Ersetzt die Labels einer Notiz vollständig.
pub fn set_for_note(conn: &Connection, note_id: &str, label_ids: &[String]) -> AppResult<()> {
    if label_ids.len() > MAX_LABELS_PER_NOTE {
        return Err(AppError::validation(format!(
            "Maximal {MAX_LABELS_PER_NOTE} Labels pro Notiz"
        )));
    }

    conn.execute(
        "DELETE FROM note_labels WHERE note_id = ?1",
        params![note_id],
    )?;
    for label_id in label_ids {
        // Unbekannte Label-IDs werden hier abgewiesen, nicht still ignoriert.
        get(conn, label_id)?;
        conn.execute(
            "INSERT OR IGNORE INTO note_labels (note_id, label_id) VALUES (?1, ?2)",
            params![note_id, label_id],
        )?;
    }
    Ok(())
}

/// Alle Zuordnungen auf einmal - die Tabelle ist klein, das spart N Queries.
pub fn by_note(conn: &Connection) -> AppResult<HashMap<String, Vec<String>>> {
    let mut stmt = conn.prepare(
        "SELECT nl.note_id, nl.label_id FROM note_labels nl
         JOIN labels l ON l.id = nl.label_id
         ORDER BY l.name COLLATE NOCASE ASC",
    )?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (note_id, label_id) = row?;
        map.entry(note_id).or_default().push(label_id);
    }
    Ok(map)
}

fn validate_color(color: &str) -> AppResult<&str> {
    COLORS
        .iter()
        .find(|known| **known == color)
        .copied()
        .ok_or_else(|| AppError::validation(format!("Unbekannte Farbe: {color}")))
}

fn duplicate_name(err: rusqlite::Error) -> AppError {
    let message = err.to_string();
    if message.contains("UNIQUE") {
        AppError::validation("Ein Label mit diesem Namen existiert bereits")
    } else {
        err.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{notes, Db};

    #[test]
    fn create_update_delete() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let label = create(conn, "Privat", "blue")?;
            assert_eq!(label.color, "blue");

            let updated = update(conn, &label.id, "Privat", "green")?;
            assert_eq!(updated.color, "green");

            delete(conn, &label.id)?;
            assert!(list(conn)?.is_empty());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn unknown_colors_are_rejected() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            assert!(create(conn, "X", "neon-pink").is_err());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn labels_are_assigned_and_replaced() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = notes::create(conn, "Inhalt", None)?;
            let privat = create(conn, "Privat", "blue")?;
            let arbeit = create(conn, "Arbeit", "amber")?;

            set_for_note(conn, &note.id, &[privat.id.clone(), arbeit.id.clone()])?;
            assert_eq!(by_note(conn)?.get(&note.id).map(Vec::len), Some(2));

            set_for_note(conn, &note.id, &[privat.id.clone()])?;
            assert_eq!(by_note(conn)?.get(&note.id).map(Vec::len), Some(1));

            // Label löschen entfernt nur die Zuordnung, nicht die Notiz.
            delete(conn, &privat.id)?;
            assert!(by_note(conn)?.get(&note.id).is_none());
            assert!(notes::get(conn, &note.id).is_ok());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn unknown_label_ids_are_rejected() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = notes::create(conn, "Inhalt", None)?;
            assert!(set_for_note(conn, &note.id, &["gibt-es-nicht".to_string()]).is_err());
            Ok(())
        })
        .expect("operations");
    }
}
