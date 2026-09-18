/**
 * Ein kleiner Markdown-Parser für die Notizvorschau.
 *
 * Bewusst selbst geschrieben statt eine Bibliothek einzubinden, aus einem
 * Grund: das Ergebnis ist eine Datenstruktur, keine HTML-Zeichenkette. Die
 * Vorschau baut daraus React-Elemente. Damit gibt es in der ganzen Kette kein
 * `dangerouslySetInnerHTML` und keinen Bedarf für einen Sanitizer - eine
 * Angriffsfläche, die gar nicht erst entsteht, muss man auch nicht absichern.
 *
 * Abgedeckt ist die Teilmenge, die man beim Notizenschreiben tatsächlich
 * benutzt. Alles andere bleibt sichtbarer Text, statt still zu verschwinden.
 */

export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'strike'; children: Inline[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'image'; src: string; alt: string };

export interface ListItem {
  content: Inline[];
  /** `null` bei einer normalen Liste, sonst der Zustand der Checkbox. */
  checked: boolean | null;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'quote'; content: Inline[] }
  | { kind: 'code'; language: string; value: string }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };

/** Nur diese Schemata werden als Link dargestellt - alles andere bleibt Text. */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/**
 * Bildquellen, die angezeigt werden: eigene Anhänge und eingebettete Daten.
 * Adressen aus dem Netz bleiben bewusst draussen - eine Notiz soll beim
 * Öffnen nichts nachladen und damit auch nichts über den Leser verraten.
 */
const SAFE_IMAGE = /^(notely:bild\/[a-z0-9-]{1,64}|data:image\/[a-z+]{1,20};base64,)/i;

/** Präfix der Referenz auf einen Anhang in der Datenbank. */
export const IMAGE_REF = 'notely:bild/';

/** Baut die Referenz, die im Notiztext steht. */
export function imageRef(id: string): string {
  return `${IMAGE_REF}${id}`;
}

