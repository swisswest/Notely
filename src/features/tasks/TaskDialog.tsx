import { useState } from 'react';

import { Button, Dialog, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { run, useStore } from '@/lib/store';
import type { Task } from '@/types';
import { addDays, toIsoDate } from '@/utils/date';
import { RECURRENCE_PRESETS, describeRecurrence, joinRule, splitRule } from '@/utils/recurrence';

interface TaskDialogProps {
  task: Task | null;
  onClose: () => void;
}

const CUSTOM = 'custom';

export function TaskDialog({ task, onClose }: TaskDialogProps) {
  const dayparts = useStore((state) => state.status?.settings.dayparts ?? []);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');

  const initial = splitRule(task?.recurrence ?? '');
  const [rule, setRule] = useState(initial.rule);
  const [until, setUntil] = useState(initial.until);

  const today = toIsoDate(new Date());
  const isPreset = RECURRENCE_PRESETS.some((preset) => preset.rule === rule);
  const [custom, setCustom] = useState(!isPreset && rule !== '');

  // Eine Wiederholung ohne Datum hat keinen Startpunkt. Statt den Benutzer in
  // einen Fehler laufen zu lassen, setzt die Auswahl den heutigen Tag.
  const applyRule = (value: string) => {
    setRule(value);
    if (value && !dueDate) setDueDate(today);
    if (!value) setUntil('');
  };

  const submit = async () => {
    if (!title.trim()) return;
    const recurrence = joinRule(rule.trim(), until) || null;

    const result = task
      ? await run(
          () =>
            api.tasks.update({
              id: task.id,
              title,
              description,
              dueDate: dueDate || null,
              dueTime: dueTime || null,
              recurrence,
            }),
          { success: 'Task aktualisiert' },
        )
      : await run(
          () =>
            api.tasks.create({
              title,
              description,
              dueDate: dueDate || null,
              dueTime: dueTime || null,
              sourceNoteId: null,
              aiGenerated: false,
              confidence: null,
              recurrence,
            }),
          { success: 'Task erstellt' },
        );

    if (result) onClose();
  };

  return (
    <Dialog
      title={task ? 'Task bearbeiten' : 'Neuer Task'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!title.trim()}>
            {task ? 'Speichern' : 'Erstellen'}
          </Button>
        </>
      }
    >
      <Field label="Titel">
        <TextInput
          value={title}
          autoFocus
          placeholder="Was ist zu tun?"
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
      </Field>

      <Field label="Notiz zum Task">
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </Field>

      <div className="field__row" style={{ marginBottom: 10 }}>
        <Field label="Datum">
          <TextInput
            type="date"
            className="input--compact"
            value={dueDate}
            onChange={(event) => setDueDate(event.currentTarget.value)}
          />
        </Field>
        <Field label="Uhrzeit">
          <TextInput
            type="time"
            className="input--compact"
            value={dueTime}
            onChange={(event) => setDueTime(event.currentTarget.value)}
          />
        </Field>
      </div>

      <div className="field__row" style={{ flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={() => setDueDate(today)}>
          Heute
        </Button>
        <Button variant="ghost" onClick={() => setDueDate(addDays(today, 1))}>
          Morgen
        </Button>
        {dayparts.map((part) => (
          <Button
            key={part.key}
            variant="ghost"
            title={`${part.label} = ${part.time}`}
            onClick={() => {
              setDueTime(part.time);
              if (!dueDate) setDueDate(today);
            }}
          >
            {part.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          onClick={() => {
            setDueDate('');
            setDueTime('');
            applyRule('');
          }}
        >
          Ohne Termin
        </Button>
      </div>

      <Field label="Wiederholung">
        <select
          className="select"
          value={custom ? CUSTOM : rule}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            applyRule(value);
          }}
        >
          {RECURRENCE_PRESETS.map((preset) => (
            <option key={preset.rule || 'none'} value={preset.rule}>
              {preset.label}
            </option>
          ))}
          <option value={CUSTOM}>Benutzerdefiniert…</option>
        </select>
      </Field>

      {custom ? (
        <Field
          label="Eigene Regel"
          hint="Form: daily:2, weekly:1:mo,we,fr, monthly:1:last, yearly:1. Einzelne Wochentage nur bei jeder Woche."
        >
          <TextInput
            value={rule}
            placeholder="weekly:1:mo,we"
            onChange={(event) => applyRule(event.currentTarget.value.trim())}
          />
        </Field>
      ) : null}

      {rule ? (
        <div className="field__row">
          <Field label="Endet am" hint="Leer lassen für unbegrenzt.">
            <TextInput
              type="date"
              className="input--compact"
              value={until}
              min={dueDate || undefined}
              onChange={(event) => setUntil(event.currentTarget.value)}
            />
          </Field>
          <p className="field__hint" style={{ alignSelf: 'flex-end', paddingBottom: 6 }}>
            {describeRecurrence(joinRule(rule, until))}
          </p>
        </div>
      ) : null}
    </Dialog>
  );
}
