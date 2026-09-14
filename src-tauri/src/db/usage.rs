use chrono::Local;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::AppResult;

/// Token-Verbrauch einer einzelnen Analyse, so wie ihn die API meldet.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
}

impl TokenUsage {
    pub fn total(self) -> i64 {
        self.input_tokens + self.output_tokens
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePeriod {
    pub analyses: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub today: UsagePeriod,
    pub month: UsagePeriod,
    pub total: UsagePeriod,
    pub last_model: Option<String>,
}

pub fn record(
    conn: &Connection,
    model: &str,
    usage: TokenUsage,
    note_id: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO ai_usage (occurred_at, model, input_tokens, output_tokens, note_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
            model,
            usage.input_tokens,
            usage.output_tokens,
            note_id
        ],
    )?;
    Ok(())
}

/// Zählt über Zeiträume. Die Spalte ist ein RFC3339-Text mit lokaler Zeit,
/// deshalb reicht ein Präfixvergleich auf Datum bzw. Monat.
pub fn summary(conn: &Connection) -> AppResult<UsageSummary> {
    let now = Local::now();
    let today = now.format("%Y-%m-%d").to_string();
    let month = now.format("%Y-%m").to_string();

    Ok(UsageSummary {
        today: period(conn, Some(&today))?,
        month: period(conn, Some(&month))?,
        total: period(conn, None)?,
        last_model: conn
            .query_row(
                "SELECT model FROM ai_usage ORDER BY occurred_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok(),
    })
}

fn period(conn: &Connection, prefix: Option<&str>) -> AppResult<UsagePeriod> {
    let (sql, bound) = match prefix {
        Some(value) => (
            "SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)
             FROM ai_usage WHERE occurred_at LIKE ?1 || '%'",
            Some(value.to_string()),
        ),
        None => (
            "SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)
             FROM ai_usage",
            None,
        ),
    };

    let map = |row: &rusqlite::Row<'_>| {
        Ok(UsagePeriod {
            analyses: row.get(0)?,
            input_tokens: row.get(1)?,
            output_tokens: row.get(2)?,
        })
    };

    let result = match bound {
        Some(value) => conn.query_row(sql, params![value], map)?,
        None => conn.query_row(sql, [], map)?,
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn counts_analyses_and_tokens() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            record(
                conn,
                "claude-sonnet-4-5",
                TokenUsage {
                    input_tokens: 1200,
                    output_tokens: 300,
                },
                None,
            )?;
            record(
                conn,
                "claude-sonnet-4-5",
                TokenUsage {
                    input_tokens: 800,
                    output_tokens: 100,
                },
                None,
            )?;

            let summary = summary(conn)?;
            assert_eq!(summary.today.analyses, 2);
            assert_eq!(summary.today.input_tokens, 2000);
            assert_eq!(summary.month.output_tokens, 400);
            assert_eq!(summary.total.analyses, 2);
            assert_eq!(summary.last_model.as_deref(), Some("claude-sonnet-4-5"));
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn empty_database_returns_zeroes() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let summary = summary(conn)?;
            assert_eq!(summary.total.analyses, 0);
            assert_eq!(summary.total.input_tokens, 0);
            assert!(summary.last_model.is_none());
            Ok(())
        })
        .expect("operations");
    }
}
