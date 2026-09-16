pub mod ai;
pub mod backup;
pub mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod logging;
pub mod notifications;
pub mod paths;
pub mod quick;
pub mod security;
pub mod startup;
pub mod state;
pub mod tray;
pub mod window;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::ai::ClaudeClient;
use crate::db::{settings as settings_repo, Db};
use crate::state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::show_and_focus(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![startup::MINIMIZED_FLAG]),
        ))
        .setup(|app| {
            let handle = app.handle().clone();

            if let Ok(log_dir) = paths::log_dir(&handle) {
                logging::init(&log_dir);
            }
            logging::info("app", "Notely startet");

            let data_dir = paths::data_dir(&handle)?;
            let db = Db::open(&data_dir.join(paths::DATABASE_FILE))?;
            let settings = db.with(settings_repo::load)?;

            // Abgelaufene Papierkorb-Einträge verschwinden beim Start.
            match db.with(|conn| {
                let notes = crate::db::notes::purge_expired(conn, commands::trash::RETENTION_DAYS)?;
                let tasks = crate::db::tasks::purge_expired(conn, commands::trash::RETENTION_DAYS)?;
                Ok(notes + tasks)
            }) {
                Ok(count) if count > 0 => logging::info(
                    "app",
                    format!("{count} Eintraege aus dem Papierkorb entfernt"),
                ),
                Err(err) => logging::warn("app", format!("Papierkorb nicht aufgeraeumt: {err}")),
                _ => {}
            }

            let claude = ClaudeClient::new()?;
            app.manage(AppState::new(db, claude));

            if let Err(err) = tray::setup(&handle) {
                logging::error("app", format!("Tray nicht initialisierbar: {err}"));
            }

            notifications::ensure_permission(&handle);
            notifications::spawn_scheduler(handle.clone());
            startup::sync(&handle, settings.windows.autostart);

            if let Err(err) = quick::apply_shortcut(&handle, &settings.quick_capture) {
                logging::warn("app", format!("Schnellerfassung nicht aktiv: {err}"));
            }

            if settings.updates.check_on_start {
                let update_handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    announce_update(&update_handle).await;
                });
            }

            if backup::due(&settings, chrono::Local::now()) {
                let backup_handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = run_startup_backup(&backup_handle) {
                        logging::warn(
                            "app",
                            format!("Automatische Sicherung fehlgeschlagen: {err}"),
                        );
                    }
                });
            }

            let stay_hidden = startup::started_minimized() && settings.windows.start_minimized;
            if stay_hidden {
                logging::info("app", "Start im Hintergrund (Autostart)");
            } else {
                window::show_and_focus(&handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Die Schnellerfassung wird nie geschlossen, nur versteckt.
                if window.label() == quick::QUICK_WINDOW {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                if window.label() != window::MAIN_WINDOW {
                    return;
                }
                let app = window.app_handle();
                let close_to_tray = app
                    .try_state::<AppState>()
                    .and_then(|state| {
                        state
                            .db
                            .with(|conn| Ok(settings_repo::load(conn)?.windows.close_to_tray))
                            .ok()
                    })
                    .unwrap_or(true);

                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    logging::info("app", "Fenster in den Tray minimiert");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::notes::get_note,
            commands::notes::list_notes,
            commands::notes::set_note_folder,
            commands::notes::set_note_labels,
            commands::notes::tasks_for_note,
            commands::organization::list_folders,
            commands::organization::create_folder,
            commands::organization::rename_folder,
            commands::organization::delete_folder,
            commands::organization::list_labels,
            commands::organization::label_colors,
            commands::organization::create_label,
            commands::organization::update_label,
            commands::organization::delete_label,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::delete_task,
            commands::tasks::set_task_completed,
            commands::tasks::snooze_task,
            commands::tasks::clear_snooze,
            commands::tasks::list_tasks,
            commands::tasks::get_task,
            commands::settings::get_status,
            commands::settings::save_settings,
            commands::settings::set_api_key,
            commands::settings::clear_api_key,
            commands::settings::test_connection,
            commands::settings::list_models,
            commands::ai::analyze_note,
            commands::ai::create_tasks_from_suggestions,
            commands::system::set_autostart,
            commands::system::hide_window,
            commands::system::quit_app,
            commands::system::report_timezone,
            commands::system::complete_onboarding,
            commands::system::log_file_path,
            commands::backup::backup_now,
            commands::backup::backup_directory,
            commands::backup::list_backups,
            commands::backup::import_backup,
            commands::backup::export_markdown,
            commands::quick::quick_capture,
            commands::quick::hide_quick_window,
            commands::quick::open_quick_window,
            commands::quick::set_quick_shortcut,
            commands::tasks::bulk_set_completed,
            commands::tasks::bulk_reschedule,
            commands::tasks::bulk_delete,
            commands::trash::list_trash,
            commands::trash::restore_note,
            commands::trash::restore_task,
            commands::trash::purge_note,
            commands::trash::purge_task,
            commands::trash::empty_trash,
            commands::search::search,
            commands::settings::usage_summary,
            commands::review::review_status,
            commands::review::complete_review,
            commands::backup::import_markdown,
            commands::ai::ai_feedback_summary,
            commands::ai::clear_ai_feedback,
            commands::update::check_for_update,
            commands::update::install_update,
            commands::update::skip_update_version,
            commands::notes::note_versions,
            commands::notes::restore_note_version,
            commands::notes::notes_needing_attention,
            commands::tasks::set_task_labels,
            commands::ai::analyze_notes,
            commands::tasks::recurrence_preview,
            commands::system::pick_directory,
            commands::backup::verify_backup,
        ])
        .run(tauri::generate_context!())
        .expect("Notely konnte nicht gestartet werden");
}

