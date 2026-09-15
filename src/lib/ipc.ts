import { invoke } from '@tauri-apps/api/core';

import type {
  AnalysisResult,
  AppSettings,
  AppStatus,
  BackupInfo,
  CompletionResult,
  ConnectionTest,
  FeedbackSummary,
  Folder,
  ImportSummary,
  Label,
  MarkdownImportSummary,
  ModelInfo,
  Note,
  QuickResult,
  ReviewStatus,
  SearchResults,
  SuggestionDecision,
  Task,
  TaskDraft,
  TaskEdit,
  TrashContents,
  UpdateInfo,
  UsageSummary,
} from '@/types';

export type ErrorCode =
  | 'DB_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'API_KEY_MISSING'
  | 'API_KEY_INVALID'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'API_ERROR'
  | 'INVALID_AI_RESPONSE'
  | 'UPDATE_UNAVAILABLE'
  | 'SECRET_STORE_ERROR'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

export class BackendError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(code: ErrorCode, message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function toBackendError(raw: unknown): BackendError {
  if (raw && typeof raw === 'object' && 'code' in raw && 'message' in raw) {
    const value = raw as { code: string; message: string; retryAfterSeconds?: number | null };
    return new BackendError(
      value.code as ErrorCode,
      value.message,
      value.retryAfterSeconds ?? null,
    );
  }
  return new BackendError('UNKNOWN', typeof raw === 'string' ? raw : 'Unbekannter Fehler', null);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toBackendError(error);
  }
}

export const api = {
  notes: {
    list: (search?: string, folder?: string, labelIds?: string[]) =>
      call<Note[]>('list_notes', {
        search: search ?? null,
        folder: folder ?? null,
        labelIds: labelIds ?? null,
      }),
    get: (id: string) => call<Note>('get_note', { id }),
    create: (content: string, folderId?: string | null) =>
      call<Note>('create_note', { content, folderId: folderId ?? null }),
    update: (id: string, content: string) => call<Note>('update_note', { id, content }),
    remove: (id: string) => call<void>('delete_note', { id }),
    setFolder: (noteId: string, folderId: string | null) =>
      call<Note>('set_note_folder', { noteId, folderId }),
    setLabels: (noteId: string, labelIds: string[]) =>
      call<Note>('set_note_labels', { noteId, labelIds }),
    tasks: (noteId: string) => call<Task[]>('tasks_for_note', { noteId }),
  },
  folders: {
    list: () => call<Folder[]>('list_folders'),
    create: (name: string) => call<Folder>('create_folder', { name }),
    rename: (id: string, name: string) => call<Folder>('rename_folder', { id, name }),
    remove: (id: string) => call<void>('delete_folder', { id }),
  },
  labels: {
    list: () => call<Label[]>('list_labels'),
    colors: () => call<string[]>('label_colors'),
    create: (name: string, color: string) => call<Label>('create_label', { name, color }),
    update: (id: string, name: string, color: string) =>
      call<Label>('update_label', { id, name, color }),
    remove: (id: string) => call<void>('delete_label', { id }),
  },
  tasks: {
    list: () => call<Task[]>('list_tasks', { includeCompleted: true }),
    create: (draft: TaskDraft) => call<Task>('create_task', { draft }),
    update: (edit: TaskEdit) => call<Task>('update_task', { edit }),
    remove: (id: string) => call<void>('delete_task', { id }),
    setCompleted: (id: string, completed: boolean) =>
      call<CompletionResult>('set_task_completed', { id, completed }),
    snooze: (id: string, minutes?: number) =>
      call<Task>('snooze_task', { id, minutes: minutes ?? null }),
    clearSnooze: (id: string) => call<Task>('clear_snooze', { id }),
    bulkComplete: (ids: string[], completed: boolean) =>
      call<number>('bulk_set_completed', { ids, completed }),
    bulkReschedule: (ids: string[], dueDate: string | null, dueTime: string | null) =>
      call<number>('bulk_reschedule', { ids, dueDate, dueTime }),
    bulkDelete: (ids: string[]) => call<number>('bulk_delete', { ids }),
  },
  trash: {
    list: () => call<TrashContents>('list_trash'),
    restoreNote: (id: string) => call<Note>('restore_note', { id }),
    restoreTask: (id: string) => call<Task>('restore_task', { id }),
    purgeNote: (id: string) => call<void>('purge_note', { id }),
    purgeTask: (id: string) => call<void>('purge_task', { id }),
    empty: () => call<number>('empty_trash'),
  },
  search: (term: string, limit?: number) =>
    call<SearchResults>('search', { term, limit: limit ?? null }),
  ai: {
    analyze: (noteId: string) => call<AnalysisResult>('analyze_note', { noteId }),
    createFromSuggestions: (noteId: string, decisions: SuggestionDecision[]) =>
      call<Task[]>('create_tasks_from_suggestions', { noteId, decisions }),
    feedback: () => call<FeedbackSummary>('ai_feedback_summary'),
    clearFeedback: () => call<number>('clear_ai_feedback'),
  },
  updates: {
    check: () => call<UpdateInfo>('check_for_update'),
    install: () => call<void>('install_update'),
  },
  settings: {
    status: () => call<AppStatus>('get_status'),
    save: (settings: AppSettings) => call<AppSettings>('save_settings', { settings }),
    setApiKey: (key: string) => call<string | null>('set_api_key', { key }),
    clearApiKey: () => call<void>('clear_api_key'),
    testConnection: (model?: string) =>
      call<ConnectionTest>('test_connection', { model: model ?? null }),
    models: () => call<ModelInfo[]>('list_models'),
    usage: () => call<UsageSummary>('usage_summary'),
  },
  backup: {
    directory: () => call<string>('backup_directory'),
    now: () => call<BackupInfo>('backup_now'),
    list: () => call<BackupInfo[]>('list_backups'),
    import: (fileName: string) => call<ImportSummary>('import_backup', { fileName }),
    exportMarkdown: () => call<BackupInfo>('export_markdown'),
    importMarkdown: (directory: string, folderId: string | null) =>
      call<MarkdownImportSummary>('import_markdown', { directory, folderId }),
  },
  review: {
    status: () => call<ReviewStatus>('review_status'),
    complete: () => call<void>('complete_review'),
  },
  quick: {
    capture: (content: string) => call<QuickResult>('quick_capture', { content }),
    hide: () => call<void>('hide_quick_window'),
    open: () => call<void>('open_quick_window'),
    setShortcut: (shortcut: string, enabled: boolean) =>
      call<string>('set_quick_shortcut', { shortcut, enabled }),
  },
  system: {
    setAutostart: (enabled: boolean) => call<boolean>('set_autostart', { enabled }),
    hideWindow: () => call<void>('hide_window'),
    quit: () => call<void>('quit_app'),
    reportTimezone: (timezone: string) => call<void>('report_timezone', { timezone }),
    completeOnboarding: (autostart: boolean) => call<void>('complete_onboarding', { autostart }),
    logFilePath: () => call<string>('log_file_path'),
  },
};

