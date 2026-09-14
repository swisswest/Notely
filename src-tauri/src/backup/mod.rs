use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::models::{Folder, Label, Note, Task};
use crate::db::{folders, labels, notes, settings as settings_repo, tasks, Db};
use crate::domain::settings::AppSettings;
use crate::error::{AppError, AppResult};
use crate::logging;

pub const SCHEMA_VERSION: u32 = 1;
const DEFAULT_DIR_NAME: &str = "Notely Backups";
const FILE_PREFIX: &str = "notely-backup-";
const TARGET: &str = "backup";
/// Erst nach dieser Zeit wird beim Start erneut gesichert.
const MIN_HOURS_BETWEEN_BACKUPS: i64 = 20;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPayload {
    pub schema_version: u32,
    pub app_version: String,
    pub exported_at: String,
    pub notes: Vec<Note>,
    pub tasks: Vec<Task>,
    pub folders: Vec<Folder>,
    pub labels: Vec<Label>,
    /// Nur zur Information; beim Import werden Einstellungen nicht übernommen.
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub notes: usize,
    pub tasks: usize,
    pub folders: usize,
    pub labels: usize,
    pub skipped: usize,
}

/// Zielordner: Einstellung, sonst "Dokumente/Notely Backups".
pub fn resolve_dir(documents: Option<PathBuf>, settings: &AppSettings) -> AppResult<PathBuf> {
    let configured = settings.backup.directory.trim();
    if !configured.is_empty() {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err(AppError::validation(
                "Der Backup-Ordner muss ein vollständiger Pfad sein",
            ));
        }
        return Ok(path);
    }

    let base = documents.ok_or_else(|| {
        AppError::Internal("Dokumentenordner konnte nicht ermittelt werden".into())
    })?;
    Ok(base.join(DEFAULT_DIR_NAME))
}

pub fn collect(db: &Db, app_version: &str) -> AppResult<BackupPayload> {
    db.with(|conn| {
        Ok(BackupPayload {
            schema_version: SCHEMA_VERSION,
            app_version: app_version.to_string(),
            exported_at: Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
            notes: notes::list_all(conn)?,
            tasks: tasks::list_all(conn)?,
            folders: folders::list(conn)?,
            labels: labels::list(conn)?,
            settings: settings_repo::load(conn)?,
        })
    })
}

pub fn write(db: &Db, app_version: &str, dir: &Path) -> AppResult<BackupInfo> {
    fs::create_dir_all(dir)
        .map_err(|err| AppError::Internal(format!("Backup-Ordner nicht anlegbar: {err}")))?;

    let payload = collect(db, app_version)?;
    let file_name = format!(
        "{FILE_PREFIX}{}.json",
        Local::now().format("%Y-%m-%d-%H%M%S")
    );
    let path = dir.join(&file_name);

    let json = serde_json::to_string_pretty(&payload)
        .map_err(|err| AppError::Internal(format!("Sicherung nicht serialisierbar: {err}")))?;
    fs::write(&path, json)
        .map_err(|err| AppError::Internal(format!("Sicherung nicht schreibbar: {err}")))?;

    logging::info(
        TARGET,
        format!(
            "Sicherung geschrieben: {} Notizen, {} Tasks",
            payload.notes.len(),
            payload.tasks.len()
        ),
    );

    info_for(&path)
}

