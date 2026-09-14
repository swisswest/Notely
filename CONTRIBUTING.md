# Mitarbeiten

Notely ist ein persönliches Projekt, aber Fehlerberichte, Ideen und Pull
Requests sind willkommen.

## Umgebung einrichten

Nötig sind Windows 11, Node.js 20+, Rust (stable, MSVC-Toolchain) und die
Visual Studio Build Tools mit „Desktop development with C++".

```powershell
npm install
npm run tauri:dev
```

`.\build.ps1 -InstallMissing` installiert fehlendes Rust und die Build Tools
automatisch nach.

## Vor jedem Commit

```powershell
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run typecheck` ist nicht optional: Vitest transpiliert nur und prüft keine
Typen. Ein Fehler, den kein Test zeigt, fällt erst hier auf.

Optional, aber gern gesehen:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --all
```

Die CI meldet Formatierung und Clippy-Hinweise in einem eigenen Job, der bewusst
nicht blockiert. Für das Frontend gilt `.editorconfig`.

## Wie der Code aussehen soll

- TypeScript strict, kein `any`, keine Magic Strings.
- Kleine Funktionen, kleine Komponenten. Wird eine Datei unübersichtlich, wird
  sie geteilt statt kommentiert.
- Kommentare erklären **warum**, nicht was. Selbsterklärender Code braucht keinen.
- Deutsche Texte in der Oberfläche, deutsche Kommentare, englische Bezeichner.
- Schweizer Schreibweise: `ss` statt `ß`.

## Drei Regeln, die nicht verhandelbar sind

1. **Keine Secrets** in Code, Logs, Tests oder Sicherungen. Der API-Key gehört in
   den Credential Manager, sonst nirgendwohin.
2. **Jede Claude-Ausgabe wird validiert**, bevor sie die Datenbank sieht. Neue
   Felder aus dem Modell brauchen eine Prüfung und einen Test mit kaputten Daten.
3. **Jede Schemaänderung braucht eine Migration und einen Upgrade-Test** — also
   einen Test, der ein altes Schema anlegt, migriert und prüft, dass die
   Bestandsdaten noch da sind. Siehe `db/migrations.rs`.

## Aufbau

Das Frontend spricht ausschliesslich über typisierte Commands in
`src/lib/ipc.ts` mit dem Backend; SQL bleibt in Rust. Fachliche Logik gehört in
`src-tauri/src/domain/` und ist dort ohne Datenbank testbar — Zeitauflösung,
Scheduling und Validierung liegen bewusst als reine Funktionen vor.

## Pull Requests

Ein PR pro Thema, Beschreibung in ganzen Sätzen, `CHANGELOG.md` ergänzt. Die CI
baut auf Windows und muss grün sein.
