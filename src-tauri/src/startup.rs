use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, AppResult};
use crate::logging;

/// Kommandozeilen-Schalter, den der Autostart-Eintrag mitgibt.
pub const MINIMIZED_FLAG: &str = "--minimized";

pub fn started_minimized() -> bool {
    std::env::args().any(|arg| arg == MINIMIZED_FLAG)
}

pub fn is_enabled(app: &AppHandle) -> AppResult<bool> {
    app.autolaunch()
        .is_enabled()
        .map_err(|err| AppError::Internal(format!("Autostart-Status nicht lesbar: {err}")))
}

pub fn set_enabled(app: &AppHandle, enabled: bool) -> AppResult<()> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|err| AppError::Internal(format!("Autostart nicht änderbar: {err}")))?;
    logging::info("startup", format!("Autostart gesetzt: {enabled}"));
    Ok(())
}

/// Gleicht den Registry-Eintrag mit der gespeicherten Einstellung ab. Der
/// Benutzer kann den Eintrag ausserhalb der App entfernt haben.
pub fn sync(app: &AppHandle, desired: bool) {
    match is_enabled(app) {
        Ok(current) if current == desired => {}
        Ok(_) => {
            if let Err(err) = set_enabled(app, desired) {
                logging::warn(
                    "startup",
                    format!("Autostart-Abgleich fehlgeschlagen: {err}"),
                );
            }
        }
        Err(err) => logging::warn("startup", format!("Autostart-Status unbekannt: {err}")),
    }
}
