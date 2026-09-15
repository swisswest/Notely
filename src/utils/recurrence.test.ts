import { describe, expect, it } from 'vitest';

import { describeRecurrence, joinRule, shortRecurrence, splitRule } from './recurrence';

describe('Wiederholungen beschreiben', () => {
  it('benennt die geläufigen Regeln', () => {
    expect(describeRecurrence(null)).toBe('Keine Wiederholung');
    expect(describeRecurrence('daily:1')).toBe('Täglich');
    expect(describeRecurrence('daily:3')).toBe('Alle 3 Tage');
    expect(describeRecurrence('weekly:1')).toBe('Wöchentlich');
    expect(describeRecurrence('weekly:2')).toBe('Alle 2 Wochen');
    expect(describeRecurrence('weekly:1:mo,tu,we,th,fr')).toBe('Jeden Werktag');
    expect(describeRecurrence('weekly:1:mo,we')).toBe('Wöchentlich am Mo, Mi');
    expect(describeRecurrence('monthly:1')).toBe('Monatlich');
    expect(describeRecurrence('monthly:1:15')).toBe('Monatlich am 15.');
    expect(describeRecurrence('monthly:1:last')).toBe('Am letzten Tag im Monat');
    expect(describeRecurrence('yearly:1')).toBe('Jährlich');
  });

  it('hängt das Enddatum in Schweizer Schreibweise an', () => {
    expect(describeRecurrence('daily:1|until:2027-03-04')).toBe('Täglich bis 04.03.2027');
  });

  it('gibt unbekannten Text unverändert zurück, statt zu raten', () => {
    expect(describeRecurrence('jeden-zweiten-dienstag')).toBe('jeden-zweiten-dienstag');
    expect(describeRecurrence('daily:0')).toBe('daily:0');
  });

  it('trennt und verbindet das Enddatum verlustfrei', () => {
    expect(splitRule('weekly:1:mo|until:2027-01-01')).toEqual({
      rule: 'weekly:1:mo',
      until: '2027-01-01',
    });
    expect(splitRule('weekly:1')).toEqual({ rule: 'weekly:1', until: '' });
    expect(joinRule('weekly:1', '2027-01-01')).toBe('weekly:1|until:2027-01-01');
    expect(joinRule('weekly:1', '')).toBe('weekly:1');
    expect(joinRule('', '2027-01-01')).toBe('');
  });

  it('kürzt für die Liste', () => {
    expect(shortRecurrence(null)).toBeNull();
    expect(shortRecurrence('weekly:1:mo,we')).toBe('wöchentlich');
    expect(shortRecurrence('daily:3')).toBe('täglich×3');
    expect(shortRecurrence('kaputt')).toBeNull();
  });
});
