use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::schema::TOOL_NAME;
use crate::error::{AppError, AppResult};
use crate::logging;

const API_BASE: &str = "https://api.anthropic.com/v1";
const API_VERSION: &str = "2023-06-01";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const TARGET: &str = "claude";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
}

pub struct ClaudeClient {
    http: reqwest::Client,
}

impl ClaudeClient {
    pub fn new() -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent(concat!("Notely/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|err| AppError::Internal(format!("HTTP-Client nicht initialisierbar: {err}")))?;
        Ok(Self { http })
    }

    /// Führt einen Tool-Call aus und liefert ausschliesslich das Tool-Input
    /// zurück. Freitext des Modells wird bewusst ignoriert.
    pub async fn extract_tasks(
        &self,
        api_key: &str,
        model: &str,
        max_tokens: u32,
        system: &str,
        user_message: &str,
        tool: Value,
    ) -> AppResult<Value> {
        let body = json!({
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0,
            "system": system,
            "tools": [tool],
            "tool_choice": { "type": "tool", "name": TOOL_NAME },
            "messages": [{ "role": "user", "content": user_message }]
        });

        let response = self
            .http
            .post(format!("{API_BASE}/messages"))
            .header("x-api-key", api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(map_transport_error)?;

        let payload = read_json(response).await?;
        extract_tool_input(&payload)
    }

    pub async fn list_models(&self, api_key: &str) -> AppResult<Vec<ModelInfo>> {
        let response = self
            .http
            .get(format!("{API_BASE}/models?limit=100"))
            .header("x-api-key", api_key)
            .header("anthropic-version", API_VERSION)
            .send()
            .await
            .map_err(map_transport_error)?;

        let payload = read_json(response).await?;
        let items = payload
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::InvalidAiResponse("Modellliste ohne data-Feld".into()))?;

        Ok(items
            .iter()
            .filter_map(|item| {
                let id = item.get("id")?.as_str()?.to_string();
                let display_name = item
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or(&id)
                    .to_string();
                Some(ModelInfo { id, display_name })
            })
            .collect())
    }
}

fn map_transport_error(err: reqwest::Error) -> AppError {
    // Die Fehlermeldung von reqwest enthält nur URL und Ursache, keinen Key.
    let reason = if err.is_timeout() {
        "Zeitüberschreitung".to_string()
    } else if err.is_connect() {
        "Verbindung fehlgeschlagen".to_string()
    } else {
        err.to_string()
    };
    logging::warn(TARGET, format!("Transportfehler: {reason}"));
    AppError::Network(reason)
}

async fn read_json(response: reqwest::Response) -> AppResult<Value> {
    let status = response.status();
    let retry_after = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());

    let text = response.text().await.map_err(map_transport_error)?;

    if status.is_success() {
        return serde_json::from_str::<Value>(&text)
            .map_err(|err| AppError::InvalidAiResponse(format!("Antwort ist kein JSON: {err}")));
    }

    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| status.canonical_reason().unwrap_or("Fehler").to_string());

    logging::warn(TARGET, format!("API-Fehler {}: {message}", status.as_u16()));

    Err(match status.as_u16() {
        401 | 403 => AppError::Unauthorized,
        429 => AppError::RateLimited {
            retry_after_seconds: retry_after,
        },
        529 => AppError::RateLimited {
            retry_after_seconds: retry_after.or(Some(30)),
        },
        other => AppError::Api {
            status: other,
            message,
        },
    })
}

fn extract_tool_input(payload: &Value) -> AppResult<Value> {
    let blocks = payload
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::InvalidAiResponse("Antwort ohne content".into()))?;

    for block in blocks {
        let is_tool_use = block.get("type").and_then(Value::as_str) == Some("tool_use");
        let is_expected = block.get("name").and_then(Value::as_str) == Some(TOOL_NAME);
        if is_tool_use && is_expected {
            return block
                .get("input")
                .cloned()
                .ok_or_else(|| AppError::InvalidAiResponse("Tool-Aufruf ohne input".into()));
        }
    }

    if payload.get("stop_reason").and_then(Value::as_str) == Some("max_tokens") {
        return Err(AppError::InvalidAiResponse(
            "Antwort wurde abgeschnitten (max_tokens)".into(),
        ));
    }

    Err(AppError::InvalidAiResponse(
        "Antwort enthält keinen strukturierten Tool-Aufruf".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_tool_input() {
        let payload = json!({
            "content": [
                { "type": "text", "text": "ignoriert" },
                { "type": "tool_use", "name": TOOL_NAME, "input": { "tasks": [] } }
            ],
            "stop_reason": "tool_use"
        });
        let input = extract_tool_input(&payload).expect("tool input");
        assert!(input.get("tasks").is_some());
    }

    #[test]
    fn rejects_response_without_tool_use() {
        let payload = json!({ "content": [{ "type": "text", "text": "Hallo" }], "stop_reason": "end_turn" });
        assert!(extract_tool_input(&payload).is_err());
    }

    #[test]
    fn reports_truncated_responses() {
        let payload = json!({ "content": [], "stop_reason": "max_tokens" });
        let err = extract_tool_input(&payload).expect_err("fehler");
        assert!(err.to_string().contains("abgeschnitten"));
    }

    #[test]
    fn rejects_foreign_tool_names() {
        let payload = json!({
            "content": [{ "type": "tool_use", "name": "anderes_tool", "input": { "tasks": [] } }],
            "stop_reason": "tool_use"
        });
        assert!(extract_tool_input(&payload).is_err());
    }
}
