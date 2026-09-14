use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::AppHandle;

use crate::error::AppResult;
use crate::logging;
use crate::window;

const ID_OPEN: &str = "tray_open";
const ID_NEW_TASK: &str = "tray_new_task";
const ID_NEW_NOTE: &str = "tray_new_note";
const ID_TODAY: &str = "tray_today";
const ID_QUIT: &str = "tray_quit";

pub fn setup(app: &AppHandle) -> AppResult<()> {
    let open = MenuItem::with_id(app, ID_OPEN, "App öffnen", true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, ID_NEW_TASK, "Neuen Task erstellen", true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, ID_NEW_NOTE, "Neue Notiz", true, None::<&str>)?;
    let today = MenuItem::with_id(app, ID_TODAY, "Heute anzeigen", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Beenden", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&open, &new_task, &new_note, &today, &separator, &quit],
    )?;

    let Some(tray) = app.tray_by_id("main") else {
        logging::warn("tray", "Tray-Icon nicht gefunden");
        return Ok(());
    };

    tray.set_menu(Some(menu))?;
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        ID_OPEN => window::show_and_focus(app),
        ID_NEW_TASK => window::navigate(app, "task/new"),
        ID_NEW_NOTE => window::navigate(app, "note/new"),
        ID_TODAY => window::navigate(app, "today"),
        ID_QUIT => {
            logging::info("tray", "Beenden über Tray");
            app.exit(0);
        }
        other => logging::warn("tray", format!("Unbekannter Menüpunkt: {other}")),
    });

    tray.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            window::show_and_focus(tray.app_handle());
        }
    });

    Ok(())
}
