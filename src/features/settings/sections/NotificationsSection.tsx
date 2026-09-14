import { Checkbox, Field, TextInput } from '@/components/ui';
import type { AppSettings } from '@/types';

interface NotificationsSectionProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

function parseLeadMinutes(value: string): number[] {
  return value
    .split(/[,;\s]+/)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0 && entry <= 7 * 24 * 60)
    .slice(0, 5);
}

export function NotificationsSection({ settings, onChange }: NotificationsSectionProps) {
  const config = settings.notifications;
  const update = (patch: Partial<AppSettings['notifications']>) =>
    onChange({ ...settings, notifications: { ...config, ...patch } });

  return (
    <section className="settings__group">
      <h3 className="settings__group-title">Benachrichtigungen</h3>

      <div className="field">
        <Checkbox
          checked={config.enabled}
          label="Windows-Benachrichtigungen aktivieren"
          onChange={(checked) => update({ enabled: checked })}
        />
      </div>

      <Field
        label="Erinnerung vorher (Minuten)"
        hint="Mehrere Werte mit Komma trennen, z. B. 60, 15. Maximal fünf Vorlaufzeiten."
      >
        <TextInput
          defaultValue={config.leadMinutes.join(', ')}
          disabled={!config.enabled}
          onBlur={(event) => update({ leadMinutes: parseLeadMinutes(event.currentTarget.value) })}
        />
      </Field>

      <div className="field">
        <Checkbox
          checked={config.notifyAtDue}
          label="Zusätzlich zur Fälligkeit benachrichtigen"
          onChange={(checked) => update({ notifyAtDue: checked })}
        />
      </div>

      <div className="field">
        <Checkbox
          checked={config.remindOverdue}
          label="An überfällige Tasks erinnern"
          onChange={(checked) => update({ remindOverdue: checked })}
        />
      </div>

      <Field label="Intervall für überfällige Tasks (Minuten)">
        <TextInput
          type="number"
          className="input--compact"
          min={5}
          max={1440}
          value={config.overdueIntervalMinutes}
          disabled={!config.remindOverdue}
          onChange={(event) =>
            update({ overdueIntervalMinutes: Number(event.currentTarget.value) || 60 })
          }
        />
      </Field>

      <Field label="Standard-Snooze (Minuten)">
        <TextInput
          type="number"
          className="input--compact"
          min={1}
          max={1440}
          value={config.defaultSnoozeMinutes}
          onChange={(event) =>
            update({ defaultSnoozeMinutes: Number(event.currentTarget.value) || 15 })
          }
        />
      </Field>
    </section>
  );
}
