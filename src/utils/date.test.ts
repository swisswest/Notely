import { describe, expect, it } from 'vitest';

import type { Task } from '@/types';
import {
  addDays,
  bucketOf,
  compareTasks,
  dayDifference,
  formatDayLabel,
  groupByDay,
  isOverdue,
  toIsoDate,
} from './date';

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task',
    title: 'Task',
    description: '',
    createdAt: '2026-09-10T07:36:00Z',
    updatedAt: '2026-09-10T07:36:00Z',
    dueDate: null,
    dueTime: null,
    completed: false,
    completedAt: null,
    sourceNoteId: null,
    aiGenerated: false,
    confidence: null,
    snoozedUntil: null,
    deletedAt: null,
    recurrence: null,
    seriesId: null,
    ...overrides,
  };
}

const now = new Date(2026, 8, 10, 9, 36); // 10.09.2026 09:36 lokal

describe('Datumsberechnung', () => {
  it('bildet lokale Kalenderdaten ohne UTC-Versatz ab', () => {
    expect(toIsoDate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(toIsoDate(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
  });

  it('rechnet Tage über Monatsgrenzen', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayDifference('2026-09-11', '2026-09-10')).toBe(1);
  });

  it('beschriftet Tage relativ', () => {
    expect(formatDayLabel('2026-09-10', '2026-09-10')).toBe('Heute');
    expect(formatDayLabel('2026-09-11', '2026-09-10')).toBe('Morgen');
    expect(formatDayLabel('2026-09-09', '2026-09-10')).toBe('Gestern');
    expect(formatDayLabel('2026-09-14', '2026-09-10')).toBe('Montag');
    expect(formatDayLabel('2026-10-20', '2026-09-10')).toBe('20.10.2026');
  });
});

describe('Einordnung von Tasks', () => {
  it('erkennt überfällige Tasks anhand von Datum und Uhrzeit', () => {
    expect(isOverdue(task({ dueDate: '2026-09-10', dueTime: '09:00' }), now)).toBe(true);
    expect(isOverdue(task({ dueDate: '2026-09-10', dueTime: '12:00' }), now)).toBe(false);
    expect(isOverdue(task({ dueDate: '2026-09-10', dueTime: null }), now)).toBe(false);
    expect(
      isOverdue(task({ dueDate: '2026-09-09', dueTime: '09:00', completed: true }), now),
    ).toBe(false);
  });

  it('ordnet Tasks den Ansichten zu', () => {
    expect(bucketOf(task({ dueDate: '2026-09-10', dueTime: '12:00' }), now)).toBe('today');
    expect(bucketOf(task({ dueDate: '2026-09-11', dueTime: '09:00' }), now)).toBe('tomorrow');
    expect(bucketOf(task({ dueDate: '2026-09-15', dueTime: '09:00' }), now)).toBe('week');
    expect(bucketOf(task({ dueDate: '2026-10-15', dueTime: '09:00' }), now)).toBe('later');
    expect(bucketOf(task({ dueDate: '2026-09-09', dueTime: '09:00' }), now)).toBe('overdue');
    expect(bucketOf(task({}), now)).toBe('someday');
    expect(bucketOf(task({ completed: true }), now)).toBe('completed');
  });

  it('sortiert nach Fälligkeit, Tasks ohne Termin ans Ende', () => {
    const list = [
      task({ id: 'ohne' }),
      task({ id: 'abend', dueDate: '2026-09-10', dueTime: '18:00' }),
      task({ id: 'mittag', dueDate: '2026-09-10', dueTime: '12:00' }),
    ];
    expect([...list].sort(compareTasks).map((entry) => entry.id)).toEqual([
      'mittag',
      'abend',
      'ohne',
    ]);
  });
});

describe('Tagesgruppierung', () => {
  it('erzeugt die Heute/Morgen-Struktur der Hauptansicht', () => {
    const groups = groupByDay(
      [
        task({ id: '1', title: 'Meeting vorbereiten', dueDate: '2026-09-10', dueTime: '10:00' }),
        task({ id: '2', title: 'Nico informieren', dueDate: '2026-09-10', dueTime: '18:00' }),
        task({ id: '3', title: 'Datenbankmigration', dueDate: '2026-09-10', dueTime: '12:00' }),
        task({ id: '4', title: 'Dokumentation', dueDate: '2026-09-11', dueTime: '09:00' }),
        task({ id: '5', title: 'Erledigt', dueDate: '2026-09-10', completed: true }),
        task({ id: '6', title: 'Ohne Termin' }),
      ],
      now,
    );

    expect(groups.map((group) => group.label)).toEqual(['Heute', 'Morgen']);
    expect(groups[0]?.tasks.map((entry) => entry.title)).toEqual([
      'Meeting vorbereiten',
      'Datenbankmigration',
      'Nico informieren',
    ]);
    expect(groups[1]?.tasks).toHaveLength(1);
  });
});
