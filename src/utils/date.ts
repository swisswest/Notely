import type { Task } from '@/types';
import { priorityRank } from '@/utils/priority';

const WEEKDAYS = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
] as const;

export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'someday' | 'completed';

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Lokales Kalenderdatum als YYYY-MM-DD - unabhängig von UTC-Verschiebungen. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function dayDifference(value: string, reference: string): number {
  const target = parseIsoDate(value);
  const base = parseIsoDate(reference);
  if (!target || !base) return Number.NaN;
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

export function formatDayLabel(value: string, today: string): string {
  const difference = dayDifference(value, today);
  if (difference === 0) return 'Heute';
  if (difference === 1) return 'Morgen';
  if (difference === -1) return 'Gestern';

  const date = parseIsoDate(value);
  if (!date) return value;
  if (difference > 1 && difference < 7) return WEEKDAYS[date.getDay()] ?? value;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Zeitpunkt eines Tasks; ohne Uhrzeit gilt das Tagesende. */
export function dueTimestamp(task: Task): number | null {
  if (!task.dueDate) return null;
  const date = parseIsoDate(task.dueDate);
  if (!date) return null;
  const [hours = '23', minutes = '59'] = (task.dueTime ?? '23:59').split(':');
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.getTime();
}

export function isOverdue(task: Task, now: Date): boolean {
  if (task.completed) return false;
  const timestamp = dueTimestamp(task);
  return timestamp !== null && timestamp < now.getTime();
}

export function bucketOf(task: Task, now: Date): Bucket {
  if (task.completed) return 'completed';
  if (!task.dueDate) return 'someday';

  const today = toIsoDate(now);
  const difference = dayDifference(task.dueDate, today);

  if (isOverdue(task, now)) return 'overdue';
  if (difference === 0) return 'today';
  if (difference === 1) return 'tomorrow';
  if (difference > 1 && difference <= 7) return 'week';
  return 'later';
}

/**
 * Sortiert nach Faelligkeit. Bei gleichem Termin entscheidet die Prioritaet,
 * erst danach das Anlagedatum - so steht das Wichtige oben, ohne dass die
 * Zeitachse durcheinandergeraet.
 */
export function compareTasks(left: Task, right: Task): number {
  const leftDue = dueTimestamp(left);
  const rightDue = dueTimestamp(right);
  if (leftDue === null && rightDue === null) return byPriorityThenAge(left, right);
  if (leftDue === null) return 1;
  if (rightDue === null) return -1;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return byPriorityThenAge(left, right);
}

function byPriorityThenAge(left: Task, right: Task): number {
  const difference = priorityRank(right.priority) - priorityRank(left.priority);
  if (difference !== 0) return difference;
  return left.createdAt.localeCompare(right.createdAt);
}

export interface DayGroup {
  date: string;
  label: string;
  tasks: Task[];
}

/** Gruppiert offene Tasks nach Kalendertag - Basis der Heute-Ansicht. */
export function groupByDay(tasks: Task[], now: Date): DayGroup[] {
  const today = toIsoDate(now);
  const groups = new Map<string, Task[]>();

  for (const task of tasks) {
    if (task.completed || !task.dueDate) continue;
    const list = groups.get(task.dueDate) ?? [];
    list.push(task);
    groups.set(task.dueDate, list);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entries]) => ({
      date,
      label: formatDayLabel(date, today),
      tasks: [...entries].sort(compareTasks),
    }));
}

export function relativeMinutes(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}
