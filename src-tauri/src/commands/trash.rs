use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::models::{Note, Task};
use crate::db::{notes as note_repo, tasks as task_repo};
use crate::domain::validation;
use crate::error::AppResult;
use crate::state::AppState;
use crate::{logging, window};

/// Nach dieser Frist räumt die App den Papierkorb beim Start selbst auf.
pub const RETENTION_DAYS: i64 = 30;
const LIMIT: u32 = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashContents {
    pub notes: Vec<Note>,
    pub tasks: Vec<Task>,
    pub retention_days: i64,
}

#[tauri::command]
pub fn list_trash(state: State<'_, AppState>) -> AppResult<TrashContents> {
    state.db.with(|conn| {
        Ok(TrashContents {
            notes: note_repo::list_deleted(conn, LIMIT)?,
            tasks: task_repo::list_deleted(conn, LIMIT)?,
            retention_days: RETENTION_DAYS,
        })
    })
}

#[tauri::command]
pub fn restore_note(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<Note> {
    let id = validation::identifier(&id, "Notiz-ID")?;
    let note = state.db.with(|conn| note_repo::restore(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(note)
}

#[tauri::command]
pub fn restore_task(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<Task> {
    let id = validation::identifier(&id, "Task-ID")?;
    let task = state.db.with(|conn| task_repo::restore(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(task)
}

/// Endgültig löschen - ab hier hilft nur noch eine Sicherung.
#[tauri::command]
pub fn purge_note(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = validation::identifier(&id, "Notiz-ID")?;
    state.db.with(|conn| note_repo::purge(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn purge_task(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = validation::identifier(&id, "Task-ID")?;
    state.db.with(|conn| task_repo::purge(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn empty_trash(app: AppHandle, state: State<'_, AppState>) -> AppResult<usize> {
    let removed = state.db.with(|conn| {
        let notes = note_repo::purge_expired(conn, 0)?;
        let tasks = task_repo::purge_expired(conn, 0)?;
        Ok(notes + tasks)
    })?;
    logging::info("trash", format!("Papierkorb geleert: {removed} Einträge"));
    window::notify_data_changed(&app);
    Ok(removed)
}