/// Lesbarer Export aller Notizen und offenen Tasks als eine Markdown-Datei.
pub fn write_markdown(db: &Db, dir: &Path) -> AppResult<BackupInfo> {
    fs::create_dir_all(dir)
        .map_err(|err| AppError::Internal(format!("Ordner nicht anlegbar: {err}")))?;

    let (note_list, task_list, folder_list, label_list) = db.with(|conn| {
        Ok((
            notes::list_all(conn)?,
            tasks::list_all(conn)?,
            folders::list(conn)?,
            labels::list(conn)?,
        ))
    })?;

    let mut text = format!(
        "# Notely Export\n\nErstellt am {}\n\n",
        Local::now().format("%d.%m.%Y %H:%M")
    );

    text.push_str("## Offene Aufgaben\n\n");
    let mut open: Vec<&Task> = task_list.iter().filter(|task| !task.completed).collect();
    open.sort_by(|a, b| {
        a.due_date
            .cmp(&b.due_date)
            .then(a.due_time.cmp(&b.due_time))
    });
    if open.is_empty() {
        text.push_str("_keine_\n");
    }
    for task in open {
        let when = match (&task.due_date, &task.due_time) {
            (Some(date), Some(time)) => format!(" — {date} {time}"),
            (Some(date), None) => format!(" — {date}"),
            _ => String::new(),
        };
        text.push_str(&format!("- [ ] {}{}\n", task.title, when));
    }

    text.push_str("\n## Notizen\n");
    for folder in folder_list.iter().map(Some).chain(std::iter::once(None)) {
        let folder_id = folder.map(|value| value.id.as_str());
        let matching: Vec<&Note> = note_list
            .iter()
            .filter(|note| note.folder_id.as_deref() == folder_id)
            .collect();
        if matching.is_empty() {
            continue;
        }

        let heading = folder
            .map(|value| value.name.as_str())
            .unwrap_or("Ohne Ordner");
        text.push_str(&format!("\n### {heading}\n"));
        for note in matching {
            let names: Vec<&str> = note
                .labels
                .iter()
                .filter_map(|id| label_list.iter().find(|label| &label.id == id))
                .map(|label| label.name.as_str())
                .collect();
            let tags = if names.is_empty() {
                String::new()
            } else {
                format!(" `{}`", names.join("` `"))
            };
            text.push_str(&format!(
                "\n**{}**{}\n\n{}\n",
                note.created_at, tags, note.content
            ));
        }
    }

    let path = dir.join(format!(
        "notely-notizen-{}.md",
        Local::now().format("%Y-%m-%d")
    ));
    fs::write(&path, text)
        .map_err(|err| AppError::Internal(format!("Export nicht schreibbar: {err}")))?;
    info_for(&path)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownImportSummary {
    pub imported: usize,
    /// Dateien, deren Inhalt schon als Notiz existiert.
    pub duplicates: usize,
    /// Dateien, die zu gross oder nicht lesbar waren.
    pub skipped: usize,
}

const MAX_MARKDOWN_FILES: usize = 500;
const MAX_MARKDOWN_BYTES: u64 = 1024 * 1024;
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];

/// Liest alle Textdateien eines Ordners als Notizen ein. Nicht rekursiv, damit
/// nachvollziehbar bleibt, was importiert wird.
pub fn import_markdown(
    db: &Db,
    dir: &Path,
    folder_id: Option<&str>,
) -> AppResult<MarkdownImportSummary> {
    if !dir.is_dir() {
        return Err(AppError::validation(
            "Der angegebene Ordner existiert nicht",
        ));
    }

    let existing: std::collections::HashSet<String> = db.with(|conn| {
        Ok(notes::list_all(conn)?
            .into_iter()
            .map(|note| normalize(&note.content))
            .collect())
    })?;

    let mut summary = MarkdownImportSummary::default();
    let mut seen = existing;

    let entries = fs::read_dir(dir)
        .map_err(|err| AppError::Internal(format!("Ordner nicht lesbar: {err}")))?;

    for entry in entries.flatten().take(MAX_MARKDOWN_FILES) {
        let path = entry.path();
        let matches_extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| MARKDOWN_EXTENSIONS.contains(&value.to_lowercase().as_str()))
            .unwrap_or(false);
        if !path.is_file() || !matches_extension {
            continue;
        }

        let too_big = fs::metadata(&path)
            .map(|meta| meta.len() > MAX_MARKDOWN_BYTES)
            .unwrap_or(true);
        if too_big {
            summary.skipped += 1;
            continue;
        }

        let Ok(content) = fs::read_to_string(&path) else {
            summary.skipped += 1;
            continue;
        };
        if content.trim().is_empty() {
            summary.skipped += 1;
            continue;
        }

        let fingerprint = normalize(&content);
        if seen.contains(&fingerprint) {
            summary.duplicates += 1;
            continue;
        }

        db.with(|conn| notes::create(conn, content.trim(), folder_id))?;
        seen.insert(fingerprint);
        summary.imported += 1;
    }

    logging::info(TARGET, format!("Markdown-Import: {summary:?}"));
    Ok(summary)
}

