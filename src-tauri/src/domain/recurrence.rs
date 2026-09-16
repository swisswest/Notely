use chrono::{Datelike, NaiveDate, Weekday};

use crate::error::{AppError, AppResult};

pub const MAX_INTERVAL: u32 = 99;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Unit {
    fn as_str(self) -> &'static str {
        match self {
            Unit::Daily => "daily",
            Unit::Weekly => "weekly",
            Unit::Monthly => "monthly",
            Unit::Yearly => "yearly",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "daily" => Some(Unit::Daily),
            "weekly" => Some(Unit::Weekly),
            "monthly" => Some(Unit::Monthly),
            "yearly" => Some(Unit::Yearly),
            _ => None,
        }
    }
}

/// Welcher Tag im Monat getroffen wird. `Last` meint immer den letzten Tag,
/// auch im Februar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MonthDay {
    Fixed(u32),
    Last,
}

/// Eine Wiederholungsregel. Bewusst klein gehalten: alles, was hier nicht
/// abgebildet ist, lässt sich mit einer zweiten Aufgabe lösen.
///
/// Textform (so liegt sie auch in der Datenbank):
/// `daily:2`, `weekly:1:mo,we`, `monthly:1:last`, `yearly:1`,
/// optional gefolgt von `|until:2027-12-31`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recurrence {
    pub unit: Unit,
    pub interval: u32,
    /// Nur bei `Weekly` und nur bei `interval == 1`. Leer = Wochentag des Termins.
    pub weekdays: Vec<Weekday>,
    /// Nur bei `Monthly`. `None` = Tag des Termins.
    pub month_day: Option<MonthDay>,
    /// Letzter Tag, an dem die Serie noch eine Aufgabe erzeugt.
    pub until: Option<NaiveDate>,
}

fn weekday_key(day: Weekday) -> &'static str {
    match day {
        Weekday::Mon => "mo",
        Weekday::Tue => "tu",
        Weekday::Wed => "we",
        Weekday::Thu => "th",
        Weekday::Fri => "fr",
        Weekday::Sat => "sa",
        Weekday::Sun => "su",
    }
}

fn parse_weekday(value: &str) -> Option<Weekday> {
    match value {
        "mo" => Some(Weekday::Mon),
        "tu" => Some(Weekday::Tue),
        "we" => Some(Weekday::Wed),
        "th" => Some(Weekday::Thu),
        "fr" => Some(Weekday::Fri),
        "sa" => Some(Weekday::Sat),
        "su" => Some(Weekday::Sun),
        _ => None,
    }
}

fn invalid(detail: impl std::fmt::Display) -> AppError {
    AppError::validation(format!("Ungültige Wiederholung: {detail}"))
}

pub fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .and_then(|first| first.pred_opt())
        .map(|last| last.day())
        .unwrap_or(28)
}

/// Verschiebt (Jahr, Monat) um `count` Monate nach vorn.
fn add_months(year: i32, month: u32, count: u32) -> (i32, u32) {
    let zero_based = i64::from(month) - 1 + i64::from(count);
    let year = year + (zero_based / 12) as i32;
    let month = (zero_based % 12) as u32 + 1;
    (year, month)
}

impl Recurrence {
    /// Liest die Textform. Unbekannte oder widersprüchliche Angaben werden
    /// abgelehnt statt stillschweigend korrigiert.
    pub fn parse(value: &str) -> AppResult<Self> {
        let trimmed = value.trim().to_ascii_lowercase();
        if trimmed.is_empty() {
            return Err(invalid("leer"));
        }
        if trimmed.len() > 120 {
            return Err(invalid("zu lang"));
        }

        let (rule_part, until_part) = match trimmed.split_once('|') {
            Some((rule, rest)) => (rule, Some(rest)),
            None => (trimmed.as_str(), None),
        };

        let until = match until_part {
            Some(rest) => {
                let date = rest
                    .strip_prefix("until:")
                    .ok_or_else(|| invalid("unbekannter Zusatz"))?;
                Some(crate::domain::time::parse_date(date).ok_or_else(|| invalid("Enddatum"))?)
            }
            None => None,
        };

        let mut parts = rule_part.split(':');
        let unit = parts
            .next()
            .and_then(Unit::parse)
            .ok_or_else(|| invalid("unbekannte Einheit"))?;
        let interval: u32 = parts
            .next()
            .ok_or_else(|| invalid("Intervall fehlt"))?
            .parse()
            .map_err(|_| invalid("Intervall ist keine Zahl"))?;
        let detail = parts.next();
        if parts.next().is_some() {
            return Err(invalid("zu viele Felder"));
        }

        if !(1..=MAX_INTERVAL).contains(&interval) {
            return Err(invalid(format!("Intervall 1 bis {MAX_INTERVAL}")));
        }

        let mut weekdays = Vec::new();
        let mut month_day = None;

        match (unit, detail) {
            (Unit::Weekly, Some(list)) => {
                if interval != 1 {
                    return Err(invalid("einzelne Wochentage gibt es nur bei jeder Woche"));
                }
                for entry in list.split(',') {
                    let day = parse_weekday(entry.trim()).ok_or_else(|| invalid("Wochentag"))?;
                    if !weekdays.contains(&day) {
                        weekdays.push(day);
                    }
                }
                if weekdays.is_empty() {
                    return Err(invalid("keine Wochentage angegeben"));
                }
                weekdays.sort_by_key(|day| day.num_days_from_monday());
            }
            (Unit::Monthly, Some(value)) => {
                month_day = Some(if value == "last" {
                    MonthDay::Last
                } else {
                    let day: u32 = value.parse().map_err(|_| invalid("Monatstag"))?;
                    if !(1..=31).contains(&day) {
                        return Err(invalid("Monatstag 1 bis 31"));
                    }
                    MonthDay::Fixed(day)
                });
            }
            (_, Some(_)) => return Err(invalid("Zusatzangabe passt nicht zur Einheit")),
            (_, None) => {}
        }

        Ok(Self {
            unit,
            interval,
            weekdays,
            month_day,
            until,
        })
    }

