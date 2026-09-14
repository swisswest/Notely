# Notely

Notizen, Aufgaben und Claude-Analyse als native Windows-11-Desktop-App.
Freier Notiztext geht an Claude, zurück kommen strukturierte Aufgaben mit Datum und Uhrzeit -
aufgelöst gegen die Tageszeiten, die in den Einstellungen definiert sind.

## Stack und wichtige Entscheidungen

| Thema | Entscheidung | Begruendung |
| --- | --- | --- |
| Framework | Tauri 2 (WebView2) statt Electron | ~10x kleinerer RAM-Fussabdruck, Start in Millisekunden, natives Tray/Autostart, kein mitgeliefertes Chromium |
| Frontend | React 19 + TypeScript strict + Vite | Bekannt, typsicher, schneller Build; kein UI-Framework, dadurch volle Kontrolle über das Design |
| Datenbank | SQLite via `rusqlite` (bundled), Zugriff nur in Rust | Kein `tauri-plugin-sql`: der wuerde SQL aus dem WebView erlauben und damit eine Injection-Flaeche öffnen. Das Frontend kennt nur typisierte Commands |
| Migrationen | eigener Runner über `PRAGMA user_version` | Kein zusätzliches Statusfile, transaktional, idempotent |
| API-Key | Windows Credential Manager (`keyring`) | Nie im Sourcecode, nie in der Datenbank, nie im Log, nie im Frontend |
| Claude-Aufruf | ausschliesslich aus Rust, Structured Output über Tool-Schema | Der Key verlässt den Rust-Prozess nicht; Freitext des Modells wird ignoriert |
| Zeitaufloesung | Modell liefert Datum + Tageszeit-**Schlüssel**, die App setzt die Uhrzeit | Deterministisch und testbar. Aendert sich "Abend" auf 18:30, gilt das sofort - ohne erneute Analyse und ohne dass das Modell rechnen muss |
| State im Frontend | `useSyncExternalStore` statt Redux/Zustand | Eine Abhaengigkeit weniger, ~60 Zeilen, vollständig typisiert |

## Projektstruktur

```
src/                     React-Frontend
  components/            wiederverwendbare Bausteine (ui, TaskRow, Sidebar, Palette)
  features/              fachliche Ansichten (today, inbox, tasks, notes, settings, onboarding)
  hooks/                 useTheme, useHotkeys
  lib/                   ipc.ts (typisierte Commands + Fehlerabbildung), store.ts
  utils/                 date.ts (+ Tests)
src-tauri/src/
  ai/                    Claude-Client, Prompt, JSON-Schema, Validierung der AI-Ausgabe
  commands/              Tauri-Commands (notes, tasks, settings, ai, system)
  db/                    Verbindung, Migrationen, Repositories, Modelle
  domain/                Settings, Zeitlogik, Scheduling, Eingabevalidierung
  notifications/         Scheduler, Dedupe, Texte
  backup/                Export, Import, Markdown, automatische Sicherung
  quick.rs               Schnellerfassungsfenster und globales Kuerzel
  security/              Zugriff auf den Windows Credential Manager
  startup.rs tray.rs window.rs logging.rs error.rs state.rs
```

## Voraussetzungen

