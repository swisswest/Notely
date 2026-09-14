import type { MouseEvent } from 'react';

import type { Task } from '@/types';
import { TaskRow } from '@/components/TaskRow';

interface TaskGroupProps {
  title: string;
  tasks: Task[];
  showDate?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSnooze?: (task: Task) => void;
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
  onSelect,
}: TaskGroupProps) {
  if (tasks.length === 0) return null;

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
          selected={selectedIds?.has(task.id) ?? false}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          {...(onSnooze ? { onSnooze } : {})}
          {...(onSelect ? { onSelect } : {})}
        />
      ))}
    </section>
  );
}
