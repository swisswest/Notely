use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::logging;
use crate::state::events;

pub const MAIN_WINDOW: &str = "main";

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW)
}

pub fn show_and_focus(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        logging::warn("window", "Hauptfenster nicht gefunden");
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    if let Err(err) = window.set_focus() {
        logging::warn("window", format!("Fokus fehlgeschlagen: {err}"));
    }
}

/// Öffnet das Fenster und schickt das Frontend auf eine bestimmte Ansicht.
pub fn navigate(app: &AppHandle, target: &str) {
    show_and_focus(app);
    if let Err(err) = app.emit(events::NAVIGATE, target.to_string()) {
        logging::warn("window", format!("Navigation nicht zustellbar: {err}"));
    }
}

pub fn notify_data_changed(app: &AppHandle) {
    if let Err(err) = app.emit(events::DATA_CHANGED, ()) {
        logging::warn("window", format!("Aktualisierung nicht zustellbar: {err}"));
    }
}
