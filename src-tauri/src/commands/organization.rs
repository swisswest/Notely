use tauri::{AppHandle, State};

use crate::db::models::{Folder, Label};
use crate::db::{folders as folder_repo, labels as label_repo};
use crate::domain::validation;
use crate::error::AppResult;
use crate::state::AppState;
use crate::window;

#[tauri::command]
pub fn list_folders(state: State<'_, AppState>) -> AppResult<Vec<Folder>> {
    state.db.with(folder_repo::list)
}

#[tauri::command]
pub fn create_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Folder> {
    let name = validation::display_name(&name, "Ordnername")?;
    let folder = state.db.with(|conn| folder_repo::create(conn, &name))?;
    window::notify_data_changed(&app);
    Ok(folder)
}

#[tauri::command]
pub fn rename_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<Folder> {
    let id = validation::identifier(&id, "Ordner-ID")?;
    let name = validation::display_name(&name, "Ordnername")?;
    let folder = state
        .db
        .with(|conn| folder_repo::rename(conn, &id, &name))?;
    window::notify_data_changed(&app);
    Ok(folder)
}

/// Der Ordner verschwindet, die Notizen darin bleiben und landen in "Ohne Ordner".
#[tauri::command]
pub fn delete_folder(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = validation::identifier(&id, "Ordner-ID")?;
    state.db.with(|conn| folder_repo::delete(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn list_labels(state: State<'_, AppState>) -> AppResult<Vec<Label>> {
    state.db.with(label_repo::list)
}

#[tauri::command]
pub fn label_colors() -> Vec<String> {
    label_repo::COLORS
        .iter()
        .map(|color| color.to_string())
        .collect()
}

#[tauri::command]
pub fn create_label(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    color: String,
) -> AppResult<Label> {
    let name = validation::display_name(&name, "Labelname")?;
    let label = state
        .db
        .with(|conn| label_repo::create(conn, &name, &color))?;
    window::notify_data_changed(&app);
    Ok(label)
}

#[tauri::command]
pub fn update_label(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
    color: String,
) -> AppResult<Label> {
    let id = validation::identifier(&id, "Label-ID")?;
    let name = validation::display_name(&name, "Labelname")?;
    let label = state
        .db
        .with(|conn| label_repo::update(conn, &id, &name, &color))?;
    window::notify_data_changed(&app);
    Ok(label)
}

/// Entfernt das Label überall; die Notizen selbst bleiben unberührt.
#[tauri::command]
pub fn delete_label(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = validation::identifier(&id, "Label-ID")?;
    state.db.with(|conn| label_repo::delete(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(())
}
