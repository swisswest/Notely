import type { MouseEvent } from 'react';

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
  onSelect?: (task: Task, event: MouseEvent<HTMLDivElement>) => void;
}

export function TaskRow({
  task,
  selected = false,
  showDate = false,
  onToggle,
  onEdit,
  onDelete,
  onSnooze,
  onSelect,
}: TaskRowProps) {
  const today = toIsoDate(new Date());
  const overdue = isOverdue(task, new Date());

  // Klicks auf Checkbox oder Buttons dürfen die Auswahl nicht verändern.
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onSelect) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, label')) return;
    onSelect(task, event);
  };

  return (
    <div
      className="task-row"
      data-selected={selected}
      data-completed={task.completed}
      data-overdue={overdue}
      data-selectable={Boolean(onSelect)}
      onClick={handleClick}
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
          <Button variant="danger" onClick={() => onDelete(task)} title="In den Papierkorb">
            Löschen
          </Button>
        </span>
      </span>
    </div>
  );
}
