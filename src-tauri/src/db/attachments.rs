use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::{new_id, now_utc};
use crate::error::{AppError, AppResult};

/// Obergrenze je Bild. Alles darueber gehoert nicht in eine Notiz, sondern
/// neben sie - und wuerde die Datenbank in kurzer Zeit unbrauchbar gross machen.
pub const MAX_BYTES: usize = 10 * 1024 * 1024;

/// Formate, die im Webview zuverlaessig darstellbar sind.
///
/// SVG fehlt mit Absicht: es ist ein Dokument, kein Bild, und kann Skripte
/// und Verweise nach draussen enthalten. Wer ein Diagramm braucht, nimmt einen
/// Mermaid-Block.
pub const ALLOWED_MIME: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
];

/// Ein Bildanhang ohne seine Daten. Die Bytes werden einzeln geholt, damit
/// eine Liste nicht versehentlich hundert Megabyte durch die Bruecke schiebt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub note_id: Option<String>,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub created_at: String,
}

/// Anhang samt Daten - nur fuer Sicherung und Export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    #[serde(flatten)]
    pub meta: Attachment,
    /// Base64, weil eine Sicherung eine lesbare JSON-Datei bleiben soll.
    pub data: String,
}

const COLUMNS: &str = "id, note_id, name, mime, size, created_at";

fn map(row: &rusqlite::Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        note_id: row.get(1)?,
        name: row.get(2)?,
        mime: row.get(3)?,
        size: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn checked_mime(mime: &str) -> AppResult<String> {
    let lower = mime.trim().to_ascii_lowercase();
    if ALLOWED_MIME.contains(&lower.as_str()) {
        Ok(lower)
    } else {
        Err(AppError::validation(format!(
            "Dieses Bildformat wird nicht unterstützt: {mime}"
        )))
    }
}

/// Kuerzt den Namen und nimmt ihm alles, was in einer Notiz stoeren wuerde.
fn clean_name(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c.is_control() || c == '\n' || c == ']' || c == '[' {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "Bild".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

pub fn create(
    conn: &Connection,
    note_id: Option<&str>,
    name: &str,
    mime: &str,
    bytes: &[u8],
) -> AppResult<Attachment> {
    if bytes.is_empty() {
        return Err(AppError::validation("Das Bild ist leer"));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::validation(format!(
            "Das Bild ist zu gross ({} MB). Erlaubt sind {} MB.",
            bytes.len() / 1024 / 1024,
            MAX_BYTES / 1024 / 1024
        )));
    }

    let attachment = Attachment {
        id: new_id(),
        note_id: note_id.map(str::to_string),
        name: clean_name(name),
        mime: checked_mime(mime)?,
        size: bytes.len() as i64,
        created_at: now_utc(),
    };

    conn.execute(
        "INSERT INTO attachments (id, note_id, name, mime, bytes, size, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            attachment.id,
            attachment.note_id,
            attachment.name,
            attachment.mime,
            bytes,
            attachment.size,
            attachment.created_at
        ],
    )?;

    Ok(attachment)
}

/// Holt die Bytes eines Anhangs.
pub fn bytes(conn: &Connection, id: &str) -> AppResult<(String, Vec<u8>)> {
    conn.query_row(
        "SELECT mime, bytes FROM attachments WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Bild {id}")),
        other => other.into(),
    })
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Attachment> {
    let sql = format!("SELECT {COLUMNS} FROM attachments WHERE id = ?1");
    conn.query_row(&sql, params![id], map)
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Bild {id}")),
            other => other.into(),
        })
}

/// Haengt einen Anhang nachtraeglich an eine Notiz.
///
/// Beim Einfuegen in eine noch nicht gespeicherte Notiz gibt es die Notiz-ID
/// noch nicht. Der Anhang entsteht dann ohne Zuordnung und wird nachgetragen,
/// sobald die Notiz das erste Mal gespeichert ist.
pub fn assign(conn: &Connection, id: &str, note_id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE attachments SET note_id = ?2 WHERE id = ?1 AND note_id IS NULL",
        params![id, note_id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let removed = conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])?;
    if removed == 0 {
        return Err(AppError::NotFound(format!("Bild {id}")));
    }
    Ok(())
}

