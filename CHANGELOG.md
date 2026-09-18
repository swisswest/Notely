# Changelog

Alle nennenswerten Änderungen an Notely. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionierung an
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Geplant

- Code-Signing gegen die SmartScreen-Warnung
- Weitere KI-Anbieter (OpenAI, Gemini) neben Claude

## [0.11.0] - 2026-09-18

### Neu

- **Notizen fragen.** Über dem Suchfeld steht jetzt ein Knopf „Fragen". Dort
  stellst du eine ganze Frage - „Wo habe ich mein Auto geparkt?" - und
  bekommst einen Satz Antwort, zusammen mit den Notizen, in denen sie steht.
  Ein Klick auf eine Quelle öffnet die Notiz.
- Der Weg dahin läuft bewusst in zwei Schritten. Erst sucht SQLite auf dem
  eigenen Rechner die passenden Notizen heraus, dann liest Claude nur diese -
  höchstens acht, zusammen auf ein Zeichenbudget begrenzt. Der gesamte
  Notizbestand geht also nie an Anthropic, und was nicht zur Frage passt,
  verlässt den Rechner gar nicht erst. Findet die lokale Suche nichts,
  unterbleibt der API-Aufruf komplett - die Auskunft ist dieselbe und kostet
  nichts.
- **Ohne Quelle keine Antwort.** Die vom Modell genannten Notiz-IDs werden
  gegen die tatsächlich mitgeschickten Notizen geprüft. Bleibt danach keine
  Quelle übrig, gilt die Antwort als „nichts gefunden" und wird verworfen.
  Lieber „dazu steht nichts da" als eine erfundene Parkhausnummer.
- **Volltextindex über alle Notizen** (SQLite FTS5). Er wird beim Update aus
  dem Bestand aufgebaut, nicht erst ab der nächsten Notiz, und hängt per
  Trigger an der Notiztabelle - angelegt, geändert, gelöscht, wiederhergestellt
  stimmt er ohne Zutun. Umlaute und ihre Umschreibung ergeben denselben
  Treffer: „Buero" findet „Büro".
- **Rechtsklick auf eine Notiz in der Liste** öffnet ein Menü: Ordner
  wechseln, Labels setzen, in den Papierkorb legen. Es arbeitet auf der
  angeklickten Notiz, nicht auf der offenen - der Entwurf im Editor bleibt
  stehen.

### Geändert

- Die Suche in der Befehlspalette gewichtet Treffer jetzt (bm25) statt nur
  nach Änderungsdatum zu sortieren. Findet der Index nichts, greift weiterhin
  die Teilzeichenkettensuche - sonst würde die Suche nach `park` das
  `Parkhaus` nicht mehr finden.
- Eine Frage wird nicht als Suchanfrage genommen. Füllwörter fallen raus, der
  Rest wird ODER-verknüpft und als Wortanfang gesucht. „Wo habe ich mein Auto
  geparkt" sucht also nach `auto` oder `geparkt` - mit UND-Verknüpfung wäre
  das Ergebnis immer leer.
- Der Hilfe-Tab hat einen Abschnitt „Suchen und Notizen fragen", die
  IT-Seite und SECURITY.md nennen den neuen Datenfluss ausdrücklich.

### Behoben

- Eine Notiz aus der Befehlspalette oder aus einer Aufgabe zu öffnen tat
  nichts, wenn sie gerade durch einen Ordner-, Label- oder Suchfilter aus der
  Liste fiel. Die Filter werden jetzt vorher geräumt. Aufgefallen ist es erst
  über die Quellenlinks in der Antwort - dort tritt der Fall ständig auf.

## [0.10.1] - 2026-09-18

Ein Fehlerbehebungs-Release. Keine neuen Funktionen, keine Datenbankänderung.

### Behoben

- **Strg+Z ging nach einem Blick in die Vorschau nicht mehr.** Ursache: beim
  Wechsel auf „Vorschau“ wurde das Schreibfeld aus der Oberfläche entfernt
  und beim Zurückwechseln neu aufgebaut. Der Rückgängig-Verlauf hängt am
  Feld selbst, nicht am Text - mit dem Feld war er weg. Das Feld bleibt jetzt
  stehen und wird nur ausgeblendet.

### Geändert

- **Die Notizliste zeigt die erste Zeile als Titel**, darunter den Anfang des
  Inhalts in Grau. Vorher standen dort zwei Zeilen Rohtext, was bei einer
  Notiz, die mit einer Überschrift beginnt, hiess: `# Einkauf` statt
  `Einkauf`. Auszeichnung, Bilder und Tabellen werden dabei zu lesbarem Text
  aufgelöst; ausgewertet wird nur der Anfang der Notiz, damit die Liste auch
  bei langen Texten flüssig bleibt.
- Dieselbe Titelzeile steht jetzt auch in der Inbox, in der Befehlspalette
  und im Papierkorb - vorher zeigten die drei Stellen drei verschiedene
  Ausschnitte desselben Rohtexts.

## [0.10.0] - 2026-09-17

### Neu

