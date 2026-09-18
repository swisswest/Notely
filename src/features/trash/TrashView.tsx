import { useCallback, useEffect, useState } from 'react';

import { Button, EmptyState } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshTasks, refreshNotes, reportError, showToast, useStore } from '@/lib/store';
import type { TrashContents } from '@/types';
import { summarize } from '@/features/notes/NoteSummary';
import { formatDateTime } from '@/utils/date';

const EMPTY: TrashContents = { notes: [], tasks: [], retentionDays: 30 };

export function TrashView() {
  const dataVersion = useStore((state) => state.notes.length + state.tasks.length);
  const [trash, setTrash] = useState<TrashContents>(EMPTY);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setTrash(await api.trash.list());
    } catch (error) {
      reportError(error);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      showToast({ kind: 'success', message });
      await Promise.all([reload(), refreshTasks(), refreshNotes()]);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const total = trash.notes.length + trash.tasks.length;

  return (
    <div className="main__body">
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Gelöschtes bleibt {trash.retentionDays} Tage liegen und verschwindet dann beim Start
        automatisch. „Endgültig löschen" lässt sich nur noch über eine Sicherung rückgängig machen.
      </p>

      {total === 0 ? (
        <EmptyState>Der Papierkorb ist leer.</EmptyState>
      ) : (
        <div className="field__row" style={{ marginBottom: 16 }}>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void act(() => api.trash.empty(), 'Papierkorb geleert')}
          >
            Papierkorb leeren ({total})
          </Button>
        </div>
      )}

      {trash.tasks.length > 0 ? (
        <section className="section">
          <h3 className="section__title">
            Aufgaben<span className="section__count">{trash.tasks.length}</span>
          </h3>
          {trash.tasks.map((task) => (
            <div className="task-row" key={task.id}>
              <span />
              <span className="task-row__time">{task.dueTime ?? ''}</span>
              <span className="task-row__title">{task.title}</span>
              <span className="task-row__meta">
                <span>{task.deletedAt ? formatDateTime(task.deletedAt) : ''}</span>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(() => api.trash.restoreTask(task.id), 'Task wiederhergestellt')
                  }
                >
                  Wiederherstellen
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void act(() => api.trash.purgeTask(task.id), 'Endgültig gelöscht')
                  }
                >
                  Endgültig löschen
                </Button>
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {trash.notes.length > 0 ? (
        <section className="section">
          <h3 className="section__title">
            Notizen<span className="section__count">{trash.notes.length}</span>
          </h3>
          {trash.notes.map((note) => (
            <div className="task-row" key={note.id}>
              <span />
              <span />
              <span className="task-row__title">{summarize(note.content).title}</span>
              <span className="task-row__meta">
                <span>{note.deletedAt ? formatDateTime(note.deletedAt) : ''}</span>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(() => api.trash.restoreNote(note.id), 'Notiz wiederhergestellt')
                  }
                >
                  Wiederherstellen
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void act(() => api.trash.purgeNote(note.id), 'Endgültig gelöscht')
                  }
                >
                  Endgültig löschen
                </Button>
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
