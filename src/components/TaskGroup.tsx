import type { MouseEvent } from 'react';

import type { Label, Task } from '@/types';
import { TaskRow } from '@/components/TaskRow';
import { useStore } from '@/lib/store';

interface TaskGroupProps {
  title: string;
  tasks: Task[];
  showDate?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSnooze?: (task: Task) => void;
  onOpenSource?: (task: Task) => void;
  onSelect?: (task: Task, event: MouseEvent<HTMLDivElement>) => void;
}

export function TaskGroup({
  title,
  tasks,
  showDate = false,
  selectedIds,
  onToggle,
  onEdit,
  onDelete,
  onSnooze,
  onOpenSource,
  onSelect,
}: TaskGroupProps) {
  const labels = useStore((state) => state.labels);
  if (tasks.length === 0) return null;

  const resolve = (ids: string[]): Label[] =>
    ids
      .map((id) => labels.find((label) => label.id === id))
      .filter((label): label is Label => Boolean(label));

  return (
    <section className="section">
      <h3 className="section__title">
        {title}
        <span className="section__count">{tasks.length}</span>
      </h3>
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          showDate={showDate}
          labels={resolve(task.labels)}
          selected={selectedIds?.has(task.id) ?? false}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          {...(onSnooze ? { onSnooze } : {})}
          {...(onOpenSource ? { onOpenSource } : {})}
          {...(onSelect ? { onSelect } : {})}
        />
      ))}
    </section>
  );
}
