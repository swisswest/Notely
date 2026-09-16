use rusqlite::{params, Connection, Row};

use super::models::{
    FeedbackCounts, FeedbackEntry, FeedbackSummary, TaskSuggestion, Verdict, MAX_EXCERPT_CHARS,
};
use super::now_utc;
use crate::error::AppResult;

/// Wie viele Fehlgriffe die Auswertung höchstens zeigt.
pub const MAX_MISSES: u32 = 25;
/// Nach so vielen Tagen zählt ein Eintrag nicht mehr als "aktuell".
const RECENT_DAYS: i64 = 30;
/// Harte Obergrenze, damit die Tabelle nicht unbegrenzt wächst.
pub const MAX_ROWS: i64 = 2000;

fn map(row: &Row<'_>) -> rusqlite::Result<FeedbackEntry> {
    let suggested: String = row.get(6)?;
    let corrected: Option<String> = row.get(7)?;
    let verdict: String = row.get(4)?;

    Ok(FeedbackEntry {
        id: row.get(0)?,
        created_at: row.get(1)?,
        note_id: row.get(2)?,
        model: row.get(3)?,
        verdict: Verdict::parse(&verdict).unwrap_or(Verdict::Rejected),
        note_excerpt: row.get(5)?,
        suggested: serde_json::from_str(&suggested).unwrap_or_else(|_| placeholder()),
        corrected: corrected.and_then(|value| serde_json::from_str(&value).ok()),
    })
}

/// Falls ein alter Datensatz nicht mehr lesbar ist, soll die Auswertung
/// trotzdem funktionieren statt komplett zu scheitern.
fn placeholder() -> TaskSuggestion {
    TaskSuggestion {
        title: "(nicht mehr lesbar)".into(),
        description: String::new(),
        due_date: None,
        due_time: None,
        confidence: 0.0,
        daypart_key: None,
        in_past: false,
    }
}

/// Kürzt den Notiztext auf einen Ausschnitt, der im UI Kontext gibt, ohne die
/// ganze Notiz zu duplizieren.
pub fn excerpt(content: &str) -> String {
    let cleaned: String = content
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if cleaned.chars().count() <= MAX_EXCERPT_CHARS {
        return cleaned;
    }
    let mut short: String = cleaned.chars().take(MAX_EXCERPT_CHARS).collect();
    short.push('…');
    short
}

pub fn record(
    conn: &Connection,
    note_id: Option<&str>,
    model: &str,
    note_excerpt: &str,
    verdict: Verdict,
    suggested: &TaskSuggestion,
    corrected: Option<&TaskSuggestion>,
) -> AppResult<()> {
    let suggested_json = serde_json::to_string(suggested)?;
    let corrected_json = match corrected {
        Some(value) => Some(serde_json::to_string(value)?),
        None => None,
    };

    conn.execute(
        "INSERT INTO ai_feedback
           (created_at, note_id, model, verdict, note_excerpt, suggested, corrected)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            now_utc(),
            note_id,
            model,
            verdict.as_str(),
            note_excerpt,
            suggested_json,
            corrected_json,
        ],
    )?;
    Ok(())
}

/// Hält die Tabelle klein. Wird nach jedem Schreiben aufgerufen.
pub fn prune(conn: &Connection) -> AppResult<usize> {
    let removed = conn.execute(
        "DELETE FROM ai_feedback WHERE id NOT IN
           (SELECT id FROM ai_feedback ORDER BY id DESC LIMIT ?1)",
        params![MAX_ROWS],
    )?;
    Ok(removed)
}

