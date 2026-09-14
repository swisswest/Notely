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
}

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
}

export interface TaskEdit {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
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
  timezone: string;
  onboardingCompleted: boolean;
}

export interface BackupInfo {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
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
