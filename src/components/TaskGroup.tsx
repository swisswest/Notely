import type { Task } from '@/types';
import { TaskRow } from '@/components/TaskRow';

interface TaskGroupProps {
  title: string;
  tasks: Task[];
  showDate?: boolean;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSnooze?: (task: Task) => void;
}

export function TaskGroup({
  title,
  tasks,
  showDate = false,
  onToggle,
  onEdit,
  onDelete,
  onSnooze,
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
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          {...(onSnooze ? { onSnooze } : {})}
        />
      ))}
    </section>
  );
}
