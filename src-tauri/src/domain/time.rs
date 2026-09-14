use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};

pub const DATE_FORMAT: &str = "%Y-%m-%d";
pub const TIME_FORMAT: &str = "%H:%M";

/// Strikte Uhrzeit-Prüfung: nur exakt HH:MM wird akzeptiert.
pub fn parse_time(value: &str) -> Option<NaiveTime> {
    if value.len() != 5 {
        return None;
    }
    let bytes = value.as_bytes();
    if bytes[2] != b':' || !bytes.iter().enumerate().all(|(i, b)| i == 2 || b.is_ascii_digit()) {
        return None;
    }
    NaiveTime::parse_from_str(value, TIME_FORMAT).ok()
}

/// Striktes Datum: nur exakt YYYY-MM-DD wird akzeptiert.
pub fn parse_date(value: &str) -> Option<NaiveDate> {
    if value.len() != 10 {
        return None;
    }
    NaiveDate::parse_from_str(value, DATE_FORMAT).ok()
}

pub fn format_date(date: NaiveDate) -> String {
    date.format(DATE_FORMAT).to_string()
}

pub fn format_time(time: NaiveTime) -> String {
    time.format(TIME_FORMAT).to_string()
}

/// Wall-Clock-Zeitpunkt eines Tasks. Ohne Uhrzeit gilt das Tagesende, damit
/// ein Task erst nach Ablauf des Tages als überfällig zählt.
pub fn due_datetime(date: NaiveDate, time: Option<NaiveTime>) -> NaiveDateTime {
    match time {
        Some(time) => date.and_time(time),
        None => date.and_hms_opt(23, 59, 0).unwrap_or_else(|| date.and_time(NaiveTime::MIN)),
    }
}

/// Rechnet eine lokale Wall-Clock-Zeit in einen absoluten Zeitpunkt um.
/// Bei Zeitumstellungen wird die früheste gültige Variante gewählt.
pub fn to_local(naive: NaiveDateTime) -> DateTime<Local> {
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(value) => value,
        chrono::LocalResult::Ambiguous(first, _) => first,
        chrono::LocalResult::None => Local
            .from_local_datetime(&(naive + chrono::Duration::hours(1)))
            .earliest()
            .unwrap_or_else(Local::now),
    }
}

pub fn parse_rfc3339(value: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Local))
}

pub fn to_rfc3339(value: DateTime<Local>) -> String {
    value.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Minutengenauer Schlüssel für die Notification-Historie.
pub fn minute_key(value: DateTime<Local>) -> String {
    value.format("%Y-%m-%dT%H:%M").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_times() {
        assert_eq!(parse_time("07:00"), NaiveTime::from_hms_opt(7, 0, 0));
        assert_eq!(parse_time("23:59"), NaiveTime::from_hms_opt(23, 59, 0));
    }

    #[test]
    fn rejects_invalid_times() {
        for value in ["24:00", "7:00", "07:60", "0700", "07:0a", "07:00:00", ""] {
            assert!(parse_time(value).is_none(), "{value} sollte ungültig sein");
        }
    }

    #[test]
    fn parses_and_rejects_dates() {
        assert!(parse_date("2026-09-11").is_some());
        assert!(parse_date("2026-02-30").is_none());
        assert!(parse_date("11.09.2026").is_none());
        assert!(parse_date("2026-9-11").is_none());
    }

    #[test]
    fn due_datetime_without_time_is_end_of_day() {
        let date = NaiveDate::from_ymd_opt(2026, 9, 11).expect("date");
        assert_eq!(
            due_datetime(date, None),
            date.and_hms_opt(23, 59, 0).expect("time")
        );
    }
}
