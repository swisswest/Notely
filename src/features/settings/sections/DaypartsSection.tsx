import { Button, TextInput } from '@/components/ui';
import type { AppSettings, Daypart } from '@/types';

interface DaypartsSectionProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

function slugify(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'tageszeit';

  let candidate = base;
  let counter = 2;
  while (taken.includes(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export function DaypartsSection({ settings, onChange }: DaypartsSectionProps) {
  const setDayparts = (dayparts: Daypart[]) => onChange({ ...settings, dayparts });

  const update = (index: number, patch: Partial<Daypart>) => {
    setDayparts(
      settings.dayparts.map((part, position) =>
        position === index ? { ...part, ...patch } : part,
      ),
    );
  };

  return (
    <section className="settings__group">
      <h3 className="settings__group-title">Tageszeiten</h3>
      <p className="field__hint" style={{ marginBottom: 10 }}>
        Diese Werte bekommt Claude bei jeder Analyse. Die Uhrzeit setzt immer die App, nicht das
        Modell - eine Änderung wirkt sofort auf neue Analysen.
      </p>

      {settings.dayparts.map((part, index) => (
        <div className="daypart-row" key={part.key}>
          <TextInput
            value={part.label}
            aria-label="Bezeichnung"
            onChange={(event) => update(index, { label: event.currentTarget.value })}
          />
          <TextInput
            type="time"
            value={part.time}
            aria-label={`Uhrzeit für ${part.label}`}
            onChange={(event) => update(index, { time: event.currentTarget.value })}
          />
          <Button
            variant="danger"
            title="Tageszeit entfernen"
            disabled={settings.dayparts.length <= 1}
            onClick={() => setDayparts(settings.dayparts.filter((_, position) => position !== index))}
          >
            &times;
          </Button>
        </div>
      ))}

      <Button
        onClick={() => {
          const label = 'Neue Tageszeit';
          setDayparts([
            ...settings.dayparts,
            {
              key: slugify(label, settings.dayparts.map((part) => part.key)),
              label,
              time: '09:00',
            },
          ]);
        }}
        disabled={settings.dayparts.length >= 12}
      >
        Tageszeit hinzufügen
      </Button>
    </section>
  );
}
