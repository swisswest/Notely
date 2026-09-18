use rusqlite::{params, Connection, Row, ToSql};

use super::labels;
use super::models::{FolderFilter, Note, NoteFilter};
use super::{new_id, now_utc};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, content, created_at, updated_at, analyzed_at, last_analysis_status,
                       folder_id, deleted_at";

/// Dieselben Spalten, qualifiziert - fuer Abfragen, die `notes` mit dem
/// Volltextindex verbinden.
const COLUMNS_N: &str = "n.id, n.content, n.created_at, n.updated_at, n.analyzed_at,
                         n.last_analysis_status, n.folder_id, n.deleted_at";

fn map(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        content: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        analyzed_at: row.get(4)?,
        last_analysis_status: row.get(5)?,
        folder_id: row.get(6)?,
        deleted_at: row.get(7)?,
        labels: Vec::new(),
    })
}

pub fn create(conn: &Connection, content: &str, folder_id: Option<&str>) -> AppResult<Note> {
    let now = now_utc();
    let id = new_id();
    conn.execute(
        "INSERT INTO notes (id, content, created_at, updated_at, folder_id)
         VALUES (?1, ?2, ?3, ?3, ?4)",
        params![id, content, now, folder_id],
    )?;
    get(conn, &id)
}

/// Schreibt neuen Inhalt und legt den bisherigen Stand als Version ab.
///
/// Unveraenderter Text wird nicht gespeichert: sonst wuerde jedes Autosave
/// das Aenderungsdatum verschieben und eine Version erzeugen, obwohl nichts
/// passiert ist.
pub fn update_content(conn: &Connection, id: &str, content: &str) -> AppResult<Note> {
    let previous = get(conn, id)?;
    if previous.deleted_at.is_some() {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    if previous.content == content {
        return Ok(previous);
    }

    super::versions::record(conn, id, &previous.content)?;

    let changed = conn.execute(
        "UPDATE notes SET content = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, content, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    get(conn, id)
}

pub fn set_folder(conn: &Connection, id: &str, folder_id: Option<&str>) -> AppResult<Note> {
    let changed = conn.execute(
        "UPDATE notes SET folder_id = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, folder_id, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    get(conn, id)
}

/// Löschen heisst zunächst nur: als gelöscht markieren. Erst `purge` entfernt
/// die Zeile wirklich - so ist jedes Versehen umkehrbar.
pub fn soft_delete(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE notes SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    Ok(())
}

pub fn restore(conn: &Connection, id: &str) -> AppResult<Note> {
    let changed = conn.execute(
        "UPDATE notes SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, now_utc()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Notiz {id}")));
    }
    get(conn, id)
}

pub fn purge(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

/// Entfernt endgültig, was länger als `days` im Papierkorb liegt.
pub fn purge_expired(conn: &Connection, days: i64) -> AppResult<usize> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let removed = conn.execute(
        "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )?;
    Ok(removed)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Note> {
    let sql = format!("SELECT {COLUMNS} FROM notes WHERE id = ?1");
    let mut note = conn
        .query_row(&sql, params![id], map)
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Notiz {id}")),
            other => AppError::from(other),
        })?;
    note.labels = labels::by_note(conn)?.remove(id).unwrap_or_default();
    Ok(note)
}

