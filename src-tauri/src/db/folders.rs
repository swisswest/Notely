use rusqlite::{params, Connection, Row};

use super::models::Folder;
use super::{new_id, now_utc};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, name, position, created_at";
pub const MAX_FOLDERS: i64 = 200;

fn map(row: &Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get(0)?,
        name: row.get(1)?,
        position: row.get(2)?,
        created_at: row.get(3)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Folder>> {
    let sql = format!("SELECT {COLUMNS} FROM folders ORDER BY position ASC, name COLLATE NOCASE ASC");
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }
    Ok(result)
}

pub fn create(conn: &Connection, name: &str) -> AppResult<Folder> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0))?;
    if count >= MAX_FOLDERS {
        return Err(AppError::validation("Maximale Anzahl Ordner erreicht"));
    }

    let id = new_id();
    let position = count;
    conn.execute(
        "INSERT INTO folders (id, name, position, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, position, now_utc()],
    )
    .map_err(duplicate_name)?;
    get(conn, &id)
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> AppResult<Folder> {
    let changed = conn
        .execute("UPDATE folders SET name = ?2 WHERE id = ?1", params![id, name])
        .map_err(duplicate_name)?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Ordner {id}")));
    }
    get(conn, id)
}

/// Notizen im Ordner bleiben erhalten und landen wieder in "Ohne Ordner".
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Ordner {id}")));
    }
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Folder> {
    let sql = format!("SELECT {COLUMNS} FROM folders WHERE id = ?1");
    conn.query_row(&sql, params![id], map)
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Ordner {id}")),
            other => other.into(),
        })
}

pub fn exists(conn: &Connection, id: &str) -> AppResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM folders WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn duplicate_name(err: rusqlite::Error) -> AppError {
    let message = err.to_string();
    if message.contains("UNIQUE") {
        AppError::validation("Ein Ordner mit diesem Namen existiert bereits")
    } else {
        err.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn create_rename_delete() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let folder = create(conn, "Arbeit")?;
            assert_eq!(folder.name, "Arbeit");
            assert_eq!(list(conn)?.len(), 1);

            let renamed = rename(conn, &folder.id, "Beruf")?;
            assert_eq!(renamed.name, "Beruf");

            delete(conn, &folder.id)?;
            assert!(list(conn)?.is_empty());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn duplicate_names_are_rejected_case_insensitively() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "Arbeit")?;
            assert!(create(conn, "arbeit").is_err());
            Ok(())
        })
        .expect("operations");
    }
}
