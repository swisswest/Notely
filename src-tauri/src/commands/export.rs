use std::fs;

use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::logging;

/// Grössere Exporte als das sind kein Export mehr, sondern ein Versehen.
const MAX_BYTES: usize = 32 * 1024 * 1024;

/// Speichert einen Export unter einem selbst gewählten Namen.
///
/// Der Zielpfad kommt ausschliesslich aus dem Windows-Dialog, nie aus dem
/// Frontend. Damit kann die Oberfläche nicht bestimmen, wohin geschrieben
/// wird - sie liefert nur Inhalt und Namensvorschlag. Dieselbe Trennung wie
/// überall sonst in dieser App: die Oberfläche fragt, das Backend entscheidet.
///
/// `None` bedeutet abgebrochen. Das ist kein Fehler und wird auch nicht als
/// solcher gemeldet.
#[tauri::command]
pub async fn save_export(
    app: AppHandle,
    suggested_name: String,
    contents: String,
) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    if contents.len() > MAX_BYTES {
        return Err(AppError::validation(
            "Der Export ist zu gross. Bitte weniger Notizen auf einmal wählen.",
        ));
    }

    let name = safe_name(&suggested_name);
    let extension = name.rsplit('.').next().unwrap_or("txt").to_string();

    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&name)
        .add_filter(&extension.to_uppercase(), &[extension.as_str()])
        .save_file(move |picked| {
            let _ = sender.send(picked);
        });

    let Some(target) = receiver
        .await
        .map_err(|_| AppError::internal("Speicherdialog wurde unerwartet beendet"))?
    else {
        return Ok(None);
    };

    let path = target
        .into_path()
        .map_err(|err| AppError::Internal(format!("Zielpfad nicht verwendbar: {err}")))?;

    fs::write(&path, contents.as_bytes())
        .map_err(|err| AppError::Internal(format!("Export nicht schreibbar: {err}")))?;

    // Nur der Dateiname ins Log, nicht der Inhalt und nicht der ganze Pfad.
    logging::info(
        "export",
        format!(
            "Export geschrieben: {}",
            path.file_name().unwrap_or_default().to_string_lossy()
        ),
    );

    Ok(Some(path.to_string_lossy().to_string()))
}

/// Macht aus einem Vorschlag einen Dateinamen, den Windows akzeptiert.
///
/// Der Vorschlag entsteht aus der ersten Zeile einer Notiz und kann daher
/// alles enthalten, was jemand tippt - auch Doppelpunkte und Schrägstriche.
fn safe_name(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if (c as u32) < 0x20 => '-',
            c => c,
        })
        .collect();

    // Punkte und Leerzeichen am Ende lässt Windows stillschweigend weg.
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());

    let limited: String = trimmed.chars().take(80).collect();
    if limited.is_empty() {
        "Notely-Export.md".to_string()
    } else {
        limited
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_characters_windows_refuses() {
        assert_eq!(
            safe_name("Besprechung: Team/Planung"),
            "Besprechung- Team-Planung"
        );
        assert_eq!(safe_name("Was nun?*"), "Was nun--");
    }

    #[test]
    fn trims_trailing_dots_and_spaces() {
        assert_eq!(safe_name("  Notiz ...  "), "Notiz");
    }

    #[test]
    fn falls_back_when_nothing_usable_remains() {
        assert_eq!(safe_name("   "), "Notely-Export.md");
        assert_eq!(safe_name("..."), "Notely-Export.md");
    }

    #[test]
    fn shortens_very_long_names() {
        let long = "a".repeat(300);
        assert_eq!(safe_name(&long).chars().count(), 80);
    }

    #[test]
    fn keeps_umlauts_and_the_extension() {
        assert_eq!(safe_name("Grüezi wohl.md"), "Grüezi wohl.md");
    }
}
