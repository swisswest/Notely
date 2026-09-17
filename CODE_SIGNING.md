# Code-Signing-Richtlinie

Diese Seite beschreibt, wie die veröffentlichten Notely-Installer entstehen, wer
sie freigeben darf und wie sich prüfen lässt, dass eine heruntergeladene Datei
echt ist.

## Stand heute

Die Installer sind **nicht Authenticode-signiert**. Windows meldet deshalb beim
ersten Start „Unbekannter Herausgeber". Das ist der einzige Grund für die
Meldung — sie sagt nichts über den Inhalt der Datei aus.

Was stattdessen für Nachvollziehbarkeit sorgt:

- **Jeder Installer wird von GitHub Actions gebaut**, nicht auf einem privaten
  Rechner. Der Build-Lauf, der Quellstand und das Protokoll sind für jede
  Version öffentlich einsehbar.
- **SHA-256 jeder Datei** steht auf der [Versionsseite](https://swisswest.github.io/Notely/versionen/)
  und maschinenlesbar in [releases.json](https://swisswest.github.io/Notely/releases.json).
- **Automatische Updates sind signiert.** Der Updater prüft jedes Update gegen
  einen minisign-Schlüssel und lehnt es ab, wenn die Signatur nicht passt. Der
  öffentliche Schlüssel liegt in `src-tauri/tauri.conf.json`, der private
  ausschliesslich als GitHub-Secret. Diese Signatur ist unabhängig von
  Authenticode und schützt den Update-Weg bereits heute.

Eine heruntergeladene Datei prüfst du so:

```powershell
Get-FileHash "$HOME\Downloads\Notely_x.y.z_x64-setup.exe" -Algorithm SHA256
```

Stimmt der Wert mit dem auf der Versionsseite überein, ist die Datei Byte für
Byte die, die GitHub Actions gebaut hat.

## Verantwortlichkeiten

Notely ist ein Ein-Personen-Projekt.

| Rolle | Person | Aufgabe |
| --- | --- | --- |
| Author | Alexander W. ([@swisswest](https://github.com/swisswest)) | Änderungen am Quellcode |
| Reviewer | Alexander W. ([@swisswest](https://github.com/swisswest)) | Prüfung der Änderungen vor dem Zusammenführen |
| Approver | Alexander W. ([@swisswest](https://github.com/swisswest)) | Freigabe einer Version zur Signatur |

Zugänge zu GitHub und zu allen Signaturschlüsseln sind mit
Zwei-Faktor-Authentifizierung geschützt. Veröffentlicht wird ausschliesslich
über einen Versions-Tag auf `main`; der Release-Workflow baut, testet und
signiert in einem Lauf.

## Was signiert wird

Nur Artefakte, die aus dem öffentlichen Quellcode dieses Repositories in der
Release-Pipeline entstehen. Es werden keine fremden Binärdateien signiert und
keine proprietären Komponenten mitgeliefert; verwendet werden ausschliesslich
System-Bibliotheken von Windows und die in `package.json` und `Cargo.toml`
deklarierten Open-Source-Abhängigkeiten.

## Datenschutz

Notely sendet keine Telemetrie und legt kein Benutzerkonto an. Notizen,
Aufgaben und Einstellungen bleiben lokal auf dem Gerät. Nur beim ausdrücklich
ausgelösten Analysieren einer Notiz wird deren Text an die Anthropic-API
übertragen; ohne hinterlegten API-Key geschieht das nie. Einzelheiten stehen in
[SECURITY.md](SECURITY.md) und auf der Seite
[Firmenrechner & IT](https://swisswest.github.io/Notely/it/).

Bei einem Signaturdienst anfallende Daten beschränken sich auf das, was für die
Signatur nötig ist: die zu signierende Datei, den Versionsstand und die Identität
des freigebenden Kontos. Es werden keine Daten von Notely-Nutzern übermittelt.

## Geplant

Angestrebt wird ein kostenloses Code-Signing-Zertifikat der
[SignPath Foundation](https://signpath.org/) für Open-Source-Projekte. Sobald es
vorliegt, werden die Installer damit signiert; die Prüfsummen und die
minisign-Signatur der Updates bleiben zusätzlich bestehen.

## Missbrauch melden

Findet sich ein signierter Installer, der nicht aus diesem Repository stammt,
bitte umgehend über ein [GitHub-Issue](https://github.com/swisswest/Notely/issues)
oder den in [SECURITY.md](SECURITY.md) genannten Weg melden.
