import { TaskGroup } from '@/components/TaskGroup';
import { Button, EmptyState } from '@/components/ui';
import { requestNewNote, requestView, useStore } from '@/lib/store';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import { bucketOf, compareTasks, groupByDay } from '@/utils/date';

const HORIZON_DAYS = 7;

export function TodayView() {
  const tasks = useStore((state) => state.tasks);
  const noteCount = useStore((state) => state.notes.length);
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
  // Unterscheidet "gerade nichts zu tun" von "noch gar nicht angefangen".
  const hasAnything = tasks.length > 0 || noteCount > 0;

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
        onOpenSource={actions.openSource}
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
          onOpenSource={actions.openSource}
        />
      ))}

      {nothingToShow ? (
        <EmptyState>
          <p style={{ margin: '0 0 10px' }}>
            {hasAnything
              ? 'Nichts fällig in den nächsten Tagen.'
              : 'Noch nichts erfasst. Schreib einfach los - Claude macht daraus Aufgaben.'}
          </p>
          <span className="field__row" style={{ justifyContent: 'center' }}>
            <Button
              variant="primary"
              onClick={() => {
                requestView('notes');
                requestNewNote();
              }}
            >
              Notiz schreiben
            </Button>
            <Button onClick={() => actions.startCreate()}>Aufgabe anlegen</Button>
            {!hasAnything ? (
              <Button variant="ghost" onClick={() => requestView('settings')}>
                API-Key hinterlegen
              </Button>
            ) : null}
          </span>
        </EmptyState>
      ) : null}
    </div>
  );
}
