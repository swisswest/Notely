use tauri::State;

use crate::ai::ask::{self, NoteAnswer};
use crate::db::{notes as note_repo, settings as settings_repo, usage as usage_repo};
use crate::error::{AppError, AppResult};
use crate::security::secrets::SecretStore;
use crate::state::AppState;

/// Frage an die eigenen Notizen.
///
/// Zwei Schritte, bewusst getrennt: erst sucht die Datenbank die Notizen, die
/// ueberhaupt in Frage kommen, dann liest Claude nur diese. Das hat einen
/// handfesten Grund - so gehen nie alle Notizen an einen fremden Dienst,
/// sondern hoechstens eine Handvoll, und was nicht zur Frage passt, verlaesst
/// den Rechner gar nicht erst.
///
/// Findet die Suche nichts, gibt es keinen API-Aufruf. Die Auskunft ist
/// dieselbe und kostet nichts.
#[tauri::command]
pub async fn ask_notes(state: State<'_, AppState>, question: String) -> AppResult<NoteAnswer> {
    let trimmed = question.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Die Frage ist leer"));
    }
    if trimmed.chars().count() > ask::MAX_QUESTION_CHARS {
        return Err(AppError::validation(format!(
            "Die Frage ist zu lang (max. {} Zeichen)",
            ask::MAX_QUESTION_CHARS
        )));
    }

    let (candidates, settings) = state.db.with(|conn| {
        let candidates = note_repo::search(conn, trimmed, ask::MAX_SOURCES as u32)?;
        let settings = settings_repo::load(conn)?;
        Ok((candidates, settings))
    })?;

    if candidates.is_empty() {
        return Ok(NoteAnswer::default());
    }

    // Der Schluessel wird erst geholt, wenn wirklich gefragt wird.
    let api_key = SecretStore::require_api_key()?;

    let (answer, usage) = ask::ask(
        &state.claude,
        &api_key,
        &settings.claude.model,
        settings.claude.max_output_tokens,
        trimmed,
        &candidates,
    )
    .await?;

    // Der Verbrauch ist Statistik und darf die Antwort nie gefaehrden.
    let _ = state
        .db
        .with(|conn| usage_repo::record(conn, &settings.claude.model, usage, None));

    Ok(answer)
}
