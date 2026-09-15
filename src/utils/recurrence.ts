/**
 * Lesbare Beschreibung einer Wiederholungsregel. Die Regel selbst wird im
 * Backend geprüft (`domain/recurrence.rs`); hier geht es nur um die Anzeige,
 * deshalb fällt unbekannter Text auf sich selbst zurück statt zu werfen.
 */

const WEEKDAY_LABELS: Record<string, string> = {
  mo: 'Mo',
  tu: 'Di',
  we: 'Mi',
  th: 'Do',
  fr: 'Fr',
  sa: 'Sa',
  su: 'So',
};

const WORKDAYS = 'mo,tu,we,th,fr';

export interface RecurrencePreset {
  /** Regel ohne Enddatum. Leerer String = keine Wiederholung. */
  rule: string;
  label: string;
}

export const RECURRENCE_PRESETS: RecurrencePreset[] = [
  { rule: '', label: 'Keine Wiederholung' },
  { rule: 'daily:1', label: 'Täglich' },
  { rule: `weekly:1:${WORKDAYS}`, label: 'Jeden Werktag' },
  { rule: 'weekly:1', label: 'Wöchentlich' },
  { rule: 'weekly:2', label: 'Alle zwei Wochen' },
  { rule: 'monthly:1', label: 'Monatlich' },
  { rule: 'monthly:1:last', label: 'Am letzten Tag im Monat' },
  { rule: 'yearly:1', label: 'Jährlich' },
];

/** Trennt die Regel von einem angehängten Enddatum. */
export function splitRule(value: string): { rule: string; until: string } {
  const [rule = '', rest] = value.split('|');
  const until = rest?.startsWith('until:') ? rest.slice('until:'.length) : '';
  return { rule, until };
}

export function joinRule(rule: string, until: string): string {
  if (!rule) return '';
  return until ? `${rule}|until:${until}` : rule;
}

function describeWeekly(interval: number, days: string | undefined): string {
  if (!days) {
    return interval === 1 ? 'Wöchentlich' : `Alle ${interval} Wochen`;
  }
  const keys = days.split(',').filter(Boolean);
  const normalized = [...keys].sort().join(',');
  if (normalized === [...WORKDAYS.split(',')].sort().join(',')) {
    return 'Jeden Werktag';
  }
  const labels = keys.map((key) => WEEKDAY_LABELS[key] ?? key);
  return `Wöchentlich am ${labels.join(', ')}`;
}

function describeMonthly(interval: number, day: string | undefined): string {
  if (day === 'last') {
    return interval === 1 ? 'Am letzten Tag im Monat' : `Alle ${interval} Monate am letzten Tag`;
  }
  const base = interval === 1 ? 'Monatlich' : `Alle ${interval} Monate`;
  return day ? `${base} am ${day}.` : base;
}

function describeUntil(until: string): string {
  const parts = until.split('-');
  if (parts.length !== 3) return ` bis ${until}`;
  const [year, month, day] = parts;
  return ` bis ${day}.${month}.${year}`;
}

export function describeRecurrence(value: string | null | undefined): string {
  if (!value) return 'Keine Wiederholung';

  const { rule, until } = splitRule(value);
  const [unit, rawInterval, detail] = rule.split(':');
  const interval = Number(rawInterval);

  if (!unit || !Number.isFinite(interval) || interval < 1) return value;

  let text: string;
  switch (unit) {
    case 'daily':
      text = interval === 1 ? 'Täglich' : `Alle ${interval} Tage`;
      break;
    case 'weekly':
      text = describeWeekly(interval, detail);
      break;
    case 'monthly':
      text = describeMonthly(interval, detail);
      break;
    case 'yearly':
      text = interval === 1 ? 'Jährlich' : `Alle ${interval} Jahre`;
      break;
    default:
      return value;
  }

  return until ? `${text}${describeUntil(until)}` : text;
}

/** Kurzform für die Aufgabenliste - dort ist wenig Platz. */
export function shortRecurrence(value: string | null | undefined): string | null {
  if (!value) return null;
  const { rule } = splitRule(value);
  const [unit, rawInterval] = rule.split(':');
  const interval = Number(rawInterval);
  if (!unit || !Number.isFinite(interval)) return null;

  const suffix = interval > 1 ? `×${interval}` : '';
  switch (unit) {
    case 'daily':
      return `täglich${suffix}`;
    case 'weekly':
      return `wöchentlich${suffix}`;
    case 'monthly':
      return `monatlich${suffix}`;
    case 'yearly':
      return `jährlich${suffix}`;
    default:
      return null;
  }
}
