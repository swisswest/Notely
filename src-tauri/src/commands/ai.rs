use tauri::{AppHandle, State};

use crate::ai;
use crate::db::models::{
    AnalysisResult, FeedbackSummary, SuggestionDecision, Task, TaskDraft, TaskSuggestion,
    ANALYSIS_STATUS_EMPTY, ANALYSIS_STATUS_FAILED, ANALYSIS_STATUS_OK,
};
use crate::db::{
    feedback as feedback_repo, labels as label_repo, notes as note_repo, settings as settings_repo,
    tasks as task_repo, usage as usage_repo,
};
use crate::domain::validation;
use crate::error::{AppError, AppResult};
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
    analyze_one(&app, &state, note_id).await
}

/// Hoechstzahl Notizen pro Sammelanalyse. Jede Notiz ist ein API-Aufruf -
/// ohne Grenze waere ein Fehlgriff teuer.
pub const MAX_BATCH: usize = 25;

/// Analysiert mehrere Notizen nacheinander. Bewusst seriell: parallele
/// Aufrufe wuerden nur schneller ins Rate Limit laufen.
#[tauri::command]
pub async fn analyze_notes(
    app: AppHandle,
    state: State<'_, AppState>,
    note_ids: Vec<String>,
) -> AppResult<BatchAnalysis> {
    if note_ids.is_empty() {
        return Err(AppError::validation("Keine Notizen ausgewaehlt"));
    }
    if note_ids.len() > MAX_BATCH {
        return Err(AppError::validation(format!(
            "Maximal {MAX_BATCH} Notizen auf einmal"
        )));
    }

    let mut summary = BatchAnalysis::default();
    for note_id in note_ids {
        match analyze_one(&app, &state, note_id).await {
            Ok(result) => {
                summary.analyzed += 1;
                summary.created += result.created_task_ids.len();
                if result.needs_confirmation {
                    summary.pending.push(result);
                }
            }
            // Ein Fehlschlag darf den Rest nicht abbrechen.
            Err(err) => {
                summary.failed += 1;
                logging::warn("ai", format!("Sammelanalyse: {err}"));
            }
        }
    }
    Ok(summary)
}

/// Ergebnis einer Sammelanalyse. `pending` sammelt die Vorschlaege, die noch
/// bestaetigt werden muessen - die Oberflaeche arbeitet sie nacheinander ab.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysis {
    pub analyzed: usize,
    pub failed: usize,
    pub created: usize,
    pub pending: Vec<AnalysisResult>,
}

async fn analyze_one(
    app: &AppHandle,
    state: &State<'_, AppState>,
    note_id: String,
) -> AppResult<AnalysisResult> {
    let note_id = validation::identifier(&note_id, "Notiz-ID")?;

    let (note, settings) = state.db.with(|conn| {
        let note = note_repo::get(conn, &note_id)?;
        let settings = settings_repo::load(conn)?;
        Ok((note, settings))
    })?;

    let api_key = SecretStore::require_api_key()?;

    let (outcome, usage) =
        match ai::analyze_note(&state.claude, &api_key, &settings, &note.content).await {
            Ok(result) => result,
            Err(err) => {
                let _ = state.db.with(|conn| {
                    note_repo::set_analysis_status(conn, &note_id, ANALYSIS_STATUS_FAILED)
                });
                logging::warn("ai", format!("Analyse fehlgeschlagen: {err}"));
                return Err(err);
            }
        };

    let _ = state
        .db
        .with(|conn| usage_repo::record(conn, &settings.claude.model, usage, Some(&note_id)));

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
            match persist(state, &note_id, &suggestion) {
                Ok(task) => created_task_ids.push(task.id),
                Err(err) => {
                    logging::warn("ai", format!("Task nicht anlegbar: {err}"));
                    pending.push(suggestion);
                }
            }
        }
    }

    if !created_task_ids.is_empty() {
        window::notify_data_changed(app);
    }

    Ok(AnalysisResult {
        note_id,
        needs_confirmation: !pending.is_empty(),
        suggestions: pending,
        rejected: outcome.rejected,
        created_task_ids,
    })
}