export const EVENTS = {
  dataChanged: 'notely://data-changed',
  navigate: 'notely://navigate',
  notificationsBlocked: 'notely://notifications-blocked',
  quickOpened: 'notely://quick-opened',
  suggestions: 'notely://suggestions',
  updateAvailable: 'notely://update-available',
} as const;

/** Benutzerlesbare Meldung je Fehlercode - technische Details bleiben im Log. */
export function describeError(error: unknown): string {
  if (!(error instanceof BackendError)) {
    return error instanceof Error ? error.message : 'Unerwarteter Fehler';
  }

  switch (error.code) {
    case 'API_KEY_MISSING':
      return 'Kein Claude API-Key hinterlegt. Der Key wird in den Einstellungen gesetzt.';
    case 'API_KEY_INVALID':
      return 'Der Claude API-Key wurde abgelehnt. Bitte in den Einstellungen prüfen.';
    case 'RATE_LIMITED':
      return error.retryAfterSeconds
        ? `Rate Limit erreicht. Erneut versuchen in ${error.retryAfterSeconds} Sekunden.`
        : 'Rate Limit der Claude API erreicht. Bitte kurz warten.';
    case 'NETWORK_ERROR':
      return 'Keine Verbindung zu Claude. Die Notiz wurde gespeichert und kann später analysiert werden.';
    case 'INVALID_AI_RESPONSE':
      return 'Claude hat keine verwertbare Antwort geliefert. Die Notiz bleibt unverändert.';
    case 'UPDATE_UNAVAILABLE':
      return 'Im Repository liegt noch kein Update-Katalog. Der erste veröffentlichte Release mit der neuen Pipeline legt ihn an.';
    case 'SECRET_STORE_ERROR':
      return 'Der Windows Credential Manager ist nicht erreichbar.';
    case 'DB_ERROR':
      return 'Die lokale Datenbank konnte nicht gelesen oder geschrieben werden.';
    default:
      return error.message;
  }
}
