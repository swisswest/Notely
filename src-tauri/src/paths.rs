use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::logging;

/// Sichtbarer Name der Ordner unter `%APPDATA%` und `%LOCALAPPDATA%`.
///
/// Bewusst getrennt vom Bezeichner `ch.westcon.notely`: an dem haengen der
/// Updater, die AUMID der Benachrichtigungen und der Eintrag im Credential
/// Manager. Wer ihn aendert, verliert den Zugriff auf all das. Der Ordner ist
/// dagegen das Einzige, was jemand je zu Gesicht bekommt - und der darf lesbar
/// heissen.
pub const APP_FOLDER: &str = "Notely";

pub const DATABASE_FILE: &str = "notely.db";
pub const LOG_FILE: &str = "notely.log";

/// SQLite legt neben der Datenbank zwei Begleitdateien an. Beim Umzug muessen
/// sie mit, sonst fehlen im neuen Ordner die zuletzt geschriebenen Aenderungen.
const DATABASE_PARTS: [&str; 3] = [DATABASE_FILE, "notely.db-wal", "notely.db-shm"];

/// Ersetzt den Pfadteil, der den Bezeichner traegt, durch `APP_FOLDER`.
/// `None`, wenn der Bezeichner im Pfad gar nicht vorkommt - dann wird nichts
/// angefasst.
fn rebranded(path: &Path, identifier: &str) -> Option<PathBuf> {
    let mut result = PathBuf::new();
    let mut replaced = false;

    for part in path.components() {
        if part.as_os_str() == identifier {
            result.push(APP_FOLDER);
            replaced = true;
        } else {
            result.push(part.as_os_str());
        }
    }

    replaced.then_some(result)
}

fn missing(what: &str, err: impl std::fmt::Display) -> AppError {
    AppError::Internal(format!("{what} nicht ermittelbar: {err}"))
}

/// Ordner der Datenbank. Beim ersten Start nach dem Umbenennen zieht ein
/// vorhandener Bestand automatisch mit um.
///
/// Scheitert der Umzug, bleibt alles im alten Ordner und die App laeuft dort
/// weiter. Ein halb verschobener Datenbestand waere schlimmer als ein Ordner
/// mit haesslichem Namen.
pub fn data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|err| missing("Datenverzeichnis", err))?;

    let Some(target) = rebranded(&legacy, &app.config().identifier) else {
        return Ok(legacy);
    };

    // Schon umgezogen, oder es gibt noch gar nichts zu verschieben.
    if target.join(DATABASE_FILE).exists() || !legacy.join(DATABASE_FILE).exists() {
        return Ok(target);
    }

    match move_database_files(&legacy, &target) {
        Ok(count) => {
            logging::info(
                "app",
                format!(
                    "Datenordner umgezogen nach {} ({count} Dateien)",
                    target.display()
                ),
            );
            Ok(target)
        }
        Err(err) => {
            logging::warn(
                "app",
                format!("Umzug des Datenordners fehlgeschlagen, bleibe im bisherigen: {err}"),
            );
            Ok(legacy)
        }
    }
}

/// Ordner der Logdatei. Hier gibt es nichts zu retten - alte Logs bleiben
/// liegen, wo sie sind, und verschwinden mit der Zeit von selbst.
pub fn log_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let legacy = app
        .path()
        .app_log_dir()
        .map_err(|err| missing("Logverzeichnis", err))?;

    Ok(rebranded(&legacy, &app.config().identifier).unwrap_or(legacy))
}

pub fn log_file(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(log_dir(app)?.join(LOG_FILE))
}

/// Verschiebt Datenbank samt Begleitdateien. Geht ein Schritt schief, werden
/// die bereits verschobenen Dateien zurueckgelegt - danach ist der Zustand
/// wieder genau der vorherige.
pub fn move_database_files(from: &Path, to: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(to)?;

    let mut done: Vec<(PathBuf, PathBuf)> = Vec::new();
    for name in DATABASE_PARTS {
        let source = from.join(name);
        if !source.exists() {
            continue;
        }
        let destination = to.join(name);

        if let Err(err) = fs::rename(&source, &destination) {
            for (original, moved) in done.iter().rev() {
                let _ = fs::rename(moved, original);
            }
            return Err(err);
        }
        done.push((source, destination));
    }

    Ok(done.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_only_the_identifier_segment() {
        let path = Path::new("/roaming/ch.westcon.notely");
        assert_eq!(
            rebranded(path, "ch.westcon.notely"),
            Some(PathBuf::from("/roaming/Notely"))
        );

        let logs = Path::new("/local/ch.westcon.notely/logs");
        assert_eq!(
            rebranded(logs, "ch.westcon.notely"),
            Some(PathBuf::from("/local/Notely/logs"))
        );
    }

    #[test]
    fn leaves_unrelated_paths_alone() {
        assert!(rebranded(Path::new("/roaming/etwas-anderes"), "ch.westcon.notely").is_none());
    }

    #[test]
    fn move_takes_the_wal_files_along() {
        let base = std::env::temp_dir().join(format!("notely-move-{}", std::process::id()));
        let from = base.join("alt");
        let to = base.join("neu");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&from).expect("quelle");

        for name in DATABASE_PARTS {
            fs::write(from.join(name), name).expect("datei");
        }

        assert_eq!(move_database_files(&from, &to).expect("umzug"), 3);
        for name in DATABASE_PARTS {
            assert!(to.join(name).exists(), "{name} fehlt im Ziel");
            assert!(!from.join(name).exists(), "{name} liegt noch am alten Ort");
        }

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn move_without_wal_files_is_fine() {
        let base = std::env::temp_dir().join(format!("notely-move-min-{}", std::process::id()));
        let from = base.join("alt");
        let to = base.join("neu");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&from).expect("quelle");
        fs::write(from.join(DATABASE_FILE), "db").expect("datei");

        assert_eq!(move_database_files(&from, &to).expect("umzug"), 1);
        assert!(to.join(DATABASE_FILE).exists());

        let _ = fs::remove_dir_all(&base);
    }
}
