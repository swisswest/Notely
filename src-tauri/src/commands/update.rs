use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};
use crate::logging;

/// Was der Updater über die nächste Version weiss.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    /// Nur gesetzt, wenn tatsächlich eine neuere Version vorliegt.
    pub version: Option<String>,
    /// Release-Notes aus `latest.json`, gekürzt.
    pub notes: Option<String>,
}

const MAX_NOTES_CHARS: usize = 2000;

/// Netzwerkfehler sind hier der Normalfall (kein Internet, GitHub gerade
/// nicht erreichbar) und dürfen nicht wie ein Anwendungsfehler aussehen.
///
/// Bewusst über den Meldungstext statt über die Fehlervarianten des Plugins:
/// die Variantenliste ändert sich zwischen Plugin-Versionen, der Umgang damit
/// hier nicht.
fn map_error(err: tauri_plugin_updater::Error) -> AppError {
    let text = err.to_string();
    let lower = text.to_ascii_lowercase();

    // Solange kein Release den Katalog mitliefert, antwortet GitHub mit 404.
    // Das ist kein Fehler der App, sondern ein Zustand des Repositories.
    let missing = ["release json", "404", "not found"]
        .iter()
        .any(|needle| lower.contains(needle));
    if missing {
        return AppError::UpdateUnavailable;
    }

    let network = ["request", "connect", "dns", "timeout", "network", "tls"]
        .iter()
        .any(|needle| lower.contains(needle));

    if network {
        AppError::Network(text)
    } else {
        AppError::Internal(text)
    }
}

fn shorten(value: String) -> String {
    if value.chars().count() <= MAX_NOTES_CHARS {
        return value;
    }
    value.chars().take(MAX_NOTES_CHARS).collect()
}

/// Fragt den Update-Endpunkt ab. Wird sowohl vom Button in den Einstellungen
/// als auch vom stillen Start-Check benutzt.
pub async fn check(app: &AppHandle) -> AppResult<UpdateInfo> {
    let current_version = app.package_info().version.to_string();

    let updater = app.updater().map_err(map_error)?;
    let found = updater.check().await.map_err(map_error)?;

    Ok(match found {
        Some(update) => UpdateInfo {
            available: true,
            current_version,
            version: Some(update.version.clone()),
            notes: update.body.clone().map(shorten),
        },
        None => UpdateInfo {
            available: false,
            current_version,
            version: None,
            notes: None,
        },
    })
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> AppResult<UpdateInfo> {
    let result = check(&app).await;
    match &result {
        Ok(info) if info.available => logging::info(
            "update",
            format!("Version {} verfuegbar", info.version.as_deref().unwrap_or("?")),
        ),
        Ok(_) => logging::info("update", "Keine neuere Version"),
        Err(err) => logging::warn("update", format!("Pruefung fehlgeschlagen: {err}")),
    }
    result
}

/// Lädt die neue Version, installiert sie und startet die App neu.
///
/// Es wird bewusst noch einmal geprüft, statt einen Handle aus dem letzten
/// Check aufzubewahren: so kann nie eine veraltete Information installiert
/// werden, und es gibt keinen Zustand, der zwischen zwei Aufrufen verjährt.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    let updater = app.updater().map_err(map_error)?;
    let Some(update) = updater.check().await.map_err(map_error)? else {
        return Err(AppError::validation("Es liegt keine neuere Version vor"));
    };

    let version = update.version.clone();
    logging::info("update", format!("Installiere Version {version}"));

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(map_error)?;

    logging::info("update", "Installation abgeschlossen, Neustart");
    app.restart();

    // Wird nicht mehr erreicht - `restart` kehrt nicht zurueck. Steht hier,
    // damit die Signatur unabhaengig davon stimmt.
    #[allow(unreachable_code)]
    Ok(())
}