/// Vergleichsform für die Dublettenprüfung: Whitespace vereinheitlicht.
fn normalize(content: &str) -> String {
    content.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn list(dir: &Path) -> AppResult<Vec<BackupInfo>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(dir)
        .map_err(|err| AppError::Internal(format!("Backup-Ordner nicht lesbar: {err}")))?;

    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_backup = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with(FILE_PREFIX) && name.ends_with(".json"))
            .unwrap_or(false);
        if is_backup {
            result.push(info_for(&path)?);
        }
    }

    result.sort_by(|a, b| b.file_name.cmp(&a.file_name));
    Ok(result)
}

pub fn prune(dir: &Path, keep: u32) -> AppResult<usize> {
    let existing = list(dir)?;
    let mut removed = 0;
    for info in existing.into_iter().skip(keep.max(1) as usize) {
        if fs::remove_file(&info.path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Dateiname ohne Pfadanteile - verhindert Ausbrüche aus dem Backup-Ordner.
pub fn safe_file_name(name: &str) -> AppResult<&str> {
    let valid = !name.is_empty()
        && name.len() <= 120
        && name.ends_with(".json")
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if valid {
        Ok(name)
    } else {
        Err(AppError::validation("Ungültiger Dateiname"))
    }
}

/// Führt Daten aus einer Sicherung mit dem Bestand zusammen. Vorhandene
/// Einträge bleiben unangetastet - der Import kann nichts überschreiben.
pub fn import(db: &Db, path: &Path) -> AppResult<ImportSummary> {
    let raw = fs::read_to_string(path)
        .map_err(|err| AppError::Internal(format!("Sicherung nicht lesbar: {err}")))?;
    let payload: BackupPayload = serde_json::from_str(&raw)
        .map_err(|err| AppError::validation(format!("Sicherung ist beschädigt: {err}")))?;

    if payload.schema_version > SCHEMA_VERSION {
        return Err(AppError::validation(
            "Die Sicherung stammt aus einer neueren Version von Notely",
        ));
    }

    db.with(|conn| merge(conn, &payload))
}

fn merge(conn: &Connection, payload: &BackupPayload) -> AppResult<ImportSummary> {
    let mut summary = ImportSummary::default();

    for folder in &payload.folders {
        if exists(conn, "folders", &folder.id)? {
            summary.skipped += 1;
            continue;
        }
        let name = free_name(conn, "folders", &folder.name)?;
        conn.execute(
            "INSERT INTO folders (id, name, position, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![folder.id, name, folder.position, folder.created_at],
        )?;
        summary.folders += 1;
    }

    for label in &payload.labels {
        if exists(conn, "labels", &label.id)? {
            summary.skipped += 1;
            continue;
        }
        let name = free_name(conn, "labels", &label.name)?;
        conn.execute(
            "INSERT INTO labels (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![label.id, name, label.color, label.created_at],
        )?;
        summary.labels += 1;
    }

    for note in &payload.notes {
        if exists(conn, "notes", &note.id)? {
            summary.skipped += 1;
            continue;
        }
        let folder_id = match note.folder_id.as_deref() {
            Some(id) if exists(conn, "folders", id)? => Some(id),
            _ => None,
        };
        conn.execute(
            "INSERT INTO notes (id, content, created_at, updated_at, analyzed_at,
                                last_analysis_status, folder_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                note.id,
                note.content,
                note.created_at,
                note.updated_at,
                note.analyzed_at,
                note.last_analysis_status,
                folder_id
            ],
        )?;
        for label_id in &note.labels {
            if exists(conn, "labels", label_id)? {
                conn.execute(
                    "INSERT OR IGNORE INTO note_labels (note_id, label_id) VALUES (?1, ?2)",
                    params![note.id, label_id],
                )?;
            }
        }
        summary.notes += 1;
    }

    for task in &payload.tasks {
        if exists(conn, "tasks", &task.id)? {
            summary.skipped += 1;
            continue;
        }
        let source = match task.source_note_id.as_deref() {
            Some(id) if exists(conn, "notes", id)? => Some(id),
            _ => None,
        };
        conn.execute(
            "INSERT INTO tasks (id, title, description, created_at, updated_at, due_date, due_time,
                                completed, completed_at, source_note_id, ai_generated, confidence,
                                snoozed_until)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                task.id,
                task.title,
                task.description,
                task.created_at,
                task.updated_at,
                task.due_date,
                task.due_time,
                i64::from(task.completed),
                task.completed_at,
                source,
                i64::from(task.ai_generated),
                task.confidence,
                task.snoozed_until
            ],
        )?;
        summary.tasks += 1;
    }

    logging::info(TARGET, format!("Import abgeschlossen: {summary:?}"));
    Ok(summary)
}