/** Zieht die Kennung aus einer Referenz; `null`, wenn es keine ist. */
export function attachmentId(src: string): string | null {
  if (!src.startsWith(IMAGE_REF)) return null;
  const id = src.slice(IMAGE_REF.length);
  return /^[a-z0-9-]{1,64}$/i.test(id) ? id : null;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```\s*([A-Za-z0-9+#-]*)\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/;

/** Zerlegt einen Notiztext in Blöcke. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // Codeblock zuerst: innerhalb gilt keine andere Regel, sonst würde ein
    // "# " im Beispielcode zur Überschrift.
    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      // Ein nicht geschlossener Block reicht bis zum Ende - lieber so als
      // den Rest der Notiz zu verschlucken.
      index += 1;
      blocks.push({ kind: 'code', language, value: body.join('\n') });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: 'heading', level, content: parseInline(heading[2] ?? '') });
      index += 1;
      continue;
    }

    if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
      const head = splitRow(line);
      const rows: Inline[][][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index] ?? '')) {
        rows.push(splitRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
        parts.push(QUOTE.exec(lines[index] ?? '')?.[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'quote', content: parseInline(parts.join(' ')) });
      continue;
    }

    if (UNORDERED.test(line) || ORDERED.test(line)) {
      const ordered = !UNORDERED.test(line);
      const items: ListItem[] = [];

      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = ordered ? ORDERED.exec(current) : UNORDERED.exec(current);
        if (!match) break;

        const raw = match[1] ?? '';
        const task = TASK.exec(raw);
        items.push(
          task
            ? { content: parseInline(task[2] ?? ''), checked: (task[1] ?? ' ').toLowerCase() === 'x' }
            : { content: parseInline(raw), checked: null },
        );
        index += 1;
      }

      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Absatz: läuft bis zur nächsten Leerzeile oder bis eine Zeile beginnt,
    // die für sich genommen ein eigener Block wäre.
    //
    // Die erste Zeile wird immer geschluckt, bevor geprüft wird. Sonst steht
    // die Schleife still, wenn eine Zeile zwar nach einem Block aussieht, es
    // aber keiner ist - eine einzelne Tabellenzeile ohne Trennzeile etwa
    // landet genau hier und wäre sonst eine Endlosschleife.
    const paragraph: string[] = [(lines[index] ?? '').trim()];
    index += 1;
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || startsBlock(current)) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    UNORDERED.test(line) ||
    ORDERED.test(line) ||
    TABLE_ROW.test(line)
  );
}

function splitRow(line: string): Inline[][] {
  const inner = TABLE_ROW.exec(line)?.[1] ?? '';
  return inner.split('|').map((cell) => parseInline(cell.trim()));
}

/**
 * Inline-Auszeichnungen. Der Parser läuft einmal von links nach rechts und
 * sucht bei jedem Sonderzeichen die passende schliessende Markierung. Findet
 * er keine, bleibt das Zeichen gewöhnlicher Text - ein einzelner Stern in
 * einer Notiz ist eben ein Stern.
 */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) {
      out.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  while (i < source.length) {
    const rest = source.slice(i);

    // Code zuerst: darin gilt keine weitere Auszeichnung.
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      flush();
      out.push({ kind: 'code', value: code[1] ?? '' });
      i += code[0].length;
      continue;
    }

    // Bilder vor Links pruefen: sonst bliebe das Ausrufezeichen als Text
    // stehen und der Rest wuerde zum gewoehnlichen Link.
    const image = /^!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/.exec(rest);
    if (image) {
      const src = image[2] ?? '';
      flush();
      if (SAFE_IMAGE.test(src)) {
        out.push({ kind: 'image', src, alt: image[1] ?? '' });
      } else {
        // Unbekannte Quelle: unveraendert anzeigen, nichts stillschweigend laden.
        out.push({ kind: 'text', value: image[0] });
      }
      i += image[0].length;
      continue;
    }

    // Eine Klammerebene in der Adresse ist erlaubt, sonst bricht jeder
    // Wikipedia-Link der Form .../Foo_(Bar) mitten im Wort ab.
    const link = /^\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/.exec(rest);
    if (link) {
      const href = link[2] ?? '';
      const label = link[1] ?? '';
      flush();
      if (SAFE_LINK.test(href)) {
        out.push({ kind: 'link', href, children: parseInline(label) });
      } else {
        // Kein erlaubtes Schema: unverändert anzeigen, nichts verstecken.
        out.push({ kind: 'text', value: link[0] });
      }
      i += link[0].length;
      continue;
    }

    const strong = /^\*\*([^*]+)\*\*/.exec(rest) ?? /^__([^_]+)__/.exec(rest);
    if (strong) {
      flush();
      out.push({ kind: 'strong', children: parseInline(strong[1] ?? '') });
      i += strong[0].length;
      continue;
    }

    const strike = /^~~([^~]+)~~/.exec(rest);
    if (strike) {
      flush();
      out.push({ kind: 'strike', children: parseInline(strike[1] ?? '') });
      i += strike[0].length;
      continue;
    }

    const em = /^\*([^*]+)\*/.exec(rest) ?? /^_([^_]+)_/.exec(rest);
    if (em) {
      flush();
      out.push({ kind: 'em', children: parseInline(em[1] ?? '') });
      i += em[0].length;
      continue;
    }

    const bare = /^(https?:\/\/[^\s<>()]+)/.exec(rest);
    if (bare) {
      flush();
      const href = bare[1] ?? '';
      out.push({ kind: 'link', href, children: [{ kind: 'text', value: href }] });
      i += bare[0].length;
      continue;
    }

    buffer += source[i];
    i += 1;
  }

  flush();
  return merge(out);
}

/**
 * Fasst benachbarte Textstücke zusammen. Sie entstehen, wenn eine erkannte
 * Auszeichnung doch verworfen wird - etwa ein Link mit unerlaubtem Schema.
 * Zusammengefasst ist das Ergebnis vorhersagbar und leichter zu prüfen.
 */
function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.kind === 'text' && last && last.kind === 'text') {
      last.value += node.value;
      continue;
    }
    out.push(node);
  }
  return out;
}

/**
 * Macht aus Markdown wieder lesbaren Fliesstext - für den Export als .txt und
 * für die Vorschauzeile in der Notizliste. Die Struktur geht dabei bewusst
 * verloren, der Inhalt nicht.
 */
export function toPlainText(source: string): string {
  return parseMarkdown(source).map(blockToText).join('\n\n');
}

function blockToText(block: Block): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return inlineToText(block.content);
    case 'code':
      return block.value;
    case 'rule':
      return '---';
    case 'list':
      return block.items
        .map((item, position) => {
          const marker = block.ordered ? `${position + 1}.` : '-';
          const box = item.checked === null ? '' : item.checked ? '[x] ' : '[ ] ';
          return `${marker} ${box}${inlineToText(item.content)}`;
        })
        .join('\n');
    case 'table':
      return [block.head, ...block.rows]
        .map((row) => row.map(inlineToText).join('\t'))
        .join('\n');
  }
}

export function inlineToText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
          return node.value;
        case 'code':
          return node.value;
        case 'link':
          return inlineToText(node.children);
        case 'image':
          return node.alt ? `[Bild: ${node.alt}]` : '[Bild]';
        default:
          return inlineToText(node.children);
      }
    })
    .join('');
}

/**
 * Titel und Rest einer Notiz in einem Durchgang.
 *
 * Getrennt zu rechnen wäre fehleranfällig: `headline` überspringt einen
 * Codeblock oder eine Trennlinie am Anfang, und der Rest müsste dann raten,
 * wo der Titel aufgehört hat. Hier weiss es beides voneinander.
 */
export interface Digest {
  title: string;
  /** Der Inhalt ohne den Titel, als Fliesstext und gekürzt. */
  rest: string;
}

export function digest(source: string, fallback = 'Ohne Titel', max = 160): Digest {
  const blocks = parseMarkdown(source);
  const head = firstTextBlock(blocks);

  const rest = blocks
    .filter((_, index) => index !== head.index)
    .map(blockToText)
    .filter((part) => part.trim() !== '')
    .join(' · ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: head.text || fallback,
    rest: rest.length > max ? `${rest.slice(0, max).trimEnd()}…` : rest,
  };
}

/** Erster Block mit lesbarem Text, samt Position - die Quelle des Titels. */
function firstTextBlock(blocks: Block[]): { text: string; index: number } {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || (block.kind !== 'heading' && block.kind !== 'paragraph')) continue;
    const text = inlineToText(block.content).trim();
    if (text) return { text, index };
  }
  return { text: '', index: -1 };
}

/** Erste sinnvolle Zeile einer Notiz - als Titel für Export und Dateiname. */
export function headline(source: string, fallback = 'Notiz'): string {
  return firstTextBlock(parseMarkdown(source)).text || fallback;
}
