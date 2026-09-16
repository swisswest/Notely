import { describe, expect, it } from 'vitest';

import { daypartKeyFor, isoWeekNumber, minutesOfDay, startOfWeek, weekDays } from './date';

const DAYPARTS = [
  { key: 'morgen', time: '09:00' },
  { key: 'mittag', time: '12:00' },
  { key: 'abend', time: '18:00' },
];

describe('startOfWeek', () => {
  it('liefert den Montag der laufenden Woche', () => {
    // Mittwoch, 16.09.2026
    expect(startOfWeek(new Date(2026, 8, 16))).toBe('2026-09-14');
  });

  it('behandelt Sonntag als letzten Tag der Woche', () => {
    expect(startOfWeek(new Date(2026, 8, 20))).toBe('2026-09-14');
  });

  it('ist auf einem Montag ein Fixpunkt', () => {
    expect(startOfWeek(new Date(2026, 8, 14))).toBe('2026-09-14');
  });
});

describe('weekDays', () => {
  it('liefert sieben aufeinanderfolgende Tage', () => {
    const days = weekDays('2026-09-14');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-09-14');
    expect(days[6]).toBe('2026-09-20');
  });

  it('kommt über einen Monatswechsel', () => {
    expect(weekDays('2026-09-28')[6]).toBe('2026-10-04');
  });
});

describe('isoWeekNumber', () => {
  it('zählt nach ISO 8601', () => {
    expect(isoWeekNumber('2026-09-14')).toBe(38);
    expect(isoWeekNumber('2026-01-01')).toBe(1);
  });

  it('ordnet den Jahreswechsel der Woche des Donnerstags zu', () => {
    // Der 01.01.2027 ist ein Freitag, gehört also noch zur Woche 53 von 2026.
    expect(isoWeekNumber('2027-01-01')).toBe(53);
  });
});

describe('minutesOfDay', () => {
  it('rechnet Uhrzeiten um', () => {
    expect(minutesOfDay('09:00')).toBe(540);
    expect(minutesOfDay('00:00')).toBe(0);
  });

  it('lehnt Unsinn ab, statt zu raten', () => {
    expect(minutesOfDay('25:00')).toBeNull();
    expect(minutesOfDay('abends')).toBeNull();
  });
});

describe('daypartKeyFor', () => {
  it('nimmt die letzte Tageszeit, die nicht nach der Uhrzeit liegt', () => {
    expect(daypartKeyFor('09:00', DAYPARTS)).toBe('morgen');
    expect(daypartKeyFor('11:59', DAYPARTS)).toBe('morgen');
    expect(daypartKeyFor('12:00', DAYPARTS)).toBe('mittag');
    expect(daypartKeyFor('23:30', DAYPARTS)).toBe('abend');
  });

  it('ordnet alles vor der ersten Tageszeit der ersten zu', () => {
    expect(daypartKeyFor('06:00', DAYPARTS)).toBe('morgen');
  });

  it('funktioniert unabhängig von der Reihenfolge der Einstellungen', () => {
    const shuffled = [DAYPARTS[2]!, DAYPARTS[0]!, DAYPARTS[1]!];
    expect(daypartKeyFor('13:00', shuffled)).toBe('mittag');
  });

  it('ohne Uhrzeit oder ohne Tageszeiten gibt es keine Zuordnung', () => {
    expect(daypartKeyFor(null, DAYPARTS)).toBeNull();
    expect(daypartKeyFor('09:00', [])).toBeNull();
  });
});