fn exists(conn: &Connection, table: &str, id: &str) -> AppResult<bool> {
    // `table` stammt ausschliesslich aus festen Literalen dieser Datei.
    let sql = match table {
        "folders" => "SELECT COUNT(*) FROM folders WHERE id = ?1",
        "labels" => "SELECT COUNT(*) FROM labels WHERE id = ?1",
        "notes" => "SELECT COUNT(*) FROM notes WHERE id = ?1",
        "tasks" => "SELECT COUNT(*) FROM tasks WHERE id = ?1",
        other => return Err(AppError::Internal(format!("Unbekannte Tabelle {other}"))),
    };
    let count: i64 = conn.query_row(sql, params![id], |row| row.get(0))?;
    Ok(count > 0)
}

/// Namen sind eindeutig - bei Kollision wird ein Zusatz angehängt.
fn free_name(conn: &Connection, table: &str, name: &str) -> AppResult<String> {
    let sql = match table {
        "folders" => "SELECT COUNT(*) FROM folders WHERE name = ?1 COLLATE NOCASE",
        "labels" => "SELECT COUNT(*) FROM labels WHERE name = ?1 COLLATE NOCASE",
        other => return Err(AppError::Internal(format!("Unbekannte Tabelle {other}"))),
    };

    let mut candidate = name.to_string();
    for attempt in 1..50 {
        let count: i64 = conn.query_row(sql, params![candidate], |row| row.get(0))?;
        if count == 0 {
            return Ok(candidate);
        }
        candidate = format!("{name} (Import {attempt})");
    }
    Err(AppError::validation(
        "Name konnte nicht eindeutig gemacht werden",
    ))
}

fn info_for(path: &Path) -> AppResult<BackupInfo> {
    let metadata = fs::metadata(path)
        .map_err(|err| AppError::Internal(format!("Datei nicht lesbar: {err}")))?;
    let created: chrono::DateTime<Local> = metadata
        .modified()
        .map(chrono::DateTime::<Local>::from)
        .unwrap_or_else(|_| Local::now());

    Ok(BackupInfo {
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        path: path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        created_at: created.to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
    })
}

