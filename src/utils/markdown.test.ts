import { describe, expect, it } from 'vitest';

import {
  attachmentId,
  digest,
  headline,
  imageRef,
  inlineToText,
  parseInline,
  parseMarkdown,
  toPlainText,
} from './markdown';

describe('Blöcke', () => {
  it('erkennt Überschriften bis Ebene sechs', () => {
    const blocks = parseMarkdown('# Eins\n\n###### Sechs');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 6 });
  });

  it('behandelt mehr als sechs Rauten nicht mehr als Überschrift', () => {
    const blocks = parseMarkdown('####### Zu viele');
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('fasst aufeinanderfolgende Zeilen zu einem Absatz zusammen', () => {
    const blocks = parseMarkdown('Erste Zeile\nzweite Zeile\n\nNeuer Absatz');
    expect(blocks).toHaveLength(2);

    // Ueber die Variante eingrenzen statt zu casten: so prueft der Compiler
    // mit, und der Test bricht auf, wenn sich die Blockstruktur aendert.
    const first = blocks[0];
    if (first?.kind !== 'paragraph') throw new Error(`Absatz erwartet, war ${first?.kind}`);
    expect(inlineToText(first.content)).toBe('Erste Zeile zweite Zeile');
  });

  it('beendet einen Absatz, wenn ein anderer Block beginnt', () => {
    const blocks = parseMarkdown('Text davor\n# Überschrift');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'heading']);
  });

  it('liest Listen mit allen gängigen Aufzählungszeichen', () => {
    for (const marker of ['-', '*', '+']) {
      const blocks = parseMarkdown(`${marker} eins\n${marker} zwei`);
      expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
      expect((blocks[0] as { items: unknown[] }).items).toHaveLength(2);
    }
  });

  it('unterscheidet nummerierte von unnummerierten Listen', () => {
    expect(parseMarkdown('1. eins\n2. zwei')[0]).toMatchObject({ kind: 'list', ordered: true });
    expect(parseMarkdown('- eins')[0]).toMatchObject({ kind: 'list', ordered: false });
  });

  it('erkennt Todo-Listen samt Zustand', () => {
    const blocks = parseMarkdown('- [ ] offen\n- [x] erledigt\n- normal');
    const items = (blocks[0] as { items: { checked: boolean | null }[] }).items;
    expect(items.map((i) => i.checked)).toEqual([false, true, null]);
  });

  it('lässt im Codeblock jede andere Regel ausser Kraft', () => {
    const blocks = parseMarkdown('```js\n# kein Titel\n- keine Liste\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: 'code',
      language: 'js',
      value: '# kein Titel\n- keine Liste',
    });
  });

  it('verschluckt bei einem nicht geschlossenen Codeblock nichts', () => {
    const blocks = parseMarkdown('```\noffen geblieben');
    expect(blocks[0]).toMatchObject({ kind: 'code', value: 'offen geblieben' });
  });

  it('liest Tabellen mit Kopfzeile', () => {
    const blocks = parseMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
    expect(blocks[0]?.kind).toBe('table');
    const table = blocks[0] as { head: unknown[]; rows: unknown[] };
    expect(table.head).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
  });

  it('hält eine Zeile mit Strichen ohne Trennzeile für keine Tabelle', () => {
    const blocks = parseMarkdown('| nur eine Zeile |');
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('erkennt Trennlinien', () => {
    for (const rule of ['---', '***', '___', '- - -'.replace(/ /g, '')]) {
      expect(parseMarkdown(rule)[0]).toMatchObject({ kind: 'rule' });
    }
  });

  it('fasst mehrzeilige Zitate zusammen', () => {
    const blocks = parseMarkdown('> erste\n> zweite');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('quote');
  });
});

describe('Inline', () => {
  it('erkennt fett, kursiv, durchgestrichen und Code', () => {
    expect(parseInline('**f**')[0]?.kind).toBe('strong');
    expect(parseInline('__f__')[0]?.kind).toBe('strong');
    expect(parseInline('*k*')[0]?.kind).toBe('em');
    expect(parseInline('_k_')[0]?.kind).toBe('em');
    expect(parseInline('~~weg~~')[0]?.kind).toBe('strike');
    expect(parseInline('`code`')[0]).toMatchObject({ kind: 'code', value: 'code' });
  });

  it('lässt im Code jede Auszeichnung unangetastet', () => {
    expect(parseInline('`**nicht fett**`')[0]).toMatchObject({
      kind: 'code',
      value: '**nicht fett**',
    });
  });

  it('lässt einen einzelnen Stern in Ruhe', () => {
    expect(parseInline('3 * 4 = 12')).toEqual([{ kind: 'text', value: '3 * 4 = 12' }]);
  });

  it('nimmt nur Links mit erlaubtem Schema', () => {
    expect(parseInline('[ok](https://example.com)')[0]).toMatchObject({
      kind: 'link',
      href: 'https://example.com',
    });
    expect(parseInline('[mail](mailto:a@b.ch)')[0]?.kind).toBe('link');
  });

  it('zeigt einen Link mit gefährlichem Schema als Text, statt ihn zu verstecken', () => {
    const nodes = parseInline('[klick](javascript:alert(1))');
    expect(nodes).toEqual([{ kind: 'text', value: '[klick](javascript:alert(1))' }]);
  });

  it('erkennt nackte Adressen', () => {
    const nodes = parseInline('siehe https://example.com/pfad hier');
    expect(nodes[1]).toMatchObject({ kind: 'link', href: 'https://example.com/pfad' });
  });

  it('verschachtelt Auszeichnungen', () => {
    const nodes = parseInline('**fett mit `code`**');
    expect(nodes[0]?.kind).toBe('strong');
    const children = (nodes[0] as { children: { kind: string }[] }).children;
    expect(children.some((c) => c.kind === 'code')).toBe(true);
  });
});