- **Bilder in Notizen.** Screenshot machen, in die Notiz mit `Strg+V` - fertig.
  Ebenso per Ziehen-und-Ablegen, über den Knopf „Bild" oder den Baustein
  `/bild`. Erlaubt sind PNG, JPEG, GIF, WebP und BMP bis 10 MB je Bild.
- Die Bilddaten liegen in einer eigenen Tabelle der Profil-Datenbank, im
  Notiztext steht nur eine kurze Referenz. Das ist Absicht: ein eingebettetes
  Bild würde bei jeder Analyse an Claude gehen, zwanzigmal im Versionsverlauf
  liegen und in jeder Suche auftauchen. So bleibt der Notiztext das, was er
  sein soll - Text. Die Beschreibung des Bildes liest Claude weiterhin mit und
  kann daraus Aufgaben ableiten.
- Export und Druck **betten die Bilder ein**, damit eine exportierte Datei für
  sich steht. Im reinen Textexport bleibt die Beschreibung.
- Bilder sind in der Sicherung enthalten und kommen beim Import zurück. Ein
  einzelnes unlesbares Bild lässt den Import nicht scheitern.
- **Hilfe im Programm** (`F1` oder „Hilfe" in der Seitenleiste). Erklärt die
  Grundidee, die Bausteine, Diagramme, Bilder, Aufgaben, Profile und die
  Sicherung - mit durchsuchbaren Abschnitten. Die Beispiele stehen als
  Quelltext neben ihrem Ergebnis und werden mit demselben Renderer angezeigt
  wie eine echte Notiz; es sind also keine Bildschirmfotos, die veralten
  können. Die Liste der Bausteine und die eigenen Tageszeiten liest die Hilfe
  aus der laufenden App.
- **Aufgaben erben Ordner und Labels ihrer Notiz.** Was Claude aus einer Notiz
  im Ordner „Arbeit" mit dem Label „Kunde X" ableitet, landet dort ebenfalls -
  auch bei der Schnellerfassung und bei jedem Folgetermin einer Serie.
  Aufgaben haben dafür neu einen Ordner; die Aufgabenliste lässt sich danach
  filtern, und im Aufgaben-Dialog ist er von Hand änderbar.
  Übernommen wird **einmalig beim Anlegen**, nicht dauerhaft verknüpft: zieht
  die Notiz später in einen anderen Ordner, bleiben ihre Aufgaben stehen. Eine
  Aufgabe, die ihre Einordnung im Rücken des Benutzers ändert, wäre schwerer
  zu erklären als eine, die liegen bleibt.

### Geändert

- **Voreinstellung für aufbewahrte Sicherungen von 14 auf 5.** Mit Bildern
  werden die Dateien deutlich grösser; vierzehn Stände davon füllen den
  Sicherungsordner schneller, als es jemandem auffällt. Wer es anders will,
  stellt es in den Einstellungen um.
- Funktionstasten greifen jetzt auch, während der Cursor in einem Eingabefeld
  steht. `F1` will man gerade dann, wenn man mitten im Schreiben nicht
  weiterweiss.
- Die CSP erlaubt bei `img-src` zusätzlich `blob:` - nötig, um ein Bild aus
  der Datenbank anzuzeigen, ohne es als Zeichenkette doppelt im Speicher zu
  halten. Ein eng umrissenes Token für lokal erzeugte Daten.

### Behoben

- **Der Sicherungs-Import hat Priorität und Labels von Aufgaben verworfen.**
  Wer eine Sicherung einspielte, bekam alle Aufgaben mit normaler Priorität
  und ohne Labels zurück. Beides wird jetzt mitgeschrieben und
  wiederhergestellt. Bestehende Sicherungsdateien enthalten die Priorität
  bereits - sie wurde beim Einspielen nur nicht gelesen.

### Aufgeräumt

- Bilder, die in keinem Notiztext mehr vorkommen, werden beim Start entfernt -
  mit zwei Tagen Schonfrist, damit ein noch ungespeicherter Entwurf nicht
  bestraft wird. Wird eine Notiz endgültig gelöscht, gehen ihre Bilder über
  den Fremdschlüssel automatisch mit.

## 0.9.0 - nicht einzeln veroeffentlicht

Diese Aenderungen sind in 0.10.0 enthalten. Der Stand wurde nie als
eigener Release herausgegeben - deshalb steht hier keine Verknuepfung.

### Neu

- **Bausteine im Editor.** Ein Schrägstrich öffnet eine Liste: Überschriften,
  Listen, Aufgabenlisten, Zitat, Codeblock, Tabelle, Trennlinie, heutiges
  Datum. Auswahl mit den Pfeiltasten, Enter fügt ein, Esc schliesst.
  Gespeichert wird weiterhin reiner Text - Suche, Claude-Analyse,
  Versionsverlauf und Export arbeiten unverändert damit.
- **Vorschau** im Notizeditor, umschaltbar neben „Schreiben". Der Markdown-
  Parser ist bewusst selbst geschrieben und liefert eine Datenstruktur statt
  einer HTML-Zeichenkette: es gibt in der ganzen Kette kein
  `dangerouslySetInnerHTML` und damit keine Stelle, an der Notizinhalt zu
  Markup werden könnte.
- **Diagramme mit Mermaid.** Ein Codeblock mit der Sprache `mermaid` wird in
  der Vorschau gezeichnet. Bewusst textbasiert statt eingebettetem
  Zeichenprogramm: so findet die Suche das Diagramm, Claude kann es lesen und
  daraus Aufgaben ableiten, und der Export braucht keine Sonderbehandlung. Die
  Bibliothek wird erst beim ersten Diagramm nachgeladen; scheitert das
  Zeichnen, erscheint der Quelltext statt eines leeren Bereichs.
- **Export einzelner Notizen** als Markdown, Text oder in sich geschlossenes
  HTML, dazu Drucken als PDF und Kopieren in die Zwischenablage - als Markdown
  oder formatiert für Mail und Word. Der Zielpfad kommt ausschliesslich aus
  dem Windows-Speicherdialog, nie aus der Oberfläche.

### Geändert

- **`freezePrototype` steht jetzt auf `false`.** Mermaid zieht `dayjs`
  statisch herein, und dessen Zuweisung an `valueOf` scheitert an
  eingefrorenen Prototypen - jedes Diagramm brach schon beim Laden ab. Die
  Einstellung schützte gegen Prototype Pollution, für die es in Notely keinen
  erreichbaren Weg gibt: kein fremdes JavaScript dank CSP, kein HTML aus
  Notizinhalt, kein `eval`, keine Zusammenführung fremder Objekte. Die
  Abwägung steht ausführlich in [SECURITY.md](SECURITY.md). Strikte CSP,
  Rust-Validierung, Parameter-Binding und minimale Capabilities bleiben.

### Hinweis

Nach dem Update einmal `npm install` ausführen - Mermaid ist neu dazugekommen.

## [0.8.0] - 2026-09-16

### Neu

- **Getrennte Profile.** Privat und Arbeit liegen in getrennten Datenbanken -
  eigene Notizen, Aufgaben, Ordner, Labels und Einstellungen. Der API-Key gilt
  weiterhin für das Programm, nicht für ein Profil; er liegt unverändert im
  Windows Credential Manager. Gewechselt wird über die Seitenleiste, das
  Tray-Menü oder die Einstellungen. Ein Wechsel startet Notely neu: die
  Datenbankverbindung im laufenden Betrieb auszutauschen hiesse, sie in jedem
  einzelnen Befehl austauschbar zu machen - eine Sekunde Neustart ist der
  Preis dafür, dass keine Abfrage je die Daten des anderen Profils sieht.
  Bestehende Daten werden beim ersten Start zum Profil „Privat".
- **Wochenansicht** (Strg+5). Sieben Tagesspalten plus eine Spalte für alles
  ohne Termin, innerhalb eines Tages gegliedert nach den eigenen Tageszeiten.
  Aufgaben lassen sich ziehen; ohne Maus geht es mit Tab zur Karte und dann
  ← → für den Tag, ↑ ↓ für die Tageszeit, Enter zum Bearbeiten, Leertaste zum
  Abhaken. Die Zeiten kommen aus den Einstellungen - die Ansicht erfindet
  keine eigenen.

### Geändert

- Sicherungen tragen das Profil im Dateinamen und im Inhalt. Eine Sicherung
  aus einem anderen Profil lässt sich nicht versehentlich einspielen: der
  Import bricht ab und fragt einmal nach. Sicherungen aus Versionen vor 0.8
  haben kein Profil und werden ohne Nachfrage übernommen.
- Entfernte Profile werden nicht gelöscht. Der Ordner wandert nach
  `profiles\_entfernt\` im Datenordner - eine Datenbank ist nichts, was man
  auf Knopfdruck unwiederbringlich wegwerfen können sollte.

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

[Unveröffentlicht]: https://github.com/swisswest/Notely/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/swisswest/Notely/releases/tag/v0.11.0
[0.10.1]: https://github.com/swisswest/Notely/releases/tag/v0.10.1
[0.10.0]: https://github.com/swisswest/Notely/releases/tag/v0.10.0
[0.8.0]: https://github.com/swisswest/Notely/releases/tag/v0.8.0
[0.7.1]: https://github.com/swisswest/Notely/releases/tag/v0.7.1
[0.7.0]: https://github.com/swisswest/Notely/releases/tag/v0.7.0
[0.6.0]: https://github.com/swisswest/Notely/releases/tag/v0.6.0
[0.5.0]: https://github.com/swisswest/Notely/releases/tag/v0.5.0
[0.4.0]: https://github.com/swisswest/Notely/releases/tag/v0.4.0
[0.3.0]: https://github.com/swisswest/Notely/releases/tag/v0.3.0
[0.2.0]: https://github.com/swisswest/Notely/releases/tag/v0.2.0
[0.1.2]: https://github.com/swisswest/Notely/releases/tag/v0.1.2
[0.1.1]: https://github.com/swisswest/Notely/releases/tag/v0.1.1
[0.1.0]: https://github.com/swisswest/Notely/releases/tag/v0.1.0