/// Prüft beim Start, ob eine neue Sicherung fällig ist.
pub fn due(settings: &AppSettings, now: chrono::DateTime<Local>) -> bool {
    if !settings.backup.enabled {
        return false;
    }
    match settings
        .backup
        .last_backup_at
        .as_deref()
        .and_then(crate::domain::time::parse_rfc3339)
    {
        Some(last) => (now - last).num_hours() >= MIN_HOURS_BETWEEN_BACKUPS,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::TaskDraft;

    fn seeded_db() -> Db {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let folder = folders::create(conn, "Arbeit")?;
            let label = labels::create(conn, "Dringend", "red")?;
            let note = notes::create(conn, "Bestandsnotiz", Some(&folder.id))?;
            labels::set_for_note(conn, &note.id, &[label.id.clone()])?;
            tasks::create(
                conn,
                &TaskDraft {
                    title: "Migration".into(),
                    description: String::new(),
                    due_date: Some("2026-09-11".into()),
                    due_time: Some("12:00".into()),
                    source_note_id: Some(note.id.clone()),
                    ai_generated: true,
                    confidence: Some(0.9),
                },
            )?;
            Ok(())
        })
        .expect("seed");
        db
    }

    #[test]
    fn export_contains_everything() {
        let payload = collect(&seeded_db(), "0.3.0").expect("payload");
        assert_eq!(payload.notes.len(), 1);
        assert_eq!(payload.tasks.len(), 1);
        assert_eq!(payload.folders.len(), 1);
        assert_eq!(payload.labels.len(), 1);
        assert_eq!(payload.notes[0].labels.len(), 1);
    }

    #[test]
    fn import_into_empty_database_restores_everything() {
        let payload = collect(&seeded_db(), "0.3.0").expect("payload");
        let target = Db::open_in_memory().expect("db");

        let summary = target.with(|conn| merge(conn, &payload)).expect("import");
        assert_eq!(summary.notes, 1);
        assert_eq!(summary.tasks, 1);
        assert_eq!(summary.folders, 1);
        assert_eq!(summary.labels, 1);

        target
            .with(|conn| {
                let restored = notes::list_all(conn)?;
                assert_eq!(restored[0].content, "Bestandsnotiz");
                assert!(restored[0].folder_id.is_some());
                assert_eq!(restored[0].labels.len(), 1);

                let restored_tasks = tasks::list_all(conn)?;
                assert_eq!(restored_tasks[0].title, "Migration");
                assert!(restored_tasks[0].source_note_id.is_some());
                Ok(())
            })
            .expect("check");
    }

    #[test]
    fn importing_twice_changes_nothing() {
        let payload = collect(&seeded_db(), "0.3.0").expect("payload");
        let target = Db::open_in_memory().expect("db");

        target.with(|conn| merge(conn, &payload)).expect("first");
        let second = target.with(|conn| merge(conn, &payload)).expect("second");

        assert_eq!(second.notes, 0);
        assert_eq!(second.tasks, 0);
        assert_eq!(second.skipped, 4);

        target
            .with(|conn| {
                assert_eq!(notes::list_all(conn)?.len(), 1);
                assert_eq!(tasks::list_all(conn)?.len(), 1);
                Ok(())
            })
            .expect("check");
    }

    #[test]
    fn name_collisions_get_a_suffix() {
        let payload = collect(&seeded_db(), "0.3.0").expect("payload");
        let target = Db::open_in_memory().expect("db");
        target
            .with(|conn| {
                folders::create(conn, "Arbeit")?;
                Ok(())
            })
            .expect("existing folder");

        target.with(|conn| merge(conn, &payload)).expect("import");

        let names: Vec<String> = target
            .with(|conn| folders::list(conn))
            .expect("folders")
            .into_iter()
            .map(|folder| folder.name)
            .collect();
        assert!(names.contains(&"Arbeit".to_string()));
        assert!(names.iter().any(|name| name.starts_with("Arbeit (Import")));
    }

    #[test]
    fn markdown_import_skips_duplicates_and_junk() {
        let dir = std::env::temp_dir().join(format!("notely-md-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("tempdir");
        fs::write(dir.join("eins.md"), "Erste Notiz").expect("write");
        fs::write(dir.join("zwei.markdown"), "Zweite  Notiz").expect("write");
        fs::write(dir.join("kopie.md"), "Zweite Notiz").expect("write");
        fs::write(dir.join("leer.md"), "   ").expect("write");
        fs::write(dir.join("bild.png"), "kein Text").expect("write");

        let db = Db::open_in_memory().expect("db");
        let summary = import_markdown(&db, &dir, None).expect("import");

        assert_eq!(summary.imported, 2);
        assert_eq!(summary.duplicates, 1);
        assert_eq!(summary.skipped, 1);

        // Zweiter Durchlauf bringt nichts Neues.
        let again = import_markdown(&db, &dir, None).expect("import");
        assert_eq!(again.imported, 0);
        assert_eq!(again.duplicates, 3);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_names_cannot_escape_the_folder() {
        assert!(safe_file_name("notely-backup-2026-09-14-1200.json").is_ok());
        assert!(safe_file_name("../../etc/passwd.json").is_err());
        assert!(safe_file_name("backup.json.exe").is_err());
        assert!(safe_file_name("C:\\evil.json").is_err());
    }

    #[test]
    fn backup_is_due_only_after_the_interval() {
        let mut settings = AppSettings::default();
        let now = Local::now();
        assert!(due(&settings, now));

        settings.backup.last_backup_at = Some(crate::domain::time::to_rfc3339(now));
        assert!(!due(&settings, now));

        settings.backup.last_backup_at = Some(crate::domain::time::to_rfc3339(
            now - chrono::Duration::hours(21),
        ));
        assert!(due(&settings, now));

        settings.backup.enabled = false;
        assert!(!due(&settings, now));
    }
}
