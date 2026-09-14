use tauri::{AppHandle, Manager, State};

use crate::db::settings as settings_repo;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::{logging, startup, window};

#[tauri::command]
pub fn set_autostart(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> AppResult<bool> {
    startup::set_enabled(&app, enabled)?;
    state.db.with(|conn| {
        let mut settings = settings_repo::load(conn)?;
        settings.windows.autostart = enabled;
        settings_repo::save(conn, &settings)
    })?;
    startup::is_enabled(&app)
}

#[tauri::command]
pub fn hide_window(app: AppHandle) -> AppResult<()> {
    if let Some(main) = window::main_window(&app) {
        main.hide()?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    logging::info("system", "Beenden über UI");
    app.exit(0);
}

/// Das Frontend meldet die Zeitzone des Systems, damit sie Claude bei jeder
/// Analyse mitgegeben werden kann.
#[tauri::command]
pub fn report_timezone(state: State<'_, AppState>, timezone: String) -> AppResult<()> {
    let trimmed = timezone.trim();
    let valid = !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-' | '+' | ':'));
    if !valid {
        return Err(AppError::validation("Ungültige Zeitzone"));
    }

    state.db.with(|conn| {
        let mut settings = settings_repo::load(conn)?;
        if settings.timezone == trimmed {
            return Ok(());
        }
        settings.timezone = trimmed.to_string();
        settings_repo::save(conn, &settings)
    })
}

#[tauri::command]
pub fn complete_onboarding(
    app: AppHandle,
    state: State<'_, AppState>,
    autostart: bool,
) -> AppResult<()> {
    startup::set_enabled(&app, autostart)?;
    state.db.with(|conn| {
        let mut settings = settings_repo::load(conn)?;
        settings.windows.autostart = autostart;
        settings.onboarding_completed = true;
        settings_repo::save(conn, &settings)
    })
}

#[tauri::command]
pub fn log_file_path(app: AppHandle) -> AppResult<String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|err| AppError::Internal(format!("Log-Verzeichnis unbekannt: {err}")))?;
    Ok(dir.join("notely.log").to_string_lossy().to_string())
}
