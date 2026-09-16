use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::backup::{self, BackupCheck, BackupInfo, ImportSummary, MarkdownImportSummary};
use crate::db::settings as settings_repo;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::{logging, window};

fn documents(app: &AppHandle) -> Option<PathBuf> {
    app.path().document_dir().ok()
}

fn target_dir(app: &AppHandle, state: &State<'_, AppState>) -> AppResult<PathBuf> {
    let settings = state.db.with(settings_repo::load)?;
    backup::resolve_dir(documents(app), &settings)
}

#[tauri::command]
pub fn backup_directory(app: AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    Ok(target_dir(&app, &state)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn backup_now(app: AppHandle, state: State<'_, AppState>) -> AppResult<BackupInfo> {
    let dir = target_dir(&app, &state)?;
    let version = app.package_info().version.to_string();
    let info = backup::write(&state.db, &version, &dir)?;

    state.db.with(|conn| {
        let mut settings = settings_repo::load(conn)?;
        settings.backup.last_backup_at =
            Some(crate::domain::time::to_rfc3339(chrono::Local::now()));
        settings_repo::save(conn, &settings)?;
        let removed = backup::prune(&dir, settings.backup.keep)?;
        if removed > 0 {
            logging::info("backup", format!("{removed} alte Sicherungen entfernt"));
        }
        Ok(())
    })?;

    window::notify_data_changed(&app);
    Ok(info)
}

#[tauri::command]
pub fn list_backups(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<BackupInfo>> {
    backup::list(&target_dir(&app, &state)?)
}

/// Prüft eine Sicherung, ohne sie einzuspielen. Zeigt Inhalt und
/// Prüfsumme - so lässt sich vor dem Ernstfall feststellen, ob die Datei
/// überhaupt noch brauchbar ist.
#[tauri::command]
pub fn verify_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    file_name: String,
) -> AppResult<BackupCheck> {
    let name = backup::safe_file_name(&file_name)?;
    let path = target_dir(&app, &state)?.join(name);
    backup::verify(&path)
}

/// Führt eine Sicherung mit dem Bestand zusammen. Bestehende Einträge
/// bleiben unverändert - es kann nichts überschrieben werden.
#[tauri::command]
pub fn import_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    file_name: String,
) -> AppResult<ImportSummary> {
    let name = backup::safe_file_name(&file_name)?;
    let path = target_dir(&app, &state)?.join(name);
    let summary = backup::import(&state.db, &path)?;
    window::notify_data_changed(&app);
    Ok(summary)
}

/// Liest Textdateien aus einem Ordner als Notizen ein.
#[tauri::command]
pub fn import_markdown(
    app: AppHandle,
    state: State<'_, AppState>,
    directory: String,
    folder_id: Option<String>,
) -> AppResult<MarkdownImportSummary> {
    let path = PathBuf::from(directory.trim());
    if !path.is_absolute() {
        return Err(AppError::validation(
            "Bitte den vollständigen Pfad zum Ordner angeben",
        ));
    }

    let folder_id = match folder_id {
        Some(id) => Some(crate::domain::validation::identifier(&id, "Ordner-ID")?),
        None => None,
    };

    let summary = backup::import_markdown(&state.db, &path, folder_id.as_deref())?;
    window::notify_data_changed(&app);
    Ok(summary)
}

#[tauri::command]
pub fn export_markdown(app: AppHandle, state: State<'_, AppState>) -> AppResult<BackupInfo> {
    let dir = target_dir(&app, &state)?;
    backup::write_markdown(&state.db, &dir)
}
