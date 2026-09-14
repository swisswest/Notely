use tauri::{AppHandle, State};

use crate::db::models::{FolderFilter, Note, NoteFilter, Task};
use crate::db::{folders as folder_repo, labels as label_repo, notes as repo, tasks as task_repo};
use crate::domain::validation;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::window;

const DEFAULT_LIMIT: u32 = 200;

fn build_filter(
    search: Option<String>,
    folder: Option<String>,
    label_ids: Option<Vec<String>>,
) -> AppResult<NoteFilter> {
    let label_ids = label_ids.unwrap_or_default();
    if label_ids.len() > 20 {
        return Err(AppError::validation("Zu viele Label-Filter"));
    }
    for id in &label_ids {
        validation::identifier(id, "Label-ID")?;
    }

    Ok(NoteFilter {
        search,
        folder: FolderFilter::parse(folder.as_deref()),
        label_ids,
    })
}

#[tauri::command]
pub fn create_note(
    app: AppHandle,
    state: State<'_, AppState>,
    content: String,
    folder_id: Option<String>,
) -> AppResult<Note> {
    let content = validation::note_content(&content)?;
    let folder_id = match folder_id {
        Some(id) => Some(validation::identifier(&id, "Ordner-ID")?),
        None => None,
    };

    let note = state.db.with(|conn| {
        if let Some(id) = folder_id.as_deref() {
            if !folder_repo::exists(conn, id)? {
                return Err(AppError::NotFound(format!("Ordner {id}")));
            }
        }
        repo::create(conn, &content, folder_id.as_deref())
    })?;
    window::notify_data_changed(&app);
    Ok(note)
}

#[tauri::command]
pub fn update_note(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> AppResult<Note> {
    let id = validation::identifier(&id, "Notiz-ID")?;
    let content = validation::note_content(&content)?;
    let note = state.db.with(|conn| repo::update_content(conn, &id, &content))?;
    window::notify_data_changed(&app);
    Ok(note)
}

#[tauri::command]
pub fn delete_note(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = validation::identifier(&id, "Notiz-ID")?;
    state.db.with(|conn| repo::delete(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn get_note(state: State<'_, AppState>, id: String) -> AppResult<Note> {
    let id = validation::identifier(&id, "Notiz-ID")?;
    state.db.with(|conn| repo::get(conn, &id))
}

#[tauri::command]
pub fn list_notes(
    state: State<'_, AppState>,
    search: Option<String>,
    folder: Option<String>,
    label_ids: Option<Vec<String>>,
    limit: Option<u32>,
) -> AppResult<Vec<Note>> {
    let filter = build_filter(search, folder, label_ids)?;
    state
        .db
        .with(|conn| repo::list(conn, &filter, limit.unwrap_or(DEFAULT_LIMIT)))
}

/// Verschiebt eine Notiz in einen Ordner; `null` bedeutet "Ohne Ordner".
#[tauri::command]
pub fn set_note_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
    folder_id: Option<String>,
) -> AppResult<Note> {
    let note_id = validation::identifier(&note_id, "Notiz-ID")?;
    let folder_id = match folder_id {
        Some(id) => Some(validation::identifier(&id, "Ordner-ID")?),
        None => None,
    };

    let note = state.db.with(|conn| {
        if let Some(id) = folder_id.as_deref() {
            if !folder_repo::exists(conn, id)? {
                return Err(AppError::NotFound(format!("Ordner {id}")));
            }
        }
        repo::set_folder(conn, &note_id, folder_id.as_deref())
    })?;
    window::notify_data_changed(&app);
    Ok(note)
}

/// Ersetzt die Labels einer Notiz vollständig.
#[tauri::command]
pub fn set_note_labels(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
    label_ids: Vec<String>,
) -> AppResult<Note> {
    let note_id = validation::identifier(&note_id, "Notiz-ID")?;
    for id in &label_ids {
        validation::identifier(id, "Label-ID")?;
    }

    let note = state.db.with(|conn| {
        repo::get(conn, &note_id)?;
        label_repo::set_for_note(conn, &note_id, &label_ids)?;
        repo::get(conn, &note_id)
    })?;
    window::notify_data_changed(&app);
    Ok(note)
}

#[tauri::command]
pub fn tasks_for_note(state: State<'_, AppState>, note_id: String) -> AppResult<Vec<Task>> {
    let note_id = validation::identifier(&note_id, "Notiz-ID")?;
    state.db.with(|conn| task_repo::list_by_note(conn, &note_id))
}
