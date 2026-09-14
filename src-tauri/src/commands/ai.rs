use tauri::{AppHandle, State};

use crate::ai;
use crate::db::models::{
    AnalysisResult, Task, TaskDraft, TaskSuggestion, ANALYSIS_STATUS_EMPTY, ANALYSIS_STATUS_FAILED,
    ANALYSIS_STATUS_OK,
};
use crate::db::{
    notes as note_repo, settings as settings_repo, tasks as task_repo, usage as usage_repo,
};
use crate::domain::validation;
use crate::error::AppResult;
use crate::security::secrets::SecretStore;
use crate::state::AppState;
use crate::{logging, window};

/// Analysiert eine gespeicherte Notiz. Die Notiz selbst wird dabei nie
/// verändert - schlägt die Analyse fehl, bleibt der Text unberührt.
#[tauri::command]
pub async fn analyze_note(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
) -> AppResult<AnalysisResult> {
    let note_id = validation::identifier(&note_id, "Notiz-ID")?;

    let (note, settings) = state.db.with(|conn| {
        let note = note_repo::get(conn, &note_id)?;
        let settings = settings_repo::load(conn)?;
        Ok((note, settings))
    })?;

    let api_key = SecretStore::require_api_key()?;

    let (outcome, usage) = match ai::analyze_note(&state.claude, &api_key, &settings, &note.content)
        .await
    {
        Ok(result) => result,
        Err(err) => {
            let _ = state.db.with(|conn| {
                note_repo::set_analysis_status(conn, &note_id, ANALYSIS_STATUS_FAILED)
            });
            logging::warn("ai", format!("Analyse fehlgeschlagen: {err}"));
            return Err(err);
        }
    };

    let _ = state.db.with(|conn| {
        usage_repo::record(conn, &settings.claude.model, usage, Some(&note_id))
    });

    for reason in &outcome.rejected {
        logging::warn("ai", format!("Vorschlag verworfen: {reason}"));
    }

    let status = if outcome.suggestions.is_empty() {
        ANALYSIS_STATUS_EMPTY
    } else {
        ANALYSIS_STATUS_OK
    };
    let _ = state
        .db
        .with(|conn| note_repo::set_analysis_status(conn, &note_id, status));

    let threshold = settings.ai.auto_create_min_confidence;
    let mut created_task_ids = Vec::new();
    let mut pending = Vec::new();

    if settings.ai.confirm_before_create {
        pending = outcome.suggestions;
    } else {
        for suggestion in outcome.suggestions {
            if suggestion.confidence < threshold {
                pending.push(suggestion);
                continue;
            }
            match persist(&state, &note_id, &suggestion) {
                Ok(task) => created_task_ids.push(task.id),
                Err(err) => {
                    logging::warn("ai", format!("Task nicht anlegbar: {err}"));
                    pending.push(suggestion);
                }
            }
        }
    }

    if !created_task_ids.is_empty() {
        window::notify_data_changed(&app);
    }

    Ok(AnalysisResult {
        note_id,
        needs_confirmation: !pending.is_empty(),
        suggestions: pending,
        rejected: outcome.rejected,
        created_task_ids,
    })
}

/// Übernimmt die vom Benutzer bestätigten (und ggf. bearbeiteten) Vorschläge.
#[tauri::command]
pub fn create_tasks_from_suggestions(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
    suggestions: Vec<TaskSuggestion>,
) -> AppResult<Vec<Task>> {
    let note_id = validation::identifier(&note_id, "Notiz-ID")?;
    let mut created = Vec::new();

    for suggestion in &suggestions {
        created.push(persist(&state, &note_id, suggestion)?);
    }

    if !created.is_empty() {
        window::notify_data_changed(&app);
    }

    Ok(created)
}

fn persist(
    state: &State<'_, AppState>,
    note_id: &str,
    suggestion: &TaskSuggestion,
) -> AppResult<Task> {
    let draft = validation::task_draft(TaskDraft {
        title: suggestion.title.clone(),
        description: suggestion.description.clone(),
        due_date: suggestion.due_date.clone(),
        due_time: suggestion.due_time.clone(),
        source_note_id: Some(note_id.to_string()),
        ai_generated: true,
        confidence: Some(suggestion.confidence),
    })?;

    state.db.with(|conn| task_repo::create(conn, &draft))
}
