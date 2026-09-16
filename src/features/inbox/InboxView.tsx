import { useCallback, useEffect, useState } from 'react';

import { TaskGroup } from '@/components/TaskGroup';
import { Button, EmptyState } from '@/components/ui';
import { api } from '@/lib/ipc';
import {
  openSuggestionQueue,
  refreshAll,
  reportError,
  requestOpenNote,
  requestView,
  showToast,
  useStore,
} from '@/lib/store';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import type { Note } from '@/types';
import { compareTasks, formatDateTime } from '@/utils/date';

/** Muss zu MAX_BATCH im Backend passen. */
const MAX_BATCH = 25;
const PREVIEW_CHARS = 110;

/**
 * Die Inbox sammelt, was noch Aufmerksamkeit braucht: Aufgaben ohne Termin
 * und Notizen, aus denen noch keine Aufgabe geworden ist.
 */
export function InboxView() {
  const tasks = useStore((state) => state.tasks);
  const actions = useTaskActions();

  const [pending, setPending] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);

  const undated = tasks.filter((task) => !task.completed && !task.dueDate).sort(compareTasks);

  const load = useCallback(() => {
    api.notes
      .needingAttention()
      .then(setPending)
      .catch(() => setPending([]));
  }, []);

  useEffect(load, [load]);

  const openNote = (note: Note) => {
    requestView('notes');
    requestOpenNote(note.id);
  };

  const analyzeAll = async () => {
    const batch = pending.slice(0, MAX_BATCH).map((note) => note.id);
    if (batch.length === 0) return;

    setBusy(true);
    try {
      const summary = await api.ai.analyzeMany(batch);
      await refreshAll();
      load();

      const parts = [`${summary.analyzed} analysiert`];
      if (summary.created > 0) parts.push(`${summary.created} Aufgabe(n) erstellt`);
      if (summary.failed > 0) parts.push(`${summary.failed} fehlgeschlagen`);
      showToast({
        kind: summary.failed > 0 ? 'info' : 'success',
        message: parts.join(' · '),
      });

      // Offene Bestätigungen kommen nacheinander, nicht alle auf einmal.
      if (summary.pending.length > 0) openSuggestionQueue(summary.pending);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const nothingToDo = undated.length === 0 && pending.length === 0;

  return (
    <div className="main__body">
      {pending.length > 0 ? (
        <section className="section">
          <h3 className="section__title">
            Notizen ohne Aufgabe
            <span className="section__count">{pending.length}</span>
          </h3>
          <p className="field__hint" style={{ marginBottom: 8 }}>
            Diese Notizen wurden nie analysiert oder der letzte Versuch ist gescheitert.
          </p>

          <div className="field__row" style={{ marginBottom: 8 }}>
            <Button variant="primary" disabled={busy} onClick={() => void analyzeAll()}>
              {busy
                ? 'Analysiert...'
                : `${Math.min(pending.length, MAX_BATCH)} Notiz(en) analysieren`}
            </Button>
            {busy ? <span className="spinner" aria-label="Analyse läuft" /> : null}
            {pending.length > MAX_BATCH ? (
              <span className="field__hint" style={{ alignSelf: 'center' }}>
                Höchstens {MAX_BATCH} pro Durchgang - jede Notiz ist ein API-Aufruf.
              </span>
            ) : null}
          </div>

          {pending.map((note) => (
            <button
              key={note.id}
              type="button"
              className="note-item note-item--row"
              onClick={() => openNote(note)}
            >
              <span className="note-item__preview">
                {note.content.replace(/\s+/g, ' ').slice(0, PREVIEW_CHARS)}
              </span>
              <span className="note-item__meta">
                {formatDateTime(note.updatedAt)}
                {note.lastAnalysisStatus === 'failed' ? (
                  <span className="tag tag--warning">Analyse fehlgeschlagen</span>
                ) : null}
              </span>
            </button>
          ))}
        </section>
      ) : null}

      <TaskGroup
        title="Ohne Termin"
        tasks={undated}
        onToggle={actions.toggle}
        onEdit={actions.startEdit}
        onDelete={actions.remove}
        onOpenSource={actions.openSource}
      />

      {nothingToDo ? (
        <EmptyState>
          Nichts offen - jede Aufgabe hat einen Termin und jede Notiz wurde angeschaut.
        </EmptyState>
      ) : null}
    </div>
  );
}
