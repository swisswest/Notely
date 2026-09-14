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

**Datenbank:** alle Zugriffe über Parameter-Binding, auch die Suche mit
escapten LIKE-Wildcards. Das Frontend kann kein SQL absetzen — es kennt nur
typisierte Commands.

**Tauri:** die Capabilities enthalten nur die tatsächlich benötigten
Fensterrechte. Keine Shell-Ausführung, kein freier Dateisystemzugriff, kein
Asset-Protokoll. Die CSP erlaubt ausschliesslich eigene Ressourcen und IPC.

## Bekannte Einschränkungen

- **Die Installer sind nicht signiert.** Windows SmartScreen warnt entsprechend.
  Lade Releases nur aus diesem Repository.
- **Die lokale Datenbank ist nicht verschlüsselt.** Wer Zugriff auf das
  Windows-Benutzerprofil hat, kann die Notizen lesen. Für vertrauliche Inhalte
  gehört zusätzlich eine Festplattenverschlüsselung wie BitLocker dazu.
- **Sicherungen sind Klartext-JSON.** Sie enthalten keine Secrets, aber alle
  Notizen — der Zielordner sollte entsprechend gewählt werden.
