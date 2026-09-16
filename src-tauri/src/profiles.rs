use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::logging;
use crate::paths;

/// Mehr Profile hat in der Praxis niemand, und jedes weitere ist eine weitere
/// Datenbank, die gesichert werden will.
pub const MAX_PROFILES: usize = 8;
/// Das Profil, in dem ein bestehender Datenbestand landet.
pub const DEFAULT_ID: &str = "privat";
pub const DEFAULT_NAME: &str = "Privat";

const REGISTRY_FILE: &str = "profiles.json";
const PROFILES_DIR: &str = "profiles";
/// Entfernte Profile landen hier statt im Nichts.
const REMOVED_DIR: &str = "_entfernt";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Aus derselben Farbliste wie die Labels, damit die Oberflaeche einheitlich bleibt.
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Registry {
    pub profiles: Vec<Profile>,
    pub active: String,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            profiles: vec![Profile {
                id: DEFAULT_ID.to_string(),
                name: DEFAULT_NAME.to_string(),
                color: "blue".to_string(),
            }],
            active: DEFAULT_ID.to_string(),
        }
    }
}

impl Registry {
    pub fn get(&self, id: &str) -> Option<&Profile> {
        self.profiles.iter().find(|profile| profile.id == id)
    }

    pub fn active_profile(&self) -> Option<&Profile> {
        self.get(&self.active)
    }

    /// Sorgt dafuer, dass die Liste nie leer ist und `active` immer auf ein
    /// vorhandenes Profil zeigt. Eine von Hand verbogene Datei soll die App
    /// nicht am Start hindern.
    fn repaired(mut self) -> Self {
        self.profiles.retain(|profile| is_valid_id(&profile.id));
        if self.profiles.is_empty() {
            return Registry::default();
        }
        if self.get(&self.active).is_none() {
            self.active = self.profiles[0].id.clone();
        }
        self
    }
}

/// Ein Profil-Ordner heisst wie die ID. Deshalb sind nur Zeichen erlaubt, die
/// auf jedem Dateisystem unauffaellig sind.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id != REMOVED_DIR
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Macht aus einem Anzeigenamen eine Ordner-taugliche ID.
pub fn slug(name: &str) -> String {
    let mut result = String::new();
    let mut last_dash = true;

    for raw in name.trim().to_lowercase().chars() {
        let mapped = match raw {
            'ä' => "ae",
            'ö' => "oe",
            'ü' => "ue",
            'ß' => "ss",
            _ => "",
        };

        if !mapped.is_empty() {
            result.push_str(mapped);
            last_dash = false;
            continue;
        }

        if raw.is_ascii_alphanumeric() {
            result.push(raw);
            last_dash = false;
        } else if !last_dash && result.len() < 32 {
            result.push('-');
            last_dash = true;
        }

        if result.len() >= 32 {
            break;
        }
    }

    let trimmed = result.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("profil-{}", chrono::Utc::now().timestamp())
    } else {
        trimmed
    }
}

pub fn registry_path(data_dir: &Path) -> PathBuf {
    data_dir.join(REGISTRY_FILE)
}

pub fn profile_dir(data_dir: &Path, id: &str) -> PathBuf {
    data_dir.join(PROFILES_DIR).join(id)
}

pub fn database_path(data_dir: &Path, id: &str) -> PathBuf {
    profile_dir(data_dir, id).join(paths::DATABASE_FILE)
}

/// Liest das Verzeichnis. Eine fehlende oder kaputte Datei ergibt die
/// Standardbelegung - der Start darf daran nie scheitern.
pub fn load(data_dir: &Path) -> Registry {
    let Ok(raw) = fs::read_to_string(registry_path(data_dir)) else {
        return Registry::default();
    };

    match serde_json::from_str::<Registry>(&raw) {
        Ok(registry) => registry.repaired(),
        Err(err) => {
            logging::error(
                "profiles",
                format!("Profilverzeichnis nicht lesbar, Standard aktiv: {err}"),
            );
            Registry::default()
        }
    }
}

pub fn save(data_dir: &Path, registry: &Registry) -> AppResult<()> {
    let text = serde_json::to_string_pretty(registry)
        .map_err(|err| AppError::Internal(format!("Profilverzeichnis nicht schreibbar: {err}")))?;
    fs::create_dir_all(data_dir)
        .map_err(|err| AppError::Internal(format!("Datenordner nicht anlegbar: {err}")))?;
    fs::write(registry_path(data_dir), text)
        .map_err(|err| AppError::Internal(format!("Profilverzeichnis nicht schreibbar: {err}")))
}

