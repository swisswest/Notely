import type { Task } from '@/types';
import { Button, Checkbox } from '@/components/ui';
import { formatDayLabel, isOverdue, toIsoDate } from '@/utils/date';

interface TaskRowProps {
  task: Task;
  selected?: boolean;
  showDate?: boolean;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSnooze?: (task: Task) => void;
  onFocus?: (task: Task) => void;
}

export function TaskRow({
  task,
  selected = false,
  showDate = false,
  onToggle,
  onEdit,
  onDelete,
  onSnooze,
  onFocus,
}: TaskRowProps) {
  const today = toIsoDate(new Date());
  const overdue = isOverdue(task, new Date());

  return (
    <div
      className="task-row"
      data-selected={selected}
      data-completed={task.completed}
      data-overdue={overdue}
      onMouseEnter={() => onFocus?.(task)}
      onDoubleClick={() => onEdit(task)}
    >
      <Checkbox
        checked={task.completed}
        ariaLabel={task.completed ? 'Task wieder öffnen' : 'Task erledigen'}
        onChange={() => onToggle(task)}
      />

      <span className="task-row__time">{task.dueTime ?? (task.dueDate ? '--:--' : '')}</span>

      <span className="task-row__title" title={task.description || task.title}>
        {task.title}
      </span>

      <span className="task-row__meta">
        {showDate && task.dueDate ? <span>{formatDayLabel(task.dueDate, today)}</span> : null}
        {task.snoozedUntil ? <span className="tag tag--warning">verschoben</span> : null}
        {task.aiGenerated ? <span className="tag tag--ai">AI</span> : null}
        <span className="task-row__actions">
          {onSnooze && !task.completed ? (
            <Button variant="ghost" onClick={() => onSnooze(task)} title="Später erinnern">
              Snooze
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onEdit(task)} title="Bearbeiten">
            Bearbeiten
          </Button>
          <Button variant="danger" onClick={() => onDelete(task)} title="Löschen">
            Löschen
          </Button>
        </span>
      </span>
    </div>
  );
}
