import { useEffect, useState } from 'react';

import { Button, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { describeRecurrence, joinRule, splitRule } from '@/utils/recurrence';
import { formatDayLabel, toIsoDate } from '@/utils/date';

interface RecurrenceEditorProps {
  /** Vollstaendige Regel inklusive Enddatum, leer = keine Wiederholung. */
  value: string;
  /** Startpunkt der Serie; ohne Datum ist keine Wiederholung moeglich. */
  dueDate: string;
  onChange: (rule: string) => void;
}

type Unit = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

const UNITS: { id: Unit; label: string }[] = [
  { id: 'none', label: 'Keine Wiederholung' },
  { id: 'daily', label: 'Täglich' },
  { id: 'weekly', label: 'Wöchentlich' },
  { id: 'monthly', label: 'Monatlich' },
  { id: 'yearly', label: 'Jährlich' },
];

const WEEKDAYS: { id: string; label: string }[] = [
  { id: 'mo', label: 'Mo' },
  { id: 'tu', label: 'Di' },
  { id: 'we', label: 'Mi' },
  { id: 'th', label: 'Do' },
  { id: 'fr', label: 'Fr' },
  { id: 'sa', label: 'Sa' },
  { id: 'su', label: 'So' },
];

type MonthMode = 'same' | 'last';

interface Parts {
  unit: Unit;
  interval: number;
  weekdays: string[];
  monthMode: MonthMode;
}

/** Zerlegt eine Regel in die Felder der Oberflaeche. */
function toParts(rule: string): Parts {
  const [unit = '', rawInterval = '1', detail] = rule.split(':');
  const interval = Number(rawInterval);
  const base: Parts = {
    unit: 'none',
    interval: Number.isFinite(interval) && interval >= 1 ? interval : 1,
    weekdays: [],
    monthMode: 'same',
  };

  if (unit === 'daily' || unit === 'weekly' || unit === 'monthly' || unit === 'yearly') {
    base.unit = unit;
  }
  if (unit === 'weekly' && detail) base.weekdays = detail.split(',').filter(Boolean);
  if (unit === 'monthly' && detail === 'last') base.monthMode = 'last';
  return base;
}

/** Baut aus den Feldern wieder die Regel, die das Backend erwartet. */
function toRule(parts: Parts): string {
  if (parts.unit === 'none') return '';
  const interval = Math.min(Math.max(Math.round(parts.interval) || 1, 1), 99);

  if (parts.unit === 'weekly' && interval === 1 && parts.weekdays.length > 0) {
    const ordered = WEEKDAYS.filter((day) => parts.weekdays.includes(day.id)).map((day) => day.id);
    return `weekly:1:${ordered.join(',')}`;
  }
  if (parts.unit === 'monthly' && parts.monthMode === 'last') {
    return `monthly:${interval}:last`;
  }
  return `${parts.unit}:${interval}`;
}

export function RecurrenceEditor({ value, dueDate, onChange }: RecurrenceEditorProps) {
  const initial = splitRule(value);
  const [parts, setParts] = useState<Parts>(() => toParts(initial.rule));
  const [until, setUntil] = useState(initial.until);
  const [preview, setPreview] = useState<string[]>([]);
  const [problem, setProblem] = useState('');

  const rule = toRule(parts);
  const full = joinRule(rule, until);

  // Nach aussen melden, sobald sich etwas geaendert hat.
  useEffect(() => {
    onChange(full);
    // onChange ist bei jedem Render eine neue Funktion; das Abhaengen an `full`
    // reicht, weil nur der Wert zaehlt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  /**
   * Die Vorschau kommt aus dem Backend - genau aus dem Code, der spaeter die
   * Folgeaufgaben anlegt. Eine zweite Rechnung im Frontend wuerde irgendwann
   * abweichen und dann still das Falsche versprechen.
   */
  useEffect(() => {
    if (!full || !dueDate) {
      setPreview([]);
      setProblem('');
      return;
    }

    let cancelled = false;
    api.tasks
      .recurrencePreview(full, dueDate, 5)
      .then((dates) => {
        if (cancelled) return;
        setPreview(dates);
        setProblem('');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreview([]);
        setProblem(error instanceof Error ? error.message : 'Regel nicht auswertbar');
      });

    return () => {
      cancelled = true;
    };
  }, [full, dueDate]);

  const toggleWeekday = (id: string) => {
    setParts((current) => ({
      ...current,
      weekdays: current.weekdays.includes(id)
        ? current.weekdays.filter((day) => day !== id)
        : [...current.weekdays, id],
    }));
  };

  const today = toIsoDate(new Date());
  const weekdaysAvailable = parts.unit === 'weekly' && parts.interval === 1;

  return (
    <>
      <div className="field__row">
        <Field label="Wiederholung">
          <select
            className="select"
            value={parts.unit}
            onChange={(event) =>
              setParts((current) => ({ ...current, unit: event.currentTarget.value as Unit }))
            }
          >
            {UNITS.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </select>
        </Field>

        {parts.unit !== 'none' ? (
          <Field label="Alle" hint={parts.unit === 'daily' ? 'Tage' : undefined}>
            <TextInput
              type="number"
              className="input--compact"
              min={1}
              max={99}
              value={parts.interval}
              onChange={(event) =>
                setParts((current) => ({
                  ...current,
                  interval: Number(event.currentTarget.value) || 1,
                }))
              }
            />
          </Field>
        ) : null}
      </div>

      {weekdaysAvailable ? (
        <Field label="An diesen Tagen" hint="Nichts ausgewählt = derselbe Wochentag wie der Termin.">
          <div className="weekdays">
            {WEEKDAYS.map((day) => (
              <button
                key={day.id}
                type="button"
                className="weekday"
                data-active={parts.weekdays.includes(day.id)}
                onClick={() => toggleWeekday(day.id)}
              >
                {day.label}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {parts.unit === 'weekly' && parts.interval > 1 && parts.weekdays.length > 0 ? (
        <p className="field__hint">
          Einzelne Wochentage gibt es nur bei jeder Woche. Bei grösserem Abstand gilt der Wochentag
          des Termins.
        </p>
      ) : null}

      {parts.unit === 'monthly' ? (
        <Field label="Tag im Monat">
          <select
            className="select"
            value={parts.monthMode}
            onChange={(event) =>
              setParts((current) => ({
                ...current,
                monthMode: event.currentTarget.value as MonthMode,
              }))
            }
          >
            <option value="same">Gleicher Tag wie der Termin</option>
            <option value="last">Letzter Tag im Monat</option>
          </select>
        </Field>
      ) : null}

      {parts.unit !== 'none' ? (
        <>
          <div className="field__row">
            <Field label="Endet am" hint="Leer lassen für unbegrenzt.">
              <TextInput
                type="date"
                className="input--compact"
                value={until}
                min={dueDate || today}
                onChange={(event) => setUntil(event.currentTarget.value)}
              />
            </Field>
            {until ? (
              <Button variant="ghost" onClick={() => setUntil('')}>
                Ohne Ende
              </Button>
            ) : null}
          </div>

          <p className="field__hint">{describeRecurrence(full)}</p>

          {problem ? (
            <p className="field__hint" data-tone="warning">
              {problem}
            </p>
          ) : !dueDate ? (
            <p className="field__hint" data-tone="warning">
              Eine Wiederholung braucht ein Datum als Startpunkt.
            </p>
          ) : preview.length > 0 ? (
            <p className="field__hint">
              Nächste Termine: {preview.map((date) => formatDayLabel(date, today)).join(' · ')}
            </p>
          ) : (
            <p className="field__hint">Diese Regel erzeugt keinen weiteren Termin.</p>
          )}
        </>
      ) : null}
    </>
  );
}