- Windows 11
- Node.js 20+
- Rust (stable) via [rustup](https://rustup.rs) inkl. MSVC-Toolchain
- Visual Studio Build Tools mit "Desktop development with C++"
- WebView2 Runtime (auf Windows 11 vorinstalliert)

## Entwickeln

```powershell
npm install
npm run tauri:dev
```

## Tests

```powershell
npm test                       # Frontend: Datumslogik, Gruppierung, Sortierung
cd src-tauri; cargo test       # Rust: Tageszeiten, AI-Validierung, Scheduling, Dedupe, Migrationen, Repositories
```

Abgedeckt sind unter anderem die geforderten Faelle:
`10.09.2026 09:36` + "Morgen Mittag" -> `2026-09-11 12:00`, und "heute Abend" mit
Evening = `18:30` -> `2026-09-10 18:30`.

## Build (Installer)

Der schnellste Weg - prueft Voraussetzungen, läuft durch Tests und baut:

```powershell
cd C:\Users\west\projects\privat\notely
.\build.ps1                 # nur prüfen und bauen
.\build.ps1 -SkipChecks     # Pruefung ueberspringen
.\build.ps1 -InstallMissing # fehlendes Rust / MSVC vorher automatisch installieren
```

Manuell:

```powershell
npm install
npm run tauri:build
```

Ergebnisse:

- `src-tauri\target\release\bundle\nsis\Notely_0.5.0_x64-setup.exe` - Installer, Installation im
  Benutzerprofil, keine Adminrechte nötig. **Empfohlen**, weil erst die Startmenue-Verknuepfung die
  AUMID liefert, über die Windows-Toasts zuverlaessig laufen.
- `src-tauri\target\release\notely.exe` - portable EXE, läuft direkt, Benachrichtigungen koennen
  ohne Installation unzuverlaessig sein.

## Erste Schritte in der App

1. Beim ersten Start fragt Notely, ob die App mit Windows starten soll.
2. Unter **Settings -> Claude** den API-Key eintragen (`sk-ant-...`) und "Verbindung testen".
3. Unter **Settings -> Tageszeiten** die Uhrzeiten anpassen.
4. Unter **Notizen** frei schreiben, dann "Mit Claude analysieren".

## Tastatur

| Kuerzel | Aktion |
| --- | --- |
| `Strg+K` | Befehlspalette |
| `Strg+N` | Neue Notiz |
| `Strg+T` | Neuer Task |
| `Strg+1..4` | Heute / Inbox / Tasks / Notizen |
| `Strg+,` | Einstellungen |
| `Strg+S` | Notiz speichern (im Editor) |
| `Esc` | Dialog schliessen |
| `Ctrl+Alt+N` | Schnellerfassung (systemweit, konfigurierbar) |

## Sicherung und Schnellerfassung

**Sicherung** (Settings -> Sicherung): schreibt Notizen, Tasks, Ordner und Labels als JSON in
`Dokumente\\Notely Backups` (Ordner frei wählbar). Beim Start passiert das automatisch, höchstens
einmal pro Tag; ältere Dateien werden nach der eingestellten Anzahl entfernt. „Wiederherstellen"
ergänzt fehlende Einträge anhand ihrer IDs - bestehende Daten werden nie überschrieben oder
gelöscht, ein doppelter Import ändert nichts. Zusätzlich gibt es einen Markdown-Export zum Lesen.

**Schnellerfassung**: `Ctrl+Alt+N` (konfigurierbar) öffnet ein rahmenloses Fenster über allen
anderen. Text eintippen, Enter - die Notiz wird gespeichert und, wenn ein API-Key hinterlegt ist,
direkt analysiert. Braucht ein Vorschlag Bestätigung, öffnet sich das Hauptfenster mit dem Dialog.
Die Notiz ist immer gespeichert, bevor die Analyse startet.

## Tagesabschluss und Import

**Tagesabschluss**: ab der eingestellten Uhrzeit (Standard 18:00) meldet Notely, was heute offen
geblieben ist. Der Dialog kennt zwei Aktionen - abhaken oder auf morgen schieben - und lässt sich
jederzeit über Strg+K öffnen. Einmal pro Tag, danach erst wieder am nächsten.

**Markdown-Import** (Settings -> Sicherung): liest `.md`, `.markdown` und `.txt` aus einem Ordner
als Notizen ein, nicht rekursiv. Inhalte, die bereits als Notiz existieren, werden übersprungen -
ein zweiter Durchlauf ändert nichts. Optional landen alle importierten Notizen in einem Ordner.

## Sicherheit

- API-Key ausschliesslich im Windows Credential Manager, im UI nur maskiert (`sk-ant...9f2c`).
- Logs werden vor dem Schreiben gefiltert: alles was mit `sk-` beginnt wird ersetzt.
- Jede Claude-Antwort gilt als nicht vertrauenswürdig: Struktur, Datum, Uhrzeit, Tageszeit-Schlüssel,
  Confidence und Textlaenge werden geprüft, Steuerzeichen entfernt, Duplikate verworfen.
  Ungültige Vorschläge landen im Log und im Dialog unter "Verworfen", nie in der Datenbank.
- Claude schreibt nie direkt in die Datenbank - der Weg ist immer
  `Notiz -> API -> Validierung -> (optional Bestätigung) -> Task`.
- Alle SQL-Zugriffe nutzen Parameter-Binding, auch die Volltextsuche (`LIKE` mit escapten Wildcards).
- CSP erlaubt nur eigene Ressourcen und IPC, keine externen Skripte, kein Asset-Protokoll.
- Capabilities enthalten nur die tatsaechlich benoetigten Fensterrechte; Notifications,
  Autostart und Datenbank laufen ausschliesslich über eigene Rust-Commands.
- Keine Shell-Ausfuehrung, kein freier Dateisystemzugriff.

## Fehlerverhalten

| Fall | Verhalten |
| --- | --- |
| Kein Internet / API nicht erreichbar | Notiz bleibt gespeichert, Hinweis im UI, Analyse jederzeit wiederholbar |
| Ungültiger Key / Rate Limit | Eigene Meldung inkl. Wartezeit, keine Datenaenderung |
| Ungültiges JSON oder abgeschnittene Antwort | Analyse gilt als fehlgeschlagen, Notiz unverändert |
| Keine Aufgabe erkannt | Hinweis "keine konkrete Aufgabe erkannt", kein Task |
| Datum in der Vergangenheit | Vorschlag wird markiert und standardmaessig **nicht** angehakt |
| Datenbankfehler | Fehlermeldung im UI, Log-Eintrag, App läuft weiter |
| Benachrichtigung abgelehnt | Hinweis im UI mit Verweis auf die Windows-Einstellungen |

## Benachrichtigungen

Der Scheduler läuft alle 30 Sekunden in Rust. Für jeden offenen Task mit Termin werden die
faelligen Slots berechnet (Vorlaufzeiten, Fälligkeit, Überfällig-Intervall) und über
`INSERT OR IGNORE` in `notification_history` reserviert - der UNIQUE-Index
`(task_id, kind, fire_at)` macht Doppel-Benachrichtigungen technisch unmoeglich, auch nach
einem Neustart. Verpasste Erinnerungen werden nur innerhalb von 10 Minuten nachgeholt, damit nach
laengerer Abwesenheit keine Toast-Welle entsteht.

**Aktionsbuttons im Toast** (Erledigt / Oeffnen / Später) sind bewusst nicht umgesetzt: unter
Windows brauchen sie eine registrierte AUMID plus COM-Activator, funktionieren nur im
installierten Zustand und fallen bei jedem Update auseinander. Stattdessen: Snooze direkt in der
Liste (Standardwert konfigurierbar), Tray-Menue und `Strg+K`.

## Bekannte Stellschrauben

- `app.trayIcon.showMenuOnLeftClick` in `src-tauri/tauri.conf.json` heisst in Tauri-Versionen
  vor 2.2 `menuOnLeftClick`. Falls der Build die Konfiguration ablaehnt: Schlüssel umbenennen
  oder entfernen.
- Modell-Vorgabe ist `claude-sonnet-4-5`; die tatsaechlich verfügbaren IDs laedt die
  Settings-Seite über "Modelle laden" direkt vom Account, damit nichts veraltet.
