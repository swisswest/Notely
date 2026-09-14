use chrono::{DateTime, Local};

use crate::domain::settings::ReviewSettings;
use crate::domain::time;

/// Tagesdatum in lokaler Zeit, wie es in den Einstellungen gespeichert wird.
pub fn today(now: DateTime<Local>) -> String {
    now.format("%Y-%m-%d").to_string()
}

/// Der Tagesabschluss ist fällig, sobald die eingestellte Uhrzeit erreicht ist
/// und er heute noch nicht erledigt wurde.
pub fn is_due(settings: &ReviewSettings, now: DateTime<Local>, last_date: Option<&str>) -> bool {
    if !settings.enabled {
        return false;
    }
    let Some(configured) = time::parse_time(&settings.time) else {
        return false;
    };
    if now.time() < configured {
        return false;
    }
    last_date != Some(today(now).as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 9, 14, hour, minute, 0)
            .single()
            .expect("zeitpunkt")
    }

    #[test]
    fn becomes_due_at_the_configured_time() {
        let settings = ReviewSettings::default(); // 18:00
        assert!(!is_due(&settings, at(17, 59), None));
        assert!(is_due(&settings, at(18, 0), None));
        assert!(is_due(&settings, at(23, 30), None));
    }

    #[test]
    fn not_due_again_on_the_same_day() {
        let settings = ReviewSettings::default();
        assert!(!is_due(&settings, at(19, 0), Some("2026-09-14")));
        assert!(is_due(&settings, at(19, 0), Some("2026-09-13")));
    }

    #[test]
    fn disabled_or_broken_time_never_fires() {
        let mut settings = ReviewSettings::default();
        settings.enabled = false;
        assert!(!is_due(&settings, at(20, 0), None));

        settings.enabled = true;
        settings.time = "kaputt".into();
        assert!(!is_due(&settings, at(20, 0), None));
    }
}
