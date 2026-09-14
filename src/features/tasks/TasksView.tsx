import { useState } from 'react';

import { TaskGroup } from '@/components/TaskGroup';
import { Button, EmptyState } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import type { Bucket } from '@/utils/date';
import { bucketOf, compareTasks } from '@/utils/date';

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
  const now = new Date();

  const visible = tasks
    .filter((task) => {
      const bucket = bucketOf(task, now);
      if (filter === 'all') return !task.completed;
      if (filter === 'week') return bucket === 'today' || bucket === 'tomorrow' || bucket === 'week';
      return bucket === filter;
    })
    .sort(compareTasks);

  const label = FILTERS.find((entry) => entry.id === filter)?.label ?? 'Tasks';

  return (
    <div className="main__body">
      <div className="field__row" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
        {FILTERS.map((entry) => (
          <Button
            key={entry.id}
            variant={filter === entry.id ? 'default' : 'ghost'}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <TaskGroup
        title={label}
        tasks={visible}
        showDate
        onToggle={actions.toggle}
        onEdit={actions.startEdit}
        onDelete={actions.remove}
        {...(filter === 'completed' ? {} : { onSnooze: actions.snooze })}
      />

      {visible.length === 0 ? <EmptyState>Keine Tasks in dieser Ansicht.</EmptyState> : null}
    </div>
  );
}
