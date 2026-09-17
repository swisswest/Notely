<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Notely" />

# Notely

**Notizen schreiben. Claude macht Aufgaben daraus.**

Eine native Windows-11-Desktop-App: freier Notiztext geht an die Claude API,
zurück kommen strukturierte Aufgaben mit Datum und Uhrzeit — aufgelöst gegen
deine eigenen Tageszeiten.

[![CI](https://github.com/swisswest/notely/actions/workflows/ci.yml/badge.svg)](https://github.com/swisswest/notely/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/swisswest/notely?include_prereleases&sort=semver)](https://github.com/swisswest/notely/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Platform-Windows%2011-0078d4)

</div>

---



<!-- ![Notely](docs/screenshot.png) -->

## Was die App macht

Du schreibst:

```
Morgen Mittag Datenbankmigration vorbereiten und am Abend Nico informieren.
```

Notely macht daraus zwei Aufgaben:

| Aufgabe | Fällig |
| --- | --- |
| Datenbankmigration vorbereiten | morgen, 12:00 |
| Nico informieren | morgen, 18:00 |

„Mittag" und „Abend" sind dabei **nicht** einprogrammiert. Du definierst sie in
den Einstellungen; änderst du „Abend" auf 18:30, gilt das ab der nächsten Analyse.

## Funktionen

- **Notizen** mit Ordnern, frei benennbaren Labels und Volltextsuche. Die
  ursprüngliche Notiz bleibt immer erhalten, auch wenn die Analyse fehlschlägt.
- **Aufgaben** mit Heute/Morgen/Diese Woche/Überfällig, Mehrfachauswahl und
  Massenaktionen (verschieben, erledigen, löschen).
- **Wochenansicht** (`Strg+5`): sieben Tagesspalten, innerhalb eines Tages nach
  deinen Tageszeiten gegliedert, dazu eine Spalte für alles ohne Termin.
  Verschieben per Ziehen oder komplett über die Tastatur.
- **Getrennte Profile** für Privat und Arbeit: eigene Datenbank je Profil, ein
  gemeinsamer API-Key. Der Wechsel startet die App neu, damit keine Abfrage je
  Daten des anderen Profils sieht.
- **Claude-Analyse** über Structured Output. Erkennt keine konkrete Handlung,
  entsteht auch keine Aufgabe.
- **Windows-Benachrichtigungen** mit konfigurierbaren Vorlaufzeiten, Snooze und
  garantiert ohne Dubletten.
- **Schnellerfassung** per systemweitem Kürzel (`Ctrl+Alt+N`): tippen, Enter, weg.
- **Tagesabschluss** am Abend: was offen blieb, abhaken oder auf morgen schieben.
- **Wiederkehrende Aufgaben**: täglich, werktags, an bestimmten Wochentagen,
  monatlich, am Monatsletzten, jährlich — mit optionalem Enddatum und Vorschau
  der nächsten Termine. Der nächste Termin entsteht beim Abhaken.
- **Autosave mit Verlauf**: Notizen speichern sich selbst, die letzten 20
  Fassungen bleiben abrufbar.
- **Priorität und Labels** für Aufgaben, samt Filtern.
- **Papierkorb** mit 30 Tagen Schonfrist und automatische tägliche Sicherung.
- **Automatische Updates**: signiert, prüfbar, auf Wunsch abschaltbar.
- **Tray, Autostart** und Start im Hintergrund.
- Dark und Light Mode, durchgehende Tastaturbedienung.

## Installation

Am einfachsten über den Windows-Paketmanager:

```powershell
winget install Westcon.Notely
```

winget lädt die Datei selbst herunter, sie trägt deshalb keine
Internet-Markierung — die SmartScreen-Abfrage entfällt vollständig.

Alternativ den Installer aus den [Releases](../../releases) laden und ausführen:
`Notely_x.y.z_x64-setup.exe`. Installation ins Benutzerprofil, keine Adminrechte.

> Windows zeigt beim ersten Start „unbekannter Herausgeber", weil die Datei nicht
> signiert ist → *Weitere Informationen* → *Trotzdem ausführen*. Sauberer:
> Rechtsklick auf die Datei → *Eigenschaften* → *Zulassen* → *Übernehmen*, dann
> erscheint die Abfrage gar nicht. Auf einem gesperrten Firmenrechner hilft die
> Seite [Firmenrechner & IT](https://swisswest.github.io/Notely/it/) weiter.
> Wie die Dateien entstehen: [CODE_SIGNING.md](CODE_SIGNING.md).

Für die Aufgabenerkennung wird ein eigener [Claude API-Key](https://console.anthropic.com)
benötigt. Ohne Key funktioniert alles ausser der Analyse.

## Schnellstart für Entwickler

**Voraussetzungen:** Windows 11, Node.js 20+, Rust (stable, MSVC), Visual Studio
Build Tools mit „Desktop development with C++".

```powershell
git clone https://github.com/swisswest/notely.git
cd notely
npm install
npm run tauri:dev
```

Bauen und testen in einem Schritt — prüft die Werkzeuge, lässt alle Tests laufen
und erzeugt den Installer:

```powershell
.\build.ps1                 # prüfen, testen, bauen
.\build.ps1 -SkipChecks     # Werkzeugprüfung überspringen
.\build.ps1 -InstallMissing # fehlendes Rust / MSVC automatisch installieren
```

Ergebnis liegt in `src-tauri/target/release/bundle/nsis/`.

## Tests

```powershell
npm test                                   # Frontend: Datumslogik, Gruppierung
cargo test --manifest-path src-tauri/Cargo.toml   # Rust: ~95 Tests
```

Abgedeckt sind unter anderem die Fälle, an denen solche Apps üblicherweise
scheitern: Zeitzonen und Monatsgrenzen, doppelte Benachrichtigungen nach
Neustart, kaputte AI-Antworten, Migrationen auf bestehenden Datenbanken und
der Papierkorb.

## Architektur

```
src/                    React-Frontend (TypeScript strict)
  components/           wiederverwendbare Bausteine
  features/             fachliche Ansichten (today, tasks, notes, review, …)
  lib/                  typisierte IPC-Schicht, Store
  utils/                Datumslogik (+ Tests)
src-tauri/src/
  ai/                   Claude-Client, Prompt, JSON-Schema, Validierung
  backup/               Export, Import, Markdown, automatische Sicherung
  commands/             Tauri-Commands – die einzige Brücke zum Frontend
  db/                   Verbindung, Migrationen, Repositories, Modelle
  domain/               Settings, Zeitlogik, Scheduling, Review, Validierung
  notifications/        Scheduler, Dedupe, Texte
  security/             Windows Credential Manager
```

### Entscheidungen, die das Projekt prägen

| Thema | Entscheidung | Warum |
| --- | --- | --- |
| Framework | Tauri 2 statt Electron | Deutlich kleinerer Speicherbedarf, Start in Millisekunden, native Windows-Integration, kein mitgeliefertes Chromium |
| Datenbank | SQLite via `rusqlite`, Zugriff nur in Rust | Kein `tauri-plugin-sql` — der würde SQL aus dem WebView erlauben. Das Frontend kennt ausschliesslich typisierte Commands |
| Migrationen | eigener Runner über `PRAGMA user_version` | Transaktional, idempotent, kein zusätzliches Statusfile |
| API-Key | Windows Credential Manager | Nie im Code, nie in der Datenbank, nie im Log, nie im Frontend |
| Zeitauflösung | Modell liefert Datum + Tageszeit-**Schlüssel**, die App setzt die Uhrzeit | Deterministisch und testbar; Änderungen an den Tageszeiten wirken sofort |
| Löschen | Soft Delete mit Papierkorb | Ein Restore, der überschreiben kann, ist im Panikmoment gefährlicher als das Problem |
| Frontend-State | `useSyncExternalStore` statt Redux | Eine Abhängigkeit weniger, rund 60 Zeilen, vollständig typisiert |
| Wiederholungen | eigene Kurzregel statt voller RFC-5545-RRULE | Deckt ab, was eine Aufgabenliste braucht, und passt in einen prüfbaren Parser mit Tests. Kein Rattenschwanz aus Sonderfällen |
| Serien | nächster Termin entsteht beim Abhaken | Keine 52 Zeilen pro Jahr in der Datenbank, kein unbrauchbarer Papierkorb |
| Updates | Tauri-Updater gegen GitHub Releases | Der Katalog liegt als Asset am Release; Entwürfe lösen nichts aus. Jedes Archiv ist signiert und wird vor der Installation geprüft |

## Sicherheit

- Der API-Key liegt im Windows Credential Manager und wird im UI nur maskiert angezeigt.
- Updates werden nur installiert, wenn die Signatur zum eingebauten öffentlichen
  Schlüssel passt. Der private Schlüssel liegt ausschliesslich als GitHub-Secret vor.
- Logs werden vor dem Schreiben gefiltert — alles, was mit `sk-` beginnt, wird ersetzt.
- **Jede Claude-Antwort gilt als nicht vertrauenswürdig.** Struktur, Datum, Uhrzeit,
  Tageszeit-Schlüssel, Confidence und Textlänge werden geprüft, Steuerzeichen entfernt,
  Duplikate verworfen. Claude schreibt nie direkt in die Datenbank.
- Alle SQL-Zugriffe nutzen Parameter-Binding, auch die Suche.
- CSP erlaubt nur eigene Ressourcen und IPC. Keine Shell-Ausführung, kein freier
  Dateisystemzugriff, nur die tatsächlich benötigten Tauri-Capabilities.

Details und Meldeweg: [SECURITY.md](SECURITY.md).

## Datenschutz

Notizen, Aufgaben und Einstellungen liegen ausschliesslich lokal in
`%APPDATA%\Notely\profiles\<profil>\notely.db` — pro Profil eine eigene
Datei. Bei einer Analyse wird der Text der jeweiligen Notiz an die
Anthropic-API übertragen — sonst verlässt nichts den Rechner.

## Tastatur

| Kürzel | Aktion |
| --- | --- |
| `Ctrl+Alt+N` | Schnellerfassung (systemweit) |
| `Strg+K` | Befehlspalette und Suche |
| `Strg+N` / `Strg+T` | Neue Notiz / neuer Task |
| `Strg+1…5` | Heute / Inbox / Tasks / Notizen / Woche |
| `Strg+S` | Notiz speichern |
| `Strg+,` | Einstellungen |
| `Esc` | Dialog schliessen |

## Roadmap

- [x] Automatische Updates über den Tauri-Updater
- [x] Wiederkehrende Aufgaben
- [x] Autosave und Versionsverlauf für Notizen
- [x] Priorität und Labels für Aufgaben
- [x] Wochenansicht mit Tageszeiten
- [ ] Volltextsuche über SQLite FTS5
- [ ] Code-Signing, damit die SmartScreen-Warnung verschwindet
- [x] Getrennte Profile für Privat und Arbeit

## Mitmachen

Siehe [CONTRIBUTING.md](CONTRIBUTING.md). Änderungen werden in
[CHANGELOG.md](CHANGELOG.md) festgehalten.

## Lizenz

[MIT](LICENSE)