    /// Kanonische Textform - genau so wird gespeichert.
    pub fn to_rule(&self) -> String {
        let mut rule = format!("{}:{}", self.unit.as_str(), self.interval);
        match self.unit {
            Unit::Weekly if !self.weekdays.is_empty() => {
                let days: Vec<&str> = self.weekdays.iter().copied().map(weekday_key).collect();
                rule.push(':');
                rule.push_str(&days.join(","));
            }
            Unit::Monthly => {
                if let Some(day) = self.month_day {
                    rule.push(':');
                    match day {
                        MonthDay::Last => rule.push_str("last"),
                        MonthDay::Fixed(value) => rule.push_str(&value.to_string()),
                    }
                }
            }
            _ => {}
        }
        if let Some(until) = self.until {
            rule.push_str(&format!(
                "|until:{}",
                crate::domain::time::format_date(until)
            ));
        }
        rule
    }

    /// Nächster Termin nach `current`. `None`, wenn die Serie hier endet.
    ///
    /// `current` ist immer der Termin der gerade erledigten Aufgabe. Die
    /// Berechnung geht von der Regel aus, nicht vom vorherigen Ergebnis -
    /// deshalb rutscht eine Serie am 31. nicht dauerhaft auf den 28.
    pub fn next(&self, current: NaiveDate) -> Option<NaiveDate> {
        let candidate = match self.unit {
            Unit::Daily => {
                current.checked_add_signed(chrono::Duration::days(i64::from(self.interval)))?
            }
            Unit::Weekly => self.next_weekly(current)?,
            Unit::Monthly => self.next_monthly(current)?,
            Unit::Yearly => self.next_yearly(current)?,
        };

        match self.until {
            Some(until) if candidate > until => None,
            _ => Some(candidate),
        }
    }

    fn next_weekly(&self, current: NaiveDate) -> Option<NaiveDate> {
        if self.weekdays.is_empty() {
            return current.checked_add_signed(chrono::Duration::weeks(i64::from(self.interval)));
        }
        // interval ist hier per Validierung 1, also darf jeder Tag der
        // folgenden Woche getroffen werden.
        for offset in 1..=7 {
            let candidate = current.checked_add_signed(chrono::Duration::days(offset))?;
            if self.weekdays.contains(&candidate.weekday()) {
                return Some(candidate);
            }
        }
        None
    }

    fn next_monthly(&self, current: NaiveDate) -> Option<NaiveDate> {
        let (year, month) = add_months(current.year(), current.month(), self.interval);
        let last = last_day_of_month(year, month);
        let day = match self.month_day {
            Some(MonthDay::Last) => last,
            Some(MonthDay::Fixed(value)) => value.min(last),
            None => current.day().min(last),
        };
        NaiveDate::from_ymd_opt(year, month, day)
    }

    fn next_yearly(&self, current: NaiveDate) -> Option<NaiveDate> {
        let year = current.year() + self.interval as i32;
        let month = current.month();
        let day = current.day().min(last_day_of_month(year, month));
        NaiveDate::from_ymd_opt(year, month, day)
    }
}

