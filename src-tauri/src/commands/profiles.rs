use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::profiles::{self, Profile};
use crate::state::AppState;
use crate::{logging, paths, tray};

/// Was die Oberflaeche ueber die Profile wissen muss.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileList {
    pub profiles: Vec<Profile>,
    pub active: String,
    pub max: usize,
}

pub fn list_for(app: &AppHandle) -> AppResult<ProfileList> {
    let data_dir = paths::data_dir(app)?;
    let registry = profiles::load(&data_dir);
    Ok(ProfileList {
        profiles: registry.profiles,
        active: registry.active,
        max: profiles::MAX_PROFILES,
    })
}

/// Zieht die Profil-Liste im Tray nach. Scheitert das, bleibt nur das Menue
/// veraltet - kein Grund, die eigentliche Aenderung zurueckzumelden.
fn refresh_tray(app: &AppHandle) {
    if let Err(err) = tray::setup(app) {
        logging::warn("profiles", format!("Tray nicht aktualisiert: {err}"));
    }
}

#[tauri::command]
pub fn list_profiles(app: AppHandle) -> AppResult<ProfileList> {
    list_for(&app)
}

#[tauri::command]
pub fn create_profile(app: AppHandle, name: String, color: String) -> AppResult<ProfileList> {
    let data_dir = paths::data_dir(&app)?;
    let created = profiles::create(&data_dir, &name, &color)?;
    logging::info("profiles", format!("Profil {} angelegt", created.id));
    refresh_tray(&app);
    list_for(&app)
}

#[tauri::command]
pub fn rename_profile(app: AppHandle, id: String, name: String) -> AppResult<ProfileList> {
    let data_dir = paths::data_dir(&app)?;
    profiles::rename(&data_dir, &checked_id(&id)?, &name)?;
    refresh_tray(&app);
    list_for(&app)
}

/// Entfernt ein Profil. Der Ordner wird beiseitegelegt, nicht geloescht.
///
/// War es das aktive Profil, startet die App danach neu - weiterzulaufen mit
/// einer Datenbank, die nicht mehr zum gewaehlten Profil gehoert, waere der
/// sicherste Weg, Daten zu vermischen.
#[tauri::command]
pub fn remove_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<ProfileList> {
    let id = checked_id(&id)?;
    let data_dir = paths::data_dir(&app)?;
    let was_active = state.profile == id;

    profiles::remove(&data_dir, &id)?;
    logging::info("profiles", format!("Profil {id} entfernt"));

    if was_active {
        restart(&app);
    }

    refresh_tray(&app);
    list_for(&app)
}

/// Wechselt das Profil und startet die App neu.
///
/// Der Neustart ist Absicht: die Datenbankverbindung im laufenden Betrieb
/// auszutauschen hiesse, sie in jedem einzelnen Command austauschbar zu machen.
/// Eine Sekunde Neustart ist der Preis dafuer, dass keine Abfrage je die Daten
/// des anderen Profils sehen kann.
#[tauri::command]
pub fn switch_profile(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = checked_id(&id)?;
    if state.profile == id {
        return Ok(());
    }

    let data_dir = paths::data_dir(&app)?;
    profiles::set_active(&data_dir, &id)?;
    logging::info("profiles", format!("Wechsel zu Profil {id}, Neustart"));

    restart(&app);

    #[allow(unreachable_code)]
    Ok(())
}

/// Bewusst ohne `!` als Rueckgabetyp: ob `restart` zurueckkehrt, haengt an der
/// Tauri-Version. So stimmt die Signatur in beiden Faellen.
fn restart(app: &AppHandle) {
    app.restart();
}

fn checked_id(id: &str) -> AppResult<String> {
    let trimmed = id.trim();
    if !profiles::is_valid_id(trimmed) {
        return Err(AppError::validation("Ungültige Profil-Kennung"));
    }
    Ok(trimmed.to_string())
}
