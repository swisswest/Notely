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
    // 4 - Wiederkehrende Aufgaben und Rueckmeldungen zur Analysequalitaet
    r#"
    ALTER TABLE tasks ADD COLUMN recurrence TEXT;
    ALTER TABLE tasks ADD COLUMN series_id TEXT;

    CREATE INDEX idx_tasks_series ON tasks(series_id);

    CREATE TABLE ai_feedback (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at   TEXT NOT NULL,
        note_id      TEXT,
        model        TEXT NOT NULL DEFAULT '',
        verdict      TEXT NOT NULL,
        note_excerpt TEXT NOT NULL DEFAULT '',
        suggested    TEXT NOT NULL,
        corrected    TEXT
    );

    CREATE INDEX idx_ai_feedback_time ON ai_feedback(created_at DESC);
    "#,
    // 5 - Notiz-Versionen, Prioritaet und Labels fuer Aufgaben
    r#"
    CREATE TABLE note_versions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE INDEX idx_note_versions ON note_versions(note_id, id DESC);

    -- 0 = niedrig, 1 = normal, 2 = hoch. Bestand bleibt normal.
    ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 1;

    CREATE TABLE task_labels (
        task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, label_id)
    );

    CREATE INDEX idx_task_labels_label ON task_labels(label_id);
    "#,
    // 6 - Bildanhaenge in Notizen
    r#"
    -- Die Bilddaten liegen bewusst in derselben Datei wie die Notizen. Ein
    -- Bild gehoert untrennbar zu seiner Notiz: so bleiben Profilwechsel,
    -- Papierkorb und Loeschen ohne Zutun stimmig, und es kann keine Datei
    -- zurueckbleiben, zu der es keine Notiz mehr gibt.
    CREATE TABLE attachments (
        id         TEXT PRIMARY KEY,
        note_id    TEXT REFERENCES notes(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL,
        bytes      BLOB NOT NULL,
        size       INTEGER NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE INDEX idx_attachments_note ON attachments(note_id);
    "#,
    // 7 - Aufgaben kennen den Ordner ihrer Notiz
    r#"
    -- Bestandsaufgaben bleiben ohne Ordner. Ein nachtraegliches Zuordnen
    -- waere geraten, und geratene Daten sind schlimmer als fehlende.
    ALTER TABLE tasks ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

    CREATE INDEX idx_tasks_folder ON tasks(folder_id);
    "#,
    // 8 - Volltextindex ueber Notizen
    r#"
    -- Der Index ist abgeleitete Information: er laesst sich jederzeit aus
    -- `notes` neu aufbauen. Er haengt an `notes.rowid`. Das ist stabil,
    -- solange niemand VACUUM ausfuehrt - danach koennen rowids einer Tabelle
    -- ohne INTEGER PRIMARY KEY neu vergeben werden. Wer VACUUM einbaut, muss
    -- anschliessend `notes::rebuild_index` aufrufen.
    --
    -- remove_diacritics 2 sorgt dafuer, dass "Buero" und "Büro" denselben
    -- Token ergeben. Eine Stammformreduktion gibt es bewusst nicht: der
    -- porter-Tokenizer von FTS5 kann nur Englisch und wuerde deutsche
    -- Woerter eher verstuemmeln als zusammenfuehren.
    CREATE VIRTUAL TABLE notes_fts USING fts5(
        content,
        note_id UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
    );

    INSERT INTO notes_fts (rowid, content, note_id)
        SELECT rowid, content, id FROM notes;

    CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts (rowid, content, note_id)
            VALUES (new.rowid, new.content, new.id);
    END;

    CREATE TRIGGER notes_fts_update AFTER UPDATE OF content ON notes BEGIN
        UPDATE notes_fts SET content = new.content WHERE rowid = new.rowid;
    END;

    CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
        DELETE FROM notes_fts WHERE rowid = old.rowid;
    END;
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
                 AND name IN ('notes','tasks','settings','notification_history','folders','labels','note_labels','ai_usage','ai_feedback','note_versions','task_labels')",
                [],
                |row| row.get(0),
            )
            .expect("tables");
        assert_eq!(tables, 11);
    }

    #[test]
    fn upgrade_from_version_one_keeps_existing_notes() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        // Nur Migration 1 anwenden und eine Notiz anlegen.
        conn.execute_batch(MIGRATIONS[0]).expect("schema v1");
        conn.execute_batch("PRAGMA user_version = 1")
            .expect("version");
        conn.execute(
            "INSERT INTO notes (id, content, created_at, updated_at)
             VALUES ('n1', 'Bestandsnotiz', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");

        run(&conn).expect("upgrade");

        let (content, folder): (String, Option<String>) = conn
            .query_row(
                "SELECT content, folder_id FROM notes WHERE id = 'n1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("note");
        assert_eq!(content, "Bestandsnotiz");
        assert!(folder.is_none());
    }

    #[test]
    fn upgrade_from_version_six_keeps_tasks_and_leaves_the_folder_empty() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        for (index, migration) in MIGRATIONS.iter().take(6).enumerate() {
            conn.execute_batch(migration)
                .unwrap_or_else(|err| panic!("schema v{}: {err}", index + 1));
        }
        conn.execute_batch("PRAGMA user_version = 6")
            .expect("version");
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at)
             VALUES ('t1', 'Bestandsaufgabe', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");

        run(&conn).expect("upgrade");

        let (title, folder): (String, Option<String>) = conn
            .query_row(
                "SELECT title, folder_id FROM tasks WHERE id = 't1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("task");
        assert_eq!(title, "Bestandsaufgabe");
        assert_eq!(folder, None, "Bestand bekommt keinen geratenen Ordner");
    }

    #[test]
    fn upgrade_from_version_five_keeps_notes_and_adds_the_image_table() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        for (index, migration) in MIGRATIONS.iter().take(5).enumerate() {
            conn.execute_batch(migration)
                .unwrap_or_else(|err| panic!("schema v{}: {err}", index + 1));
        }
        conn.execute_batch("PRAGMA user_version = 5")
            .expect("version");
        conn.execute(
            "INSERT INTO notes (id, content, created_at, updated_at)
             VALUES ('n1', 'Bestandsnotiz', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");

        run(&conn).expect("upgrade");

        let content: String = conn
            .query_row("SELECT content FROM notes WHERE id = 'n1'", [], |row| {
                row.get(0)
            })
            .expect("notiz");
        assert_eq!(
            content, "Bestandsnotiz",
            "Bestand muss die Migration ueberleben"
        );

        // Die Tabelle ist da und noch leer.
        let images: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .expect("tabelle");
        assert_eq!(images, 0);
    }

    #[test]
    fn upgrade_from_version_four_keeps_tasks_and_defaults_the_priority() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        for (index, migration) in MIGRATIONS.iter().take(4).enumerate() {
            conn.execute_batch(migration)
                .unwrap_or_else(|err| panic!("schema v{}: {err}", index + 1));
        }
        conn.execute_batch("PRAGMA user_version = 4")
            .expect("version");
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at)
             VALUES ('t1', 'Bestandsaufgabe', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");

        run(&conn).expect("upgrade");

        let (title, priority): (String, i64) = conn
            .query_row(
                "SELECT title, priority FROM tasks WHERE id = 't1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("task");
        assert_eq!(title, "Bestandsaufgabe");
        assert_eq!(priority, 1, "Bestandsaufgaben bleiben normal");
    }

    #[test]
    fn upgrade_from_version_three_keeps_existing_tasks() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        for (index, migration) in MIGRATIONS.iter().take(3).enumerate() {
            conn.execute_batch(migration)
                .unwrap_or_else(|err| panic!("schema v{}: {err}", index + 1));
        }
        conn.execute_batch("PRAGMA user_version = 3")
            .expect("version");
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at)
             VALUES ('t1', 'Bestandsaufgabe', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");

        run(&conn).expect("upgrade");

        let (title, recurrence): (String, Option<String>) = conn
            .query_row(
                "SELECT title, recurrence FROM tasks WHERE id = 't1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("task");
        assert_eq!(title, "Bestandsaufgabe");
        assert!(recurrence.is_none());
    }

    /// Der Volltextindex muss den Bestand mitbringen, nicht erst neue Notizen.
    /// Eine Datenbank, in der nur ab jetzt Geschriebenes auffindbar ist, waere
    /// schlimmer als gar kein Index - man wuerde dem Ergebnis glauben.
    #[test]
    fn upgrade_from_version_seven_indexes_existing_notes() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        for (index, migration) in MIGRATIONS.iter().take(7).enumerate() {
            conn.execute_batch(migration)
                .unwrap_or_else(|err| panic!("schema v{}: {err}", index + 1));
        }
        conn.execute_batch("PRAGMA user_version = 7")
            .expect("version");
        conn.execute(
            "INSERT INTO notes (id, content, created_at, updated_at)
             VALUES ('n1', 'Auto steht im Parkhaus P3, Ebene 2',
                     '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");

        run(&conn).expect("upgrade");

        let found: String = conn
            .query_row(
                "SELECT note_id FROM notes_fts WHERE notes_fts MATCH 'parkhaus'",
                [],
                |row| row.get(0),
            )
            .expect("Bestandsnotiz im Index");
        assert_eq!(found, "n1");
    }

    /// Die Trigger sind der eigentliche Vertrag: der Index darf nie von der
    /// Tabelle abweichen, egal ueber welchen Weg geschrieben wurde.
    #[test]
    fn the_index_follows_inserts_updates_and_deletes() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run(&conn).expect("migrations");

        conn.execute(
            "INSERT INTO notes (id, content, created_at, updated_at)
             VALUES ('n1', 'Velo im Keller', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");
        assert_eq!(matches(&conn, "velo"), 1, "neu angelegt");

        conn.execute("UPDATE notes SET content = 'Velo beim Bahnhof' WHERE id = 'n1'", [])
            .expect("update");
        assert_eq!(matches(&conn, "keller"), 0, "alter Text ist weg");
        assert_eq!(matches(&conn, "bahnhof"), 1, "neuer Text ist da");

        conn.execute("DELETE FROM notes WHERE id = 'n1'", [])
            .expect("delete");
        assert_eq!(matches(&conn, "bahnhof"), 0, "geloescht raeumt den Index");
    }

    /// Umlaute und ihre Umschreibung muessen denselben Treffer ergeben -
    /// sonst findet "Buero" die Notiz mit "Büro" nicht.
    #[test]
    fn diacritics_are_folded() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run(&conn).expect("migrations");
        conn.execute(
            "INSERT INTO notes (id, content, created_at, updated_at)
             VALUES ('n1', 'Schlüssel liegt im Büro', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')",
            [],
        )
        .expect("insert");

        assert_eq!(matches(&conn, "buro"), 1, "ohne Umlaut");
        assert_eq!(matches(&conn, "büro"), 1, "mit Umlaut");
        assert_eq!(matches(&conn, "schlussel"), 1, "ue zu u");
    }

    fn matches(conn: &Connection, term: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH ?1",
            [term],
            |row| row.get(0),
        )
        .expect("match")
    }
}
