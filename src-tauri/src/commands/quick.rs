use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::ai;
use crate::db::models::{
    AnalysisResult, TaskDraft, ANALYSIS_STATUS_EMPTY, ANALYSIS_STATUS_FAILED, ANALYSIS_STATUS_OK,
};
use crate::db::{
    notes as note_repo, settings as settings_repo, tasks as task_repo, usage as usage_repo,
};
use crate::domain::validation;
use crate::error::AppResult;
use crate::quick;
use crate::security::secrets::SecretStore;
use crate::state::{events, AppState};
use crate::{logging, window};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickResult {
    pub note_id: String,
    pub created_tasks: usize,
    pub analyzed: bool,
    pub needs_confirmation: bool,
    pub message: String,
}

/// Nimmt Text aus dem Schnellerfassungsfenster entgegen. Die Notiz wird immer
/// zuerst gespeichert - schlägt die Analyse fehl, ist der Text trotzdem sicher.
#[tauri::command]
pub async fn quick_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    content: String,
) -> AppResult<QuickResult> {
    let content = validation::note_content(&content)?;
    let (note, settings) = state.db.with(|conn| {
        let note = note_repo::create(conn, &content, None)?;
        let settings = settings_repo::load(conn)?;
        Ok((note, settings))
    })?;

    window::notify_data_changed(&app);

    let wants_analysis = settings.quick_capture.analyze && SecretStore::has_api_key();
    if !wants_analysis {
        return Ok(QuickResult {
            note_id: note.id,
            created_tasks: 0,
            analyzed: false,
            needs_confirmation: false,
            message: "Notiz gespeichert".to_string(),
        });
    }

    let api_key = SecretStore::require_api_key()?;
    let (outcome, usage) =
        match ai::analyze_note(&state.claude, &api_key, &settings, &note.content).await {
            Ok(result) => result,
            Err(err) => {
                let _ = state.db.with(|conn| {
                    note_repo::set_analysis_status(conn, &note.id, ANALYSIS_STATUS_FAILED)
                });
                logging::warn("quick", format!("Analyse fehlgeschlagen: {err}"));
                return Ok(QuickResult {
                    note_id: note.id,
                    created_tasks: 0,
                    analyzed: false,
                    needs_confirmation: false,
                    message: "Notiz gespeichert, Analyse nicht möglich".to_string(),
                });
            }
        };

    let _ = state
        .db
        .with(|conn| usage_repo::record(conn, &settings.claude.model, usage, Some(&note.id)));

    let status = if outcome.suggestions.is_empty() {
        ANALYSIS_STATUS_EMPTY
    } else {
        ANALYSIS_STATUS_OK
    };
    let _ = state
        .db
        .with(|conn| note_repo::set_analysis_status(conn, &note.id, status));

    let mut created = Vec::new();
    let mut pending = Vec::new();

    for suggestion in outcome.suggestions {
        let confirm = settings.ai.confirm_before_create
            || suggestion.confidence < settings.ai.auto_create_min_confidence;
        if confirm {
            pending.push(suggestion);
            continue;
        }

        let draft = validation::task_draft(TaskDraft {
            title: suggestion.title.clone(),
            description: suggestion.description.clone(),
            due_date: suggestion.due_date.clone(),
            due_time: suggestion.due_time.clone(),
            source_note_id: Some(note.id.clone()),
            ai_generated: true,
            confidence: Some(suggestion.confidence),
            recurrence: None,
        })?;

        match state.db.with(|conn| task_repo::create(conn, &draft)) {
            Ok(task) => created.push(task.id),
            Err(err) => {
                logging::warn("quick", format!("Task nicht anlegbar: {err}"));
                pending.push(suggestion);
            }
        }
    }

    let needs_confirmation = !pending.is_empty();
    let message = if needs_confirmation {
        format!("{} Vorschlag(e) warten auf Bestätigung", pending.len())
    } else if created.is_empty() {
        "Notiz gespeichert, keine Aufgabe erkannt".to_string()
    } else {
        format!("{} Task(s) erstellt", created.len())
    };

    if needs_confirmation {
        // Bestätigen geht nur im Hauptfenster - also dorthin weiterreichen.
        let result = AnalysisResult {
            note_id: note.id.clone(),
            suggestions: pending,
            rejected: outcome.rejected,
            created_task_ids: created.clone(),
            needs_confirmation: true,
        };
        quick::hide(&app);
        window::show_and_focus(&app);
        if let Err(err) = app.emit(events::SUGGESTIONS, result) {
            logging::warn("quick", format!("Vorschläge nicht zustellbar: {err}"));
        }
    }

    window::notify_data_changed(&app);

    Ok(QuickResult {
        note_id: note.id,
        created_tasks: created.len(),
        analyzed: true,
        needs_confirmation,
        message,
    })
}

#[tauri::command]
pub fn hide_quick_window(app: AppHandle) {
    quick::hide(&app);
}

#[tauri::command]
pub fn open_quick_window(app: AppHandle) {
    quick::show(&app);
}

/// Ändert Kürzel und Zustand und speichert beides erst, wenn die
/// Registrierung beim Betriebssystem geklappt hat.
#[tauri::command]
pub fn set_quick_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
    enabled: bool,
) -> AppResult<String> {
    let mut settings = state.db.with(settings_repo::load)?;
    settings.quick_capture.shortcut = shortcut.trim().to_string();
    settings.quick_capture.enabled = enabled;

    quick::apply_shortcut(&app, &settings.quick_capture)?;

    state.db.with(|conn| settings_repo::save(conn, &settings))?;
    window::notify_data_changed(&app);
    Ok(settings.quick_capture.shortcut)
}
