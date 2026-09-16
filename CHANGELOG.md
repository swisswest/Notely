# Changelog

Alle nennenswerten Änderungen an Notely. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionierung an
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Geplant

- Code-Signing gegen die SmartScreen-Warnung
- Wochenansicht mit Tageszeiten
- Volltextsuche über SQLite FTS5
- Getrennte Profile für Privat und Arbeit

## [0.7.1] - 2026-09-16

### Geändert

- Der Datenordner heisst jetzt `%APPDATA%\Notely` statt `%APPDATA%\ch.westcon.notely`,
  die Logdatei liegt unter `%LOCALAPPDATA%\Notely\logs`. Ein vorhandener
  Bestand zieht beim ersten Start automatisch mit um, samt der beiden
  SQLite-Begleitdateien. Scheitert der Umzug, bleibt alles am alten Ort und die
  App läuft dort weiter - ein halb verschobener Datenbestand wäre schlimmer als
  ein hässlicher Ordnername.
- Der Eintrag im Windows Credential Manager heisst „Notely". Ein bestehender
  Key wird beim ersten Zugriff übernommen; neu eingeben muss man nichts.

### Hinweis

- Der technische Bezeichner bleibt `ch.westcon.notely`. An ihm hängen der
  Updater, die AUMID der Benachrichtigungen und die Zuordnung des Installers.
  Ihn zu ändern hiesse: keine Updates mehr für bestehende Installationen.

## [0.7.0] - 2026-09-16

### Hinzugefügt

- **Autosave und Verlauf**: Notizen speichern sich nach kurzer Ruhezeit von
  selbst, der Zustand steht in der Fusszeile. Jede Änderung legt den alten Text
  ab; die letzten 20 Fassungen lassen sich ansehen und zurückholen.
- **Priorität und Labels für Aufgaben**: drei Stufen, dazu dieselben Labels wie
  bei Notizen. Bei gleichem Termin steht das Wichtigere oben. Filter für „nur
  wichtige" und nach Labels.
- **Ursprungsnotiz öffnen**: Aufgaben aus einer Analyse führen zurück zu der
  Notiz, aus der sie entstanden sind - aus der Liste und aus dem Dialog.
- **Smart Inbox**: zeigt Notizen, die nie analysiert wurden oder bei denen die
  Analyse scheiterte, und kann bis zu 25 davon in einem Durchgang nachholen.
  Offene Bestätigungen kommen nacheinander statt alle auf einmal.
- **Verständlicher Wiederholungs-Editor**: Wochentage zum Anklicken statt
  `weekly:1:mo,we`, Auswahl für den Monatsletzten und eine Vorschau der nächsten
  fünf Termine. Die Vorschau rechnet das Backend - dieselbe Stelle, die später
  auch die Folgeaufgaben anlegt.
- **Sicherung prüfen**: liest eine Sicherungsdatei, zeigt Inhalt und SHA-256,
  ohne etwas zu verändern.
- **Native Ordnerauswahl** für Sicherungsordner und Markdown-Import.
- **Version überspringen**: ein Update, das nicht gewollt ist, meldet sich nicht
  mehr beim Start. Eine neuere Version schon wieder.

### Geändert

- Durchgängig deutsche Bezeichnungen: „Aufgaben" statt „Tasks",
  „Einstellungen" statt „Settings".
- Die Notizsuche lädt erst nach einer kurzen Pause statt bei jedem Tastendruck.
- Leere Ansichten bieten konkrete nächste Schritte statt nur eines Hinweises.
- Serien vererben ihre Labels an die Folgeaufgabe.

### Sicherheit

- Unveränderter Notiztext erzeugt weder eine Version noch ein neues
  Änderungsdatum - Autosave kann die Historie nicht zumüllen.
- Die Sammelanalyse ist auf 25 Notizen je Durchgang begrenzt; jede Notiz ist ein
  bezahlter API-Aufruf.

## [0.6.0] - 2026-09-15

### Hinzugefügt

- **Automatische Updates**: Notely sieht beim Start nach einer neueren Version
  und installiert sie auf Wunsch selbst. Jedes Update wird vor der Installation
  gegen einen eingebauten Schlüssel geprüft; ein unsigniertes Archiv wird
  abgelehnt. Der Hinweis erscheint pro Version genau einmal.
- **Wiederkehrende Aufgaben**: täglich, werktags, wöchentlich an bestimmten
  Tagen, alle zwei Wochen, monatlich, am letzten Tag im Monat, jährlich — mit
  optionalem Enddatum. Abhaken erzeugt sofort den nächsten Termin.
- **Analysequalität**: Notely hält lokal fest, welche Vorschläge unverändert
  übernommen, korrigiert oder verworfen wurden, und zeigt in den Einstellungen
  Trefferquote und die jüngsten Fehlgriffe. Abschaltbar, verlässt das Gerät nie.

### Geändert

- Der Vorschlagsdialog übergibt jetzt Entscheidungen statt einer Auswahl. Das
  Urteil (übernommen/korrigiert/verworfen) leitet das Backend aus dem Vergleich
  ab — das Frontend kann es nicht behaupten.
- Die Serie läuft auch beim Abhaken mehrerer Aufgaben auf einmal weiter.

### Sicherheit

- Der private Signaturschlüssel liegt ausschliesslich als GitHub-Secret vor.
  Ohne ihn bricht der Release-Build ab, statt ein nicht verifizierbares Update
  zu veröffentlichen.

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

[Unveröffentlicht]: https://github.com/swisswest/Notely/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/swisswest/Notely/releases/tag/v0.5.0
[0.4.0]: https://github.com/swisswest/Notely/releases/tag/v0.4.0
[0.3.0]: https://github.com/swisswest/Notely/releases/tag/v0.3.0
[0.2.0]: https://github.com/swisswest/Notely/releases/tag/v0.2.0
[0.1.2]: https://github.com/swisswest/Notely/releases/tag/v0.1.2
[0.1.1]: https://github.com/swisswest/Notely/releases/tag/v0.1.1
[0.1.0]: https://github.com/swisswest/Notely/releases/tag/v0.1.0
