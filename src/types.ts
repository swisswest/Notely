export interface Note {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  analyzedAt: string | null;
  lastAnalysisStatus: AnalysisStatus | null;
  folderId: string | null;
  deletedAt: string | null;
  labels: string[];
}

export type AnalysisStatus = 'ok' | 'empty' | 'failed';

/** Eine gesicherte Fassung einer Notiz. */
export interface NoteVersion {
  id: number;
  noteId: string;
  content: string;
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  position: number;
  createdAt: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

/** "all" = alles, "none" = ohne Ordner, sonst eine Ordner-ID. */
export type FolderFilter = string;

export interface Task {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  dueTime: string | null;
  completed: boolean;
  completedAt: string | null;
  sourceNoteId: string | null;
  aiGenerated: boolean;
  confidence: number | null;
  snoozedUntil: string | null;
  deletedAt: string | null;
  priority: Priority;
  /** Label-IDs; die Bezeichnungen loest die Oberflaeche selbst auf. */
  labels: string[];
  /** Wiederholungsregel in Textform, z. B. "weekly:1:mo,we". */
  recurrence: string | null;
  /** Klammert alle Aufgaben einer Serie. */
  seriesId: string | null;
}

export type Priority = 'low' | 'normal' | 'high';

export interface TrashContents {
  notes: Note[];
  tasks: Task[];
  retentionDays: number;
}

export interface SearchResults {
  notes: Note[];
  tasks: Task[];
}

export interface UsagePeriod {
  analyses: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  today: UsagePeriod;
  month: UsagePeriod;
  total: UsagePeriod;
  lastModel: string | null;
}

export interface TaskDraft {
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  sourceNoteId: string | null;
  aiGenerated: boolean;
  confidence: number | null;
  recurrence: string | null;
  priority: Priority;
}

export interface TaskEdit {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: string | null;
  priority: Priority;
}

/** Ergebnis des Abhakens: bei einer Serie entsteht direkt der nächste Termin. */
export interface CompletionResult {
  task: Task;
  followUp: Task | null;
}

export interface TaskSuggestion {
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  confidence: number;
  daypartKey: string | null;
  inPast: boolean;
}

/**
 * Was mit einem Vorschlag passiert ist. `accepted` trägt den Stand, der
 * übernommen werden soll - null bedeutet verworfen.
 */
export interface SuggestionDecision {
  original: TaskSuggestion;
  accepted: TaskSuggestion | null;
}

export type Verdict = 'accepted' | 'edited' | 'rejected';

export interface FeedbackEntry {
  id: number;
  createdAt: string;
  noteId: string | null;
  model: string;
  verdict: Verdict;
  noteExcerpt: string;
  suggested: TaskSuggestion;
  corrected: TaskSuggestion | null;
}

export interface FeedbackCounts {
  accepted: number;
  edited: number;
  rejected: number;
}

export interface FeedbackSummary {
  total: FeedbackCounts;
  recent: FeedbackCounts;
  misses: FeedbackEntry[];
}

/** Ergebnis einer Sammelanalyse. */
export interface BatchAnalysis {
  analyzed: number;
  failed: number;
  created: number;
  pending: AnalysisResult[];
}

/** Ergebnis einer Sicherungspruefung - ohne Import. */
export interface BackupCheck {
  fileName: string;
  ok: boolean;
  message: string;
  appVersion: string;
  exportedAt: string;
  notes: number;
  tasks: number;
  folders: number;
  labels: number;
  sha256: string;
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version: string | null;
  notes: string | null;
}

export interface AnalysisResult {
  noteId: string;
  suggestions: TaskSuggestion[];
  rejected: string[];
  createdTaskIds: string[];
  needsConfirmation: boolean;
}

export interface Daypart {
  key: string;
  label: string;
  time: string;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface AppSettings {
  claude: {
    model: string;
    maxOutputTokens: number;
  };
  dayparts: Daypart[];
  notifications: {
    enabled: boolean;
    leadMinutes: number[];
    notifyAtDue: boolean;
    remindOverdue: boolean;
    overdueIntervalMinutes: number;
    defaultSnoozeMinutes: number;
  };
  windows: {
    autostart: boolean;
    startMinimized: boolean;
    closeToTray: boolean;
  };
  ai: {
    autoAnalyzeOnSave: boolean;
    confirmBeforeCreate: boolean;
    autoCreateMinConfidence: number;
    collectFeedback: boolean;
  };
  appearance: {
    theme: ThemeMode;
  };
  backup: {
    enabled: boolean;
    directory: string;
    keep: number;
    lastBackupAt: string | null;
  };
  quickCapture: {
    enabled: boolean;
    shortcut: string;
    analyze: boolean;
  };
  review: {
    enabled: boolean;
    time: string;
    lastCompletedDate: string | null;
    lastNotifiedDate: string | null;
  };
  updates: {
    checkOnStart: boolean;
    lastSeenVersion: string | null;
    skippedVersion: string | null;
  };
  timezone: string;
  onboardingCompleted: boolean;
}

export interface BackupInfo {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ReviewStatus {
  due: boolean;
  date: string;
  time: string;
  tasks: Task[];
  completedToday: boolean;
}

export interface MarkdownImportSummary {
  imported: number;
  duplicates: number;
  skipped: number;
}

export interface ImportSummary {
  notes: number;
  tasks: number;
  folders: number;
  labels: number;
  skipped: number;
}

export interface QuickResult {
  noteId: string;
  createdTasks: number;
  analyzed: boolean;
  needsConfirmation: boolean;
  message: string;
}

export interface AppStatus {
  settings: AppSettings;
  apiKeySet: boolean;
  apiKeyHint: string | null;
  autostartEnabled: boolean;
  appVersion: string;
}

export interface ConnectionTest {
  ok: boolean;
  modelAvailable: boolean;
  message: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
}

export type ViewId = 'today' | 'inbox' | 'tasks' | 'notes' | 'trash' | 'settings';