/// Alle Anhaenge samt Daten - fuer die Sicherung.
pub fn list_all(conn: &Connection) -> AppResult<Vec<AttachmentData>> {
    let sql = format!("SELECT {COLUMNS}, bytes FROM attachments ORDER BY created_at");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        let meta = map(row)?;
        let raw: Vec<u8> = row.get(6)?;
        Ok(AttachmentData {
            meta,
            data: encode(&raw),
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Spielt einen Anhang aus einer Sicherung zurueck. Vorhandene bleiben unberuehrt.
pub fn restore(conn: &Connection, entry: &AttachmentData) -> AppResult<bool> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM attachments WHERE id = ?1",
        params![entry.meta.id],
        |row| row.get(0),
    )?;
    if exists > 0 {
        return Ok(false);
    }

    let bytes = decode(&entry.data)?;
    if bytes.len() > MAX_BYTES {
        return Err(AppError::validation(
            "Ein Bild in der Sicherung ist zu gross",
        ));
    }

    // Zeigt der Anhang auf eine Notiz, die es hier nicht gibt, wird die
    // Zuordnung fallengelassen statt der Import abgebrochen.
    let note_id: Option<String> = match entry.meta.note_id.as_deref() {
        Some(id) => {
            let found: i64 = conn.query_row(
                "SELECT COUNT(*) FROM notes WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )?;
            (found > 0).then(|| id.to_string())
        }
        None => None,
    };

    conn.execute(
        "INSERT INTO attachments (id, note_id, name, mime, bytes, size, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            entry.meta.id,
            note_id,
            clean_name(&entry.meta.name),
            checked_mime(&entry.meta.mime)?,
            bytes,
            bytes.len() as i64,
            entry.meta.created_at
        ],
    )?;
    Ok(true)
}

/// Anzahl und Gesamtgroesse - fuer die Anzeige in den Einstellungen.
pub fn usage(conn: &Connection) -> AppResult<(i64, i64)> {
    Ok(conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM attachments",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?)
}

/// Entfernt Anhaenge, die in keinem Notiztext mehr vorkommen.
///
/// Ein geloeschtes Bild im Text laesst den Anhang sonst fuer immer liegen.
/// Geprueft wird gegen den Text der zugehoerigen Notiz; Anhaenge ohne
/// Zuordnung bekommen eine Schonfrist, weil sie zu einem noch ungespeicherten
/// Entwurf gehoeren koennen.
pub fn purge_unreferenced(conn: &Connection, grace_hours: i64) -> AppResult<usize> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::hours(grace_hours))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let removed = conn.execute(
        "DELETE FROM attachments
         WHERE created_at < ?1
           AND (
             (note_id IS NULL)
             OR NOT EXISTS (
               SELECT 1 FROM notes
               WHERE notes.id = attachments.note_id
                 AND instr(notes.content, attachments.id) > 0
             )
           )",
        params![cutoff],
    )?;
    Ok(removed)
}