/// Gefilterte Notizliste. Alle Werte werden gebunden - im SQL landen nur
/// generierte Platzhalter, nie Benutzereingaben.
pub fn list(conn: &Connection, filter: &NoteFilter, limit: u32) -> AppResult<Vec<Note>> {
    let limit = limit.clamp(1, 1000);
    let mut clauses: Vec<String> = vec!["deleted_at IS NULL".to_string()];
    let mut values: Vec<Box<dyn ToSql>> = Vec::new();

    if let Some(term) = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        clauses.push("content LIKE '%' || ? || '%' ESCAPE '\\'".to_string());
        values.push(Box::new(escape_like(term)));
    }

    match &filter.folder {
        FolderFilter::All => {}
        FolderFilter::Unfiled => clauses.push("folder_id IS NULL".to_string()),
        FolderFilter::Id(id) => {
            clauses.push("folder_id = ?".to_string());
            values.push(Box::new(id.clone()));
        }
    }

    if !filter.label_ids.is_empty() {
        // Alle gewählten Labels müssen gesetzt sein (UND-Verknüpfung).
        let placeholders = vec!["?"; filter.label_ids.len()].join(", ");
        clauses.push(format!(
            "id IN (SELECT note_id FROM note_labels WHERE label_id IN ({placeholders})
                    GROUP BY note_id HAVING COUNT(DISTINCT label_id) = ?)"
        ));
        for label_id in &filter.label_ids {
            values.push(Box::new(label_id.clone()));
        }
        values.push(Box::new(filter.label_ids.len() as i64));
    }

    let sql = format!(
        "SELECT {COLUMNS} FROM notes WHERE {} ORDER BY updated_at DESC LIMIT ?",
        clauses.join(" AND ")
    );
    values.push(Box::new(limit));

    let params: Vec<&dyn ToSql> = values.iter().map(|value| value.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params.as_slice(), map)? {
        result.push(row?);
    }

    attach_labels(conn, &mut result)?;
    Ok(result)
}

/// Inhalt der Notizen im Papierkorb, neueste Löschung zuerst.
pub fn list_deleted(conn: &Connection, limit: u32) -> AppResult<Vec<Note>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM notes WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![limit.clamp(1, 1000)], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

/// Notizen ohne erfolgreiche Analyse: nie analysiert oder zuletzt
/// fehlgeschlagen. Grundlage der Inbox.
pub fn needing_attention(conn: &Connection, limit: u32) -> AppResult<Vec<Note>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM notes
          WHERE deleted_at IS NULL
            AND (last_analysis_status IS NULL OR last_analysis_status = 'failed')
          ORDER BY updated_at DESC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![limit.clamp(1, 1000)], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

/// Sucht Notizen. Zuerst ueber den Volltextindex, weil der mehrere Woerter
/// gewichten kann; bleibt er leer, folgt die Teilzeichenkettensuche. Beides
/// wird gebraucht: der Index findet nur ganze Woerter ab Wortanfang, LIKE
/// findet auch "park" in "Parkhaus", kann dafuer nicht gewichten.
pub fn search(conn: &Connection, term: &str, limit: u32) -> AppResult<Vec<Note>> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let ranked = search_ranked(conn, trimmed, limit)?;
    if !ranked.is_empty() {
        return Ok(ranked);
    }
    search_like(conn, trimmed, limit)
}

