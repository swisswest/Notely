import { useState } from 'react';

import { Button, Checkbox, Dialog } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshTasks, reportError, run } from '@/lib/store';
import type { ReviewStatus, Task } from '@/types';
import { addDays, formatDayLabel, toIsoDate } from '@/utils/date';

interface ReviewDialogProps {
  status: ReviewStatus;
  onClose: () => void;
}

/**
 * Tagesabschluss: zeigt, was heute offen geblieben ist, und bietet genau die
 * zwei Entscheidungen an, die man abends trifft - erledigt oder verschieben.
 */
export function ReviewDialog({ status, onClose }: ReviewDialogProps) {
  const [tasks, setTasks] = useState<Task[]>(status.tasks);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(status.tasks.map((task) => task.id)),
  );

  const today = toIsoDate(new Date());
  const selectedIds = [...selected];

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finish = async () => {
    try {
      await api.review.complete();
    } catch (error) {
      reportError(error);
    }
    onClose();
  };

  const apply = async (action: () => Promise<unknown>, message: string) => {
    if (selectedIds.length === 0) return;
    const result = await run(action, { success: message });
    if (result === null) return;

    setTasks((current) => current.filter((task) => !selected.has(task.id)));
    setSelected(new Set());
    await refreshTasks();
  };

  const complete = () =>
    apply(() => api.tasks.bulkComplete(selectedIds, true), 'Als erledigt markiert');

  const moveToTomorrow = () =>
    apply(
      () => api.tasks.bulkReschedule(selectedIds, addDays(today, 1), null),
      'Auf morgen verschoben',
    );

  if (tasks.length === 0) {
    return (
      <Dialog
        title="Tagesabschluss"
        subtitle="Nichts mehr offen für heute."
        onClose={() => void finish()}
        footer={
          <Button variant="primary" onClick={() => void finish()}>
            Feierabend
          </Button>
        }
      >
        <p className="field__hint">
          Alle Aufgaben von heute sind erledigt oder verschoben. Der Abschluss meldet sich morgen
          wieder ab {status.time}.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Tagesabschluss"
      subtitle={`${tasks.length} Aufgabe(n) sind noch offen. Was davon ist wirklich erledigt?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Später
          </Button>
          <Button onClick={() => void complete()} disabled={selectedIds.length === 0}>
            {selectedIds.length} erledigt
          </Button>
          <Button
            variant="primary"
            onClick={() => void moveToTomorrow()}
            disabled={selectedIds.length === 0}
          >
            {selectedIds.length} auf morgen
          </Button>
        </>
      }
    >
      {tasks.map((task) => (
        <div className="review-row" key={task.id}>
          <Checkbox
            checked={selected.has(task.id)}
            ariaLabel={`${task.title} auswählen`}
            onChange={() => toggle(task.id)}
          />
          <div>
            <div>{task.title}</div>
            <div className="review-row__meta">
              {task.dueDate ? formatDayLabel(task.dueDate, today) : 'ohne Termin'}
              {task.dueTime ? ` · ${task.dueTime}` : ''}
              {task.dueDate && task.dueDate < today ? ' · überfällig' : ''}
            </div>
          </div>
        </div>
      ))}

      <p className="field__hint" style={{ marginTop: 12 }}>
        „Später" verschiebt nichts und fragt beim nächsten Start erneut.
      </p>
    </Dialog>
  );
}
