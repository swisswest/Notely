import { Checkbox, Field, TextInput } from '@/components/ui';
import type { AppSettings, ThemeMode } from '@/types';

interface SystemSectionProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

const THEMES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Hell' },
  { id: 'dark', label: 'Dunkel' },
];

export function SystemSection({ settings, onChange }: SystemSectionProps) {
  return (
    <>
      <section className="settings__group">
        <h3 className="settings__group-title">Windows</h3>

        <div className="field">
          <Checkbox
            checked={settings.windows.autostart}
            label="Mit Windows starten"
            onChange={(checked) =>
              onChange({ ...settings, windows: { ...settings.windows, autostart: checked } })
            }
          />
        </div>
        <div className="field">
          <Checkbox
            checked={settings.windows.startMinimized}
            label="Beim Autostart im Hintergrund starten"
            onChange={(checked) =>
              onChange({ ...settings, windows: { ...settings.windows, startMinimized: checked } })
            }
          />
        </div>
        <div className="field">
          <Checkbox
            checked={settings.windows.closeToTray}
            label="Beim Schliessen im Hintergrund weiterlaufen"
            onChange={(checked) =>
              onChange({ ...settings, windows: { ...settings.windows, closeToTray: checked } })
            }
          />
        </div>
      </section>

      <section className="settings__group">
        <h3 className="settings__group-title">AI</h3>

        <div className="field">
          <Checkbox
            checked={settings.ai.autoAnalyzeOnSave}
            label="Notizen nach dem Speichern automatisch analysieren"
            onChange={(checked) =>
              onChange({ ...settings, ai: { ...settings.ai, autoAnalyzeOnSave: checked } })
            }
          />
        </div>
        <div className="field">
          <Checkbox
            checked={settings.ai.confirmBeforeCreate}
            label="Tasks vor Erstellung bestätigen"
            onChange={(checked) =>
              onChange({ ...settings, ai: { ...settings.ai, confirmBeforeCreate: checked } })
            }
          />
        </div>

        <Field
          label="Mindest-Confidence für automatisches Anlegen"
          hint="Nur relevant, wenn die Bestätigung deaktiviert ist. Unsichere Vorschläge landen dann trotzdem im Bestätigungsdialog."
        >
          <TextInput
            type="number"
            className="input--compact"
            min={0}
            max={1}
            step={0.05}
            value={settings.ai.autoCreateMinConfidence}
            disabled={settings.ai.confirmBeforeCreate}
            onChange={(event) =>
              onChange({
                ...settings,
                ai: {
                  ...settings.ai,
                  autoCreateMinConfidence: Math.min(
                    Math.max(Number(event.currentTarget.value) || 0, 0),
                    1,
                  ),
                },
              })
            }
          />
        </Field>
      </section>

      <section className="settings__group">
        <h3 className="settings__group-title">Darstellung</h3>
        <Field label="Theme">
          <select
            className="select"
            value={settings.appearance.theme}
            onChange={(event) =>
              onChange({
                ...settings,
                appearance: { theme: event.currentTarget.value as ThemeMode },
              })
            }
          >
            {THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.label}
              </option>
            ))}
          </select>
        </Field>
      </section>
    </>
  );
}