/// Zählt nach Urteil. `since` ist ein RFC3339-Zeitpunkt; ein leerer String
/// zählt alles, weil jeder Zeitstempel lexikografisch darüber liegt.
fn counts(conn: &Connection, since: &str) -> AppResult<FeedbackCounts> {
    let mut result = FeedbackCounts::default();
    let mut stmt = conn.prepare(
        "SELECT verdict, COUNT(*) FROM ai_feedback WHERE created_at >= ?1 GROUP BY verdict",
    )?;
    let rows = stmt.query_map(params![since], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
    })?;

    for row in rows {
        let (verdict, count) = row?;
        match Verdict::parse(&verdict) {
            Some(Verdict::Accepted) => result.accepted = count,
            Some(Verdict::Edited) => result.edited = count,
            Some(Verdict::Rejected) => result.rejected = count,
            None => {}
        }
    }
    Ok(result)
}

pub fn summary(conn: &Connection, limit: u32) -> AppResult<FeedbackSummary> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(RECENT_DAYS))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let mut stmt = conn.prepare(
        "SELECT id, created_at, note_id, model, verdict, note_excerpt, suggested, corrected
           FROM ai_feedback
          WHERE verdict IN ('edited', 'rejected')
          ORDER BY id DESC LIMIT ?1",
    )?;
    let mut misses = Vec::new();
    for row in stmt.query_map(params![limit.clamp(1, MAX_MISSES)], map)? {
        misses.push(row?);
    }

    Ok(FeedbackSummary {
        total: counts(conn, "")?,
        recent: counts(conn, &cutoff)?,
        misses,
    })
}

pub fn clear(conn: &Connection) -> AppResult<usize> {
    let removed = conn.execute("DELETE FROM ai_feedback", [])?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn suggestion(title: &str) -> TaskSuggestion {
        TaskSuggestion {
            title: title.into(),
            description: String::new(),
            due_date: Some("2026-09-16".into()),
            due_time: Some("12:00".into()),
            confidence: 0.8,
            daypart_key: Some("noon".into()),
            in_past: false,
        }
    }

    #[test]
    fn summary_counts_and_lists_only_misses() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let good = suggestion("Passt");
            record(conn, None, "m", "Notiz", Verdict::Accepted, &good, None)?;

            let proposed = suggestion("Falsche Zeit");
            let mut fixed = proposed.clone();
            fixed.due_time = Some("09:00".into());
            record(
                conn,
                Some("n1"),
                "m",
                "Notiz",
                Verdict::Edited,
                &proposed,
                Some(&fixed),
            )?;

            let bad = suggestion("Voellig daneben");
            record(
                conn,
                Some("n2"),
                "m",
                "Notiz",
                Verdict::Rejected,
                &bad,
                None,
            )?;

            let result = summary(conn, MAX_MISSES)?;
            assert_eq!(result.total.accepted, 1);
            assert_eq!(result.total.edited, 1);
            assert_eq!(result.total.rejected, 1);
            assert_eq!(result.total.total(), 3);
            assert_eq!(result.recent.total(), 3);

            // Nur die Fehlgriffe landen in der Liste, neueste zuerst.
            let titles: Vec<String> = result
                .misses
                .iter()
                .map(|entry| entry.suggested.title.clone())
                .collect();
            assert_eq!(titles, vec!["Voellig daneben", "Falsche Zeit"]);
            assert_eq!(
                result.misses[1]
                    .corrected
                    .as_ref()
                    .map(|s| s.due_time.clone()),
                Some(Some("09:00".into()))
            );
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn clearing_removes_everything() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            record(
                conn,
                None,
                "m",
                "Notiz",
                Verdict::Rejected,
                &suggestion("X"),
                None,
            )?;
            assert_eq!(clear(conn)?, 1);
            assert_eq!(summary(conn, MAX_MISSES)?.total.total(), 0);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn excerpt_shortens_and_collapses_whitespace() {
        assert_eq!(excerpt("  Zeile\n\nZwei  "), "Zeile Zwei");

        let long = "a".repeat(MAX_EXCERPT_CHARS + 50);
        let short = excerpt(&long);
        assert_eq!(short.chars().count(), MAX_EXCERPT_CHARS + 1);
        assert!(short.ends_with('…'));
    }
}
