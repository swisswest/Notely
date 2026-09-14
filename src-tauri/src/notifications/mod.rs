mod text;

use std::time::Duration;

use chrono::Local;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::models::{NotificationKind, Task};
use crate::db::{notification_history, settings as settings_repo, tasks as task_repo};
use crate::domain::review;
use crate::domain::scheduling::{self, PlannedNotification};
use crate::domain::settings::AppSettings;
use crate::error::AppResult;
use crate::logging;
use crate::state::AppState;
use crate::window;

const TICK_SECONDS: u64 = 30;
const PRUNE_EVERY_TICKS: u64 = 120;
const HISTORY_KEEP_DAYS: i64 = 30;
const TARGET: &str = "notifications";

pub use text::compose;

/// Prüft im festen Takt, welche Erinnerungen fällig sind. Der Takt ist
/// bewusst grob - der Prozess bleibt im Leerlauf praktisch untätig.
pub fn spawn_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticks: u64 = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(TICK_SECONDS)).await;
            ticks = ticks.wrapping_add(1);

            if let Err(err) = run_tick(&app) {
                logging::error(TARGET, format!("Scheduler-Durchlauf fehlgeschlagen: {err}"));
            }

            if ticks % PRUNE_EVERY_TICKS == 0 {
                let state = app.state::<AppState>();
                let result = state
                    .db
                    .with(|conn| notification_history::prune(conn, HISTORY_KEEP_DAYS));
                if let Err(err) = result {
                    logging::warn(TARGET, format!("Historie nicht aufgeräumt: {err}"));
                }
            }
        }
    });
}

fn run_tick(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let (settings, candidates) = state.db.with(|conn| {
        let settings = settings_repo::load(conn)?;
        let tasks = task_repo::list_schedulable(conn)?;
        Ok((settings, tasks))
    })?;

    if !settings.notifications.enabled {
        return Ok(());
    }

    let now = Local::now();
    let mut fired = false;

    for task in candidates {
        for planned in scheduling::plan(&task, &settings, now) {
            let slot = planned.slot();
            let claimed = state.db.with(|conn| {
                notification_history::claim(conn, &task.id, planned.kind, &slot)
            })?;
            if !claimed {
                continue;
            }

            deliver(app, &task, &planned, &settings);
            fired = true;

            if planned.kind == NotificationKind::Snooze {
                let _ = state
                    .db
                    .with(|conn| task_repo::set_snoozed_until(conn, &task.id, None));
            }
        }
    }

    if fired {
        window::notify_data_changed(app);
    }

    notify_review(app, &state, now)?;
    Ok(())
}

/// Einmal am Tag eine Erinnerung an den Tagesabschluss - nur wenn überhaupt
/// etwas offen ist.
fn notify_review(
    app: &AppHandle,
    state: &tauri::State<'_, AppState>,
    now: chrono::DateTime<Local>,
) -> AppResult<()> {
    let settings = state.db.with(settings_repo::load)?;
    let today = review::today(now);

    if !review::is_due(
        &settings.review,
        now,
        settings.review.last_notified_date.as_deref(),
    ) {
        return Ok(());
    }

    let open = state.db.with(|conn| task_repo::list_due_on(conn, &today))?;

    // Auch ohne offene Tasks wird der Tag markiert, sonst prüft der Scheduler
    // im Minutentakt erneut.
    state.db.with(|conn| {
        let mut current = settings_repo::load(conn)?;
        current.review.last_notified_date = Some(today.clone());
        settings_repo::save(conn, &current)
    })?;

    if open.is_empty() {
        return Ok(());
    }

    let body = format!(
        "{} Task(s) für heute noch offen.\nÖffne Notely für den Tagesabschluss.",
        open.len()
    );
    match app
        .notification()
        .builder()
        .title("Tagesabschluss")
        .body(&body)
        .show()
    {
        Ok(()) => logging::info(TARGET, "Tagesabschluss-Erinnerung gesendet"),
        Err(err) => logging::warn(TARGET, format!("Tagesabschluss nicht zustellbar: {err}")),
    }

    Ok(())
}

fn deliver(app: &AppHandle, task: &Task, planned: &PlannedNotification, settings: &AppSettings) {
    let (title, body) = compose(task, planned, settings, Local::now());

    match app
        .notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
    {
        Ok(()) => logging::info(
            TARGET,
            format!("Benachrichtigung gesendet: {} ({})", task.id, planned.kind.as_str()),
        ),
        Err(err) => {
            logging::error(TARGET, format!("Benachrichtigung fehlgeschlagen: {err}"));
            let _ = tauri::Emitter::emit(
                app,
                crate::state::events::NOTIFICATION_BLOCKED,
                err.to_string(),
            );
        }
    }
}

/// Beim Start einmalig die Berechtigung anfragen. Unter Windows 11 ist sie in
/// der Regel bereits erteilt; ein Fehler darf den Start nicht verhindern.
pub fn ensure_permission(app: &AppHandle) {
    match app.notification().request_permission() {
        Ok(state) => logging::info(TARGET, format!("Benachrichtigungs-Status: {state:?}")),
        Err(err) => logging::warn(TARGET, format!("Berechtigung nicht prüfbar: {err}")),
    }
}
