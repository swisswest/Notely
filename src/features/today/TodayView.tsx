import { TaskGroup } from '@/components/TaskGroup';
import { EmptyState } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import { bucketOf, compareTasks, groupByDay } from '@/utils/date';

const HORIZON_DAYS = 7;

export function TodayView() {
  const tasks = useStore((state) => state.tasks);
  const actions = useTaskActions();
  const now = new Date();

  const open = tasks.filter((task) => !task.completed);
  const overdue = open.filter((task) => bucketOf(task, now) === 'overdue').sort(compareTasks);

  const upcoming = open.filter((task) => {
    const bucket = bucketOf(task, now);
    return bucket === 'today' || bucket === 'tomorrow' || bucket === 'week';
  });
  const groups = groupByDay(upcoming, now).slice(0, HORIZON_DAYS);
  const nothingToShow = overdue.length === 0 && groups.length === 0;

  return (
    <div className="main__body">
      <TaskGroup
        title="Überfällig"
        tasks={overdue}
        showDate
        onToggle={actions.toggle}
        onEdit={actions.startEdit}
        onDelete={actions.remove}
        onSnooze={actions.snooze}
      />

      {groups.map((group) => (
        <TaskGroup
          key={group.date}
          title={group.label}
          tasks={group.tasks}
          onToggle={actions.toggle}
          onEdit={actions.startEdit}
          onDelete={actions.remove}
          onSnooze={actions.snooze}
        />
      ))}

      {nothingToShow ? (
        <EmptyState>Nichts fällig. Neue Notiz mit Strg+N oder neuer Task mit Strg+T.</EmptyState>
      ) : null}
    </div>
  );
}
