use rusqlite::{params, Connection};

use crate::domain::settings::AppSettings;
use crate::error::AppResult;
use crate::logging;

const SETTINGS_KEY: &str = "app";

pub fn load(conn: &Connection) -> AppResult<AppSettings> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![SETTINGS_KEY],
            |row| row.get(0),
        )
        .ok();

    let Some(raw) = stored else {
        return Ok(AppSettings::default());
    };

    match serde_json::from_str::<AppSettings>(&raw) {
        Ok(settings) => Ok(settings),
        Err(err) => {
            // Defekte oder ältere Settings dürfen den Start nie blockieren.
            logging::error(
                "settings",
                format!("Einstellungen nicht lesbar, Standardwerte aktiv: {err}"),
            );
            Ok(AppSettings::default())
        }
    }
}

pub fn save(conn: &Connection, settings: &AppSettings) -> AppResult<()> {
    let value = serde_json::to_string(settings)
        .map_err(|err| crate::error::AppError::Internal(err.to_string()))?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SETTINGS_KEY, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn round_trip_and_defaults() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            assert_eq!(load(conn)?.claude.model, AppSettings::default().claude.model);

            let mut settings = AppSettings::default();
            settings.timezone = "Europe/Zurich".into();
            settings.notifications.lead_minutes = vec![30];
            save(conn, &settings)?;

            let loaded = load(conn)?;
            assert_eq!(loaded.timezone, "Europe/Zurich");
            assert_eq!(loaded.notifications.lead_minutes, vec![30]);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn broken_json_falls_back_to_defaults() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('app', '{kaputt')",
                [],
            )?;
            let loaded = load(conn)?;
            assert_eq!(loaded.dayparts.len(), 5);
            Ok(())
        })
        .expect("operations");
    }
}
