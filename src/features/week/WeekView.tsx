import { useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';

import { Button, Checkbox } from '@/components/ui';
import { api } from '@/lib/ipc';
import { run, useStore } from '@/lib/store';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import type { Daypart, Task } from '@/types';
import {
  addDays,
  compareTasks,
  daypartKeyFor,
  isoWeekNumber,
  minutesOfDay,
  shortDate,
  shortWeekday,
  startOfWeek,
  toIsoDate,
  weekDays,
} from '@/utils/date';
import { priorityLabel, priorityMark } from '@/utils/priority';

/** Eine Zeile innerhalb eines Tages. `key === null` heisst "ohne Uhrzeit". */
interface Slot {
  key: string | null;
  label: string;
  time: string | null;
}

const UNPLANNED = 'unplanned';

function buildSlots(dayparts: Daypart[]): Slot[] {
  const ordered = [...dayparts].sort(
    (left, right) => (minutesOfDay(left.time) ?? 0) - (minutesOfDay(right.time) ?? 0),
  );
  return [
    { key: null, label: 'Ohne Uhrzeit', time: null },
    ...ordered.map((part) => ({ key: part.key, label: part.label, time: part.time })),
  ];
}

export function WeekView() {
  const tasks = useStore((state) => state.tasks);
  const settings = useStore((state) => state.status?.settings ?? null);
  const actions = useTaskActions();

  const [monday, setMonday] = useState(() => startOfWeek(new Date()));
  const [showCompleted, setShowCompleted] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /**
   * `dragover` muss sofort entscheiden, ob es ein Ziel ist - noch bevor React
   * den State aus `dragstart` verarbeitet hat. Ueber den State gelesen kaeme
   * die Antwort einen Frame zu spaet und der erste Drop ginge ins Leere.
   */
  const draggingRef = useRef<string | null>(null);

  // Eigene Referenz je Render waere genug, um jede Memoisierung unten wertlos zu machen.
  const dayparts = useMemo(() => settings?.dayparts ?? [], [settings]);
  const slots = useMemo(() => buildSlots(dayparts), [dayparts]);
  const days = useMemo(() => weekDays(monday), [monday]);
  const today = toIsoDate(new Date());

  const visible = useMemo(
    () => tasks.filter((task) => showCompleted || !task.completed),
    [tasks, showCompleted],
  );

  /** Aufgaben je Tag und Zeile; die Zuordnung passiert genau einmal pro Render. */
  const byCell = useMemo(() => {
    const map = new Map<string, Task[]>();
    const push = (cell: string, task: Task) => {
      const list = map.get(cell) ?? [];
      list.push(task);
      map.set(cell, list);
    };

    for (const task of visible) {
      if (!task.dueDate) {
        push(UNPLANNED, task);
        continue;
      }
      if (!days.includes(task.dueDate)) continue;
      const key = daypartKeyFor(task.dueTime, dayparts);
      push(cellId(task.dueDate, task.dueTime ? key : null), task);
    }

    for (const list of map.values()) list.sort(compareTasks);
    return map;
  }, [visible, days, dayparts]);

  /**
   * Verschiebt eine Aufgabe auf Tag und Tageszeit. Die Uhrzeit kommt aus den
   * Einstellungen - die Ansicht erfindet keine eigenen Zeiten, sonst haetten
   * "Morgen" hier und "Morgen" in der Analyse unterschiedliche Bedeutungen.
   */
  const move = (task: Task, date: string | null, slotKey: string | null) => {
    const time = date === null ? null : (slots.find((slot) => slot.key === slotKey)?.time ?? null);
    if (task.dueDate === date && (task.dueTime ?? null) === time) return;
    void run(() => api.tasks.bulkReschedule([task.id], date, time), { refresh: true });
  };

  /** Ein Schritt nach links/rechts oder hoch/runter ab der aktuellen Lage. */
  const step = (task: Task, dayOffset: number, slotOffset: number) => {
    const currentSlot = task.dueDate
      ? slots.findIndex(
          (slot) => slot.key === (task.dueTime ? daypartKeyFor(task.dueTime, dayparts) : null),
        )
      : 0;
    const base = currentSlot < 0 ? 0 : currentSlot;
    const index = Math.min(Math.max(base + slotOffset, 0), slots.length - 1);
    const nextSlot = slots[index] ?? slots[0];

    // Ungeplante Aufgaben landen beim ersten Tastendruck auf dem gezeigten Montag.
    const date = task.dueDate ? addDays(task.dueDate, dayOffset) : monday;
    move(task, date, nextSlot?.key ?? null);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>, task: Task) => {
    const handlers: Record<string, () => void> = {
      ArrowLeft: () => step(task, -1, 0),
      ArrowRight: () => step(task, 1, 0),
      ArrowUp: () => step(task, 0, -1),
      ArrowDown: () => step(task, 0, 1),
      Enter: () => actions.startEdit(task),
      ' ': () => actions.toggle(task),
    };

    const handler = handlers[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  const drop = (event: DragEvent<HTMLDivElement>, date: string | null, slotKey: string | null) => {
    event.preventDefault();
    draggingRef.current = null;
    setHover(null);
    setDragging(null);
    const id = event.dataTransfer.getData('text/plain');
    const task = tasks.find((entry) => entry.id === id);
    if (task) move(task, date, slotKey);
  };

  const allowDrop = (event: DragEvent<HTMLDivElement>, cell: string) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (hover !== cell) setHover(cell);
  };

  const card = (task: Task) => (
    <div
      key={task.id}
      className="week__card"
      data-completed={task.completed}
      data-priority={task.priority}
      data-dragging={dragging === task.id}
      draggable
      tabIndex={0}
      role="button"
      title={task.description || task.title}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
        draggingRef.current = task.id;
        setDragging(task.id);
      }}
      onDragEnd={() => {
        draggingRef.current = null;
        setDragging(null);
        setHover(null);
      }}
      onDoubleClick={() => actions.startEdit(task)}
      onKeyDown={(event) => onKey(event, task)}
    >
      <Checkbox
        checked={task.completed}
        ariaLabel={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
        onChange={() => actions.toggle(task)}
      />
      <span className="week__card-text">
        {priorityMark(task.priority) ? (
          <span className="task-row__priority" title={`Priorität ${priorityLabel(task.priority)}`}>
            {priorityMark(task.priority)}
          </span>
        ) : null}
        {task.title}
      </span>
      {task.dueTime ? <span className="week__card-time">{task.dueTime}</span> : null}
    </div>
  );

  const unplanned = byCell.get(UNPLANNED) ?? [];
  const range = `${shortDate(monday)} – ${shortDate(days[6] ?? monday)}`;

  return (
    <div className="main__body week">
      <div className="week__bar">
        <Button variant="ghost" title="Vorherige Woche" onClick={() => setMonday(addDays(monday, -7))}>
          ←
        </Button>
        <Button onClick={() => setMonday(startOfWeek(new Date()))}>Diese Woche</Button>
        <Button variant="ghost" title="Nächste Woche" onClick={() => setMonday(addDays(monday, 7))}>
          →
        </Button>
        <span className="week__range">
          KW {isoWeekNumber(monday)} · {range}
        </span>
        <span className="week__spacer" />
        <Checkbox
          checked={showCompleted}
          label="Erledigte zeigen"
          onChange={setShowCompleted}
        />
      </div>

      <p className="week__hint">
        Aufgaben lassen sich ziehen. Ohne Maus: Karte mit Tab anwählen, dann ← → für den Tag, ↑ ↓
        für die Tageszeit, Enter zum Bearbeiten, Leertaste zum Abhaken.
      </p>

      <div className="week__grid">
        {days.map((date) => (
          <section className="week__day" key={date} data-today={date === today}>
            <header className="week__day-head">
              <span className="week__day-name">{shortWeekday(date)}</span>
              <span className="week__day-date">{shortDate(date)}</span>
            </header>

            {slots.map((slot) => {
              const cell = cellId(date, slot.key);
              const entries = byCell.get(cell) ?? [];
              return (
                <div
                  key={cell}
                  className="week__slot"
                  data-hover={hover === cell}
                  data-empty={entries.length === 0}
                  onDragOver={(event) => allowDrop(event, cell)}
                  onDragLeave={() => setHover((value) => (value === cell ? null : value))}
                  onDrop={(event) => drop(event, date, slot.key)}
                >
                  <span className="week__slot-label">
                    {slot.label}
                    {slot.time ? <span className="week__slot-time">{slot.time}</span> : null}
                  </span>
                  {entries.map(card)}
                </div>
              );
            })}
          </section>
        ))}

        <section className="week__day week__day--unplanned">
          <header className="week__day-head">
            <span className="week__day-name">Ungeplant</span>
            <span className="week__day-date">{unplanned.length}</span>
          </header>
          <div
            className="week__slot"
            data-hover={hover === UNPLANNED}
            data-empty={unplanned.length === 0}
            onDragOver={(event) => allowDrop(event, UNPLANNED)}
            onDragLeave={() => setHover((value) => (value === UNPLANNED ? null : value))}
            onDrop={(event) => drop(event, null, null)}
          >
            <span className="week__slot-label">Ohne Termin</span>
            {unplanned.map(card)}
          </div>
        </section>
      </div>
    </div>
  );
}

function cellId(date: string, slotKey: string | null): string {
  return `${date}#${slotKey ?? ''}`;
}
