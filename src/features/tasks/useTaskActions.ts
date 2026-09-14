import { useCallback } from 'react';

import { api } from '@/lib/ipc';
import { openTaskDialog, run, showToast } from '@/lib/store';
import type { Task } from '@/types';

export interface TaskActions {
  startCreate: () => void;
  startEdit: (task: Task) => void;
  toggle: (task: Task) => void;
  remove: (task: Task) => void;
  snooze: (task: Task) => void;
}

/** Gemeinsame Task-Aktionen für alle Listenansichten. */
export function useTaskActions(): TaskActions {
  const toggle = useCallback((task: Task) => {
    void run(() => api.tasks.setCompleted(task.id, !task.completed));
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

  return {
    startCreate: () => openTaskDialog(null),
    startEdit: (task: Task) => openTaskDialog(task),
    toggle,
    remove,
    snooze,
  };
}
