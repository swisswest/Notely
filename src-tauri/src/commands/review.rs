use chrono::Local;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::models::Task;
use crate::db::{settings as settings_repo, tasks as task_repo};
use crate::domain::review;
use crate::error::AppResult;
use crate::state::AppState;
use crate::window;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStatus {
    pub due: bool,
    pub date: String,
    pub time: String,
    /// Offene Tasks von heute und alles, was davor liegen geblieben ist.
    pub tasks: Vec<Task>,
    pub completed_today: bool,
}

/// Sammelt alles, was für den Tagesabschluss offen ist.
#[tauri::command]
pub fn review_status(state: State<'_, AppState>) -> AppResult<ReviewStatus> {
    let now = Local::now();
    let today = review::today(now);

    state.db.with(|conn| {
        let settings = settings_repo::load(conn)?;
        let completed_today =
            settings.review.last_completed_date.as_deref() == Some(today.as_str());
        let due = review::is_due(
            &settings.review,
            now,
            settings.review.last_completed_date.as_deref(),
        );

        // Heute fällig plus alles Ältere, das noch offen ist.
        let mut tasks = task_repo::list_due_on(conn, &today)?;
        for task in task_repo::list_schedulable(conn)? {
            let older = task
                .due_date
                .as_deref()
                .map(|date| date < today.as_str())
                .unwrap_or(false);
            if older {
                tasks.push(task);
            }
        }
        tasks.sort_by(|a, b| {
            a.due_date
                .cmp(&b.due_date)
                .then(a.due_time.cmp(&b.due_time))
        });

        Ok(ReviewStatus {
            due,
            date: today.clone(),
            time: settings.review.time.clone(),
            tasks,
            completed_today,
        })
    })
}

/// Merkt sich, dass der Abschluss für heute erledigt ist.
#[tauri::command]
pub fn complete_review(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let today = review::today(Local::now());
    state.db.with(|conn| {
        let mut settings = settings_repo::load(conn)?;
        settings.review.last_completed_date = Some(today.clone());
        settings.review.last_notified_date = Some(today.clone());
        settings_repo::save(conn, &settings)
    })?;
    window::notify_data_changed(&app);
    Ok(())
}
