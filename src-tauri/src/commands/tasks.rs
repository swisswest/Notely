use chrono::{Duration, Local};
use tauri::{AppHandle, State};

use crate::db::models::{Task, TaskDraft, TaskEdit};
use crate::db::{
    labels as label_repo, notification_history, settings as settings_repo, tasks as repo,
};
use crate::domain::{time, validation};
use crate::error::{AppError, AppResult};
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
    state.db.with(|conn| repo::soft_delete(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(())
}

/// Ergebnis des Abhakens. `followUp` ist gesetzt, wenn eine Serie den
/// nächsten Termin erzeugt hat - die Oberfläche kann das dann melden.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResult {
    pub task: Task,
    pub follow_up: Option<Task>,
}

#[tauri::command]
pub fn set_task_completed(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    completed: bool,
) -> AppResult<CompletionResult> {
    let id = validation::identifier(&id, "Task-ID")?;
    let result = state.db.with(|conn| {
        let task = repo::set_completed(conn, &id, completed)?;
        if completed {
            notification_history::clear_for_task(conn, &id)?;
        }
        let follow_up = if completed {
            repo::advance_series(conn, &task)?
        } else {
            None
        };
        Ok(CompletionResult { task, follow_up })
    })?;
    window::notify_data_changed(&app);
    Ok(result)
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
    let task = state
        .db
        .with(|conn| repo::set_snoozed_until(conn, &id, None))?;
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

/// Prüft eine ID-Liste aus dem Frontend, bevor sie in die Datenbank geht.
fn checked_ids(ids: Vec<String>) -> AppResult<Vec<String>> {
    if ids.is_empty() {
        return Err(AppError::validation("Keine Tasks ausgewählt"));
    }
    if ids.len() > repo::MAX_BULK {
        return Err(AppError::validation(format!(
            "Maximal {} Tasks auf einmal",
            repo::MAX_BULK
        )));
    }
    ids.into_iter()
        .map(|id| validation::identifier(&id, "Task-ID"))
        .collect()
}

#[tauri::command]
pub fn bulk_set_completed(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
    completed: bool,
) -> AppResult<usize> {
    let ids = checked_ids(ids)?;
    let changed = state
        .db
        .with(|conn| repo::bulk_set_completed(conn, &ids, completed))?;
    window::notify_data_changed(&app);
    Ok(changed)
}

/// Verschiebt mehrere Tasks auf ein Datum. `dueDate = null` nimmt den Termin weg.
#[tauri::command]
pub fn bulk_reschedule(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
    due_date: Option<String>,
    due_time: Option<String>,
) -> AppResult<usize> {
    let ids = checked_ids(ids)?;
    let (date, time_value) = validation::due_pair(due_date.as_deref(), due_time.as_deref())?;
    let changed = state
        .db
        .with(|conn| repo::bulk_reschedule(conn, &ids, date.as_deref(), time_value.as_deref()))?;
    window::notify_data_changed(&app);
    Ok(changed)
}

#[tauri::command]
pub fn bulk_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> AppResult<usize> {
    let ids = checked_ids(ids)?;
    let changed = state.db.with(|conn| repo::bulk_delete(conn, &ids))?;
    window::notify_data_changed(&app);
    Ok(changed)
}

/// Ersetzt die Labels einer Aufgabe vollständig.
#[tauri::command]
pub fn set_task_labels(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    label_ids: Vec<String>,
) -> AppResult<Task> {
    let task_id = validation::identifier(&task_id, "Task-ID")?;
    for id in &label_ids {
        validation::identifier(id, "Label-ID")?;
    }

    let task = state.db.with(|conn| {
        repo::get(conn, &task_id)?;
        label_repo::set_for_task(conn, &task_id, &label_ids)?;
        repo::get(conn, &task_id)
    })?;
    window::notify_data_changed(&app);
    Ok(task)
}

/// Zeigt, wann eine Wiederholungsregel als Naechstes zutrifft.
///
/// Die Vorschau kommt bewusst aus dem Backend: die Regel wird genau von dem
/// Code ausgewertet, der spaeter auch die Folgeaufgaben anlegt. Eine zweite
/// Implementierung im Frontend wuerde frueher oder spaeter abweichen.
#[tauri::command]
pub fn recurrence_preview(
    rule: String,
    from: String,
    count: Option<u32>,
) -> AppResult<Vec<String>> {
    let parsed = crate::domain::recurrence::Recurrence::parse(&rule)?;
    let start = time::parse_date(&from)
        .ok_or_else(|| AppError::validation("Ungültiges Startdatum (erwartet YYYY-MM-DD)"))?;

    let mut result = Vec::new();
    let mut current = start;
    for _ in 0..count.unwrap_or(5).clamp(1, 20) {
        match parsed.next(current) {
            Some(next) => {
                result.push(time::format_date(next));
                current = next;
            }
            None => break,
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    let id = validation::identifier(&id, "Task-ID")?;
    state.db.with(|conn| repo::get(conn, &id))
}
