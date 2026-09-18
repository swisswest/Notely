import { useMemo, useState } from 'react';

import { Markdown } from '@/components/Markdown';
import { Button, TextInput } from '@/components/ui';
import { showToast, useStore } from '@/lib/store';
import { SLASH_COMMANDS } from '@/features/notes/slashCommands';

/**
 * Die Hilfe im Programm.
 *
 * Alle Beispiele werden mit demselben Renderer angezeigt wie eine echte
 * Notizvorschau. Was hier steht, ist deshalb nie ein Screenshot, der
 * veraltet - es ist dasselbe, was die App auch sonst tut.
 */

interface Section {
  id: string;
  title: string;
  /** Wonach gesucht werden kann, ohne dass es sichtbar ist. */
  keywords?: string;
  body: React.ReactNode;
}

/** Quelltext links, Ergebnis rechts - so lernt man Markdown am schnellsten. */
function Beispiel({ source, hint }: { source: string; hint?: string }) {
  const copy = () => {
    navigator.clipboard
      .writeText(source)
      .then(() => showToast({ kind: 'success', message: 'In die Zwischenablage kopiert' }))
      .catch(() => showToast({ kind: 'error', message: 'Kopieren nicht möglich' }));
  };

  return (
    <div className="help__example">
      <div className="help__example-head">
        <span className="help__example-label">So tippst du es</span>
        <Button variant="ghost" onClick={copy} title="Zum Ausprobieren in eine Notiz einfügen">
          Kopieren
        </Button>
      </div>
      <div className="help__example-body">
        <pre className="help__source">
          <code>{source}</code>
        </pre>
        <div className="help__result">
          <Markdown source={source} />
        </div>
      </div>
      {hint ? <p className="field__hint help__example-hint">{hint}</p> : null}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="help__key">{children}</kbd>;
}

export function HelpView() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>('grundidee');
  const dayparts = useStore((state) => state.status?.settings.dayparts ?? []);
  const version = useStore((state) => state.status?.appVersion ?? '');

  const sections = useMemo<Section[]>(
    () => [
      {
        id: 'grundidee',
        title: 'Wofür Notely da ist',
        keywords: 'start anfang idee zweck claude analyse',
        body: (
          <>
            <p>
              Notely ist zuerst ein Notizblock. Du schreibst los, ohne dich um Form zu kümmern.
              Erst danach schaut Claude auf den Text und schlägt Aufgaben vor, die darin stecken.
            </p>
            <p>
              Der Ablauf ist immer derselbe: <strong>Notiz schreiben → analysieren lassen →
              Vorschläge bestätigen</strong>. Die ursprüngliche Notiz bleibt dabei unverändert
              erhalten, auch wenn die Analyse scheitert. Claude schreibt nie direkt in die
              Datenbank; jeder Vorschlag geht durch eine Prüfung und wartet auf deine Bestätigung.
            </p>
            <p className="field__hint">
              Ohne API-Key funktioniert alles ausser dieser Analyse: Notizen, Aufgaben,
              Erinnerungen, Suche, Sicherung.
            </p>
          </>
        ),
      },
      {
        id: 'bausteine',
        title: 'Formatieren mit dem Schrägstrich',
        keywords: 'slash markdown überschrift liste tabelle formatierung bausteine',
        body: (
          <>
            <p>
              Tippe im Notizeditor einen <Kbd>/</Kbd> am Zeilenanfang oder nach einem Leerzeichen.
              Es öffnet sich eine Liste, die beim Weitertippen enger wird. <Kbd>↑</Kbd>{' '}
              <Kbd>↓</Kbd> wählen aus, <Kbd>Enter</Kbd> fügt ein, <Kbd>Esc</Kbd> schliesst.
            </p>
            <div className="help__commands">
              {SLASH_COMMANDS.map((command) => (
                <div key={command.id} className="help__command">
                  <code>/{command.id}</code>
                  <span>{command.label}</span>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 14 }}>
              Oben im Editor schaltest du zwischen <strong>Schreiben</strong> und{' '}
              <strong>Vorschau</strong> um. Gespeichert wird immer der geschriebene Text - die
              Vorschau zeigt nur, wie er aussieht.
            </p>
            <Beispiel
              source={
                '# Besprechung Montag\n\n' +
                'Wichtig ist **der Termin am Freitag**.\n\n' +
                '- [ ] Unterlagen vorbereiten\n' +
                '- [x] Raum gebucht\n\n' +
                '> Zitat oder Randnotiz\n'
              }
            />
          </>
        ),
      },
      {
        id: 'diagramme',
        title: 'Diagramme zeichnen',
        keywords: 'mermaid flussdiagramm sequenz grafik visualisierung',
        body: (
          <>
            <p>
              Ein Diagramm entsteht aus Text - du beschreibst es, Notely zeichnet es. Der Vorteil
              gegenüber einem eingebetteten Zeichenprogramm: die Suche findet es, Claude kann es
              lesen und daraus Aufgaben ableiten, und jeder Export nimmt es ohne Umweg mit.
            </p>
            <p>
              Der Baustein <code>/diagramm</code> legt das Gerüst an. Gezeichnet wird in der
              Vorschau; im Schreibmodus siehst du weiterhin den Text.
            </p>

            <h4 className="help__sub">Ablauf mit Verzweigung</h4>
            <Beispiel
              source={
                '```mermaid\nflowchart TD\n' +
                '  A[Notiz schreiben] --> B{Aufgabe erkannt?}\n' +
                '  B -->|ja| C[Vorschlag bestätigen]\n' +
                '  B -->|nein| D[Notiz bleibt Notiz]\n```\n'
              }
              hint="TD heisst von oben nach unten, LR von links nach rechts. Eckige Klammern ergeben einen Kasten, geschweifte eine Raute für Entscheidungen."
            />

            <h4 className="help__sub">Wer spricht wann mit wem</h4>
            <Beispiel
              source={
                '```mermaid\nsequenceDiagram\n' +
                '  Du->>Notely: Notiz speichern\n' +
                '  Notely->>Claude: Text zur Analyse\n' +
                '  Claude-->>Notely: Vorschläge\n' +
                '  Notely->>Du: zur Bestätigung\n```\n'
              }
              hint="Der durchgezogene Pfeil ->> ist ein Aufruf, der gestrichelte -->> eine Antwort."
            />

            <h4 className="help__sub">Zeitplan</h4>
            <Beispiel
              source={
                '```mermaid\ngantt\n' +
                '  title Projektwoche\n' +
                '  dateFormat YYYY-MM-DD\n' +
                '  Konzept    :2026-09-21, 2d\n' +
                '  Umsetzung  :2026-09-23, 3d\n```\n'
              }
            />

            <p className="field__hint">
              Stimmt etwas an der Schreibweise nicht, zeigt die Vorschau den Quelltext mit einer
              Meldung statt einer leeren Fläche. Deine Notiz bleibt immer lesbar.
            </p>
          </>
        ),
      },
      {
        id: 'bilder',
        title: 'Bilder einfügen',
        keywords: 'screenshot bild foto einfügen ziehen png',
        body: (
          <>
            <p>
              Der schnellste Weg: Screenshot machen und im Editor <Kbd>Strg</Kbd> <Kbd>V</Kbd>{' '}
              drücken. Ausserdem geht Ziehen-und-Ablegen einer Bilddatei auf den Editor, der Knopf{' '}
              <strong>Bild</strong> oben rechts und der Baustein <code>/bild</code>.
            </p>
            <p>
              Erlaubt sind PNG, JPEG, GIF, WebP und BMP bis 10 MB je Bild. Im Notiztext steht nur
              eine kurze Referenz, die Bilddaten liegen daneben in der Datenbank. Das ist Absicht:
              ein eingebettetes Bild würde bei jeder Analyse an Claude geschickt.
            </p>
            <p className="field__hint">
              Der Text in der Klammer ist die Beschreibung. Sie taucht im Textexport auf, und
              Claude liest sie mit - „Screenshot der Fehlermeldung" ist also nützlicher als „Bild1".
            </p>
          </>
        ),
      },
      {
        id: 'suchen',
        title: 'Suchen und Notizen fragen',
        keywords: 'suche suchen finden frage fragen antwort quelle volltext rechtsklick kontextmenü',
        body: (
          <>
            <p>
              Das Feld über der Notizliste filtert beim Tippen. Es sucht nach Zeichenfolgen, auch
              mitten im Wort: <code>park</code> findet <code>Parkhaus</code>.
            </p>
            <p>
              Der Knopf <strong>Fragen</strong> daneben macht etwas anderes. Dort stellst du eine
              ganze Frage - „Wo habe ich mein Auto geparkt?" - und bekommst eine Antwort in einem
              Satz, zusammen mit den Notizen, in denen sie steht. Ein Klick auf eine Quelle öffnet
              die Notiz.
            </p>
            <p>
              Der Weg dahin geht in zwei Schritten: erst sucht Notely auf deinem Rechner die
              Notizen heraus, die zur Frage passen, dann liest Claude nur diese. Damit verlassen
              nie alle Notizen den Rechner, sondern höchstens acht - und was nicht zur Frage passt,
              geht gar nicht erst raus. Findet die Suche nichts, wird auch nicht gefragt.
            </p>
            <p>
              <strong>Steht die Antwort nirgends, sagt Notely das.</strong> Eine Antwort ohne
              Notiz, auf die sie sich beruft, wird verworfen - lieber „dazu steht nichts da" als
              eine erfundene Parkhausnummer.
            </p>
            <p style={{ marginTop: 14 }}>
              Ein <strong>Rechtsklick</strong> auf eine Notiz in der Liste öffnet ein Menü: Ordner
              wechseln, Labels setzen, in den Papierkorb legen. Das arbeitet auf der angeklickten
              Notiz, nicht auf der offenen - dein Entwurf im Editor bleibt stehen.
            </p>
          </>
        ),
      },
      {
        id: 'aufgaben',
        title: 'Aufgaben, Termine und Wiederholungen',
        keywords: 'task heute woche inbox termin priorität serie wiederkehrend',
        body: (
          <>
            <p>
              <strong>Heute</strong> zeigt, was ansteht und überfällig ist. Die{' '}
              <strong>Woche</strong> (<Kbd>Strg</Kbd> <Kbd>5</Kbd>) stellt sieben Tage
              nebeneinander, gegliedert nach deinen Tageszeiten - Aufgaben lassen sich dort ziehen
              oder mit <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> verschieben. Die{' '}
              <strong>Inbox</strong> sammelt alles ohne Termin.
            </p>
            {dayparts.length > 0 ? (
              <>
                <p>Deine Tageszeiten sind derzeit:</p>
                <div className="help__commands">
                  {dayparts.map((part) => (
                    <div key={part.key} className="help__command">
                      <code>{part.label}</code>
                      <span>ab {part.time}</span>
                    </div>
                  ))}
                </div>
                <p className="field__hint" style={{ marginTop: 10 }}>
                  Sagst du in einer Notiz „am {dayparts[0]?.label ?? 'Morgen'}", setzt Notely{' '}
                  {dayparts[0]?.time ?? '09:00'} ein. Die Zeiten änderst du in den Einstellungen;
                  sie sind nirgends fest eingebaut.
                </p>
              </>
            ) : null}
            <p style={{ marginTop: 14 }}>
              Eine <strong>Wiederholung</strong> stellst du im Aufgaben-Dialog ein: täglich,
              werktags, an bestimmten Wochentagen, monatlich, am Monatsletzten oder jährlich. Der
              nächste Termin entsteht erst beim Abhaken - so türmt sich nichts auf, wenn du eine
              Woche nicht hineinschaust.
            </p>
            <p>
              Entsteht eine Aufgabe aus einer Notiz, übernimmt sie deren{' '}
              <strong>Ordner und Labels</strong>. Ziehst du die Notiz später woandershin, bleibt
              die Aufgabe, wo sie ist.
            </p>
          </>
        ),
      },
      {
        id: 'profile',
        title: 'Privat und Arbeit trennen',
        keywords: 'profil profile arbeit privat trennen wechseln',
        body: (
          <>
            <p>
              Jedes Profil hat eine eigene Datenbank: eigene Notizen, Aufgaben, Ordner, Labels und
              Einstellungen. Angelegt und gewechselt wird oben in der Seitenleiste, über das
              Tray-Menü oder in den Einstellungen.
            </p>
            <p>
              Ein Wechsel startet Notely neu. Das ist Absicht und keine Bequemlichkeit: nur so ist
              ausgeschlossen, dass eine Abfrage noch Daten des vorherigen Profils sieht.
            </p>
            <p className="field__hint">
              Der Claude API-Key gilt für das Programm, nicht für ein Profil - er liegt im Windows
              Credential Manager und muss nur einmal hinterlegt werden. Entfernte Profile werden
              nicht gelöscht, ihr Ordner wandert beiseite.
            </p>
          </>
        ),
      },
      {
        id: 'sichern',
        title: 'Sichern und weitergeben',
        keywords: 'backup sicherung export pdf html markdown drucken',
        body: (
          <>
            <p>
              Deine Daten liegen nur auf diesem Rechner. Die <strong>Sicherung</strong> schreibt
              alles - samt Bildern - als eine JSON-Datei in einen Ordner deiner Wahl. Kopier die
              ab und zu weg; eine Sicherung, die auf derselben Festplatte liegt, ist keine.
            </p>
            <p>
              Beim Wiederherstellen wird nur ergänzt. Vorhandene Notizen und Aufgaben werden nie
              überschrieben oder gelöscht. Vorher lohnt sich der Knopf <strong>Prüfen</strong>: er
              liest die Datei und zeigt, was drinsteht, ohne etwas zu verändern.
            </p>
            <p>
              Einzelne Notizen gibst du über <strong>Exportieren</strong> weiter - als Markdown,
              Text, HTML oder PDF, oder direkt in die Zwischenablage. Bilder werden in die Datei
              eingebettet, damit sie beim Empfänger ankommt.
            </p>
          </>
        ),
      },
      {
        id: 'tastatur',
        title: 'Tastatur',
        keywords: 'kürzel shortcut tasten',
        body: (
          <div className="help__keys">
            {[
              ['Strg + K', 'Befehlspalette und Suche'],
              ['Strg + N', 'Neue Notiz'],
              ['Strg + T', 'Neue Aufgabe'],
              ['Strg + 1 … 5', 'Heute, Inbox, Aufgaben, Notizen, Woche'],
              ['Strg + S', 'Notiz sofort speichern'],
              ['Strg + V', 'Bild aus der Zwischenablage einfügen'],
              ['Strg + ,', 'Einstellungen'],
              ['F1', 'Diese Hilfe'],
              ['Ctrl + Alt + N', 'Schnellerfassung, auch ausserhalb von Notely'],
              ['Esc', 'Dialog schliessen'],
            ].map(([key, what]) => (
              <div key={key} className="help__keys-row">
                <Kbd>{key}</Kbd>
                <span>{what}</span>
              </div>
            ))}
          </div>
        ),
      },
    ],
    [dayparts],
  );

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? sections.filter((section) =>
        `${section.title} ${section.keywords ?? ''}`.toLowerCase().includes(needle),
      )
    : sections;

  return (
    <div className="main__body">
      <div className="help">
        <p className="help__lead">
          Kurz erklärt, was Notely kann und wie es gemeint ist. Die Beispiele sind echt - sie
          werden mit demselben Renderer angezeigt wie deine Notizen.
        </p>

        <TextInput
          placeholder="Hilfe durchsuchen, z. B. Diagramm oder Sicherung"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />

        {visible.length === 0 ? (
          <p className="field__hint" style={{ marginTop: 16 }}>
            Dazu steht hier nichts. Vielleicht hilft die Befehlspalette mit <Kbd>Strg</Kbd>{' '}
            <Kbd>K</Kbd> weiter.
          </p>
        ) : null}

        {visible.map((section) => {
          // Bei einer Suche sind alle Treffer offen - sonst müsste man jeden
          // einzeln aufklappen, um zu sehen, warum er gefunden wurde.
          const expanded = needle !== '' || open === section.id;
          return (
            <section className="help__section" key={section.id} data-open={expanded}>
              <button
                type="button"
                className="help__header"
                aria-expanded={expanded}
                onClick={() => setOpen(open === section.id && !needle ? null : section.id)}
              >
                <span>{section.title}</span>
                <span className="help__chevron" aria-hidden="true">
                  {expanded ? '−' : '+'}
                </span>
              </button>
              {expanded ? <div className="help__content">{section.body}</div> : null}
            </section>
          );
        })}

        <p className="help__foot">
          Notely {version} · Open Source unter MIT-Lizenz. Fehler und Wünsche gehören auf GitHub -
          dort steht auch, was als Nächstes geplant ist.
        </p>
      </div>
    </div>
  );
}