fn encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn decode(value: &str) -> AppResult<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|err| AppError::validation(format!("Bilddaten nicht lesbar: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn db_with_note() -> (Db, String) {
        let db = Db::open_in_memory().expect("db");
        let id = db
            .with(|conn| {
                let note = crate::db::notes::create(conn, "Eine Notiz", None)?;
                Ok(note.id)
            })
            .expect("notiz");
        (db, id)
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3, 4];

    #[test]
    fn stores_and_reads_back() {
        let (db, note) = db_with_note();
        db.with(|conn| {
            let saved = create(conn, Some(&note), "Screenshot.png", "image/png", PNG)?;
            assert_eq!(saved.size, PNG.len() as i64);

            let (mime, bytes) = bytes(conn, &saved.id)?;
            assert_eq!(mime, "image/png");
            assert_eq!(bytes, PNG);
            Ok(())
        })
        .expect("ablauf");
    }

    #[test]
    fn rejects_foreign_formats_and_empty_data() {
        let (db, note) = db_with_note();
        db.with(|conn| {
            assert!(create(conn, Some(&note), "x.svg", "image/svg+xml", PNG).is_err());
            assert!(create(conn, Some(&note), "x.exe", "application/x-msdownload", PNG).is_err());
            assert!(create(conn, Some(&note), "leer.png", "image/png", &[]).is_err());
            Ok(())
        })
        .expect("ablauf");
    }

    #[test]
    fn rejects_oversized_images() {
        let (db, note) = db_with_note();
        let big = vec![0u8; MAX_BYTES + 1];
        db.with(|conn| {
            let err = create(conn, Some(&note), "gross.png", "image/png", &big);
            assert!(err.is_err(), "zu grosse Bilder muessen abgelehnt werden");
            Ok(())
        })
        .expect("ablauf");
    }

    #[test]
    fn names_are_cleaned_but_kept_recognizable() {
        let (db, note) = db_with_note();
        db.with(|conn| {
            let saved = create(
                conn,
                Some(&note),
                "  Bild [mit] Klammern\n ",
                "image/png",
                PNG,
            )?;
            assert!(!saved.name.contains('['));
            assert!(!saved.name.contains('\n'));
            assert!(saved.name.contains("Bild"));

            let fallback = create(conn, Some(&note), "   ", "image/png", PNG)?;
            assert_eq!(fallback.name, "Bild");
            Ok(())
        })
        .expect("ablauf");
    }

    #[test]
    fn deleting_the_note_takes_its_images_along() {
        let (db, note) = db_with_note();
        db.with(|conn| {
            create(conn, Some(&note), "a.png", "image/png", PNG)?;
            conn.execute("DELETE FROM notes WHERE id = ?1", params![note])?;
            let (count, _) = usage(conn)?;
            assert_eq!(count, 0, "Fremdschluessel muss die Bilder mitloeschen");
            Ok(())
        })
        .expect("ablauf");
    }

    #[test]
    fn unreferenced_images_are_purged_after_the_grace_period() {
        let (db, note) = db_with_note();
        db.with(|conn| {
            let orphan = create(conn, Some(&note), "weg.png", "image/png", PNG)?;
            // Noch frisch: die Schonfrist schuetzt es.
            assert_eq!(purge_unreferenced(conn, 24)?, 0);

            // Auf alt setzen - der Text der Notiz nennt die Kennung nicht.
            conn.execute(
                "UPDATE attachments SET created_at = '2020-01-01T00:00:00Z' WHERE id = ?1",
                params![orphan.id],
            )?;
            assert_eq!(purge_unreferenced(conn, 24)?, 1);
            Ok(())
        })
        .expect("ablauf");
    }

    #[test]
    fn a_referenced_image_survives_the_purge() {
        let (db, note) = db_with_note();
        db.with(|conn| {
            let keep = create(conn, Some(&note), "bleibt.png", "image/png", PNG)?;
            conn.execute(
                "UPDATE notes SET content = ?2 WHERE id = ?1",
                params![note, format!("Text mit ![Bild](notely:bild/{})", keep.id)],
            )?;
            conn.execute(
                "UPDATE attachments SET created_at = '2020-01-01T00:00:00Z' WHERE id = ?1",
                params![keep.id],
            )?;

            assert_eq!(purge_unreferenced(conn, 24)?, 0);
            Ok(())
        })
        .expect("ablauf");
    }

    #[test]
    fn backup_round_trip_keeps_the_bytes() {
        let (db, note) = db_with_note();
        let exported = db
            .with(|conn| {
                create(conn, Some(&note), "a.png", "image/png", PNG)?;
                list_all(conn)
            })
            .expect("export");
        assert_eq!(exported.len(), 1);

        let target = Db::open_in_memory().expect("db");
        target
            .with(|conn| {
                assert!(restore(conn, &exported[0])?);
                // Zweimal einspielen legt nichts doppelt an.
                assert!(!restore(conn, &exported[0])?);

                let (_, raw) = bytes(conn, &exported[0].meta.id)?;
                assert_eq!(raw, PNG);

                // Die Notiz gibt es hier nicht - die Zuordnung faellt weg.
                let restored = get(conn, &exported[0].meta.id)?;
                assert_eq!(restored.note_id, None);
                Ok(())
            })
            .expect("import");
    }
}
