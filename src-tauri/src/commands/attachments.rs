use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::attachments::{self as repo, Attachment};
use crate::domain::validation;
use crate::error::AppResult;
use crate::state::AppState;
use crate::{logging, window};

/// Belegter Platz durch Bilder - fuer die Anzeige in den Einstellungen.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentUsage {
    pub count: i64,
    pub bytes: i64,
    pub max_bytes_per_image: usize,
}

/// Nimmt ein Bild entgegen und legt es ab.
///
/// Die Daten kommen als Base64 herein. Das ist nicht huebsch, aber die
/// Alternative waere ein JSON-Array mit zehn Millionen Zahlen - und das ist
/// deutlich schlimmer als dreissig Prozent Aufschlag auf eine Zeichenkette.
///
/// `note_id` darf fehlen: beim Einfuegen in eine noch ungespeicherte Notiz
/// gibt es sie noch nicht. Die Zuordnung wird beim ersten Speichern nachgeholt.
#[tauri::command]
pub fn add_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: Option<String>,
    name: String,
    mime: String,
    data: String,
) -> AppResult<Attachment> {
    let note_id = match note_id {
        Some(id) => Some(validation::identifier(&id, "Notiz-ID")?),
        None => None,
    };

    let bytes = repo::decode(&data)?;
    let saved = state
        .db
        .with(|conn| repo::create(conn, note_id.as_deref(), &name, &mime, &bytes))?;

    // Groesse ja, Inhalt nein - ein Log ist kein Bildarchiv.
    logging::info(
        "attachments",
        format!("Bild abgelegt: {} Bytes, {}", saved.size, saved.mime),
    );
    window::notify_data_changed(&app);
    Ok(saved)
}

/// Liefert ein Bild als Base64 zurueck, damit die Oberflaeche es anzeigen kann.
#[tauri::command]
pub fn get_attachment(state: State<'_, AppState>, id: String) -> AppResult<AttachmentPayload> {
    let id = validation::identifier(&id, "Bild-ID")?;
    let (mime, bytes) = state.db.with(|conn| repo::bytes(conn, &id))?;
    Ok(AttachmentPayload {
        mime,
        data: {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        },
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentPayload {
    pub mime: String,
    pub data: String,
}

/// Traegt die Notiz nach, sobald sie das erste Mal gespeichert wurde.
#[tauri::command]
pub fn assign_attachments(
    state: State<'_, AppState>,
    note_id: String,
    ids: Vec<String>,
) -> AppResult<usize> {
    let note_id = validation::identifier(&note_id, "Notiz-ID")?;
    let mut done = 0;

    state.db.with(|conn| {
        for id in &ids {
            let id = validation::identifier(id, "Bild-ID")?;
            repo::assign(conn, &id, &note_id)?;
            done += 1;
        }
        Ok(())
    })?;

    Ok(done)
}

#[tauri::command]
pub fn delete_attachment(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = validation::identifier(&id, "Bild-ID")?;
    state.db.with(|conn| repo::delete(conn, &id))?;
    window::notify_data_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn attachment_usage(state: State<'_, AppState>) -> AppResult<AttachmentUsage> {
    let (count, bytes) = state.db.with(repo::usage)?;
    Ok(AttachmentUsage {
        count,
        bytes,
        max_bytes_per_image: repo::MAX_BYTES,
    })
}
