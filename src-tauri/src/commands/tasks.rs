use chrono::{Duration, Local};
use tauri::{AppHandle, State};

use crate::db::models::{Task, TaskDraft, TaskEdit};
use crate::db::{notification_history, settings as settings_repo, tasks as repo};
use crate::domain::{time, validation};
use crate::error::AppResult;
use crate::state::AppState;
use crate::window;

const DEFAULT_COMPLETED_LIMIT: u32 = 100;

#[tauri::command]
pub fn create_task(
    app: AppHandle,
    state: State<'_, AppState>,
    draft: TaskDraft,
) -> AppResult<Task> {
    let draft = validation::task_draft(draft)?;
    let task = state.db.with(|conn| repo::create(conn, &draft))?;
    window::notify_data_changed(&app);
    Ok(task)
}

#[tauri::command]
pub fn update_task(app: AppHandle, state: State<'_, AppState>, edit: TaskEdit) -> AppResult<Task> {
    let edit = validation::task_edit(edit)?;
    let task = state.db.with(|conn| repo::update(conn, &edit))?;
    window::notify_data_changed(&app);
    Ok(task)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = validation::identifier(&id, "Task-ID")?;
    state.db.with(|conn| repo::delete(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_task_completed(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    completed: bool,
) -> AppResult<Task> {
    let id = validation::identifier(&id, "Task-ID")?;
    let task = state.db.with(|conn| {
        let task = repo::set_completed(conn, &id, completed)?;
        if completed {
            notification_history::clear_for_task(conn, &id)?;
        }
        Ok(task)
    })?;
    window::notify_data_changed(&app);
    Ok(task)
}

/// Verschiebt die Erinnerung. Ohne Angabe gilt der in den Einstellungen
/// hinterlegte Standardwert.
#[tauri::command]
pub fn snooze_task(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    minutes: Option<u32>,
) -> AppResult<Task> {
    let id = validation::identifier(&id, "Task-ID")?;
    let task = state.db.with(|conn| {
        let settings = settings_repo::load(conn)?;
        let minutes = minutes
            .unwrap_or(settings.notifications.default_snooze_minutes)
            .clamp(1, 1440);
        let until = time::to_rfc3339(Local::now() + Duration::minutes(i64::from(minutes)));
        repo::set_snoozed_until(conn, &id, Some(&until))
    })?;
    window::notify_data_changed(&app);
    Ok(task)
}

#[tauri::command]
pub fn clear_snooze(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<Task> {
    let id = validation::identifier(&id, "Task-ID")?;
    let task = state.db.with(|conn| repo::set_snoozed_until(conn, &id, None))?;
    window::notify_data_changed(&app);
    Ok(task)
}

#[tauri::command]
pub fn list_tasks(
    state: State<'_, AppState>,
    include_completed: Option<bool>,
    completed_limit: Option<u32>,
) -> AppResult<Vec<Task>> {
    state.db.with(|conn| {
        repo::list(
            conn,
            include_completed.unwrap_or(true),
            completed_limit.unwrap_or(DEFAULT_COMPLETED_LIMIT),
        )
    })
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    let id = validation::identifier(&id, "Task-ID")?;
    state.db.with(|conn| repo::get(conn, &id))
}
