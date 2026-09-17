import type { Note } from '@/types';
import type { Block, Inline } from '@/utils/markdown';
import { attachmentId, headline, parseMarkdown, toPlainText } from '@/utils/markdown';

export type ExportFormat = 'md' | 'txt' | 'html';

/**
 * Bilder für den Export: Kennung des Anhangs auf eine fertige Daten-Adresse.
 *
 * Ein Export muss für sich stehen. Eine Referenz auf die eigene Datenbank
 * nützt niemandem, der die Datei per Mail bekommt - also werden die Bilder
 * eingebettet.
 */
export type ImageMap = ReadonlyMap<string, string>;

/** Alle Anhang-Kennungen, die in diesen Notizen vorkommen. */
export function referencedImages(notes: Note[]): string[] {
  const found = new Set<string>();

  const walk = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.kind === 'image') {
        const id = attachmentId(node.src);
        if (id) found.add(id);
      } else if (node.kind !== 'text' && node.kind !== 'code' && 'children' in node) {
        walk(node.children);
      }
    }
  };

  for (const note of notes) {
    for (const block of parseMarkdown(note.content)) {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
        case 'quote':
          walk(block.content);
          break;
        case 'list':
          for (const item of block.items) walk(item.content);
          break;
        case 'table':
          for (const row of [block.head, ...block.rows]) for (const cell of row) walk(cell);
          break;
        default:
          break;
      }
    }
  }

  return [...found];
}

/** Ersetzt Anhang-Referenzen im Rohtext durch eingebettete Daten. */
function embed(source: string, images: ImageMap): string {
  if (images.size === 0) return source;
  return source.replace(/!\[([^\]]*)\]\(notely:bild\/([a-z0-9-]{1,64})\)/gi, (match, alt, id) => {
    const data = images.get(String(id));
    return data ? `![${alt}](${data})` : match;
  });
}

/**
 * Baut die Exportinhalte. Alles hier ist eine reine Funktion von Notiz nach
 * Zeichenkette - geschrieben wird erst im Backend, und zwar an einen Ort, den
 * der Windows-Dialog bestimmt.
 */

function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** Dateiname aus der ersten Zeile der Notiz. Das Backend putzt ihn noch. */
export function fileNameFor(notes: Note[], format: ExportFormat): string {
  if (notes.length === 1 && notes[0]) {
    return `${headline(notes[0].content, 'Notiz')}.${format}`;
  }
  const today = stamp(new Date().toISOString());
  return `Notely-Notizen-${today.replace(/\./g, '-')}.${format}`;
}

export function notesToMarkdown(notes: Note[], images: ImageMap = new Map()): string {
  return notes
    .map((note) => {
      const title = headline(note.content, 'Ohne Titel');
      const meta = `*Erstellt ${stamp(note.createdAt)} · Geändert ${stamp(note.updatedAt)}*`;
      // Trägt die Notiz bereits eine Überschrift, wird sie nicht verdoppelt.
      const content = embed(note.content, images);
      const body = content.trimStart().startsWith('#')
        ? content.trim()
        : `# ${title}\n\n${content.trim()}`;
      return `${body}\n\n${meta}`;
    })
    .join('\n\n---\n\n');
}

export function notesToText(notes: Note[]): string {
  return notes
    .map((note) => {
      const meta = `Erstellt ${stamp(note.createdAt)} · Geändert ${stamp(note.updatedAt)}`;
      return `${toPlainText(note.content)}\n\n${meta}`;
    })
    .join('\n\n' + '-'.repeat(48) + '\n\n');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineToHtml(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
          return escapeHtml(node.value);
        case 'strong':
          return `<strong>${inlineToHtml(node.children)}</strong>`;
        case 'em':
          return `<em>${inlineToHtml(node.children)}</em>`;
        case 'strike':
          return `<s>${inlineToHtml(node.children)}</s>`;
        case 'code':
          return `<code>${escapeHtml(node.value)}</code>`;
        case 'image':
          // Nicht eingebettete Bilder gehen als Beschreibung durch: eine
          // Referenz auf die eigene Datenbank wäre in einer Exportdatei tot.
          return node.src.startsWith('data:')
            ? `<img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}">`
            : `<span class="fehlt">[Bild: ${escapeHtml(node.alt || 'ohne Beschreibung')}]</span>`;
        case 'link':
          // Das Schema hat der Parser bereits geprüft; escaped wird trotzdem.
          return `<a href="${escapeHtml(node.href)}" rel="noreferrer">${inlineToHtml(
            node.children,
          )}</a>`;
      }
    })
    .join('');
}

