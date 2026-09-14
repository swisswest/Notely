use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::domain::settings::{is_valid_shortcut, QuickCaptureSettings};
use crate::error::{AppError, AppResult};
use crate::logging;
use crate::state::events;

pub const QUICK_WINDOW: &str = "quick";
const TARGET: &str = "quick";

pub fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(QUICK_WINDOW) else {
        logging::warn(TARGET, "Schnellerfassung-Fenster nicht gefunden");
        return;
    };

    let _ = window.center();
    let _ = window.show();
    let _ = window.set_focus();
    if let Err(err) = app.emit(events::QUICK_OPENED, ()) {
        logging::warn(TARGET, format!("Öffnen nicht zustellbar: {err}"));
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(QUICK_WINDOW) {
        let _ = window.hide();
    }
}

/// Registriert das systemweite Kürzel neu. Ein belegtes Kürzel meldet das
/// Betriebssystem hier zurück - dann bleibt die Schnellerfassung einfach aus.
pub fn apply_shortcut(app: &AppHandle, settings: &QuickCaptureSettings) -> AppResult<()> {
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    if !settings.enabled {
        logging::info(TARGET, "Schnellerfassung deaktiviert");
        return Ok(());
    }

    if !is_valid_shortcut(&settings.shortcut) {
        return Err(AppError::validation(
            "Kürzel muss die Form \"Ctrl+Alt+N\" haben",
        ));
    }

    manager
        .on_shortcut(settings.shortcut.as_str(), |app, _shortcut, _event| {
            show(app);
        })
        .map_err(|err| {
            AppError::validation(format!(
                "Kürzel konnte nicht registriert werden (evtl. von einem anderen Programm belegt): {err}"
            ))
        })?;

    logging::info(TARGET, format!("Kürzel aktiv: {}", settings.shortcut));
    Ok(())
}
