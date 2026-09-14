use serde::Deserialize;
use serde_json::{json, Value};

use crate::domain::settings::AppSettings;

pub const TOOL_NAME: &str = "emit_tasks";
pub const MAX_TASKS_PER_NOTE: usize = 20;

/// Das JSON-Schema wird aus den konfigurierten Tageszeiten erzeugt. Dadurch
/// existieren keine hartkodierten Begriffe - neue Tageszeiten sind sofort Teil
/// des erlaubten Wertebereichs.
pub fn build_tool_schema(settings: &AppSettings) -> Value {
    let mut daypart_enum: Vec<Value> = settings
        .dayparts
        .iter()
        .map(|part| Value::String(part.key.clone()))
        .collect();
    daypart_enum.push(Value::Null);
    let max_tasks = MAX_TASKS_PER_NOTE;

    json!({
        "name": TOOL_NAME,
        "description": "Gibt die aus einer Notiz abgeleiteten Aufgaben strukturiert zurück. Ohne konkrete Handlung wird eine leere Liste zurückgegeben.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "maxItems": max_tasks,
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {
                                "type": "string",
                                "description": "Kurze, konkrete Handlung im Imperativ, Sprache der Notiz."
                            },
                            "description": {
                                "type": "string",
                                "description": "Optionaler Zusatzkontext aus der Notiz. Leer lassen wenn nichts Weiteres dasteht."
                            },
                            "dueDate": {
                                "type": ["string", "null"],
                                "description": "Absolutes Datum im Format YYYY-MM-DD, aufgelöst gegen die übergebene aktuelle Zeit. null wenn die Notiz keinen Termin nennt."
                            },
                            "time": {
                                "type": "object",
                                "properties": {
                                    "kind": {
                                        "type": "string",
                                        "enum": ["daypart", "exact", "none"],
                                        "description": "daypart wenn die Notiz eine Tageszeit nennt, exact bei konkreter Uhrzeit, sonst none."
                                    },
                                    "daypart": {
                                        "type": ["string", "null"],
                                        "enum": daypart_enum,
                                        "description": "Schlüssel der Tageszeit. Die App setzt die konfigurierte Uhrzeit ein."
                                    },
                                    "exact": {
                                        "type": ["string", "null"],
                                        "description": "Uhrzeit im Format HH:MM, nur bei kind = exact."
                                    }
                                },
                                "required": ["kind"]
                            },
                            "confidence": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 1,
                                "description": "1.0 nur wenn Handlung und Termin eindeutig sind. Bei Unsicherheit niedriger."
                            }
                        },
                        "required": ["title", "dueDate", "time", "confidence"]
                    }
                }
            },
            "required": ["tasks"]
        }
    })
}

#[derive(Debug, Default, Deserialize)]
pub struct RawTaskList {
    #[serde(default)]
    pub tasks: Vec<RawTask>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawTask {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub time: Option<RawTime>,
    #[serde(default)]
    pub confidence: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawTime {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub daypart: Option<String>,
    #[serde(default)]
    pub exact: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_contains_configured_daypart_keys() {
        let mut settings = AppSettings::default();
        settings.dayparts.push(crate::domain::settings::Daypart {
            key: "lunchbreak".into(),
            label: "Mittagspause".into(),
            time: "12:30".into(),
        });

        let schema = build_tool_schema(&settings);
        let text = schema.to_string();
        assert!(text.contains("lunchbreak"));
        assert!(text.contains("evening"));
    }

    #[test]
    fn tolerates_missing_optional_fields() {
        let parsed: RawTaskList =
            serde_json::from_str(r#"{"tasks":[{"title":"X","time":{"kind":"none"}}]}"#)
                .expect("parse");
        assert_eq!(parsed.tasks.len(), 1);
        assert!(parsed.tasks[0].due_date.is_none());
        assert!(parsed.tasks[0].confidence.is_none());
    }

    #[test]
    fn tolerates_unknown_fields() {
        let parsed: RawTaskList = serde_json::from_str(
            r#"{"tasks":[{"title":"X","time":{"kind":"none"},"foo":1}],"bar":2}"#,
        )
        .expect("parse");
        assert_eq!(parsed.tasks.len(), 1);
    }
}
