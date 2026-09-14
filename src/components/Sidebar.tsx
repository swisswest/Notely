import type { Task, ViewId } from '@/types';
import { bucketOf } from '@/utils/date';

interface SidebarProps {
  view: ViewId;
  tasks: Task[];
  noteCount: number;
  version: string;
  onSelect: (view: ViewId) => void;
}

interface NavEntry {
  id: ViewId;
  label: string;
  count?: number;
}

export function Sidebar({ view, tasks, noteCount, version, onSelect }: SidebarProps) {
  const now = new Date();
  const open = tasks.filter((task) => !task.completed);
  const today = open.filter((task) => {
    const bucket = bucketOf(task, now);
    return bucket === 'today' || bucket === 'overdue';
  }).length;
  const inbox = open.filter((task) => !task.dueDate).length;

  const entries: NavEntry[] = [
    { id: 'today', label: 'Heute', count: today },
    { id: 'inbox', label: 'Inbox', count: inbox },
    { id: 'tasks', label: 'Tasks', count: open.length },
    { id: 'notes', label: 'Notizen', count: noteCount },
  ];

  return (
    <nav className="sidebar" aria-label="Hauptnavigation">
      <div className="sidebar__brand">
        <span>Notely</span>
        <span className="sidebar__version">{version}</span>
      </div>

      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="sidebar__item"
          aria-current={view === entry.id}
          onClick={() => onSelect(entry.id)}
        >
          <span>{entry.label}</span>
          {entry.count ? <span className="sidebar__count">{entry.count}</span> : null}
        </button>
      ))}

      <div className="sidebar__spacer" />
      <div className="sidebar__divider" />

      <button
        type="button"
        className="sidebar__item"
        aria-current={view === 'trash'}
        onClick={() => onSelect('trash')}
      >
        <span>Papierkorb</span>
      </button>
      <button
        type="button"
        className="sidebar__item"
        aria-current={view === 'settings'}
        onClick={() => onSelect('settings')}
      >
        <span>Settings</span>
      </button>
      <p className="sidebar__hint">Strg+K für Befehle</p>
    </nav>
  );
}
