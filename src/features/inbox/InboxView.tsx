import { TaskGroup } from '@/components/TaskGroup';
import { EmptyState } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import { compareTasks } from '@/utils/date';

/** Inbox = alles ohne Termin. Von hier aus bekommen Tasks ein Datum. */
export function InboxView() {
  const tasks = useStore((state) => state.tasks);
  const actions = useTaskActions();

  const undated = tasks.filter((task) => !task.completed && !task.dueDate).sort(compareTasks);

  return (
    <div className="main__body">
      <TaskGroup
        title="Ohne Termin"
        tasks={undated}
        onToggle={actions.toggle}
        onEdit={actions.startEdit}
        onDelete={actions.remove}
      />
      {undated.length === 0 ? (
        <EmptyState>Die Inbox ist leer - alle Tasks haben einen Termin.</EmptyState>
      ) : null}
    </div>
  );
}
