pub mod client;
pub mod prompt;
pub mod schema;
pub mod validation;

use chrono::Local;

use crate::db::usage::TokenUsage;
use crate::domain::settings::AppSettings;
use crate::error::{AppError, AppResult};
use crate::logging;

pub use client::{ClaudeClient, ModelInfo};
pub use validation::ValidationOutcome;

pub const MAX_NOTE_CHARS: usize = 20_000;

/// Vollständiger Ablauf: Notiz -> Claude -> Validierung. Die Notiz selbst wird
/// hier nie verändert oder gespeichert.
pub async fn analyze_note(
    client: &ClaudeClient,
    api_key: &str,
    settings: &AppSettings,
    note: &str,
) -> AppResult<(ValidationOutcome, TokenUsage)> {
    let trimmed = note.trim();
    if trimmed.is_empty() {
        return Ok((ValidationOutcome::default(), TokenUsage::default()));
    }
    if trimmed.chars().count() > MAX_NOTE_CHARS {
        return Err(AppError::validation(format!(
            "Notiz ist zu lang für die Analyse (max. {MAX_NOTE_CHARS} Zeichen)"
        )));
    }

    let now = Local::now();
    let tool = schema::build_tool_schema(settings);
    let user_message = prompt::build_user_message(trimmed, settings, now);

    let (raw_value, usage) = client
        .extract_tasks(
            api_key,
            &settings.claude.model,
            settings.claude.max_output_tokens,
            prompt::SYSTEM_PROMPT,
            &user_message,
            tool,
        )
        .await?;

    let raw: schema::RawTaskList = serde_json::from_value(raw_value)
        .map_err(|err| AppError::InvalidAiResponse(format!("Struktur unerwartet: {err}")))?;

    let outcome = validation::validate_and_resolve(raw, settings, now);
    logging::info(
        "ai",
        format!(
            "Analyse abgeschlossen: {} Vorschläge, {} verworfen, {} Tokens",
            outcome.suggestions.len(),
            outcome.rejected.len(),
            usage.total()
        ),
    );

    Ok((outcome, usage))
}