/// Bereitet den Start vor: legt das Verzeichnis an, falls es fehlt, holt einen
/// Bestand aus der Zeit vor den Profilen ins Standardprofil und liefert den
/// Pfad der aktiven Datenbank.
pub fn ensure(data_dir: &Path) -> AppResult<(Registry, PathBuf)> {
    let existed = registry_path(data_dir).exists();
    let registry = load(data_dir);

    if !existed {
        adopt_legacy_database(data_dir)?;
        save(data_dir, &registry)?;
        logging::info("profiles", "Profilverzeichnis angelegt");
    }

    let target = profile_dir(data_dir, &registry.active);
    fs::create_dir_all(&target)
        .map_err(|err| AppError::Internal(format!("Profilordner nicht anlegbar: {err}")))?;

    Ok((registry.clone(), database_path(data_dir, &registry.active)))
}

/// Verschiebt `<daten>/notely.db` nach `<daten>/profiles/privat/notely.db`.
///
/// Scheitert der Umzug, wird nichts angelegt und der Fehler nach oben gereicht:
/// mit einem leeren Standardprofil weiterzumachen wuerde so aussehen, als waeren
/// alle Notizen weg.
fn adopt_legacy_database(data_dir: &Path) -> AppResult<()> {
    let legacy = data_dir.join(paths::DATABASE_FILE);
    if !legacy.exists() {
        return Ok(());
    }

    let target = profile_dir(data_dir, DEFAULT_ID);
    paths::move_database_files(data_dir, &target).map_err(|err| {
        AppError::Internal(format!(
            "Bestand liess sich nicht ins Profil {DEFAULT_NAME} verschieben: {err}"
        ))
    })?;

    logging::info(
        "profiles",
        format!("Bestehende Daten in Profil {DEFAULT_NAME} uebernommen"),
    );
    Ok(())
}

/// Legt ein Profil an. Die Datenbank entsteht erst beim Wechsel dorthin.
pub fn create(data_dir: &Path, name: &str, color: &str) -> AppResult<Profile> {
    let name = crate::domain::validation::display_name(name, "Profilname")?;
    let mut registry = load(data_dir);

    if registry.profiles.len() >= MAX_PROFILES {
        return Err(AppError::validation(format!(
            "Mehr als {MAX_PROFILES} Profile sind nicht vorgesehen"
        )));
    }
    if registry
        .profiles
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(&name))
    {
        return Err(AppError::validation(
            "Ein Profil mit diesem Namen existiert bereits",
        ));
    }

    let color = crate::db::labels::COLORS
        .iter()
        .find(|known| **known == color)
        .copied()
        .unwrap_or("slate");

    let base = slug(&name);
    let mut id = base.clone();
    let mut suffix = 2;
    while registry.get(&id).is_some() || profile_dir(data_dir, &id).exists() {
        id = format!("{base}-{suffix}");
        suffix += 1;
    }

    let profile = Profile {
        id,
        name,
        color: color.to_string(),
    };
    registry.profiles.push(profile.clone());
    save(data_dir, &registry)?;
    Ok(profile)
}

pub fn rename(data_dir: &Path, id: &str, name: &str) -> AppResult<Profile> {
    let name = crate::domain::validation::display_name(name, "Profilname")?;
    let mut registry = load(data_dir);

    if registry
        .profiles
        .iter()
        .any(|profile| profile.id != id && profile.name.eq_ignore_ascii_case(&name))
    {
        return Err(AppError::validation(
            "Ein Profil mit diesem Namen existiert bereits",
        ));
    }

    let profile = registry
        .profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| AppError::NotFound(format!("Profil {id}")))?;
    profile.name = name;
    let updated = profile.clone();

    save(data_dir, &registry)?;
    Ok(updated)
}

/// Entfernt ein Profil aus der Liste und legt seinen Ordner beiseite.
///
/// Bewusst kein Loeschen: der Ordner wandert nach `profiles/_entfernt/`. Wer
/// sich vertut, holt ihn von Hand zurueck - eine Datenbank ist nichts, was man
/// auf Knopfdruck unwiederbringlich wegwerfen koennen sollte.
pub fn remove(data_dir: &Path, id: &str) -> AppResult<Registry> {
    let mut registry = load(data_dir);

    if registry.profiles.len() <= 1 {
        return Err(AppError::validation(
            "Das letzte Profil lässt sich nicht entfernen",
        ));
    }
    if registry.get(id).is_none() {
        return Err(AppError::NotFound(format!("Profil {id}")));
    }

    let source = profile_dir(data_dir, id);
    if source.exists() {
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let target = data_dir
            .join(PROFILES_DIR)
            .join(REMOVED_DIR)
            .join(format!("{id}-{stamp}"));

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| AppError::Internal(format!("Ordner nicht anlegbar: {err}")))?;
        }
        fs::rename(&source, &target).map_err(|err| {
            AppError::Internal(format!(
                "Profilordner liess sich nicht beiseitelegen: {err}"
            ))
        })?;
        logging::info(
            "profiles",
            format!("Profil {id} liegt jetzt unter {}", target.display()),
        );
    }

    registry.profiles.retain(|profile| profile.id != id);
    if registry.active == id {
        registry.active = registry.profiles[0].id.clone();
    }
    save(data_dir, &registry)?;
    Ok(registry)
}