/// Übernimmt die Entscheidungen aus dem Vorschlagsdialog: legt die
/// bestätigten Vorschläge an und hält fest, was Claude danebengelegen hat.
///
/// Das Urteil (übernommen / bearbeitet / verworfen) leitet das Backend aus dem
/// Vergleich ab. Das Frontend kann es nicht behaupten.
#[tauri::command]
pub fn create_tasks_from_suggestions(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
    decisions: Vec<SuggestionDecision>,
) -> AppResult<Vec<Task>> {
    let note_id = validation::identifier(&note_id, "Notiz-ID")?;
    let mut created = Vec::new();

    for decision in &decisions {
        if let Some(accepted) = &decision.accepted {
            created.push(persist(&state, &note_id, accepted)?);
        }
    }

    // Die Rückmeldung darf das Anlegen nie gefährden - sie ist Statistik,
    // keine Nutzdaten.
    if let Err(err) = record_feedback(&state, &note_id, &decisions) {
        logging::warn("ai", format!("Rückmeldung nicht gespeichert: {err}"));
    }

    if !created.is_empty() {
        window::notify_data_changed(&app);
    }

    Ok(created)
}

fn record_feedback(
    state: &State<'_, AppState>,
    note_id: &str,
    decisions: &[SuggestionDecision],
) -> AppResult<()> {
    state.db.with(|conn| {
        let settings = settings_repo::load(conn)?;
        if !settings.ai.collect_feedback {
            return Ok(());
        }

        let excerpt = note_repo::get(conn, note_id)
            .map(|note| feedback_repo::excerpt(&note.content))
            .unwrap_or_default();

        for decision in decisions {
            feedback_repo::record(
                conn,
                Some(note_id),
                &settings.claude.model,
                &excerpt,
                decision.verdict(),
                &decision.original,
                decision.accepted.as_ref(),
            )?;
        }
        feedback_repo::prune(conn)?;
        Ok(())
    })
}

/// Auswertung der bisherigen Rückmeldungen. Verlässt das Gerät nicht.
#[tauri::command]
pub fn ai_feedback_summary(state: State<'_, AppState>) -> AppResult<FeedbackSummary> {
    state
        .db
        .with(|conn| feedback_repo::summary(conn, feedback_repo::MAX_MISSES))
}

#[tauri::command]
pub fn clear_ai_feedback(state: State<'_, AppState>) -> AppResult<usize> {
    state.db.with(feedback_repo::clear)
}

/// Legt eine Aufgabe aus einem Vorschlag an und uebernimmt dabei Ordner und
/// Labels der Notiz.
///
/// Uebernommen wird einmalig beim Anlegen, nicht dauerhaft verknuepft. Zieht
/// die Notiz spaeter in einen anderen Ordner, bleiben ihre Aufgaben, wo sie
/// sind - eine Aufgabe, die ihre Einordnung im Ruecken des Benutzers aendert,
/// waere schwerer zu erklaeren als eine, die stehen bleibt.
fn persist(
    state: &State<'_, AppState>,
    note_id: &str,
    suggestion: &TaskSuggestion,
) -> AppResult<Task> {
    let source = state.db.with(|conn| note_repo::get(conn, note_id))?;

    let draft = validation::task_draft(TaskDraft {
        title: suggestion.title.clone(),
        description: suggestion.description.clone(),
        due_date: suggestion.due_date.clone(),
        due_time: suggestion.due_time.clone(),
        source_note_id: Some(note_id.to_string()),
        folder_id: source.folder_id.clone(),
        ai_generated: true,
        confidence: Some(suggestion.confidence),
        recurrence: None,
        priority: Default::default(),
    })?;

    state.db.with(|conn| {
        let task = task_repo::create(conn, &draft)?;
        if source.labels.is_empty() {
            return Ok(task);
        }
        label_repo::set_for_task(conn, &task.id, &source.labels)?;
        task_repo::get(conn, &task.id)
    })
}
