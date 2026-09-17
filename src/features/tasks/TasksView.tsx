import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';

import { TaskGroup } from '@/components/TaskGroup';
import { Button, EmptyState } from '@/components/ui';
import { api } from '@/lib/ipc';
import { LabelChip } from '@/components/LabelChip';
import { run, useStore } from '@/lib/store';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import type { Task } from '@/types';
import type { Bucket } from '@/utils/date';
import { addDays, bucketOf, compareTasks, toIsoDate } from '@/utils/date';

type FilterId = 'all' | Extract<Bucket, 'today' | 'tomorrow' | 'week' | 'overdue' | 'completed'>;

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'Alle offenen' },
  { id: 'today', label: 'Heute' },
  { id: 'tomorrow', label: 'Morgen' },
  { id: 'week', label: 'Diese Woche' },
  { id: 'overdue', label: 'Überfällig' },
  { id: 'completed', label: 'Erledigt' },
];

export function TasksView() {
  const tasks = useStore((state) => state.tasks);
  const actions = useTaskActions();
  const [filter, setFilter] = useState<FilterId>('all');
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  /** "all", "none" oder eine Ordner-ID - wie bei den Notizen. */
  const [folderFilter, setFolderFilter] = useState('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const labels = useStore((state) => state.labels);
  const folders = useStore((state) => state.folders);
  const now = new Date();

  const visible = useMemo(() => {
    const reference = new Date();
    return tasks
      .filter((task) => {
        if (onlyImportant && task.priority !== 'high') return false;
        if (labelFilter.length > 0 && !labelFilter.every((id) => task.labels.includes(id))) {
          return false;
        }
        if (folderFilter === 'none' && task.folderId) return false;
        if (folderFilter !== 'all' && folderFilter !== 'none' && task.folderId !== folderFilter) {
          return false;
        }
        const bucket = bucketOf(task, reference);
        if (filter === 'all') return !task.completed;
        if (filter === 'week') {
          return bucket === 'today' || bucket === 'tomorrow' || bucket === 'week';
        }
        return bucket === filter;
      })
      .sort(compareTasks);
  }, [tasks, filter, onlyImportant, labelFilter, folderFilter]);

  const label = FILTERS.find((entry) => entry.id === filter)?.label ?? 'Aufgaben';
  const selectedIds = [...selected].filter((id) => visible.some((task) => task.id === id));

  /** Klick wählt aus, Strg/Shift erweitern die Auswahl. */
  const handleSelect = (task: Task, event: MouseEvent<HTMLDivElement>) => {
    setSelected((current) => {
      const next = new Set(current);
      if (event.shiftKey) {
        const lastId = [...current].pop();
        const from = visible.findIndex((entry) => entry.id === lastId);
        const to = visible.findIndex((entry) => entry.id === task.id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let index = start; index <= end; index += 1) {
            const entry = visible[index];
            if (entry) next.add(entry.id);
          }
          return next;
        }
      }
      if (!event.ctrlKey && !event.metaKey && !next.has(task.id)) {
        next.clear();
      }
      if (next.has(task.id)) {
        next.delete(task.id);
      } else {
        next.add(task.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const bulk = async (action: () => Promise<unknown>, success: string) => {
    const result = await run(action, { success });
    if (result !== null) clearSelection();
  };

  const today = toIsoDate(now);

  return (
    <div className="main__body">
      <div className="field__row" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
        {FILTERS.map((entry) => (
          <Button
            key={entry.id}
            variant={filter === entry.id ? 'default' : 'ghost'}
            onClick={() => {
              setFilter(entry.id);
              clearSelection();
            }}
          >
            {entry.label}
          </Button>
        ))}
        <Button
          variant={onlyImportant ? 'default' : 'ghost'}
          title="Nur Aufgaben mit hoher Priorität"
          onClick={() => {
            setOnlyImportant((current) => !current);
            clearSelection();
          }}
        >
          Nur wichtige
        </Button>

        {folders.length > 0 ? (
          <select
            className="select input--compact"
            value={folderFilter}
            title="Nach dem Ordner der Ursprungsnotiz filtern"
            onChange={(event) => {
              setFolderFilter(event.currentTarget.value);
              clearSelection();
            }}
          >
            <option value="all">Alle Ordner</option>
            <option value="none">Ohne Ordner</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {labels.length > 0 ? (
        <div className="notes__label-filter" style={{ marginBottom: 4 }}>
          {labels.map((entry) => (
            <LabelChip
              key={entry.id}
              label={entry}
              active={labelFilter.includes(entry.id)}
              onClick={() => {
                setLabelFilter((current) =>
                  current.includes(entry.id)
                    ? current.filter((id) => id !== entry.id)
                    : [...current, entry.id],
                );
                clearSelection();
              }}
            />
          ))}
        </div>
      ) : null}

      <TaskGroup
        title={label}
        tasks={visible}
        showDate
        selectedIds={selected}
        onToggle={actions.toggle}
        onEdit={actions.startEdit}
        onDelete={actions.remove}
        onOpenSource={actions.openSource}
        onSelect={handleSelect}
        {...(filter === 'completed' ? {} : { onSnooze: actions.snooze })}
      />

      {visible.length === 0 ? (
        <EmptyState>
          {onlyImportant || labelFilter.length > 0
            ? 'Keine Aufgabe passt zu diesen Filtern.'
            : 'Keine Aufgabe in dieser Ansicht.'}
        </EmptyState>
      ) : null}

      {selectedIds.length > 0 ? (
        <div className="bulk-bar" role="toolbar" aria-label="Mehrfachauswahl">
          <span className="bulk-bar__count">{selectedIds.length} ausgewählt</span>
          <Button
            onClick={() =>
              void bulk(
                () => api.tasks.bulkReschedule(selectedIds, today, null),
                'Auf heute verschoben',
              )
            }
          >
            Heute
          </Button>
          <Button
            onClick={() =>
              void bulk(
                () => api.tasks.bulkReschedule(selectedIds, addDays(today, 1), null),
                'Auf morgen verschoben',
              )
            }
          >
            Morgen
          </Button>
          <Button
            onClick={() =>
              void bulk(
                () => api.tasks.bulkReschedule(selectedIds, null, null),
                'Termin entfernt',
              )
            }
          >
            Ohne Termin
          </Button>
          <Button
            onClick={() =>
              void bulk(() => api.tasks.bulkComplete(selectedIds, true), 'Als erledigt markiert')
            }
          >
            Erledigt
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              void bulk(() => api.tasks.bulkDelete(selectedIds), 'In den Papierkorb verschoben')
            }
          >
            Löschen
          </Button>
          <Button variant="ghost" onClick={clearSelection}>
            Auswahl aufheben
          </Button>
        </div>
      ) : null}
    </div>
  );
}
