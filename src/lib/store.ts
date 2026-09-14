import { useSyncExternalStore } from 'react';

import { api, describeError } from '@/lib/ipc';
import type { AnalysisResult, AppStatus, Folder, Label, Note, Task } from '@/types';

export interface Toast {
  kind: 'info' | 'success' | 'error';
  message: string;
}

export type DialogState =
  | { kind: 'task'; task: Task | null }
  | { kind: 'suggestions'; result: AnalysisResult }
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

export function closeDialog(): void {
  setState({ dialog: null });
}

export function requestNewNote(): void {
  setState({ newNoteSignal: state.newNoteSignal + 1 });
}

/** Öffnet eine bestimmte Notiz im Editor - aus der Suche heraus. */
export function requestOpenNote(id: string): void {
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

export async function setNoteSearch(term: string): Promise<void> {
  setState({ noteSearch: term });
  await reloadNotes();
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
