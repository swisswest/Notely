import { useState } from 'react';

import { LabelChip } from '@/components/LabelChip';
import { Button, Dialog, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { requestOpenNote, requestView, run, useStore } from '@/lib/store';
import type { Priority, Task } from '@/types';
import { addDays, toIsoDate } from '@/utils/date';
import { PRIORITIES } from '@/utils/priority';
import { RecurrenceEditor } from './RecurrenceEditor';

interface TaskDialogProps {
  task: Task | null;
  onClose: () => void;
}

export function TaskDialog({ task, onClose }: TaskDialogProps) {
  const dayparts = useStore((state) => state.status?.settings.dayparts ?? []);
  const labels = useStore((state) => state.labels);

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'normal');
  const [rule, setRule] = useState(task?.recurrence ?? '');
  const [selectedLabels, setSelectedLabels] = useState<string[]>(task?.labels ?? []);

  const today = toIsoDate(new Date());

  const toggleLabel = (id: string) => {
    setSelectedLabels((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const submit = async () => {
    if (!title.trim()) return;
    const recurrence = rule.trim() || null;

    const result = await run(
      async () => {
        const saved = task
          ? await api.tasks.update({
              id: task.id,
              title,
              description,
              dueDate: dueDate || null,
              dueTime: dueTime || null,
              recurrence,
              priority,
            })
          : await api.tasks.create({
              title,
              description,
              dueDate: dueDate || null,
              dueTime: dueTime || null,
              sourceNoteId: null,
              aiGenerated: false,
              confidence: null,
              recurrence,
              priority,
            });

        // Labels erst nach dem Anlegen - vorher gibt es keine ID.
        const before = [...(task?.labels ?? [])].sort().join(',');
        const after = [...selectedLabels].sort().join(',');
        if (before !== after) {
          return api.tasks.setLabels(saved.id, selectedLabels);
        }
        return saved;
      },
      { success: task ? 'Aufgabe aktualisiert' : 'Aufgabe erstellt' },
    );

    if (result) onClose();
  };

  const openSource = () => {
    if (!task?.sourceNoteId) return;
    requestView('notes');
    requestOpenNote(task.sourceNoteId);
    onClose();
  };

  return (
    <Dialog
      title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
      onClose={onClose}
      footer={
        <>
          {task?.sourceNoteId ? (
            <Button variant="ghost" onClick={openSource} title="Notiz öffnen, aus der sie entstand">
              Ursprungsnotiz
            </Button>
          ) : null}
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

      <Field label="Notiz zur Aufgabe">
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
        <Field label="Priorität">
          <select
            className="select input--compact"
            value={priority}
            onChange={(event) => setPriority(event.currentTarget.value as Priority)}
          >
            {PRIORITIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
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
            setRule('');
          }}
        >
          Ohne Termin
        </Button>
      </div>

      {labels.length > 0 ? (
        <Field label="Labels">
          <div className="notes__label-filter">
            {labels.map((label) => (
              <LabelChip
                key={label.id}
                label={label}
                active={selectedLabels.includes(label.id)}
                title={selectedLabels.includes(label.id) ? 'Entfernen' : 'Zuweisen'}
                onClick={() => toggleLabel(label.id)}
              />
            ))}
          </div>
        </Field>
      ) : null}

      <RecurrenceEditor
        value={rule}
        dueDate={dueDate}
        onChange={(next) => {
          setRule(next);
          if (next && !dueDate) setDueDate(today);
        }}
      />
    </Dialog>
  );
}
