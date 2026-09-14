use rusqlite::Connection;

use crate::error::AppResult;

/// Jede Migration wird genau einmal ausgeführt. Der Fortschritt liegt in
/// `PRAGMA user_version`, damit kein zusätzliches Statusfile nötig ist.
const MIGRATIONS: &[&str] = &[
    // 1 - Grundschema
    r#"
    CREATE TABLE notes (
        id                   TEXT PRIMARY KEY,
        content              TEXT NOT NULL,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        analyzed_at          TEXT,
        last_analysis_status TEXT
    );

    CREATE TABLE tasks (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        description    TEXT NOT NULL DEFAULT '',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        due_date       TEXT,
        due_time       TEXT,
        completed      INTEGER NOT NULL DEFAULT 0,
        completed_at   TEXT,
        source_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
        ai_generated   INTEGER NOT NULL DEFAULT 0,
        confidence     REAL,
        snoozed_until  TEXT
    );

    CREATE INDEX idx_tasks_due ON tasks(completed, due_date, due_time);
    CREATE INDEX idx_tasks_source ON tasks(source_note_id);
    CREATE INDEX idx_notes_updated ON notes(updated_at DESC);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE notification_history (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        kind     TEXT NOT NULL,
        fire_at  TEXT NOT NULL,
        sent_at  TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_notification_unique
        ON notification_history(task_id, kind, fire_at);
    "#,
    // 2 - Ordner und Labels
    r#"
    CREATE TABLE folders (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_folders_name ON folders(name COLLATE NOCASE);

    CREATE TABLE labels (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        color      TEXT NOT NULL DEFAULT 'slate',
        created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_labels_name ON labels(name COLLATE NOCASE);

    CREATE TABLE note_labels (
        note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, label_id)
    );

    CREATE INDEX idx_note_labels_label ON note_labels(label_id);

    ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

    CREATE INDEX idx_notes_folder ON notes(folder_id);
    "#,
    // 3 - Papierkorb und Verbrauchsstatistik
    r#"
    ALTER TABLE notes ADD COLUMN deleted_at TEXT;
    ALTER TABLE tasks ADD COLUMN deleted_at TEXT;

    CREATE INDEX idx_notes_deleted ON notes(deleted_at);
    CREATE INDEX idx_tasks_deleted ON tasks(deleted_at);

    CREATE TABLE ai_usage (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at   TEXT NOT NULL,
        model         TEXT NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        note_id       TEXT
    );

    CREATE INDEX idx_ai_usage_time ON ai_usage(occurred_at DESC);
    "#,
];

pub fn run(conn: &Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let target = MIGRATIONS.len() as i64;

    if current > target {
        return Err(crate::error::AppError::Db(format!(
            "Datenbank hat Version {current}, die Anwendung kennt nur {target}"
        )));
    }

    for (index, migration) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = index as i64 + 1;
        conn.execute_batch("BEGIN")?;
        match conn.execute_batch(migration) {
            Ok(()) => {
                conn.execute_batch(&format!("PRAGMA user_version = {version}; COMMIT"))?;
                crate::logging::info("db", format!("Migration {version} angewendet"));
            }
            Err(err) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(err.into());
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run(&conn).expect("first run");
        run(&conn).expect("second run");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, MIGRATIONS.len() as i64);

        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
                 AND name IN ('notes','tasks','settings','notification_history','folders','labels','note_labels','ai_usage')",
                [],
                |row| row.get(0),
            )
            .expect("tables");
        assert_eq!(tables, 8);
    }

    #[test]
    fn upgrade_from_version_one_keeps_existing_notes() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        // Nur Migration 1 anwenden und eine Notiz anlegen.
        conn.execute_batch(MIGRATIONS[0]).expect("schema v1");
        conn.execute_batch("PRAGMA user_version = 1").expect("version");
        conn.execute(
            "INSERT INTO notes (id, content, created_at, updated_at)
             VALUES ('n1', 'Bestandsnotiz', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");

        run(&conn).expect("upgrade");

        let (content, folder): (String, Option<String>) = conn
            .query_row("SELECT content, folder_id FROM notes WHERE id = 'n1'", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .expect("note");
        assert_eq!(content, "Bestandsnotiz");
        assert!(folder.is_none());
    }
}
