## Was ändert sich?

<!-- Kurz und in ganzen Sätzen. Warum ist die Änderung nötig? -->

## Wie getestet?

<!-- Welche Tests, welcher manuelle Durchlauf? -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] Lokal gebaut und ausprobiert

## Checkliste

- [ ] Keine Secrets im Code, in Logs oder in Tests
- [ ] Neue Datenbankfelder haben eine Migration **und** einen Upgrade-Test
- [ ] Neue Claude-Ausgaben werden validiert, bevor sie in die Datenbank gehen
- [ ] `CHANGELOG.md` ergänzt
