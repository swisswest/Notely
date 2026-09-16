import type { Priority } from '@/types';

export const PRIORITIES: { id: Priority; label: string; short: string }[] = [
  { id: 'high', label: 'Hoch', short: '!!' },
  { id: 'normal', label: 'Normal', short: '' },
  { id: 'low', label: 'Niedrig', short: '↓' },
];

const ORDER: Record<Priority, number> = { high: 2, normal: 1, low: 0 };

export function priorityRank(value: Priority): number {
  return ORDER[value] ?? 1;
}

export function priorityLabel(value: Priority): string {
  return PRIORITIES.find((entry) => entry.id === value)?.label ?? 'Normal';
}

/** Kurzzeichen für die Liste. Normal bekommt keines - sonst rauscht es. */
export function priorityMark(value: Priority): string | null {
  const mark = PRIORITIES.find((entry) => entry.id === value)?.short ?? '';
  return mark === '' ? null : mark;
}
