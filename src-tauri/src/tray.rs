use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{AppHandle, Wry};

use crate::error::AppResult;
use crate::{logging, paths, profiles, window};

const ID_OPEN: &str = "tray_open";
const ID_NEW_TASK: &str = "tray_new_task";
const ID_NEW_NOTE: &str = "tray_new_note";
const ID_TODAY: &str = "tray_today";
const ID_QUIT: &str = "tray_quit";
/// Hinter dem Doppelpunkt steht die Profil-Kennung. Sie kommt aus dem eigenen
/// Verzeichnis, nicht von aussen - trotzdem wird sie beim Wechsel noch geprüft.
const ID_PROFILE: &str = "tray_profile:";

/// Baut das Tray-Menü. Lässt sich jederzeit erneut aufrufen; das ist der Weg,
/// wie die Profil-Liste nach einer Änderung im Menü nachzieht.
pub fn setup(app: &AppHandle) -> AppResult<()> {
    let open = MenuItem::with_id(app, ID_OPEN, "App öffnen", true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, ID_NEW_TASK, "Neuen Task erstellen", true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, ID_NEW_NOTE, "Neue Notiz", true, None::<&str>)?;
    let today = MenuItem::with_id(app, ID_TODAY, "Heute anzeigen", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator_after_profiles = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Beenden", true, None::<&str>)?;

    let registry = paths::data_dir(app)
        .map(|dir| profiles::load(&dir))
        .unwrap_or_default();

    let entries = registry
        .profiles
        .iter()
        .map(|profile| {
            CheckMenuItem::with_id(
                app,
                format!("{ID_PROFILE}{}", profile.id),
                &profile.name,
                true,
                profile.id == registry.active,
                None::<&str>,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    let entry_refs = entries
        .iter()
        .map(|item| item as &dyn IsMenuItem<Wry>)
        .collect::<Vec<_>>();
    let profile_menu = Submenu::with_items(app, "Profil wechseln", true, &entry_refs)?;

    let menu = Menu::with_items(
        app,
        &[
            &open as &dyn IsMenuItem<Wry>,
            &new_task,
            &new_note,
            &today,
            &separator,
            &profile_menu,
            &separator_after_profiles,
            &quit,
        ],
    )?;

    let Some(tray) = app.tray_by_id("main") else {
        logging::warn("tray", "Tray-Icon nicht gefunden");
        return Ok(());
    };

    tray.set_menu(Some(menu))?;
    tray.on_menu_event(|app, event| {
        let id = event.id().as_ref();

        if let Some(profile) = id.strip_prefix(ID_PROFILE) {
            switch_profile(app, profile);
            return;
        }

        match id {
            ID_OPEN => window::show_and_focus(app),
            ID_NEW_TASK => window::navigate(app, "task/new"),
            ID_NEW_NOTE => window::navigate(app, "note/new"),
            ID_TODAY => window::navigate(app, "today"),
            ID_QUIT => {
                logging::info("tray", "Beenden über Tray");
                app.exit(0);
            }
            other => logging::warn("tray", format!("Unbekannter Menüpunkt: {other}")),
        }
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

/// Merkt das gewählte Profil vor und startet neu. Schlägt das Vormerken fehl,
/// passiert nichts weiter - ein Neustart in dasselbe Profil wäre nur verwirrend.
fn switch_profile(app: &AppHandle, id: &str) {
    if !profiles::is_valid_id(id) {
        logging::warn("tray", format!("Ungültige Profil-Kennung: {id}"));
        return;
    }

    let data_dir = match paths::data_dir(app) {
        Ok(dir) => dir,
        Err(err) => {
            logging::error("tray", format!("Datenordner nicht ermittelbar: {err}"));
            return;
        }
    };

    if profiles::load(&data_dir).active == id {
        return;
    }

    if let Err(err) = profiles::set_active(&data_dir, id) {
        logging::error("tray", format!("Profilwechsel fehlgeschlagen: {err}"));
        return;
    }

    logging::info("tray", format!("Wechsel zu Profil {id}, Neustart"));
    app.restart();
}