describe('Umwandlung in reinen Text', () => {
  it('behält den Inhalt und wirft nur die Auszeichnung weg', () => {
    const text = toPlainText('# Titel\n\nEin **wichtiger** Satz.\n\n- eins\n- zwei');
    expect(text).toContain('Titel');
    expect(text).toContain('Ein wichtiger Satz.');
    expect(text).toContain('- eins');
    expect(text).not.toContain('**');
    expect(text).not.toContain('#');
  });

  it('behält Todo-Kästchen, weil sie den Zustand tragen', () => {
    expect(toPlainText('- [x] erledigt')).toContain('[x]');
  });
});

describe('headline', () => {
  it('nimmt die erste Überschrift', () => {
    expect(headline('# Einkauf\n\nMilch')).toBe('Einkauf');
  });

  it('nimmt sonst den ersten Absatz', () => {
    expect(headline('Einfach losgeschrieben\nund weiter')).toBe(
      'Einfach losgeschrieben und weiter',
    );
  });

  it('greift bei leerer Notiz auf den Ersatzwert zurück', () => {
    expect(headline('   \n\n', 'Ohne Titel')).toBe('Ohne Titel');
  });
});

describe('Links mit Klammern', () => {
  it('bricht bei einer Klammer in der Adresse nicht ab', () => {
    const nodes = parseInline('[Foo](https://de.wikipedia.org/wiki/Foo_(Bar))');
    expect(nodes[0]).toMatchObject({
      kind: 'link',
      href: 'https://de.wikipedia.org/wiki/Foo_(Bar)',
    });
  });
});

describe('Bilder', () => {
  it('erkennt einen Anhang als Bild, nicht als Link', () => {
    const nodes = parseInline('![Screenshot](notely:bild/a1b2c3)');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: 'image',
      src: 'notely:bild/a1b2c3',
      alt: 'Screenshot',
    });
  });

  it('lässt das Ausrufezeichen nicht als Text übrig', () => {
    const nodes = parseInline('![x](notely:bild/abc)');
    expect(nodes.some((n) => n.kind === 'text')).toBe(false);
  });

  it('erlaubt eingebettete Bilddaten', () => {
    const nodes = parseInline('![p](data:image/png;base64,iVBORw0KGgo=)');
    expect(nodes[0]?.kind).toBe('image');
  });

  it('zeigt fremde Bildadressen als Text, statt sie nachzuladen', () => {
    const nodes = parseInline('![x](https://fremd.example/zaehlpixel.png)');
    expect(nodes).toEqual([
      { kind: 'text', value: '![x](https://fremd.example/zaehlpixel.png)' },
    ]);
  });

  it('unterscheidet Bild und Link zuverlässig', () => {
    const link = parseInline('[x](https://example.com)');
    const image = parseInline('![x](notely:bild/abc)');
    expect(link[0]?.kind).toBe('link');
    expect(image[0]?.kind).toBe('image');
  });

  it('gibt im Textexport die Beschreibung wieder', () => {
    expect(toPlainText('![Fehlermeldung](notely:bild/abc)')).toContain('[Bild: Fehlermeldung]');
    expect(toPlainText('![](notely:bild/abc)')).toContain('[Bild]');
  });

  it('baut und liest Referenzen verlustfrei', () => {
    expect(attachmentId(imageRef('a1b2c3'))).toBe('a1b2c3');
    expect(attachmentId('notely:bild/../../etc')).toBeNull();
    expect(attachmentId('https://example.com')).toBeNull();
  });
});

describe('digest', () => {
  it('trennt Titel und Rest', () => {
    const d = digest('# Einkauf\n\nMilch und Brot\n\n- Eier');
    expect(d.title).toBe('Einkauf');
    expect(d.rest).toContain('Milch und Brot');
    expect(d.rest).toContain('Eier');
    expect(d.rest).not.toContain('Einkauf');
  });

  it('nimmt den ersten Absatz als Titel, wenn keine Überschrift da ist', () => {
    const d = digest('Auto steht im Parkhaus\n\nEbene 3, Platz 47');
    expect(d.title).toBe('Auto steht im Parkhaus');
    expect(d.rest).toBe('Ebene 3, Platz 47');
  });

  it('überspringt einen Codeblock am Anfang und behält ihn im Rest', () => {
    const d = digest('```\nx = 1\n```\n\nErklärung dazu');
    expect(d.title).toBe('Erklärung dazu');
    expect(d.rest).toContain('x = 1');
  });

  it('gibt bei einer Notiz aus nur einer Zeile keinen Rest zurück', () => {
    const d = digest('Nur ein Satz');
    expect(d.title).toBe('Nur ein Satz');
    expect(d.rest).toBe('');
  });

  it('greift bei leerer Notiz auf den Ersatzwert zurück', () => {
    expect(digest('   ').title).toBe('Ohne Titel');
  });

  it('kürzt lange Inhalte und hängt Auslassungspunkte an', () => {
    const d = digest(`Titel\n\n${'Wort '.repeat(80)}`, 'Ohne Titel', 40);
    expect(d.rest.length).toBeLessThanOrEqual(41);
    expect(d.rest.endsWith('…')).toBe(true);
  });

  it('nennt Bilder im Rest, statt sie zu verschlucken', () => {
    const d = digest('Fehler\n\n![Screenshot](notely:bild/abc)');
    expect(d.rest).toContain('[Bild: Screenshot]');
  });
});
