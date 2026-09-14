# Changelog

Alle nennenswerten Änderungen an Notely. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionierung an
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Geplant

- Code-Signing gegen die SmartScreen-Warnung
- Automatische Updates über den Tauri-Updater
- Wiederkehrende Aufgaben
- Getrennte Profile für Privat und Arbeit

## [0.5.0] - 2026-09-14

### Hinzugefügt

- **Tagesabschluss**: ab einer einstellbaren Uhrzeit zeigt Notely, was heute
  offen geblieben ist — abhaken oder mit einem Klick auf morgen schieben.
  Erreichbar auch jederzeit über die Befehlspalette.
- **Markdown-Import**: liest `.md`, `.markdown` und `.txt` aus einem Ordner als
  Notizen ein. Dubletten werden erkannt, ein zweiter Durchlauf ändert nichts.

## [0.4.0] - 2026-09-14

### Hinzugefügt

- **Papierkorb**: Löschen markiert nur noch. Notizen und Aufgaben lassen sich
  wiederherstellen und verschwinden nach 30 Tagen automatisch.
- **Mehrfachauswahl** in der Aufgabenliste inkl. Strg- und Shift-Klick, dazu
  Massenaktionen: auf heute, auf morgen, Termin entfernen, erledigen, löschen.
- **Suche** über Notizen und Aufgaben direkt in der Befehlspalette.
- **Verbrauchsanzeige**: Analysen und Tokens für heute, den Monat und gesamt.

### Geändert

- Gelöschte Einträge tauchen nirgends mehr auf — auch nicht im Scheduler, in
  der Sicherung oder in der Suche.

## [0.3.0] - 2026-09-10

### Hinzugefügt

- **Automatische Sicherung** beim Start (höchstens einmal täglich) als JSON,
  mit Aufbewahrungsgrenze und additivem Wiederherstellen.
- **Markdown-Export** aller Notizen und offenen Aufgaben.
- **Schnellerfassung** über ein systemweites Kürzel in einem eigenen,
  rahmenlosen Fenster.

## [0.2.0] - 2026-09-10

### Hinzugefügt

- **Ordner** für Notizen (flach, eine Notiz gehört zu höchstens einem Ordner).
- **Labels** mit acht Farben, beliebig viele pro Notiz, UND-Filter.
- Filterleiste in der Notizansicht, Verwaltungsdialog für Ordner und Labels.

### Sicherheit

- Ordner oder Label zu löschen entfernt nie die zugehörigen Notizen.

## [0.1.2] - 2026-09-10

### Behoben

- „Verbindung testen" prüfte das gespeicherte statt des ausgewählten Modells.
- Die Toast-Meldung überdeckte die Speichern-Leiste in den Einstellungen.

## [0.1.1] - 2026-09-10

### Behoben

- Die Einstellungen liessen sich im kleinen Fenster nicht scrollen; die
  Speichern-Leiste bleibt jetzt am unteren Rand stehen.
- Das Modell liess sich nicht wechseln — die Auswahl ist jetzt ein Dropdown,
  das die Modelle des Accounts selbst lädt.
- Sämtliche Texte verwenden korrekte Umlaute.

### Geändert

- Mindestfenstergrösse auf 760×480 gesenkt.

## [0.1.0] - 2026-09-10

### Hinzugefügt

- Erste Fassung: Notizen, Aufgaben, Claude-Analyse mit Structured Output,
  konfigurierbare Tageszeiten, Windows-Benachrichtigungen mit Dublettenschutz,
  Tray-Icon, Autostart, Einstellungen, SQLite mit Migrationen.

[Unveröffentlicht]: https://github.com/DEIN-GITHUB-NAME/notely/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/DEIN-GITHUB-NAME/notely/releases/tag/v0.5.0
[0.4.0]: https://github.com/DEIN-GITHUB-NAME/notely/releases/tag/v0.4.0
[0.3.0]: https://github.com/DEIN-GITHUB-NAME/notely/releases/tag/v0.3.0
[0.2.0]: https://github.com/DEIN-GITHUB-NAME/notely/releases/tag/v0.2.0
[0.1.2]: https://github.com/DEIN-GITHUB-NAME/notely/releases/tag/v0.1.2
[0.1.1]: https://github.com/DEIN-GITHUB-NAME/notely/releases/tag/v0.1.1
[0.1.0]: https://github.com/DEIN-GITHUB-NAME/notely/releases/tag/v0.1.0
