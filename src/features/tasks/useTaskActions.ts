import { useCallback } from 'react';

import { api } from '@/lib/ipc';
import { openTaskDialog, requestOpenNote, requestView, run, showToast } from '@/lib/store';
import type { Task } from '@/types';
import { formatDayLabel, toIsoDate } from '@/utils/date';

export interface TaskActions {
  startCreate: () => void;
  startEdit: (task: Task) => void;
  toggle: (task: Task) => void;
  remove: (task: Task) => void;
  snooze: (task: Task) => void;
  openSource: (task: Task) => void;
}

/** Gemeinsame Task-Aktionen für alle Listenansichten. */
export function useTaskActions(): TaskActions {
  const toggle = useCallback((task: Task) => {
    void run(async () => {
      const result = await api.tasks.setCompleted(task.id, !task.completed);
      // Bei einer Serie entsteht sofort der nächste Termin. Ohne Hinweis
      // wirkt es so, als wäre die Aufgabe einfach wieder aufgetaucht.
      if (result.followUp?.dueDate) {
        showToast({
          kind: 'info',
          message: `Nächster Termin: ${formatDayLabel(
            result.followUp.dueDate,
            toIsoDate(new Date()),
          )}`,
        });
      }
      return result;
    });
  }, []);

  const remove = useCallback((task: Task) => {
    void run(() => api.tasks.remove(task.id), { success: `"${task.title}" gelöscht` });
  }, []);

  const snooze = useCallback((task: Task) => {
    void run(async () => {
      const updated = await api.tasks.snooze(task.id);
      showToast({
        kind: 'info',
        message: updated.snoozedUntil
          ? `Erinnerung verschoben bis ${new Date(updated.snoozedUntil).toLocaleTimeString('de-CH', {
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : 'Erinnerung verschoben',
      });
      return updated;
    });
  }, []);

  /** Springt zur Notiz, aus der die Aufgabe entstanden ist. */
  const openSource = useCallback((task: Task) => {
    if (!task.sourceNoteId) return;
    requestView('notes');
    requestOpenNote(task.sourceNoteId);
  }, []);

  return {
    startCreate: () => openTaskDialog(null),
    startEdit: (task: Task) => openTaskDialog(task),
    toggle,
    remove,
    snooze,
    openSource,
  };
}