function blockToHtml(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level}>${inlineToHtml(block.content)}</h${block.level}>`;
    case 'paragraph':
      return `<p>${inlineToHtml(block.content)}</p>`;
    case 'quote':
      return `<blockquote>${inlineToHtml(block.content)}</blockquote>`;
    case 'rule':
      return '<hr>';
    case 'code':
      return `<pre><code>${escapeHtml(block.value)}</code></pre>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items
        .map((item) => {
          const box =
            item.checked === null
              ? ''
              : `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `;
          return `<li>${box}${inlineToHtml(item.content)}</li>`;
        })
        .join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'table': {
      const head = block.head.map((cell) => `<th>${inlineToHtml(cell)}</th>`).join('');
      const rows = block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineToHtml(cell)}</td>`).join('')}</tr>`)
        .join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  }
}

export function markdownToHtml(source: string, images: ImageMap = new Map()): string {
  return parseMarkdown(embed(source, images)).map(blockToHtml).join('\n');
}

/** Stil des Exports - bewusst schlicht und ohne eine einzige externe Quelle. */
const STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0 auto; padding: 40px 24px; max-width: 46rem;
         font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
         font-size: 16px; line-height: 1.65; color: #16181d; background: #fff; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 .5em; }
  h1 { font-size: 1.8em; } h2 { font-size: 1.35em; } h3 { font-size: 1.1em; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
  ul, ol { padding-left: 1.4em; }
  blockquote { padding-left: 1em; border-left: 3px solid #d4d6dc; color: #6b7280; }
  code { font-family: Consolas, ui-monospace, monospace; font-size: .9em;
         background: #f2f3f5; padding: .1em .35em; border-radius: 4px; }
  pre { background: #f7f7f8; padding: .9em 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #e5e6ea; padding: .4em .8em; text-align: left; }
  th { background: #f7f7f8; }
  hr { border: 0; border-top: 1px solid #e5e6ea; margin: 2em 0; }
  a { color: #2563eb; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  .fehlt { color: #9ca3af; font-style: italic; }
  .meta { color: #9ca3af; font-size: .8em; margin-top: 2.5em;
          padding-top: 1em; border-top: 1px solid #e5e6ea; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e8ec; background: #0f1114; }
    code { background: #1b1e24; } pre { background: #131519; }
    th { background: #131519; } th, td, hr, .meta { border-color: #24272e; }
    blockquote { border-color: #33373f; color: #9096a1; }
    a { color: #6c9eff; }
  }
`;

/**
 * Eine in sich geschlossene HTML-Datei: kein Skript, keine externe Schrift,
 * kein Nachladen. Sie lässt sich weitergeben und öffnet überall gleich.
 */
export function notesToHtml(notes: Note[], images: ImageMap = new Map()): string {
  const title = notes.length === 1 && notes[0] ? headline(notes[0].content, 'Notiz') : 'Notizen';

  const body = notes
    .map((note) => {
      const meta = `Erstellt ${stamp(note.createdAt)} · Geändert ${stamp(note.updatedAt)}`;
      return `<article>\n${markdownToHtml(note.content, images)}\n<p class="meta">${escapeHtml(
        meta,
      )}</p>\n</article>`;
    })
    .join('\n<hr>\n');

  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function buildExport(
  notes: Note[],
  format: ExportFormat,
  images: ImageMap = new Map(),
): string {
  switch (format) {
    case 'md':
      return notesToMarkdown(notes, images);
    case 'txt':
      // Im reinen Text bleibt vom Bild die Beschreibung - eine Daten-Adresse
      // mit zwei Megabyte Base64 wäre dort schlicht unbrauchbar.
      return notesToText(notes);
    case 'html':
      return notesToHtml(notes, images);
  }
}
