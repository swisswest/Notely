/**
 * Die Logik hinter dem Slash-Menü - bewusst ohne React, damit sie prüfbar ist.
 * Cursorrechnerei ist genau die Sorte Code, bei der man sich um eins vertut
 * und es erst beim Benutzen merkt.
 */

export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  /** Was eingefügt wird. Enthält die Cursormarke, siehe unten. */
  template: string;
  /** Zusätzliche Suchbegriffe, damit "tabelle" auch unter "table" zu finden ist. */
  keywords?: string[];
}

/**
 * Marke für die spätere Cursorposition. Bewusst ein Steuerzeichen und kein
 * sichtbares Symbol: der erste Versuch benutzte `|`, und damit zerlegte der
 * Tabellen-Baustein sich selbst - die Marke sass im ersten Tabellenstrich.
 */
const C = '\u0001';

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'h1', label: 'Überschrift 1', hint: '# Titel', template: `# ${C}`, keywords: ['titel'] },
  { id: 'h2', label: 'Überschrift 2', hint: '## Titel', template: `## ${C}`, keywords: ['titel'] },
  {
    id: 'h3',
    label: 'Überschrift 3',
    hint: '### Titel',
    template: `### ${C}`,
    keywords: ['titel'],
  },
  {
    id: 'liste',
    label: 'Liste',
    hint: '- Punkt',
    template: `- ${C}`,
    keywords: ['bullet', 'punkte'],
  },
  {
    id: 'nummeriert',
    label: 'Nummerierte Liste',
    hint: '1. Punkt',
    template: `1. ${C}`,
    keywords: ['ordered', 'zahlen'],
  },
  {
    id: 'todo',
    label: 'Aufgabenliste',
    hint: '- [ ] offen',
    template: `- [ ] ${C}`,
    keywords: ['checkbox', 'haken', 'aufgabe'],
  },
  { id: 'zitat', label: 'Zitat', hint: '> Text', template: `> ${C}`, keywords: ['quote'] },
  {
    id: 'code',
    label: 'Codeblock',
    hint: '```',
    template: `\`\`\`\n${C}\n\`\`\``,
    keywords: ['quelltext'],
  },
  {
    id: 'tabelle',
    label: 'Tabelle',
    hint: '3 Spalten',
    template: `| ${C} |  |  |\n| --- | --- | --- |\n|  |  |  |`,
    keywords: ['table'],
  },
  { id: 'trennlinie', label: 'Trennlinie', hint: '---', template: `---\n${C}`, keywords: ['hr'] },
  {
    id: 'fett',
    label: 'Fett',
    hint: '**Text**',
    template: `**${C}**`,
    keywords: ['bold'],
  },
  {
    id: 'diagramm',
    label: 'Diagramm',
    hint: 'Mermaid',
    template: `\`\`\`mermaid\nflowchart TD\n  A[Start] --> B[Ende]${C}\n\`\`\``,
    keywords: ['mermaid', 'flowchart', 'grafik'],
  },
  {
    id: 'bild',
    label: 'Bild einfügen',
    hint: 'Datei wählen',
    // Leer: das Einfügen übernimmt die Dateiauswahl, nicht ein Baustein.
    template: '',
    keywords: ['image', 'foto', 'screenshot', 'grafik'],
  },
  {
    id: 'datum',
    label: 'Heutiges Datum',
    hint: 'einfügen',
    template: '',
    keywords: ['heute', 'date'],
  },
];

export interface SlashContext {
  /** Position des `/` im Text. */
  start: number;
  /** Was nach dem `/` bis zum Cursor steht. */
  query: string;
}

/**
 * Sucht einen angefangenen Slash-Befehl direkt vor dem Cursor.
 *
 * Der Schrägstrich zählt nur am Zeilenanfang oder nach einem Leerzeichen -
 * sonst würde jedes Datum und jeder Pfad das Menü aufklappen.
 */
export function findSlash(text: string, caret: number): SlashContext | null {
  const before = text.slice(0, caret);
  const slash = before.lastIndexOf('/');
  if (slash === -1) return null;

  const query = before.slice(slash + 1);
  // Leerzeichen oder Zeilenumbruch beenden den Befehl.
  if (/[\s]/.test(query)) return null;
  if (query.length > 20) return null;

  const preceding = slash === 0 ? '' : (text[slash - 1] ?? '');
  if (preceding !== '' && !/\s/.test(preceding)) return null;

  return { start: slash, query };
}

/** Filtert die Befehle nach dem Eingetippten. */
export function filterCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return SLASH_COMMANDS;

  return SLASH_COMMANDS.filter((command) => {
    const haystack = [command.id, command.label, ...(command.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export interface Applied {
  text: string;
  caret: number;
}

/**
 * Ersetzt den angefangenen Befehl durch seinen Baustein und liefert die neue
 * Cursorposition mit. Der Aufrufer muss nichts nachrechnen.
 */
export function applyCommand(
  text: string,
  context: SlashContext,
  command: SlashCommand,
  today: () => string = defaultToday,
): Applied {
  const caretBefore = context.start + 1 + context.query.length;
  const template = command.id === 'datum' ? today() : command.template;

  const cursorIn = template.indexOf(C);
  const body = cursorIn === -1 ? template : template.replace(C, '');

  const next = text.slice(0, context.start) + body + text.slice(caretBefore);
  const caret = context.start + (cursorIn === -1 ? body.length : cursorIn);

  return { text: next, caret };
}

function defaultToday(): string {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
}
