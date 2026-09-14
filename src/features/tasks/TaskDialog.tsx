import { useState } from 'react';

import { Button, Dialog, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { run, useStore } from '@/lib/store';
import type { Task } from '@/types';
import { addDays, toIsoDate } from '@/utils/date';

interface TaskDialogProps {
  task: Task | null;
  onClose: () => void;
}

export function TaskDialog({ task, onClose }: TaskDialogProps) {
  const dayparts = useStore((state) => state.status?.settings.dayparts ?? []);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');

  const today = toIsoDate(new Date());

  const submit = async () => {
    if (!title.trim()) return;

    const result = task
      ? await run(
          () =>
            api.tasks.update({
              id: task.id,
              title,
              description,
              dueDate: dueDate || null,
              dueTime: dueTime || null,
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
          }}
        >
          Ohne Termin
        </Button>
      </div>
    </Dialog>
  );
}
