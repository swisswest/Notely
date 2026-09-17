# Sicherheit

## Eine Lücke melden

Bitte **nicht** als öffentliches Issue. Nutze stattdessen
[GitHub Security Advisories](../../security/advisories/new) oder schreib direkt
an den Repository-Inhaber. Eine Antwort kommt in der Regel innerhalb einer Woche.

Notely ist ein privates Projekt ohne Sicherheitsteam und ohne Bug-Bounty — jeder
Hinweis ist trotzdem willkommen.

## Was bereits abgesichert ist

**Der API-Key** liegt im Windows Credential Manager, nicht in der Datenbank und
nicht in einer Konfigurationsdatei. Er verlässt den Rust-Prozess nie in Richtung
Frontend; die Oberfläche sieht nur eine maskierte Andeutung. Vor jedem
Logeintrag läuft ein Filter, der alles ab `sk-` ersetzt.

**Claude-Ausgaben gelten als nicht vertrauenswürdig.** Jede Antwort wird gegen
ein JSON-Schema geprüft und anschliessend noch einmal in Rust validiert: Datum,
Uhrzeit, Tageszeit-Schlüssel, Confidence, Textlänge. Steuerzeichen werden
entfernt, Duplikate verworfen, alles Ungültige landet im Log statt in der
Datenbank. Das Modell schreibt nie direkt in die Datenbank.

**Notiztext ist Datenmaterial, keine Anweisung.** Der Prompt weist das Modell
explizit an, Anweisungen innerhalb einer Notiz nicht auszuführen, sondern
höchstens als Aufgabe zu erfassen.

**Updates** werden nur installiert, wenn die minisign-Signatur des Archivs zum
öffentlichen Schlüssel in `tauri.conf.json` passt. Der private Schlüssel liegt
ausschliesslich als GitHub-Secret vor und taucht in keinem Build-Log auf. Der
Katalog `latest.json` hängt als Asset am veröffentlichten Release — ein Entwurf
löst nie ein Update aus.

**Rückmeldungen zur Analysequalität** bleiben in der lokalen Datenbank. Es gibt
keinen Command, der sie irgendwohin sendet; die Erfassung lässt sich in den
Einstellungen abschalten und der Verlauf jederzeit löschen.

**Datenbank:** alle Zugriffe über Parameter-Binding, auch die Suche mit
escapten LIKE-Wildcards. Das Frontend kann kein SQL absetzen — es kennt nur
typisierte Commands.

**Tauri:** die Capabilities enthalten nur die tatsächlich benötigten
Fensterrechte. Keine Shell-Ausführung, kein freier Dateisystemzugriff, kein
Asset-Protokoll. Die CSP erlaubt ausschliesslich eigene Ressourcen und IPC.

**`freezePrototype` steht seit 0.9.0 auf `false`.** Die Einstellung fror die
eingebauten JavaScript-Prototypen ein und schützte damit gegen Prototype
Pollution. Sie musste weichen, weil Mermaid `dayjs` statisch hereinzieht und
dayjs `valueOf` auf seinem Prototyp per Zuweisung setzt - was an einem
eingefrorenen `Object.prototype` scheitert und den Import jedes Diagramms
abbrechen liess.

Die Abwägung im Klartext: Prototype Pollution braucht einen Weg, auf dem fremde
Daten in eine tiefe Objekt-Zusammenführung laufen. Den gibt es in Notely nicht.
Die CSP lässt kein fremdes JavaScript zu, die Vorschau baut React-Elemente
statt HTML, Claudes Antwort passiert die Validierung in Rust und kommt als
typisierte Werte an - nie als Schlüssel, die irgendwo hineingemischt werden.
Es gibt weder `eval` noch eine Deep-Merge-Funktion mit fremden Daten. Die
Einstellung war hier zusätzliche Absicherung ohne erreichbaren Angriffsweg.

Alles, was tatsächlich trägt, bleibt unverändert: die strikte CSP, die
Validierung auf der Rust-Seite, das Parameter-Binding und die minimalen
Capabilities.

## Bekannte Einschränkungen

- **Die Installer sind nicht signiert.** Windows SmartScreen warnt entsprechend.
  Lade Releases nur aus diesem Repository.
- **Die lokale Datenbank ist nicht verschlüsselt.** Wer Zugriff auf das
  Windows-Benutzerprofil hat, kann die Notizen lesen. Für vertrauliche Inhalte
  gehört zusätzlich eine Festplattenverschlüsselung wie BitLocker dazu.
- **Die Auswertung speichert einen Notizausschnitt** (die ersten 200 Zeichen)
  als Kontext. Wer das nicht möchte, schaltet die Erfassung in den Einstellungen
  ab und löscht den Verlauf.
- **Bilder liegen unverschlüsselt in der Profil-Datenbank** und sind in jeder
  Sicherung enthalten. Eine Sicherung mit Screenshots kann vertraulicher sein,
  als der Dateiname vermuten lässt.
- **Sicherungen sind Klartext-JSON.** Sie enthalten keine Secrets, aber alle
  Notizen — der Zielordner sollte entsprechend gewählt werden.
