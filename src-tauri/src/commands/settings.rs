use serde::Serialize;
use tauri::{AppHandle, State};

use crate::ai::ModelInfo;
use crate::db::settings as repo;
use crate::db::usage::{self as usage_repo, UsageSummary};
use crate::domain::settings::AppSettings;
use crate::error::{AppError, AppResult};
use crate::security::secrets::SecretStore;
use crate::state::AppState;
use crate::{logging, startup, window};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub settings: AppSettings,
    pub api_key_set: bool,
    pub api_key_hint: Option<String>,
    pub autostart_enabled: bool,
    pub app_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    pub ok: bool,
    pub model_available: bool,
    pub message: String,
}

#[tauri::command]
pub fn get_status(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppStatus> {
    let settings = state.db.with(repo::load)?;
    Ok(AppStatus {
        settings,
        api_key_set: SecretStore::has_api_key(),
        api_key_hint: SecretStore::masked_hint().unwrap_or(None),
        autostart_enabled: startup::is_enabled(&app).unwrap_or(false),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    let settings = settings.normalized();
    settings.validate()?;

    state.db.with(|conn| repo::save(conn, &settings))?;
    startup::sync(&app, settings.windows.autostart);
    logging::info("settings", "Einstellungen gespeichert");
    window::notify_data_changed(&app);

    Ok(settings)
}

/// Der Key geht direkt in den Windows Credential Manager. Er wird weder in der
/// Datenbank noch im Log abgelegt und nie an das Frontend zurückgegeben.
#[tauri::command]
pub fn set_api_key(app: AppHandle, key: String) -> AppResult<Option<String>> {
    SecretStore::set_api_key(&key)?;
    logging::info("settings", "API-Key aktualisiert");
    window::notify_data_changed(&app);
    SecretStore::masked_hint()
}

#[tauri::command]
pub fn clear_api_key(app: AppHandle) -> AppResult<()> {
    SecretStore::clear_api_key()?;
    logging::info("settings", "API-Key entfernt");
    window::notify_data_changed(&app);
    Ok(())
}

/// Prüft den Key und ob das übergebene Modell für diesen Account verfügbar ist.
/// Ohne `model` gilt das gespeicherte Modell - die Oberfläche schickt aber
/// bewusst die aktuelle Auswahl, damit auch ungespeicherte Änderungen testbar sind.
#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    model: Option<String>,
) -> AppResult<ConnectionTest> {
    let model = match model.map(|value| value.trim().to_string()) {
        Some(value) if !value.is_empty() => {
            if value.len() > 100
                || !value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
            {
                return Err(AppError::validation("Modellname enthält ungültige Zeichen"));
            }
            value
        }
        _ => state.db.with(|conn| Ok(repo::load(conn)?.claude.model))?,
    };
    let api_key = SecretStore::require_api_key()?;

    match state.claude.list_models(&api_key).await {
        Ok(models) => {
            let model_available = models.iter().any(|item| item.id == model)
                || models.iter().any(|item| item.id.starts_with(&model));
            let message = if model_available {
                format!("Verbindung erfolgreich. Modell '{model}' ist verfügbar.")
            } else {
                format!(
                    "Verbindung erfolgreich, aber '{model}' steht diesem Key nicht zur Verfügung."
                )
            };
            Ok(ConnectionTest {
                ok: true,
                model_available,
                message,
            })
        }
        Err(AppError::Unauthorized) => Ok(ConnectionTest {
            ok: false,
            model_available: false,
            message: "Der API-Key wurde abgelehnt.".to_string(),
        }),
        Err(err) => Err(err),
    }
}

/// Token-Verbrauch der bisherigen Analysen. Kosten hängen vom Modell ab und
/// werden bewusst nicht in Franken geschätzt.
#[tauri::command]
pub fn usage_summary(state: State<'_, AppState>) -> AppResult<UsageSummary> {
    state.db.with(usage_repo::summary)
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> AppResult<Vec<ModelInfo>> {
    let api_key = SecretStore::require_api_key()?;
    state.claude.list_models(&api_key).await
}
