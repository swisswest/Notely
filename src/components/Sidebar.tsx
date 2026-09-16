import { useEffect, useRef, useState } from 'react';

import type { ProfileList, Task, ViewId } from '@/types';
import { bucketOf } from '@/utils/date';

interface SidebarProps {
  view: ViewId;
  tasks: Task[];
  noteCount: number;
  version: string;
  profiles: ProfileList | null;
  onSelect: (view: ViewId) => void;
  onSwitchProfile: (id: string) => void;
}

interface NavEntry {
  id: ViewId;
  label: string;
  count?: number;
}

export function Sidebar({
  view,
  tasks,
  noteCount,
  version,
  profiles,
  onSelect,
  onSwitchProfile,
}: SidebarProps) {
  const now = new Date();
  const open = tasks.filter((task) => !task.completed);
  const today = open.filter((task) => {
    const bucket = bucketOf(task, now);
    return bucket === 'today' || bucket === 'overdue';
  }).length;
  const inbox = open.filter((task) => !task.dueDate).length;

  const entries: NavEntry[] = [
    { id: 'today', label: 'Heute', count: today },
    { id: 'week', label: 'Woche' },
    { id: 'inbox', label: 'Inbox', count: inbox },
    { id: 'tasks', label: 'Aufgaben', count: open.length },
    { id: 'notes', label: 'Notizen', count: noteCount },
  ];

  return (
    <nav className="sidebar" aria-label="Hauptnavigation">
      <div className="sidebar__brand">
        <span>Notely</span>
        <span className="sidebar__version">{version}</span>
      </div>

      {profiles && profiles.profiles.length > 0 ? (
        <ProfileSwitcher
          profiles={profiles}
          onSwitch={onSwitchProfile}
          onManage={() => onSelect('settings')}
        />
      ) : null}

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
        <span>Einstellungen</span>
      </button>
      <p className="sidebar__hint">Strg+K für Befehle</p>
    </nav>
  );
}

interface SwitcherProps {
  profiles: ProfileList;
  onSwitch: (id: string) => void;
  onManage: () => void;
}

/**
 * Zeigt das offene Profil und klappt bei Bedarf die anderen auf. Bewusst kein
 * Auswahlfeld: ein Wechsel startet die App neu, und das darf nicht aus
 * Versehen passieren, weil das Mausrad über dem Feld stand.
 */
function ProfileSwitcher({ profiles, onSwitch, onManage }: SwitcherProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const active = profiles.profiles.find((profile) => profile.id === profiles.active);
  const others = profiles.profiles.filter((profile) => profile.id !== profiles.active);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="profile" ref={container}>
      <button
        type="button"
        className="profile__current"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Profil wechseln"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="label-chip__dot" data-color={active?.color ?? 'slate'} aria-hidden="true" />
        <span className="profile__name">{active?.name ?? profiles.active}</span>
        <span className="profile__caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open ? (
        <div className="profile__menu" role="menu">
          {others.length > 0 ? (
            others.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="menuitem"
                className="profile__entry"
                onClick={() => {
                  setOpen(false);
                  onSwitch(profile.id);
                }}
              >
                <span
                  className="label-chip__dot"
                  data-color={profile.color}
                  aria-hidden="true"
                />
                {profile.name}
              </button>
            ))
          ) : (
            <p className="profile__hint">Nur ein Profil vorhanden.</p>
          )}
          <button
            type="button"
            role="menuitem"
            className="profile__entry profile__entry--muted"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            Profile verwalten
          </button>
          <p className="profile__hint">Ein Wechsel startet Notely neu.</p>
        </div>
      ) : null}
    </div>
  );
}
