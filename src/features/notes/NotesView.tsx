import { useEffect, useMemo, useRef, useState } from 'react';

import { LabelChip, LabelDots } from '@/components/LabelChip';
import { Markdown } from '@/components/Markdown';
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
import { ExportDialog } from './ExportDialog';
import { NoteSummary } from './NoteSummary';
import { firstImage, insertImage, isSupportedImage } from './imageInsert';
import { OrganizeDialog } from './OrganizeDialog';
import { SlashMenu } from './SlashMenu';
import { VersionDialog } from './VersionDialog';
import {
  type SlashContext,
  applyCommand,
  filterCommands,
  findSlash,
  type SlashCommand,
} from './slashCommands';

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

  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [exportOpen, setExportOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * Bilder, die in eine noch nie gespeicherte Notiz eingefügt wurden. Sie
   * haben noch keine Notiz-ID; die wird beim ersten Speichern nachgetragen.
   */
  const unassigned = useRef<string[]>([]);
  /** Angefangener Slash-Befehl vor dem Cursor, samt Position des Menüs. */
  const [slash, setSlash] = useState<(SlashContext & { top: number; left: number }) | null>(null);
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

      // Bilder aus dem Entwurf gehören jetzt zu einer Notiz. Ohne das würde
      // die Aufräumung sie nach zwei Tagen als verwaist entfernen.
      if (unassigned.current.length > 0) {
        const ids = unassigned.current;
        unassigned.current = [];
        api.attachments.assign(note.id, ids).catch(reportError);
      }

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

  /**
   * Prüft nach jeder Cursorbewegung, ob vor dem Cursor ein Slash-Befehl
   * angefangen wurde, und rechnet die Position des Menüs aus.
   *
   * Die Zeile wird über die Zeilenhöhe bestimmt statt über die echte
   * Cursorposition. Die exakt zu messen hiesse, das Textfeld in einem
   * unsichtbaren Zwilling nachzubauen - viel Aufwand dafür, dass das Menü
   * ein paar Pixel weiter rechts steht.
   */
  const updateSlash = () => {
    const area = editorRef.current;
    if (!area) return;

    const caret = area.selectionStart;
    if (caret !== area.selectionEnd) {
      setSlash(null);
      return;
    }

    const found = findSlash(area.value, caret);
    if (!found) {
      setSlash(null);
      return;
    }

    const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight) || 20;
    const line = area.value.slice(0, found.start).split('\n').length;
    const top = Math.max(area.offsetTop + line * lineHeight - area.scrollTop + 4, 4);

    setSlash({ ...found, top, left: area.offsetLeft + 12 });
  };

  /** Setzt den gewählten Baustein ein und stellt den Cursor richtig. */
  const insertCommand = (command: SlashCommand) => {
    const area = editorRef.current;
    if (!area || !slash) return;

    // Der leere Baustein entfernt nur das getippte "/bild"; das Bild selbst
    // kommt aus der Dateiauswahl, die gleich danach aufgeht.
    const result = applyCommand(area.value, slash, command);
    if (command.id === 'bild') {
      setSlash(null);
      setDraft(result.text);
      setDirty(true);
      setSaveState('dirty');
      scheduleAutosave(result.text);
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(result.caret, result.caret);
        fileInput.current?.click();
      });
      return;
    }
    setSlash(null);
    setDraft(result.text);
    setDirty(true);
    setSaveState('dirty');
    scheduleAutosave(result.text);

    // Erst nach dem Render steht der neue Text im Feld; vorher zu setzen
    // würde die Cursorposition wieder überschreiben.
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(result.caret, result.caret);
    });
  };

  /**
   * Ein Klick auf einen Link in der Vorschau kopiert die Adresse. Die Webview
   * dorthin zu navigieren würde die Notiz aus dem Fenster werfen, und einen
   * Browser starten darf Notely bewusst nicht - dafür gibt es keine Berechtigung.
   */
  const copyLink = (href: string) => {
    navigator.clipboard
      .writeText(href)
      .then(() => showToast({ kind: 'info', message: 'Adresse kopiert' }))
      .catch(() => showToast({ kind: 'error', message: 'Adresse liess sich nicht kopieren' }));
  };

  /** Legt ein Bild ab und schreibt die Referenz an die Cursorposition. */
  const addImage = async (file: File) => {
    const area = editorRef.current;
    const caret = area ? area.selectionStart : draftRef.current.length;

    try {
      const result = await insertImage(file, selectedIdRef.current, draftRef.current, caret);
      if (!selectedIdRef.current) unassigned.current.push(result.id);

      setSlash(null);
      draftRef.current = result.text;
      setDraft(result.text);
      setDirty(true);
      setSaveState('dirty');
      scheduleAutosave(result.text);

      requestAnimationFrame(() => {
        area?.focus();
        area?.setSelectionRange(result.caret, result.caret);
      });
    } catch (error) {
      reportError(error);
    }
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
                <NoteSummary content={note.content} />
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
        <div className="notes__editor-bar">
          <div className="segmented" role="group" aria-label="Ansicht">
            <button
              type="button"
              data-active={mode === 'write'}
              onClick={() => setMode('write')}
            >
              Schreiben
            </button>
            <button
              type="button"
              data-active={mode === 'preview'}
              onClick={() => {
                setSlash(null);
                setMode('preview');
              }}
            >
              Vorschau
            </button>
          </div>

          <span className="field__row">
            <span className="field__hint">
              {mode === 'write' ? 'Schrägstrich öffnet die Bausteine · Strg+V fügt Bilder ein' : 'Nur Ansicht'}
            </span>
            <Button
              variant="ghost"
              title="Bild einfügen - oder einfach mit Strg+V einsetzen"
              onClick={() => fileInput.current?.click()}
            >
              Bild
            </Button>
            <Button
              variant="ghost"
              disabled={!draft.trim()}
              title="Diese Notiz speichern, kopieren oder drucken"
              onClick={() => setExportOpen(true)}
            >
              Exportieren
            </Button>
          </span>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            // Zurücksetzen, sonst löst dieselbe Datei beim zweiten Mal nichts aus.
            event.currentTarget.value = '';
            if (isSupportedImage(file)) void addImage(file);
          }}
        />

        {/*
          Das Textfeld wird in der Vorschau nur ausgeblendet, nicht entfernt.
          Nimmt React es aus dem Baum, wirft die Webview den Rückgängig-Verlauf
          des Feldes weg - nach einem Wechsel Schreiben → Vorschau → Schreiben
          war Strg+Z tot. Der Verlauf hängt am DOM-Element, nicht am Text, also
          muss genau dieses Element stehen bleiben.
        */}
        <textarea
          ref={editorRef}
          hidden={mode === 'preview'}
          value={draft}
          placeholder="Frei schreiben. Beispiel: Morgen Mittag Datenbankmigration vorbereiten und am Abend Nico informieren."
          onChange={(event) => {
            const text = event.currentTarget.value;
            setDraft(text);
            setDirty(true);
            setSaveState('dirty');
            scheduleAutosave(text);
            // Nach dem Setzen des Werts, damit der Cursor schon steht.
            requestAnimationFrame(updateSlash);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              void saveAndMaybeAnalyze();
              return;
            }
            // Pfeiltasten, Enter und Esc gehören dem Menü, solange es offen
            // ist. Es hört selbst mit, hier wird nur nichts dazwischengefunkt.
            if (slash && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
              return;
            }
            requestAnimationFrame(updateSlash);
          }}
          onClick={updateSlash}
          onBlur={() => setSlash(null)}
          onPaste={(event) => {
            const file = firstImage(event.clipboardData);
            if (!file) return;
            // Sonst landet zusätzlich der Dateiname als Text im Feld.
            event.preventDefault();
            void addImage(file);
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            if (!dropActive) setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            const file = firstImage(event.dataTransfer);
            setDropActive(false);
            if (!file) return;
            event.preventDefault();
            void addImage(file);
          }}
          data-drop={dropActive}
        />

        {mode === 'preview' ? (
          <div className="notes__preview">
            <Markdown source={draft} onLink={copyLink} />
          </div>
        ) : null}

        {mode === 'write' && slash ? (
          <SlashMenu
            commands={filterCommands(slash.query)}
            top={slash.top}
            left={slash.left}
            onPick={insertCommand}
            onClose={() => setSlash(null)}
          />
        ) : null}

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

      {exportOpen && draft.trim() ? (
        <ExportDialog
          notes={
            selected
              ? [{ ...selected, content: draft }]
              : [
                  {
                    id: 'entwurf',
                    content: draft,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    analyzedAt: null,
                    lastAnalysisStatus: null,
                    folderId: draftFolder || null,
                    deletedAt: null,
                    labels: [],
                  },
                ]
          }
          onClose={() => setExportOpen(false)}
        />
      ) : null}
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

