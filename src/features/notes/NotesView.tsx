import { useEffect, useMemo, useRef, useState } from 'react';

import { LabelChip, LabelDots } from '@/components/LabelChip';
import { Button, EmptyState, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import {
  clearNoteFilters,
  openSuggestionDialog,
  refreshNotes,
  refreshTasks,
  reportError,
  run,
  setNoteFolder,
  setNoteSearch,
  showToast,
  toggleNoteLabel,
  useStore,
} from '@/lib/store';
import type { AnalysisResult, Label, Note } from '@/types';
import { formatDateTime } from '@/utils/date';
import { OrganizeDialog } from './OrganizeDialog';

const ANALYSIS_LABEL: Record<string, string> = {
  ok: 'analysiert',
  empty: 'keine Aufgabe erkannt',
  failed: 'Analyse fehlgeschlagen',
};

export function NotesView() {
  const notes = useStore((state) => state.notes);
  const tasks = useStore((state) => state.tasks);
  const folders = useStore((state) => state.folders);
  const labels = useStore((state) => state.labels);
  const search = useStore((state) => state.noteSearch);
  const folderFilter = useStore((state) => state.noteFolder);
  const labelFilter = useStore((state) => state.noteLabels);
  const autoAnalyze = useStore((state) => state.status?.settings.ai.autoAnalyzeOnSave ?? false);
  const newNoteSignal = useStore((state) => state.newNoteSignal);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftFolder, setDraftFolder] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const selected = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId],
  );

  const labelById = useMemo(() => {
    const map = new Map<string, Label>();
    for (const label of labels) map.set(label.id, label);
    return map;
  }, [labels]);

  const resolveLabels = (ids: string[]): Label[] =>
    ids.map((id) => labelById.get(id)).filter((label): label is Label => Boolean(label));

  const derivedTasks = useMemo(
    () => tasks.filter((task) => task.sourceNoteId && task.sourceNoteId === selectedId),
    [tasks, selectedId],
  );

  useEffect(() => {
    if (newNoteSignal === 0) return;
    setSelectedId(null);
    setDraft('');
    setDraftFolder(folderFilter !== 'all' && folderFilter !== 'none' ? folderFilter : '');
    setDirty(false);
    editorRef.current?.focus();
  }, [newNoteSignal, folderFilter]);

  const openNote = (note: Note) => {
    setSelectedId(note.id);
    setDraft(note.content);
    setDraftFolder(note.folderId ?? '');
    setDirty(false);
  };

  /** Speichert und liefert die ID - die Notiz geht nie verloren. */
  const save = async (): Promise<string | null> => {
    if (!draft.trim()) return selectedId;
    if (!dirty && selectedId) return selectedId;

    try {
      const note = selectedId
        ? await api.notes.update(selectedId, draft)
        : await api.notes.create(draft, draftFolder || null);
      setSelectedId(note.id);
      setDirty(false);
      await refreshNotes();
      return note.id;
    } catch (error) {
      reportError(error);
      return null;
    }
  };

  const analyze = async (noteId: string) => {
    setAnalyzing(true);
    try {
      const result: AnalysisResult = await api.ai.analyze(noteId);
      handleAnalysis(result);
    } catch (error) {
      reportError(error);
    } finally {
      setAnalyzing(false);
      await refreshNotes();
    }
  };

  const handleAnalysis = (result: AnalysisResult) => {
    if (result.needsConfirmation && result.suggestions.length > 0) {
      openSuggestionDialog(result);
      return;
    }
    if (result.createdTaskIds.length > 0) {
      showToast({
        kind: 'success',
        message: `${result.createdTaskIds.length} Task(s) aus der Notiz erstellt`,
      });
      void refreshTasks();
      return;
    }
    showToast({ kind: 'info', message: 'Claude hat keine konkrete Aufgabe erkannt.' });
  };

  const saveAndMaybeAnalyze = async () => {
    const noteId = await save();
    if (!noteId) return;
    showToast({ kind: 'success', message: 'Notiz gespeichert' });
    if (autoAnalyze) await analyze(noteId);
  };

  const removeNote = async () => {
    if (!selectedId) return;
    const result = await run(() => api.notes.remove(selectedId), { success: 'Notiz gelöscht' });
    if (result !== null) {
      setSelectedId(null);
      setDraft('');
      setDirty(false);
    }
  };

  const moveToFolder = async (folderId: string) => {
    setDraftFolder(folderId);
    if (!selectedId) return;
    await run(() => api.notes.setFolder(selectedId, folderId || null), { refresh: false });
    await refreshNotes();
  };

  const toggleLabelOnNote = async (labelId: string) => {
    if (!selected) return;
    const next = selected.labels.includes(labelId)
      ? selected.labels.filter((id) => id !== labelId)
      : [...selected.labels, labelId];
    await run(() => api.notes.setLabels(selected.id, next), { refresh: false });
    await refreshNotes();
  };

  const folderName = (id: string | null) =>
    id ? (folders.find((folder) => folder.id === id)?.name ?? null) : null;

  const filtersActive = folderFilter !== 'all' || labelFilter.length > 0 || search !== '';

  return (
    <div className="notes">
      <div className="notes__list">
        <div className="notes__filters">
          <TextInput
            placeholder="Notizen durchsuchen"
            value={search}
            onChange={(event) => void setNoteSearch(event.currentTarget.value)}
          />

          <div className="notes__filter-row">
            <select
              className="select"
              value={folderFilter}
              onChange={(event) => void setNoteFolder(event.currentTarget.value)}
            >
              <option value="all">Alle Ordner</option>
              <option value="none">Ohne Ordner</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={() => setOrganizeOpen(true)} title="Ordner und Labels verwalten">
              Verwalten
            </Button>
          </div>

          {labels.length > 0 ? (
            <div className="notes__label-filter">
              {labels.map((label) => (
                <LabelChip
                  key={label.id}
                  label={label}
                  active={labelFilter.includes(label.id)}
                  onClick={() => void toggleNoteLabel(label.id)}
                />
              ))}
            </div>
          ) : null}

          {filtersActive ? (
            <Button variant="ghost" onClick={() => void clearNoteFilters()}>
              Filter zurücksetzen
            </Button>
          ) : null}
        </div>

        <div className="notes__items">
          {notes.length === 0 ? (
            <EmptyState>{filtersActive ? 'Keine Treffer' : 'Noch keine Notizen'}</EmptyState>
          ) : (
            notes.map((note) => (
              <button
                key={note.id}
                type="button"
                className="note-item"
                aria-current={note.id === selectedId}
                onClick={() => openNote(note)}
              >
                <span className="note-item__preview">{note.content}</span>
                <span className="note-item__meta">
                  {folderName(note.folderId) ? `${folderName(note.folderId)} · ` : ''}
                  {formatDateTime(note.updatedAt)}
                  {note.lastAnalysisStatus
                    ? ` · ${ANALYSIS_LABEL[note.lastAnalysisStatus] ?? note.lastAnalysisStatus}`
                    : ''}
                  <LabelDots labels={resolveLabels(note.labels)} />
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="notes__editor">
        <textarea
          ref={editorRef}
          value={draft}
          placeholder="Frei schreiben. Beispiel: Morgen Mittag Datenbankmigration vorbereiten und am Abend Nico informieren."
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setDirty(true);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              void saveAndMaybeAnalyze();
            }
          }}
        />

        <div className="notes__assign">
          <select
            className="select input--compact"
            value={draftFolder}
            onChange={(event) => void moveToFolder(event.currentTarget.value)}
          >
            <option value="">Ohne Ordner</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>

          {labels.length === 0 ? (
            <span className="field__hint">Labels lassen sich unter „Verwalten“ anlegen.</span>
          ) : selected ? (
            <div className="notes__label-filter">
              {labels.map((label) => (
                <LabelChip
                  key={label.id}
                  label={label}
                  active={selected.labels.includes(label.id)}
                  title={
                    selected.labels.includes(label.id)
                      ? `${label.name} entfernen`
                      : `${label.name} zuweisen`
                  }
                  onClick={() => void toggleLabelOnNote(label.id)}
                />
              ))}
            </div>
          ) : (
            <span className="field__hint">Labels sind nach dem Speichern zuweisbar.</span>
          )}
        </div>

        {derivedTasks.length > 0 ? (
          <div style={{ paddingTop: 10 }}>
            <h3 className="section__title">
              Aus dieser Notiz<span className="section__count">{derivedTasks.length}</span>
            </h3>
            {derivedTasks.map((task) => (
              <div key={task.id} className="task-row" data-completed={task.completed}>
                <span />
                <span className="task-row__time">{task.dueTime ?? ''}</span>
                <span className="task-row__title">{task.title}</span>
                <span className="task-row__meta">{task.dueDate ?? 'ohne Termin'}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="notes__editor-footer">
          <span>
            {selected
              ? `Erstellt ${formatDateTime(selected.createdAt)} · Geändert ${formatDateTime(selected.updatedAt)}`
              : 'Neue Notiz'}
            {dirty ? ' · nicht gespeichert' : ''}
          </span>
          <span className="field__row">
            {analyzing ? <span className="spinner" aria-label="Analyse läuft" /> : null}
            {selectedId ? (
              <Button variant="danger" onClick={() => void removeNote()}>
                Löschen
              </Button>
            ) : null}
            <Button
              onClick={() => {
                void (async () => {
                  const noteId = await save();
                  if (noteId) await analyze(noteId);
                })();
              }}
              disabled={analyzing || !draft.trim()}
            >
              Mit Claude analysieren
            </Button>
            <Button
              variant="primary"
              onClick={() => void saveAndMaybeAnalyze()}
              disabled={!draft.trim() || (!dirty && Boolean(selectedId))}
            >
              Speichern
            </Button>
          </span>
        </div>
      </div>

      {organizeOpen ? <OrganizeDialog onClose={() => setOrganizeOpen(false)} /> : null}
    </div>
  );
}
