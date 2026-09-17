import { describe, expect, it } from 'vitest';

import {
  SLASH_COMMANDS,
  applyCommand,
  filterCommands,
  findSlash,
} from './slashCommands';

const byId = (id: string) => {
  const found = SLASH_COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(`Befehl ${id} fehlt`);
  return found;
};

describe('findSlash', () => {
  it('erkennt den Schrägstrich am Zeilenanfang', () => {
    expect(findSlash('/h1', 3)).toEqual({ start: 0, query: 'h1' });
  });

  it('erkennt ihn nach einem Leerzeichen', () => {
    expect(findSlash('Text /li', 8)).toEqual({ start: 5, query: 'li' });
  });

  it('erkennt ihn nach einem Zeilenumbruch', () => {
    expect(findSlash('Zeile\n/tab', 10)).toEqual({ start: 6, query: 'tab' });
  });

  it('ignoriert Schrägstriche mitten im Wort', () => {
    expect(findSlash('C:/Users', 8)).toBeNull();
    expect(findSlash('24/12/2026', 10)).toBeNull();
  });

  it('beendet den Befehl beim Leerzeichen', () => {
    expect(findSlash('/h1 Titel', 9)).toBeNull();
  });

  it('gibt bei blossem Schrägstrich eine leere Abfrage zurück', () => {
    expect(findSlash('/', 1)).toEqual({ start: 0, query: '' });
  });

  it('gibt auf, wenn das viel zu lang wird', () => {
    expect(findSlash(`/${'x'.repeat(30)}`, 31)).toBeNull();
  });

  it('sieht nur nach links vom Cursor', () => {
    // Cursor steht vor dem Schrägstrich.
    expect(findSlash('abc /h1', 3)).toBeNull();
  });
});

describe('filterCommands', () => {
  it('liefert ohne Eingabe alles', () => {
    expect(filterCommands('')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('findet über die Kennung', () => {
    expect(filterCommands('h2').map((c) => c.id)).toEqual(['h2']);
  });

  it('findet über ein Stichwort', () => {
    expect(filterCommands('table').map((c) => c.id)).toContain('tabelle');
    expect(filterCommands('checkbox').map((c) => c.id)).toContain('todo');
  });

  it('ist unabhängig von Gross- und Kleinschreibung', () => {
    expect(filterCommands('ZITAT').map((c) => c.id)).toContain('zitat');
  });

  it('liefert bei Unsinn nichts', () => {
    expect(filterCommands('quatschbegriff')).toHaveLength(0);
  });
});

describe('applyCommand', () => {
  it('ersetzt den angefangenen Befehl und setzt den Cursor dahinter', () => {
    const context = findSlash('/h1', 3);
    const result = applyCommand('/h1', context!, byId('h1'));
    expect(result.text).toBe('# ');
    expect(result.caret).toBe(2);
  });

  it('lässt den Text davor und danach unangetastet', () => {
    const text = 'Oben\n/liste\nUnten';
    const context = findSlash(text.slice(0, 11), 11);
    const result = applyCommand(text, context!, byId('liste'));
    expect(result.text).toBe('Oben\n- \nUnten');
    expect(result.caret).toBe(7);
  });

  it('setzt den Cursor bei mehrzeiligen Bausteinen in die Mitte', () => {
    const context = findSlash('/code', 5);
    const result = applyCommand('/code', context!, byId('code'));
    expect(result.text).toBe('```\n\n```');
    expect(result.caret).toBe(4);
    expect(result.text.slice(0, result.caret)).toBe('```\n');
  });

  it('setzt den Cursor bei Fett zwischen die Sterne', () => {
    const context = findSlash('/fett', 5);
    const result = applyCommand('/fett', context!, byId('fett'));
    expect(result.text).toBe('****');
    expect(result.caret).toBe(2);
  });

  it('lässt den Cursorplatzhalter nie im Text zurück', () => {
    for (const command of SLASH_COMMANDS) {
      const context = findSlash(`/${command.id}`, command.id.length + 1);
      const result = applyCommand(`/${command.id}`, context!, command, () => '01.01.2026');
      expect(result.text).not.toContain('|**');
      expect(result.caret).toBe(Math.min(result.caret, result.text.length));
    }
  });

  it('fügt beim Datum den übergebenen Wert ein', () => {
    const context = findSlash('/datum', 6);
    const result = applyCommand('/datum', context!, byId('datum'), () => '17.09.2026');
    expect(result.text).toBe('17.09.2026');
    expect(result.caret).toBe(10);
  });

  it('zerlegt die Tabelle nicht an ihren eigenen Strichen', () => {
    const context = findSlash('/tabelle', 8);
    const result = applyCommand('/tabelle', context!, byId('tabelle'));
    const lines = result.text.split('\n');
    expect(lines).toHaveLength(3);
    // Jede Zeile muss weiterhin mit einem Strich beginnen und enden.
    for (const line of lines) {
      expect(line.startsWith('|')).toBe(true);
      expect(line.endsWith('|')).toBe(true);
    }
    // Der Cursor steht in der ersten Kopfzelle.
    expect(result.caret).toBe(2);
  });

  it('lässt kein Steuerzeichen im Text zurück', () => {
    for (const command of SLASH_COMMANDS) {
      const context = findSlash(`/${command.id}`, command.id.length + 1);
      const result = applyCommand(`/${command.id}`, context!, command, () => '01.01.2026');
      expect(result.text.includes('\u0001')).toBe(false);
    }
  });
});
