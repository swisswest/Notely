import type { MouseEvent } from 'react';

import type { Label, Task } from '@/types';
import { Button, Checkbox } from '@/components/ui';
import { LabelDots } from '@/components/LabelChip';
import { formatDayLabel, isOverdue, toIsoDate } from '@/utils/date';
import { priorityLabel, priorityMark } from '@/utils/priority';
import { describeRecurrence, shortRecurrence } from '@/utils/recurrence';

interface TaskRowProps {
  task: Task;
  selected?: boolean;
  showDate?: boolean;
  labels?: Label[];
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSnooze?: (task: Task) => void;
  onOpenSource?: (task: Task) => void;
  onSelect?: (task: Task, event: MouseEvent<HTMLDivElement>) => void;
}

export function TaskRow({
  task,
  selected = false,
  showDate = false,
  labels = [],
  onToggle,
  onEdit,
  onDelete,
  onSnooze,
  onOpenSource,
  onSelect,
}: TaskRowProps) {
  const today = toIsoDate(new Date());
  const overdue = isOverdue(task, new Date());
  const repeat = shortRecurrence(task.recurrence);
  const mark = priorityMark(task.priority);

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
      data-priority={task.priority}
      data-selectable={Boolean(onSelect)}
      onClick={handleClick}
      onDoubleClick={() => onEdit(task)}
    >
      <Checkbox
        checked={task.completed}
        ariaLabel={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
        onChange={() => onToggle(task)}
      />

      <span className="task-row__time">{task.dueTime ?? (task.dueDate ? '--:--' : '')}</span>

      <span className="task-row__title" title={task.description || task.title}>
        {mark ? (
          <span className="task-row__priority" title={`Priorität ${priorityLabel(task.priority)}`}>
            {mark}
          </span>
        ) : null}
        {task.title}
      </span>

      <span className="task-row__meta">
        {labels.length > 0 ? <LabelDots labels={labels} /> : null}
        {showDate && task.dueDate ? <span>{formatDayLabel(task.dueDate, today)}</span> : null}
        {repeat ? (
          <span className="tag" title={describeRecurrence(task.recurrence)}>
            {repeat}
          </span>
        ) : null}
        {task.snoozedUntil ? <span className="tag tag--warning">verschoben</span> : null}
        {task.aiGenerated ? <span className="tag tag--ai">AI</span> : null}
        <span className="task-row__actions">
          {onOpenSource && task.sourceNoteId ? (
            <Button
              variant="ghost"
              onClick={() => onOpenSource(task)}
              title="Notiz öffnen, aus der diese Aufgabe entstanden ist"
            >
              Notiz
            </Button>
          ) : null}
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
