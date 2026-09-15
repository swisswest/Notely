# Notely Website

Statische Download-Seite, gehostet auf GitHub Pages. Keine Abhängigkeiten.

| Pfad | Inhalt |
| --- | --- |
| `/` | Startseite, Download-Button zeigt immer auf den neuesten stabilen Installer |
| `/versionen/` | Alle Versionen mit Installer, SHA-256 und Änderungen aus `CHANGELOG.md` |
| `/download/` | Permanenter Link – startet direkt den Download der neuesten Version |
| `/latest.json`, `/releases.json` | Maschinenlesbar, z. B. für Update-Prüfung oder winget |

## Wie "immer die neueste Version" funktioniert

1. `git tag v0.6.0 && git push origin v0.6.0` → `release.yml` baut den Installer und veröffentlicht das Release.
2. Am Ende stösst `release.yml` den Workflow `pages.yml` an → Website wird mit den Daten aus der GitHub-API neu gebaut.
3. Zusätzlich prüft der Browser die GitHub-API und übernimmt eine neuere Version, falls der Deploy noch läuft.
4. Tags mit Bindestrich (`v0.6.0-beta.1`) werden Vorabversionen: sichtbar unter Versionen, nie als "aktuell".

## Einmalige Einrichtung

- Repository muss **öffentlich** sein (Pages + Downloads für Besucher).
- *Settings → Pages → Source: GitHub Actions*.
- *Settings → Actions → General → Workflow permissions: Read and write*.

## Lokal bauen

```powershell
node website/build.mjs                 # holt Releases live von GitHub
npx serve website/dist                 # ansehen
```