/// Sieht beim Start still nach einer neueren Version. Gemeldet wird jede
/// Version nur einmal - ein Hinweis, der bei jedem Start wiederkommt, wird
/// nach zwei Tagen ignoriert und ist damit wertlos.
///
/// Scheitert der Check (kein Internet, GitHub nicht erreichbar), passiert
/// nichts. Der Benutzer hat nicht danach gefragt.
async fn announce_update(app: &tauri::AppHandle) {
    let info = match commands::update::check(app).await {
        Ok(info) => info,
        Err(err) => {
            logging::info("update", format!("Start-Pruefung uebersprungen: {err}"));
            return;
        }
    };

    let Some(version) = info.version.clone().filter(|_| info.available) else {
        return;
    };

    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let already_seen = state.db.with(|conn| {
        let mut settings = settings_repo::load(conn)?;
        let known = settings.updates.last_seen_version.as_deref() == Some(version.as_str());
        let skipped = settings.updates.skipped_version.as_deref() == Some(version.as_str());
        if known || skipped {
            return Ok(true);
        }
        settings.updates.last_seen_version = Some(version.clone());
        settings_repo::save(conn, &settings)?;
        Ok(false)
    });

    match already_seen {
        Ok(true) => return,
        Ok(false) => {}
        Err(err) => logging::warn("update", format!("Version nicht vermerkt: {err}")),
    }

    window::emit(app, crate::state::events::UPDATE_AVAILABLE, info);
}

/// Schreibt beim Start eine Sicherung, räumt alte auf und merkt sich den
/// Zeitpunkt. Fehler hier dürfen den Start nie beeinträchtigen.
fn run_startup_backup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<AppState>();
    let settings = state.db.with(settings_repo::load)?;
    let dir = backup::resolve_dir(app.path().document_dir().ok(), &settings)?;
    let version = app.package_info().version.to_string();

    backup::write(&state.db, &version, &dir)?;
    backup::prune(&dir, settings.backup.keep)?;

    state.db.with(|conn| {
        let mut current = settings_repo::load(conn)?;
        current.backup.last_backup_at = Some(crate::domain::time::to_rfc3339(chrono::Local::now()));
        settings_repo::save(conn, &current)
    })?;

    Ok(())
}
