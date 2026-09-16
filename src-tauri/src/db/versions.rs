use rusqlite::{params, Connection, Row};

use super::models::NoteVersion;
use super::now_utc;
use crate::error::{AppError, AppResult};

/// So viele Fassungen bleiben pro Notiz erhalten. Mehr bringt kaum Nutzen und
/// laesst die Datenbank unnoetig wachsen.
pub const MAX_VERSIONS: i64 = 20;

fn map(row: &Row<'_>) -> rusqlite::Result<NoteVersion> {
    Ok(NoteVersion {
        id: row.get(0)?,
        note_id: row.get(1)?,
        content: row.get(2)?,
        created_at: row.get(3)?,
    })
}

/// Legt den bisherigen Stand ab, bevor er ueberschrieben wird.
///
/// Identischer Text wird nicht erneut gesichert: sonst wuerde ein einzelnes
/// Autosave-Intervall die ganze Historie mit Dubletten fuellen.
pub fn record(conn: &Connection, note_id: &str, content: &str) -> AppResult<bool> {
    let latest: Option<String> = conn
        .query_row(
            "SELECT content FROM note_versions WHERE note_id = ?1 ORDER BY id DESC LIMIT 1",
            params![note_id],
            |row| row.get(0),
        )
        .ok();

    if latest.as_deref() == Some(content) {
        return Ok(false);
    }

    conn.execute(
        "INSERT INTO note_versions (note_id, content, created_at) VALUES (?1, ?2, ?3)",
        params![note_id, content, now_utc()],
    )?;
    prune(conn, note_id)?;
    Ok(true)
}

fn prune(conn: &Connection, note_id: &str) -> AppResult<usize> {
    let removed = conn.execute(
        "DELETE FROM note_versions
          WHERE note_id = ?1
            AND id NOT IN (SELECT id FROM note_versions WHERE note_id = ?1 ORDER BY id DESC LIMIT ?2)",
        params![note_id, MAX_VERSIONS],
    )?;
    Ok(removed)
}

/// Neueste Fassung zuerst.
pub fn list(conn: &Connection, note_id: &str) -> AppResult<Vec<NoteVersion>> {
    let mut stmt = conn.prepare(
        "SELECT id, note_id, content, created_at FROM note_versions
          WHERE note_id = ?1 ORDER BY id DESC",
    )?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![note_id], map)? {
        result.push(row?);
    }
    Ok(result)
}

pub fn get(conn: &Connection, note_id: &str, version_id: i64) -> AppResult<NoteVersion> {
    conn.query_row(
        "SELECT id, note_id, content, created_at FROM note_versions
          WHERE id = ?1 AND note_id = ?2",
        params![version_id, note_id],
        map,
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Version {version_id}")),
        other => other.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{notes, Db};

    #[test]
    fn versions_are_kept_in_order_and_capped() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = notes::create(conn, "Fassung 0", None)?;

            for index in 0..(MAX_VERSIONS + 5) {
                assert!(record(conn, &note.id, &format!("Fassung {index}"))?);
            }

            let versions = list(conn, &note.id)?;
            assert_eq!(versions.len() as i64, MAX_VERSIONS);
            // Neueste zuerst, aelteste sind weggefallen.
            assert_eq!(versions[0].content, format!("Fassung {}", MAX_VERSIONS + 4));
            assert_eq!(versions[versions.len() - 1].content, "Fassung 5");
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn identical_content_is_not_stored_twice() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = notes::create(conn, "Inhalt", None)?;
            assert!(record(conn, &note.id, "Erster Stand")?);
            assert!(!record(conn, &note.id, "Erster Stand")?);
            assert_eq!(list(conn, &note.id)?.len(), 1);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn deleting_a_note_removes_its_versions() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = notes::create(conn, "Inhalt", None)?;
            record(conn, &note.id, "Alter Stand")?;
            notes::purge(conn, &note.id)?;
            assert!(list(conn, &note.id)?.is_empty());
            Ok(())
        })
        .expect("operations");
    }
}