pub fn set_active(data_dir: &Path, id: &str) -> AppResult<Registry> {
    let mut registry = load(data_dir);
    if registry.get(id).is_none() {
        return Err(AppError::NotFound(format!("Profil {id}")));
    }
    registry.active = id.to_string();
    save(data_dir, &registry)?;
    Ok(registry)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notely-profiles-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch");
        dir
    }

    #[test]
    fn slugs_are_folder_safe() {
        assert_eq!(slug("Arbeit"), "arbeit");
        assert_eq!(slug("Büro & Co."), "buero-co");
        assert_eq!(slug("  Mehrere   Wörter  "), "mehrere-woerter");
        assert!(is_valid_id(&slug("Arbeit")));
        assert!(is_valid_id(&slug("!!!")), "Rueckfall muss gueltig sein");
    }

    #[test]
    fn rejects_dangerous_ids() {
        assert!(!is_valid_id(""));
        assert!(!is_valid_id(".."));
        assert!(!is_valid_id("mit/slash"));
        assert!(!is_valid_id("Gross"));
        assert!(!is_valid_id(REMOVED_DIR));
    }

    #[test]
    fn ensure_creates_the_default_profile() {
        let dir = scratch("ensure");
        let (registry, db) = ensure(&dir).expect("ensure");

        assert_eq!(registry.profiles.len(), 1);
        assert_eq!(registry.active, DEFAULT_ID);
        assert_eq!(db, dir.join("profiles").join(DEFAULT_ID).join("notely.db"));
        assert!(registry_path(&dir).exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_adopts_a_database_from_before_profiles() {
        let dir = scratch("adopt");
        fs::write(dir.join("notely.db"), "bestand").expect("db");
        fs::write(dir.join("notely.db-wal"), "wal").expect("wal");

        let (_, db) = ensure(&dir).expect("ensure");
        assert_eq!(fs::read_to_string(&db).expect("inhalt"), "bestand");
        assert!(
            db.with_extension("db-wal").exists()
                || db.parent().unwrap().join("notely.db-wal").exists()
        );
        assert!(
            !dir.join("notely.db").exists(),
            "Bestand liegt noch am alten Ort"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_rename_and_remove() {
        let dir = scratch("crud");
        ensure(&dir).expect("ensure");

        let arbeit = create(&dir, "Arbeit", "amber").expect("anlegen");
        assert_eq!(arbeit.id, "arbeit");
        assert_eq!(load(&dir).profiles.len(), 2);

        // Gleicher Name geht nicht.
        assert!(create(&dir, "arbeit", "blue").is_err());

        let renamed = rename(&dir, "arbeit", "Büro").expect("umbenennen");
        assert_eq!(renamed.name, "Büro");
        assert_eq!(renamed.id, "arbeit", "die ID bleibt stabil");

        // Der Ordner wird beiseitegelegt, nicht geloescht.
        fs::create_dir_all(profile_dir(&dir, "arbeit")).expect("ordner");
        fs::write(profile_dir(&dir, "arbeit").join("notely.db"), "x").expect("db");
        let after = remove(&dir, "arbeit").expect("entfernen");
        assert_eq!(after.profiles.len(), 1);
        assert!(!profile_dir(&dir, "arbeit").exists());
        assert!(dir.join("profiles").join(REMOVED_DIR).exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_last_profile_stays() {
        let dir = scratch("last");
        ensure(&dir).expect("ensure");
        assert!(remove(&dir, DEFAULT_ID).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn removing_the_active_profile_moves_the_selection() {
        let dir = scratch("active");
        ensure(&dir).expect("ensure");
        create(&dir, "Arbeit", "amber").expect("anlegen");
        set_active(&dir, "arbeit").expect("wechseln");

        let after = remove(&dir, "arbeit").expect("entfernen");
        assert_eq!(after.active, DEFAULT_ID);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_registry_falls_back_instead_of_failing() {
        let dir = scratch("broken");
        fs::write(registry_path(&dir), "{ kaputt").expect("schreiben");

        let registry = load(&dir);
        assert_eq!(registry.profiles.len(), 1);
        assert_eq!(registry.active, DEFAULT_ID);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_active_id_without_profile_is_repaired() {
        let dir = scratch("repair");
        let raw = r#"{"profiles":[{"id":"arbeit","name":"Arbeit","color":"amber"}],"active":"gibt-es-nicht"}"#;
        fs::write(registry_path(&dir), raw).expect("schreiben");

        let registry = load(&dir);
        assert_eq!(registry.active, "arbeit");

        let _ = fs::remove_dir_all(&dir);
    }
}
