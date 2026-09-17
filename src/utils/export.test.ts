import { describe, expect, it } from 'vitest';

import type { Note } from '@/types';
import {
  buildExport,
  escapeHtml,
  fileNameFor,
  markdownToHtml,
  notesToHtml,
  referencedImages,
} from './export';

function note(content: string, overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    content,
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-17T09:30:00Z',
    analyzedAt: null,
    lastAnalysisStatus: null,
    folderId: null,
    deletedAt: null,
    labels: [],
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('entschärft alle fünf kritischen Zeichen', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('ersetzt das kaufmännische Und zuerst, sonst doppelt es sich', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('markdownToHtml', () => {
  it('lässt HTML aus dem Notiztext nicht durch', () => {
    const html = markdownToHtml('Hallo <script>alert(1)</script> Welt');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('entschärft auch im Codeblock', () => {
    const html = markdownToHtml('```\n<img onerror=x>\n```');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('entschärft Anführungszeichen in der Linkadresse', () => {
    const html = markdownToHtml('[x](https://a.ch/"onmouseover="y)');
    expect(html).not.toContain('"onmouseover="');
  });

  it('erzeugt die erwarteten Grundelemente', () => {
    expect(markdownToHtml('# Titel')).toBe('<h1>Titel</h1>');
    expect(markdownToHtml('- eins')).toBe('<ul><li>eins</li></ul>');
    expect(markdownToHtml('1. eins')).toBe('<ol><li>eins</li></ol>');
    expect(markdownToHtml('---')).toBe('<hr>');
  });

  it('setzt Todo-Kästchen als abgeschaltete Checkbox', () => {
    const html = markdownToHtml('- [x] fertig');
    expect(html).toContain('disabled');
    expect(html).toContain('checked');
  });
});

describe('notesToHtml', () => {
  it('kommt ohne externe Quellen und ohne Skript aus', () => {
    const html = notesToHtml([note('# Titel\n\nText')]);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html.includes('https://')).toBe(false);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
  });

  it('trennt mehrere Notizen sichtbar', () => {
    const html = notesToHtml([note('Eins'), note('Zwei')]);
    expect(html).toContain('<hr>');
    expect(html).toContain('Eins');
    expect(html).toContain('Zwei');
  });

  it('nimmt den Titel aus der Notiz und entschärft ihn', () => {
    const html = notesToHtml([note('# <böse>')]);
    expect(html).toContain('<title>&lt;böse&gt;</title>');
  });
});

describe('buildExport', () => {
  it('verdoppelt eine vorhandene Überschrift nicht', () => {
    const md = buildExport([note('# Schon da\n\nText')], 'md');
    expect(md.match(/# Schon da/g)).toHaveLength(1);
  });

  it('ergänzt eine Überschrift, wenn keine da ist', () => {
    const md = buildExport([note('Nur Text')], 'md');
    expect(md.startsWith('# Nur Text')).toBe(true);
  });

  it('wirft im Textexport die Auszeichnung weg', () => {
    const txt = buildExport([note('**fett**')], 'txt');
    expect(txt).toContain('fett');
    expect(txt).not.toContain('**');
  });
});

describe('fileNameFor', () => {
  it('nimmt bei einer Notiz deren erste Zeile', () => {
    expect(fileNameFor([note('# Einkauf')], 'md')).toBe('Einkauf.md');
  });

  it('nimmt bei mehreren einen Sammelnamen mit Datum', () => {
    const name = fileNameFor([note('a'), note('b')], 'html');
    expect(name.startsWith('Notely-Notizen-')).toBe(true);
    expect(name.endsWith('.html')).toBe(true);
  });
});

describe('Bilder im Export', () => {
  const REF = 'notely:bild/a1b2c3';
  const DATA = 'data:image/png;base64,iVBORw0KGgo=';
  const withImage = note(`Text\n\n![Fehlermeldung](${REF})`);

  it('findet die verwendeten Bilder', () => {
    expect(referencedImages([withImage])).toEqual(['a1b2c3']);
  });

  it('findet Bilder auch in Listen und Tabellen', () => {
    const inList = note(`- ![a](${REF})`);
    const inTable = note(`| x |\n| --- |\n| ![b](notely:bild/zzz) |`);
    expect(referencedImages([inList])).toEqual(['a1b2c3']);
    expect(referencedImages([inTable])).toEqual(['zzz']);
  });

  it('meldet keine Bilder, wenn keine da sind', () => {
    expect(referencedImages([note('Nur Text')])).toEqual([]);
  });

  it('bettet Bilder in den HTML-Export ein', () => {
    const html = buildExport([withImage], 'html', new Map([['a1b2c3', DATA]]));
    expect(html).toContain(`<img src="${DATA}"`);
    expect(html).toContain('alt="Fehlermeldung"');
    expect(html).not.toContain('notely:bild');
  });

  it('bettet Bilder in den Markdown-Export ein', () => {
    const md = buildExport([withImage], 'md', new Map([['a1b2c3', DATA]]));
    expect(md).toContain(DATA);
    expect(md).not.toContain('notely:bild');
  });

  it('lässt im Textexport nur die Beschreibung stehen', () => {
    const txt = buildExport([withImage], 'txt', new Map([['a1b2c3', DATA]]));
    expect(txt).toContain('[Bild: Fehlermeldung]');
    expect(txt).not.toContain('base64');
  });

  it('zeigt ein fehlendes Bild als Hinweis, statt einen toten Verweis zu schreiben', () => {
    const html = buildExport([withImage], 'html', new Map());
    expect(html).not.toContain('<img');
    expect(html).toContain('[Bild: Fehlermeldung]');
  });

  it('entschärft die Bildbeschreibung', () => {
    const böse = note('![<script>](notely:bild/x)');
    const html = buildExport([böse], 'html', new Map([['x', DATA]]));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