/// Volltextsuche nach Relevanz. Liefert eine leere Liste, wenn aus der
/// Eingabe kein sinnvoller Suchausdruck wird.
pub fn search_ranked(conn: &Connection, term: &str, limit: u32) -> AppResult<Vec<Note>> {
    let Some(query) = fts_query(term) else {
        return Ok(Vec::new());
    };

    let sql = format!(
        "SELECT {COLUMNS_N} FROM notes_fts
         JOIN notes n ON n.rowid = notes_fts.rowid
         WHERE notes_fts MATCH ?1 AND n.deleted_at IS NULL
         ORDER BY bm25(notes_fts) LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![query, limit.clamp(1, 100)], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

fn search_like(conn: &Connection, term: &str, limit: u32) -> AppResult<Vec<Note>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM notes
         WHERE deleted_at IS NULL AND content LIKE '%' || ?1 || '%' ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map(params![escape_like(term), limit.clamp(1, 100)], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

/// Baut den Volltextindex komplett neu auf. Wird heute nirgends gebraucht -
/// aber sobald jemand VACUUM einbaut oder Notizen an den Triggern vorbei
/// schreibt, ist das der Weg zurueck zu einem stimmigen Index.
pub fn rebuild_index(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "DELETE FROM notes_fts;
         INSERT INTO notes_fts (rowid, content, note_id)
             SELECT rowid, content, id FROM notes;",
    )?;
    Ok(())
}

/// Alle aktiven Notizen ohne Filter und Limit - Grundlage für Sicherungen.
pub fn list_all(conn: &Connection) -> AppResult<Vec<Note>> {
    let sql =
        format!("SELECT {COLUMNS} FROM notes WHERE deleted_at IS NULL ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql)?;
    let mut result = Vec::new();
    for row in stmt.query_map([], map)? {
        result.push(row?);
    }
    attach_labels(conn, &mut result)?;
    Ok(result)
}

pub fn set_analysis_status(conn: &Connection, id: &str, status: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE notes SET analyzed_at = ?2, last_analysis_status = ?3 WHERE id = ?1",
        params![id, now_utc(), status],
    )?;
    Ok(())
}

fn attach_labels(conn: &Connection, notes: &mut [Note]) -> AppResult<()> {
    let mut assignments = labels::by_note(conn)?;
    for note in notes.iter_mut() {
        note.labels = assignments.remove(&note.id).unwrap_or_default();
    }
    Ok(())
}

/// Woerter, die nichts eingrenzen. Bewusst kurz gehalten: jedes Wort, das
/// hier steht, kann auch nicht mehr gesucht werden. Drin sind Fragewoerter,
/// Hilfsverben, Artikel und Praepositionen - also genau das, was eine
/// Frage wie "wo habe ich mein Auto geparkt" von "auto geparkt" trennt.
const STOPWORDS: &[&str] = &[
    // Fragewoerter
    "wo", "was", "wann", "wer", "wie", "warum", "wieso", "weshalb", "wohin", "woher", "welche",
    "welcher", "welches", "welchem", "welchen",
    // Hilfs- und Modalverben
    "ist", "sind", "war", "waren", "bin", "bist", "hab", "habe", "hast", "hat", "haben", "hatte",
    "hatten", "wird", "werde", "wirst", "werden", "wurde", "wurden", "kann", "kannst", "konnen",
    "konnte", "soll", "sollte", "muss", "mussen", "musste", "will", "wollte",
    // Pronomen
    "ich", "du", "er", "sie", "es", "wir", "ihr", "mich", "mir", "dich", "dir", "mein", "meine",
    "meinen", "meinem", "meiner", "meines", "dein", "deine", "sein", "seine", "unser", "unsere",
    // Artikel und Bindewoerter
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
    "und", "oder", "aber", "denn", "dass", "damit", "weil", "wenn", "als",
    // Praepositionen und Fuellwoerter
    "nicht", "kein", "keine", "fur", "mit", "von", "vom", "zum", "zur", "beim", "ins", "aufs",
    "in", "im", "an", "am", "auf", "aus", "bei", "nach", "uber", "unter", "vor", "durch", "um",
    "zu", "da", "dann", "noch", "schon", "nur", "auch", "mal", "wieder", "etwa", "sehr",
    // Englisch, knapp
    "the", "a", "an", "is", "are", "was", "were", "where", "what", "when", "who", "how", "why",
    "my", "i", "did", "do", "does", "of", "on", "at", "to", "it", "that", "this",
];

/// Wie viele Suchbegriffe hoechstens in eine Abfrage gehen. Mehr wuerde die
/// Gewichtung nicht besser machen, nur die Abfrage langsamer.
const MAX_TERMS: usize = 12;

/// Uebersetzt eine Eingabe in einen FTS5-Ausdruck.
///
/// Eine Frage ist keine Suchanfrage. "Wo habe ich mein Auto geparkt" mit
/// UND-Verknuepfung findet nichts, weil in keiner Notiz alle diese Woerter
/// stehen. Darum: Fuellwoerter raus, der Rest ODER-verknuepft und als
/// Praefix. Die Gewichtung (bm25) sortiert die Notiz nach oben, in der die
/// meisten und seltensten Begriffe vorkommen.
///
/// Rueckgabe `None` heisst: aus der Eingabe bleibt nichts uebrig, was sich
/// suchen liesse. Der Aufrufer faellt dann auf die einfache Suche zurueck.
pub fn fts_query(input: &str) -> Option<String> {
    let mut terms: Vec<String> = Vec::new();

    for raw in input.split(|c: char| !c.is_alphanumeric()) {
        if terms.len() >= MAX_TERMS {
            break;
        }
        let word = raw.to_lowercase();
        if word.chars().count() < 2 {
            continue;
        }
        // Der Vergleich laeuft gegen die umlautfreie Form, damit "für" und
        // "fuer" beide als Fuellwort erkannt werden - so wie der Tokenizer
        // der Datenbank es auch tut.
        if STOPWORDS.contains(&fold(&word).as_str()) {
            continue;
        }
        if terms.iter().any(|existing| existing == &word) {
            continue;
        }
        terms.push(word);
    }

    if terms.is_empty() {
        return None;
    }

    // Die Begriffe bestehen nur aus Buchstaben und Ziffern - in den
    // Anfuehrungszeichen kann nichts stehen, was den Ausdruck aufbricht.
    Some(
        terms
            .iter()
            .map(|term| format!("\"{term}\"*"))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

/// Umlaute und Akzente auf ihre Grundform. Entspricht dem, was der
/// Tokenizer der Datenbank mit `remove_diacritics 2` macht.
fn fold(word: &str) -> String {
    word.chars()
        .map(|c| match c {
            'ä' | 'à' | 'á' | 'â' => 'a',
            'ö' | 'ò' | 'ó' | 'ô' => 'o',
            'ü' | 'ù' | 'ú' | 'û' => 'u',
            'ë' | 'è' | 'é' | 'ê' => 'e',
            'ï' | 'ì' | 'í' | 'î' => 'i',
            other => other,
        })
        .collect()
}

fn escape_like(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{folders, labels, Db};

    fn filter() -> NoteFilter {
        NoteFilter::default()
    }

    #[test]
    fn create_update_search_delete() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = create(conn, "Morgen Mittag Datenbankmigration", None)?;
            assert!(note.folder_id.is_none());

            let updated = update_content(conn, &note.id, "Neuer Text")?;
            assert_eq!(updated.content, "Neuer Text");

            let mut search_filter = filter();
            search_filter.search = Some("Neuer".into());
            assert_eq!(list(conn, &search_filter, 50)?.len(), 1);

            soft_delete(conn, &note.id)?;
            assert_eq!(list(conn, &filter(), 50)?.len(), 0);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn deleted_notes_land_in_the_trash_and_come_back() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = create(conn, "Versehen", None)?;
            soft_delete(conn, &note.id)?;

            assert!(list(conn, &filter(), 50)?.is_empty());
            assert_eq!(list_deleted(conn, 50)?.len(), 1);

            let restored = restore(conn, &note.id)?;
            assert!(restored.deleted_at.is_none());
            assert_eq!(list(conn, &filter(), 50)?.len(), 1);
            assert!(list_deleted(conn, 50)?.is_empty());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn deleting_twice_is_rejected() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = create(conn, "Inhalt", None)?;
            soft_delete(conn, &note.id)?;
            assert!(soft_delete(conn, &note.id).is_err());
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn expired_trash_is_purged() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let fresh = create(conn, "frisch", None)?;
            let old = create(conn, "alt", None)?;
            soft_delete(conn, &fresh.id)?;
            conn.execute(
                "UPDATE notes SET deleted_at = '2020-01-01T00:00:00Z' WHERE id = ?1",
                params![old.id],
            )?;

            assert_eq!(purge_expired(conn, 30)?, 1);
            assert_eq!(list_deleted(conn, 50)?.len(), 1);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn backups_and_search_ignore_the_trash() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let visible = create(conn, "sichtbare Migration", None)?;
            let hidden = create(conn, "geloeschte Migration", None)?;
            soft_delete(conn, &hidden.id)?;

            assert_eq!(list_all(conn)?.len(), 1);
            let found = search(conn, "Migration", 20)?;
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].id, visible.id);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn like_wildcards_are_escaped() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "echter text", None)?;
            let mut search_filter = filter();
            search_filter.search = Some("%".into());
            assert_eq!(list(conn, &search_filter, 50)?.len(), 0);
            assert_eq!(search(conn, "%", 20)?.len(), 0);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn filters_by_folder() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let arbeit = folders::create(conn, "Arbeit")?;
            create(conn, "mit Ordner", Some(&arbeit.id))?;
            create(conn, "ohne Ordner", None)?;

            let mut in_folder = filter();
            in_folder.folder = FolderFilter::Id(arbeit.id.clone());
            assert_eq!(list(conn, &in_folder, 50)?.len(), 1);

            let mut unfiled = filter();
            unfiled.folder = FolderFilter::Unfiled;
            assert_eq!(list(conn, &unfiled, 50)?.len(), 1);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn filters_by_all_selected_labels() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let privat = labels::create(conn, "Privat", "blue")?;
            let dringend = labels::create(conn, "Dringend", "red")?;

            let both = create(conn, "beide", None)?;
            let one = create(conn, "nur eins", None)?;
            create(conn, "keins", None)?;

            labels::set_for_note(conn, &both.id, &[privat.id.clone(), dringend.id.clone()])?;
            labels::set_for_note(conn, &one.id, &[privat.id.clone()])?;

            let mut single = filter();
            single.label_ids = vec![privat.id.clone()];
            assert_eq!(list(conn, &single, 50)?.len(), 2);

            let mut combined = filter();
            combined.label_ids = vec![privat.id, dringend.id];
            let found = list(conn, &combined, 50)?;
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].content, "beide");
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn deleting_a_folder_keeps_its_notes() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let arbeit = folders::create(conn, "Arbeit")?;
            let note = create(conn, "bleibt", Some(&arbeit.id))?;

            folders::delete(conn, &arbeit.id)?;

            let reloaded = get(conn, &note.id)?;
            assert_eq!(reloaded.content, "bleibt");
            assert!(reloaded.folder_id.is_none());
            Ok(())
        })
        .expect("operations");
    }

    /// Der eigentliche Punkt der Frage-Funktion: eine ganze Frage muss die
    /// Notiz finden, in der nur zwei der Woerter vorkommen.
    #[test]
    fn a_whole_question_finds_the_note() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "Auto steht im Parkhaus P3, Ebene 2", None)?;
            create(conn, "Einkaufsliste: Brot, Milch, Kaffee", None)?;

            let hits = search(conn, "wo habe ich mein Auto geparkt?", 10)?;
            assert_eq!(hits.len(), 1, "nur die Autonotiz passt");
            assert!(hits[0].content.starts_with("Auto steht"));
            Ok(())
        })
        .expect("operations");
    }

    /// Mehr Treffer sind schlechter als richtig sortierte Treffer.
    #[test]
    fn the_better_match_comes_first() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "Kaffee kaufen", None)?;
            create(conn, "Kaffeemaschine entkalken und Kaffee nachfuellen", None)?;

            let hits = search(conn, "Kaffeemaschine entkalken", 10)?;
            assert!(hits.len() >= 1);
            assert!(
                hits[0].content.starts_with("Kaffeemaschine"),
                "erwartet die Notiz mit beiden Begriffen, war: {}",
                hits[0].content
            );
            Ok(())
        })
        .expect("operations");
    }

    /// Wortteile findet der Index nicht - dafuer gibt es den Rueckfall auf
    /// die einfache Suche. Ohne ihn waere die Suche nach "park" leer,
    /// obwohl "Parkhaus" dasteht.
    #[test]
    fn a_word_fragment_still_finds_the_note() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "Auto steht im Parkhaus", None)?;
            assert_eq!(search_ranked(conn, "arkhaus", 10)?.len(), 0, "Index kennt keine Wortmitte");
            assert_eq!(search(conn, "arkhaus", 10)?.len(), 1, "der Rueckfall findet sie");
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn the_trash_stays_out_of_the_full_text_search() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = create(conn, "Geheimnis im Parkhaus", None)?;
            assert_eq!(search(conn, "Parkhaus", 10)?.len(), 1);

            soft_delete(conn, &note.id)?;
            assert_eq!(search(conn, "Parkhaus", 10)?.len(), 0, "Papierkorb bleibt draussen");

            restore(conn, &note.id)?;
            assert_eq!(search(conn, "Parkhaus", 10)?.len(), 1, "und kommt zurueck");
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn an_edited_note_is_found_under_its_new_text() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            let note = create(conn, "Velo im Keller", None)?;
            update_content(conn, &note.id, "Velo beim Bahnhof")?;

            assert_eq!(search(conn, "Keller", 10)?.len(), 0, "alter Text ist weg");
            assert_eq!(search(conn, "Bahnhof", 10)?.len(), 1, "neuer Text zaehlt");
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn rebuilding_the_index_restores_it() {
        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "Auto im Parkhaus", None)?;
            conn.execute_batch("DELETE FROM notes_fts")?;
            assert_eq!(search_ranked(conn, "Parkhaus", 10)?.len(), 0);

            rebuild_index(conn)?;
            assert_eq!(search_ranked(conn, "Parkhaus", 10)?.len(), 1);
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn a_question_becomes_an_or_query_without_filler() {
        let query = fts_query("Wo habe ich mein Auto geparkt?").expect("Ausdruck");
        assert_eq!(query, "\"auto\"* OR \"geparkt\"*");
    }

    #[test]
    fn filler_only_input_yields_no_query() {
        assert!(fts_query("wo ist das denn").is_none());
        assert!(fts_query("???").is_none());
        assert!(fts_query("").is_none());
    }

    /// Anfuehrungszeichen und Operatoren duerfen den Ausdruck nicht
    /// aufbrechen - sonst waere jede Suche ein Syntaxfehler.
    ///
    /// Das Mittel dafuer ist nicht die Fuellwortliste, sondern das
    /// Anfuehrungszeichen um jeden Begriff: `AND`, `OR` und `NEAR` kommen als
    /// gewoehnliche Suchbegriffe heraus, nicht als Syntax. Genau das wird hier
    /// festgehalten - wer die Fuellwortliste spaeter aendert, soll diesen Test
    /// nicht versehentlich entwerten.
    #[test]
    fn operators_become_ordinary_search_terms() {
        let query = fts_query("\"Miete\" AND (Januar OR NEAR)").expect("Ausdruck");
        assert_eq!(
            query,
            "\"miete\"* OR \"and\"* OR \"januar\"* OR \"or\"* OR \"near\"*",
            "jeder Begriff steht in Anfuehrungszeichen, auch die Operatoren"
        );

        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "Miete Januar ueberwiesen", None)?;
            // Waere auch nur eines der Schluesselwoerter als Syntax
            // durchgegangen, gaebe es hier einen Fehler statt eines Treffers.
            assert_eq!(search(conn, "\"Miete\" AND (Januar OR NEAR)", 10)?.len(), 1);
            Ok(())
        })
        .expect("operations");
    }

    /// Ein Stern im Suchtext ist in FTS5 ein Praefix-Operator. Kommt er
    /// ungefiltert durch, steht am Ende `""*` da - und das ist ein
    /// Syntaxfehler, kein leeres Ergebnis.
    #[test]
    fn stray_wildcards_and_quotes_are_stripped() {
        assert_eq!(fts_query("Miete*").expect("Ausdruck"), "\"miete\"*");
        assert_eq!(fts_query("^Miete").expect("Ausdruck"), "\"miete\"*");
        assert!(fts_query("*").is_none(), "nichts Suchbares uebrig");

        let db = Db::open_in_memory().expect("db");
        db.with(|conn| {
            create(conn, "Miete Januar ueberwiesen", None)?;
            assert_eq!(search(conn, "Miete*", 10)?.len(), 1);
            assert_eq!(search(conn, "\"\"\"", 10)?.len(), 0, "kein Absturz, nur kein Treffer");
            Ok(())
        })
        .expect("operations");
    }

    #[test]
    fn duplicates_and_overlong_input_are_capped() {
        let query = fts_query("Auto auto AUTO").expect("Ausdruck");
        assert_eq!(query, "\"auto\"*");

        let many = (0..40).map(|i| format!("wort{i}")).collect::<Vec<_>>().join(" ");
        let query = fts_query(&many).expect("Ausdruck");
        assert_eq!(query.matches(" OR ").count(), MAX_TERMS - 1);
    }
}
