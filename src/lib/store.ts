import { useSyncExternalStore } from 'react';

import { api, describeError } from '@/lib/ipc';
import type {
  AnalysisResult,
  AppStatus,
  Folder,
  Label,
  Note,
  ReviewStatus,
  Task,
  ViewId,
} from '@/types';

export interface Toast {
  kind: 'info' | 'success' | 'error';
  message: string;
}

export type DialogState =
  | { kind: 'task'; task: Task | null }
  | { kind: 'suggestions'; result: AnalysisResult }
  | { kind: 'review'; status: ReviewStatus }
  | null;

interface StoreState {
  status: AppStatus | null;
  tasks: Task[];
  notes: Note[];
  folders: Folder[];
  labels: Label[];
  ready: boolean;
  busy: boolean;
  toast: Toast | null;
  noteSearch: string;
  /** "all", "none" oder eine Ordner-ID. */
  noteFolder: string;
  noteLabels: string[];
  dialog: DialogState;
  /** Zähler, mit dem andere Ansichten eine neue Notiz anfordern. */
  newNoteSignal: number;
  /** Von der Suche angeforderte Notiz; der Zähler löst das Öffnen aus. */
  openNote: { id: string; token: number } | null;
  /** Angeforderter Ansichtswechsel; der Zähler löst ihn aus. */
  viewRequest: { id: ViewId; token: number } | null;
  /**
   * Weitere Vorschläge, die nach dem aktuellen Dialog zu bestätigen sind.
   * Entsteht bei der Sammelanalyse mehrerer Notizen.
   */
  suggestionQueue: AnalysisResult[];
}

const initialState: StoreState = {
  status: null,
  tasks: [],
  notes: [],
  folders: [],
  labels: [],
  ready: false,
  busy: false,
  toast: null,
  noteSearch: '',
  noteFolder: 'all',
  noteLabels: [],
  dialog: null,
  newNoteSignal: 0,
  openNote: null,
  viewRequest: null,
  suggestionQueue: [],
};

let state: StoreState = initialState;
const listeners = new Set<() => void>();

function setState(patch: Partial<StoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStore<T>(selector: (value: StoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initialState),
  );
}

export function openTaskDialog(task: Task | null = null): void {
  setState({ dialog: { kind: 'task', task } });
}

export function openSuggestionDialog(result: AnalysisResult): void {
  setState({ dialog: { kind: 'suggestions', result } });
}

/**
 * Arbeitet mehrere Analyseergebnisse nacheinander ab. Alles gleichzeitig
 * anzuzeigen wäre unübersichtlich; eine Liste, die man später abarbeiten muss,
 * würde vergessen.
 */
export function openSuggestionQueue(results: AnalysisResult[]): void {
  const [first, ...rest] = results;
  if (!first) return;
  setState({ dialog: { kind: 'suggestions', result: first }, suggestionQueue: rest });
}

/** Wechselt die Ansicht aus einer beliebigen Komponente heraus. */
export function requestView(id: ViewId): void {
  setState({ viewRequest: { id, token: (state.viewRequest?.token ?? 0) + 1 } });
}

export function openReviewDialog(status: ReviewStatus): void {
  setState({ dialog: { kind: 'review', status } });
}

export function closeDialog(): void {
  const [next, ...rest] = state.suggestionQueue;
  if (next) {
    setState({ dialog: { kind: 'suggestions', result: next }, suggestionQueue: rest });
    return;
  }
  setState({ dialog: null });
}

export function requestNewNote(): void {
  setState({ newNoteSignal: state.newNoteSignal + 1 });
}

/**
 * Öffnet eine bestimmte Notiz im Editor - aus der Suche, aus einer Aufgabe
 * oder aus der Antwort auf eine Frage heraus.
 *
 * Die Filter werden vorher geräumt. Ohne das bleibt das Öffnen wirkungslos,
 * sobald die Notiz gerade durch Ordner, Label oder Suchtext aus der Liste
 * fällt: die Ansicht sucht sie in der geladenen Liste und findet sie nicht.
 * Ein Klick, der sichtbar nichts tut, ist schlimmer als ein zurückgesetzter
 * Filter.
 */
export async function requestOpenNote(id: string): Promise<void> {
  const filtered =
    state.noteFolder !== 'all' || state.noteLabels.length > 0 || state.noteSearch !== '';
  if (filtered) await clearNoteFilters();
  setState({ openNote: { id, token: (state.openNote?.token ?? 0) + 1 } });
}

export function showToast(toast: Toast): void {
  setState({ toast });
}

export function clearToast(): void {
  setState({ toast: null });
}

export function reportError(error: unknown): void {
  showToast({ kind: 'error', message: describeError(error) });
}

export async function refreshTasks(): Promise<void> {
  setState({ tasks: await api.tasks.list() });
}

export async function refreshNotes(): Promise<void> {
  setState({
    notes: await api.notes.list(
      state.noteSearch || undefined,
      state.noteFolder,
      state.noteLabels.length > 0 ? state.noteLabels : undefined,
    ),
  });
}

export async function refreshOrganization(): Promise<void> {
  const [folders, labels] = await Promise.all([api.folders.list(), api.labels.list()]);
  setState({ folders, labels });
}

export async function refreshStatus(): Promise<void> {
  setState({ status: await api.settings.status() });
}

export async function refreshAll(): Promise<void> {
  try {
    const [status, tasks, folders, labels] = await Promise.all([
      api.settings.status(),
      api.tasks.list(),
      api.folders.list(),
      api.labels.list(),
    ]);
    setState({ status, tasks, folders, labels, ready: true });
    await refreshNotes();
  } catch (error) {
    reportError(error);
    setState({ ready: true });
  }
}

async function reloadNotes(): Promise<void> {
  try {
    await refreshNotes();
  } catch (error) {
    reportError(error);
  }
}

/**
 * Die Suche lädt erst, wenn kurz nichts mehr getippt wurde. Ohne das setzt
 * jeder Tastendruck eine Datenbankabfrage ab, und bei vielen Notizen
 * überholen sich die Antworten gegenseitig.
 */
const SEARCH_DELAY_MS = 250;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

export function setNoteSearch(term: string): void {
  setState({ noteSearch: term });
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void reloadNotes();
  }, SEARCH_DELAY_MS);
}

export async function setNoteFolder(folder: string): Promise<void> {
  setState({ noteFolder: folder });
  await reloadNotes();
}

export async function toggleNoteLabel(labelId: string): Promise<void> {
  const active = state.noteLabels.includes(labelId);
  setState({
    noteLabels: active
      ? state.noteLabels.filter((id) => id !== labelId)
      : [...state.noteLabels, labelId],
  });
  await reloadNotes();
}

export async function clearNoteFilters(): Promise<void> {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  setState({ noteFolder: 'all', noteLabels: [], noteSearch: '' });
  await reloadNotes();
}

/** Führt eine Aktion aus, zeigt Fehler an und hält die Daten aktuell. */
export async function run<T>(
  action: () => Promise<T>,
  options: { success?: string; refresh?: boolean } = {},
): Promise<T | null> {
  setState({ busy: true });
  try {
    const result = await action();
    if (options.refresh !== false) {
      await Promise.all([refreshTasks(), refreshNotes(), refreshOrganization()]);
    }
    if (options.success) {
      showToast({ kind: 'success', message: options.success });
    }
    return result;
  } catch (error) {
    reportError(error);
    return null;
  } finally {
    setState({ busy: false });
  }
}
