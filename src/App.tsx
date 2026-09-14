import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import { CommandPalette, type Command } from '@/components/CommandPalette';
import { Sidebar } from '@/components/Sidebar';
import { Toast } from '@/components/Toast';
import { Button } from '@/components/ui';
import { EVENTS, api } from '@/lib/ipc';
import {
  clearToast,
  closeDialog,
  openSuggestionDialog,
  openTaskDialog,
  refreshAll,
  refreshNotes,
  refreshOrganization,
  refreshStatus,
  refreshTasks,
  requestNewNote,
  showToast,
  useStore,
} from '@/lib/store';
import { InboxView } from '@/features/inbox/InboxView';
import { NotesView } from '@/features/notes/NotesView';
import { SuggestionDialog } from '@/features/notes/SuggestionDialog';
import { OnboardingDialog } from '@/features/onboarding/OnboardingDialog';
import { SettingsView } from '@/features/settings/SettingsView';
import { TaskDialog } from '@/features/tasks/TaskDialog';
import { TasksView } from '@/features/tasks/TasksView';
import { TodayView } from '@/features/today/TodayView';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useTheme } from '@/hooks/useTheme';
import type { AnalysisResult, ViewId } from '@/types';

const TITLES: Record<ViewId, string> = {
  today: 'Heute',
  inbox: 'Inbox',
  tasks: 'Tasks',
  notes: 'Notizen',
  settings: 'Settings',
};

export function App() {
  const status = useStore((state) => state.status);
  const ready = useStore((state) => state.ready);
  const dialog = useStore((state) => state.dialog);
  const toast = useStore((state) => state.toast);
  const notes = useStore((state) => state.notes);
  const tasks = useStore((state) => state.tasks);

  const [view, setView] = useState<ViewId>('today');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useTheme(status?.settings.appearance.theme ?? 'system');

  const goToNotes = useCallback(() => {
    setView('notes');
    requestNewNote();
  }, []);

  useEffect(() => {
    void refreshAll();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) {
      api.system
        .reportTimezone(timezone)
        .then(() => refreshStatus())
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const unlisten = [
      listen(EVENTS.dataChanged, () => {
        void refreshTasks();
        void refreshNotes();
        void refreshOrganization();
      }),
      listen<string>(EVENTS.navigate, (event) => {
        if (event.payload === 'today') setView('today');
        if (event.payload === 'task/new') openTaskDialog(null);
        if (event.payload === 'note/new') goToNotes();
      }),
      listen<AnalysisResult>(EVENTS.suggestions, (event) => {
        openSuggestionDialog(event.payload);
      }),
      listen<string>(EVENTS.notificationsBlocked, () => {
        showToast({
          kind: 'error',
          message:
            'Windows hat die Benachrichtigung abgelehnt. Bitte in den Windows-Einstellungen unter Benachrichtigungen für Notely freigeben.',
        });
      }),
    ];

    return () => {
      for (const pending of unlisten) {
        void pending.then((off) => off());
      }
    };
  }, [goToNotes]);

  const commands = useMemo<Command[]>(
    () => [
      { id: 'today', label: 'Heute anzeigen', hint: 'Strg+1', run: () => setView('today') },
      { id: 'inbox', label: 'Inbox anzeigen', hint: 'Strg+2', run: () => setView('inbox') },
      { id: 'tasks', label: 'Tasks anzeigen', hint: 'Strg+3', run: () => setView('tasks') },
      { id: 'notes', label: 'Notizen anzeigen', hint: 'Strg+4', run: () => setView('notes') },
      { id: 'new-task', label: 'Neuen Task erstellen', hint: 'Strg+T', run: () => openTaskDialog(null) },
      { id: 'new-note', label: 'Neue Notiz', hint: 'Strg+N', run: goToNotes },
      { id: 'settings', label: 'Einstellungen öffnen', run: () => setView('settings') },
      { id: 'hide', label: 'Fenster in den Tray legen', run: () => void api.system.hideWindow() },
      { id: 'quit', label: 'Notely beenden', run: () => void api.system.quit() },
    ],
    [goToNotes],
  );

  const hotkeys = useMemo(
    () => ({
      'ctrl+k': () => setPaletteOpen(true),
      'ctrl+t': () => openTaskDialog(null),
      'ctrl+n': goToNotes,
      'ctrl+1': () => setView('today'),
      'ctrl+2': () => setView('inbox'),
      'ctrl+3': () => setView('tasks'),
      'ctrl+4': () => setView('notes'),
      'ctrl+,': () => setView('settings'),
    }),
    [goToNotes],
  );

  useHotkeys(hotkeys);

  const showOnboarding =
    ready && status !== null && !status.settings.onboardingCompleted && !onboardingDone;

  const today = new Date().toLocaleDateString('de-CH', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  return (
    <div className="app">
      <Sidebar
        view={view}
        tasks={tasks}
        noteCount={notes.length}
        version={status?.appVersion ?? ''}
        onSelect={setView}
      />

      <main className="main">
        <header className="main__header">
          <div>
            <h1 className="main__title">{TITLES[view]}</h1>
            {view === 'today' ? <p className="main__subtitle">{today}</p> : null}
          </div>
          <div className="main__actions">
            {view === 'notes' ? (
              <Button variant="primary" onClick={goToNotes}>
                Neue Notiz
              </Button>
            ) : null}
            {view !== 'settings' && view !== 'notes' ? (
              <Button variant="primary" onClick={() => openTaskDialog(null)}>
                Neuer Task
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setPaletteOpen(true)}>
              Strg+K
            </Button>
          </div>
        </header>

        {view === 'today' ? <TodayView /> : null}
        {view === 'inbox' ? <InboxView /> : null}
        {view === 'tasks' ? <TasksView /> : null}
        {view === 'notes' ? (
          <div className="main__body main__body--flush">
            <NotesView />
          </div>
        ) : null}
        {view === 'settings' ? <SettingsView /> : null}
      </main>

      {dialog?.kind === 'task' ? <TaskDialog task={dialog.task} onClose={closeDialog} /> : null}
      {dialog?.kind === 'suggestions' ? (
        <SuggestionDialog result={dialog.result} onClose={closeDialog} />
      ) : null}
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      ) : null}
      {showOnboarding ? <OnboardingDialog onDone={() => setOnboardingDone(true)} /> : null}
      {toast ? <Toast toast={toast} onClose={clearToast} /> : null}
    </div>
  );
}
