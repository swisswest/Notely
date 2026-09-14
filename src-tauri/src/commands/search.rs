use serde::Serialize;
use tauri::State;

use crate::db::models::{Note, Task};
use crate::db::{notes as note_repo, tasks as task_repo};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const DEFAULT_LIMIT: u32 = 20;
const MAX_TERM_CHARS: usize = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub notes: Vec<Note>,
    pub tasks: Vec<Task>,
}

/// Sucht gleichzeitig in Notizen und Tasks. Der Papierkorb bleibt aussen vor.
#[tauri::command]
pub fn search(
    state: State<'_, AppState>,
    term: String,
    limit: Option<u32>,
) -> AppResult<SearchResults> {
    if term.chars().count() > MAX_TERM_CHARS {
        return Err(AppError::validation("Suchbegriff ist zu lang"));
    }

    let limit = limit.unwrap_or(DEFAULT_LIMIT);
    state.db.with(|conn| {
        Ok(SearchResults {
            notes: note_repo::search(conn, &term, limit)?,
            tasks: task_repo::search(conn, &term, limit)?,
        })
    })
}