/// Prüft eine Regel aus dem Frontend und gibt sie kanonisch zurück.
pub fn normalize(value: &str) -> AppResult<String> {
    Ok(Recurrence::parse(value)?.to_rule())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> NaiveDate {
        crate::domain::time::parse_date(value).expect("date")
    }

    fn next(rule: &str, from: &str) -> Option<String> {
        Recurrence::parse(rule)
            .expect("rule")
            .next(date(from))
            .map(crate::domain::time::format_date)
    }

    #[test]
    fn round_trip_keeps_the_rule() {
        for rule in [
            "daily:1",
            "daily:3",
            "weekly:2",
            "weekly:1:mo,we,fr",
            "monthly:1",
            "monthly:2:15",
            "monthly:1:last",
            "yearly:1",
            "daily:1|until:2027-12-31",
        ] {
            assert_eq!(normalize(rule).expect(rule), rule);
        }
    }

    #[test]
    fn weekday_order_is_normalized() {
        assert_eq!(
            normalize("weekly:1:fr,mo,we").expect("rule"),
            "weekly:1:mo,we,fr"
        );
        // Doppelte Angaben fallen weg.
        assert_eq!(normalize("weekly:1:mo,mo").expect("rule"), "weekly:1:mo");
    }

    #[test]
    fn daily_respects_the_interval() {
        assert_eq!(next("daily:1", "2026-09-15").as_deref(), Some("2026-09-16"));
        assert_eq!(next("daily:3", "2026-09-15").as_deref(), Some("2026-09-18"));
    }

    #[test]
    fn weekly_without_weekdays_keeps_the_weekday() {
        // 2026-09-15 ist ein Dienstag.
        assert_eq!(
            next("weekly:1", "2026-09-15").as_deref(),
            Some("2026-09-22")
        );
        assert_eq!(
            next("weekly:2", "2026-09-15").as_deref(),
            Some("2026-09-29")
        );
    }

    #[test]
    fn weekly_with_weekdays_picks_the_next_listed_day() {
        // Dienstag, Regel Montag/Mittwoch/Freitag -> Mittwoch.
        assert_eq!(
            next("weekly:1:mo,we,fr", "2026-09-15").as_deref(),
            Some("2026-09-16")
        );
        // Freitag -> nächster Montag.
        assert_eq!(
            next("weekly:1:mo,we,fr", "2026-09-18").as_deref(),
            Some("2026-09-21")
        );
    }

    #[test]
    fn monthly_does_not_drift_away_from_the_31st() {
        // Der Januar-Termin am 31. landet im Februar auf dem 28.,
        // im März aber wieder auf dem 31.
        let rule = Recurrence::parse("monthly:1:31").expect("rule");
        let february = rule.next(date("2027-01-31")).expect("februar");
        assert_eq!(crate::domain::time::format_date(february), "2027-02-28");

        let march = rule.next(february).expect("maerz");
        assert_eq!(crate::domain::time::format_date(march), "2027-03-31");
    }

    #[test]
    fn monthly_without_day_uses_the_current_date() {
        assert_eq!(
            next("monthly:1", "2026-09-15").as_deref(),
            Some("2026-10-15")
        );
        assert_eq!(
            next("monthly:2", "2026-11-30").as_deref(),
            Some("2027-01-30")
        );
    }

    #[test]
    fn monthly_last_hits_the_end_of_every_month() {
        assert_eq!(
            next("monthly:1:last", "2027-01-31").as_deref(),
            Some("2027-02-28")
        );
        assert_eq!(
            next("monthly:1:last", "2028-01-31").as_deref(),
            Some("2028-02-29")
        );
    }

    #[test]
    fn yearly_handles_the_29th_of_february() {
        assert_eq!(
            next("yearly:1", "2028-02-29").as_deref(),
            Some("2029-02-28")
        );
        assert_eq!(
            next("yearly:4", "2028-02-29").as_deref(),
            Some("2032-02-29")
        );
    }

    #[test]
    fn until_ends_the_series() {
        assert_eq!(
            next("daily:1|until:2026-09-16", "2026-09-15").as_deref(),
            Some("2026-09-16")
        );
        assert_eq!(next("daily:1|until:2026-09-16", "2026-09-16"), None);
    }

    #[test]
    fn rejects_broken_rules() {
        for rule in [
            "",
            "taeglich:1",
            "daily",
            "daily:0",
            "daily:100",
            "daily:x",
            "weekly:2:mo",
            "weekly:1:xx",
            "weekly:1:",
            "monthly:1:0",
            "monthly:1:32",
            "daily:1:mo",
            "daily:1|bis:2027-01-01",
            "daily:1|until:01.01.2027",
            "daily:1:2:3",
        ] {
            assert!(
                Recurrence::parse(rule).is_err(),
                "{rule} haette abgelehnt werden muessen"
            );
        }
    }
}
