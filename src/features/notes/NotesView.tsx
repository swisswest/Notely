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
import { VersionDialog } from './VersionDialog';

const ANALYSIS_LABEL: Record<string, string> = {
  ok: 'analysiert',
  empty: 'keine Aufgabe erkannt',
  failed: 'Analyse fehlgeschlagen',
};

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const SAVE_STATE_LABEL: Record<SaveState, string> = {
  idle: '',
  dirty: 'nicht gespeichert',
  saving: 'speichert...',
  saved: 'gespeichert',
  error: 'nicht gespeichert - letzter Versuch fehlgeschlagen',
};

/** So lange muss Ruhe sein, bevor automatisch gespeichert wird. */
const AUTOSAVE_DELAY_MS = 1200;
/** Kürzere Texte legen noch keine neue Notiz an - sonst entstehen Fragmente. */
const AUTOSAVE_MIN_CHARS = 3;

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
  const openNoteRequest = useStore((state) => state.openNote);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftFolder, setDraftFolder] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Aus der Suche heraus wird eine bestimmte Notiz geöffnet.
  useEffect(() => {
    if (!openNoteRequest) return;
    const note = notes.find((entry) => entry.id === openNoteRequest.id);
    if (!note) return;
    setSelectedId(note.id);
    setDraft(note.content);
    setDraftFolder(note.folderId ?? '');
    setDirty(false);
  }, [openNoteRequest, notes]);

  useEffect(() => {
    if (newNoteSignal === 0) return;
    setSelectedId(null);
    setDraft('');
    setDraftFolder(folderFilter !== 'all' && folderFilter !== 'none' ? folderFilter : '');
    setDirty(false);
    setSaveState('idle');
    editorRef.current?.focus();
  }, [newNoteSignal, folderFilter]);

  /**
   * Der Autosave-Timer feuert spaeter als der Render, in dem er gesetzt wurde.
   * Ueber den State gelesen wuerde er deshalb einen veralteten Text speichern
   * oder - schlimmer - eine zweite Notiz anlegen, weil die frisch vergebene ID
   * in der alten Closure noch fehlt. Darum laufen die drei Werte, auf die es
   * beim Speichern ankommt, ueber Refs.
   */
  const draftRef = useRef(draft);
  const selectedIdRef = useRef(selectedId);
  const folderRef = useRef(draftFolder);
  const savingRef = useRef(false);
  draftRef.current = draft;
  selectedIdRef.current = selectedId;
  folderRef.current = draftFolder;

  const cancelAutosave = () => {
    if (autosaveTimer.current !== null) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
  };

  const openNote = (note: Note) => {
    cancelAutosave();
    setSelectedId(note.id);
    setDraft(note.content);
    setDraftFolder(note.folderId ?? '');
    setDirty(false);
    setSaveState('idle');
  };

  /**
   * Speichert und liefert die ID - die Notiz geht nie verloren.
   *
   * Unveraenderter Text ist im Backend ein No-op, deshalb muss hier nicht
   * geraten werden, ob sich seit dem letzten Mal etwas getan hat.
   */
  const save = async (): Promise<string | null> => {
    const text = draftRef.current;
    if (!text.trim()) return selectedIdRef.current;
    if (savingRef.current) return selectedIdRef.current;

    cancelAutosave();
    savingRef.current = true;
    setSaveState('saving');
    try {
      const existing = selectedIdRef.current;
      const note = existing
        ? await api.notes.update(existing, text)
        : await api.notes.create(text, folderRef.current || null);

      selectedIdRef.current = note.id;
      setSelectedId(note.id);

      // Waehrend des Speicherns kann weitergetippt worden sein.
      if (draftRef.current === text) {
        setDirty(false);
        setSaveState('saved');
      } else {
        scheduleAutosave(draftRef.current);
      }

      await refreshNotes();
      return note.id;
    } catch (error) {
      setSaveState('error');
      reportError(error);
      return null;
    } finally {
      savingRef.current = false;
    }
  };

  /**
   * Speichert nach kurzer Ruhezeit von selbst. Der Text einer Notiz soll
   * nicht davon abhaengen, ob jemand an Strg+S gedacht hat.
   */
  const scheduleAutosave = (text: string) => {
    cancelAutosave();
    const enough = selectedIdRef.current
      ? text.trim().length > 0
      : text.trim().length >= AUTOSAVE_MIN_CHARS;
    if (!enough) return;

    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      void save();
    }, AUTOSAVE_DELAY_MS);
  };

  // Beim Verlassen der Ansicht laeuft kein Timer weiter.
  useEffect(() => cancelAutosave, []);

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
        message: `${result.createdTaskIds.length} Aufgabe(n) aus der Notiz erstellt`,
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
    cancelAutosave();
    const result = await run(() => api.notes.remove(selectedId), { success: 'Notiz gelöscht' });
    if (result !== null) {
      selectedIdRef.current = null;
      draftRef.current = '';
      setSelectedId(null);
      setDraft('');
      setDirty(false);
      setSaveState('idle');
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
            onChange={(event) => setNoteSearch(event.currentTarget.value)}
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
            const text = event.currentTarget.value;
            setDraft(text);
            setDirty(true);
            setSaveState('dirty');
            scheduleAutosave(text);
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
            {SAVE_STATE_LABEL[saveState] ? (
              <span data-save-state={saveState}> · {SAVE_STATE_LABEL[saveState]}</span>
            ) : null}
          </span>
          <span className="field__row">
            {analyzing ? <span className="spinner" aria-label="Analyse läuft" /> : null}
            {selectedId ? (
              <Button variant="ghost" onClick={() => setVersionsOpen(true)} title="Frühere Fassungen">
                Verlauf
              </Button>
            ) : null}
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
      {versionsOpen && selectedId ? (
        <VersionDialog
          noteId={selectedId}
          onRestored={(content) => {
            cancelAutosave();
            draftRef.current = content;
            setDraft(content);
            setDirty(false);
            setSaveState('saved');
          }}
          onClose={() => setVersionsOpen(false)}
        />
      ) : null}
    </div>
  );
}
