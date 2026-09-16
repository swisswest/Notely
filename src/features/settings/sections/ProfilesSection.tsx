import { useEffect, useState } from 'react';

import { Button, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshStatus, reportError, showToast } from '@/lib/store';
import type { ProfileList } from '@/types';

/** Fallback, falls die Farbliste aus dem Backend nicht kommt. */
const FALLBACK_COLORS = ['slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal', 'pink'];

interface ProfilesSectionProps {
  profiles: ProfileList;
}

/**
 * Profile sind getrennte Datenbestände - eigene Notizen, Aufgaben, Ordner,
 * Labels und Einstellungen. Geteilt wird nur der API-Key, der liegt im
 * Windows Credential Manager und gilt für das Programm, nicht für ein Profil.
 */
export function ProfilesSection({ profiles }: ProfilesSectionProps) {
  const [colors, setColors] = useState<string[]>(FALLBACK_COLORS);
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [busy, setBusy] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  useEffect(() => {
    api.labels
      .colors()
      .then((available) => {
        if (available.length > 0) setColors(available);
      })
      .catch(() => undefined);
  }, []);

  const apply = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      await refreshStatus();
      if (success) showToast({ kind: 'success', message: success });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await apply(() => api.profiles.create(trimmed, color), `Profil "${trimmed}" angelegt`);
    setName('');
  };

  const full = profiles.profiles.length >= profiles.max;

  return (
    <section className="settings__group">
      <h3 className="settings__group-title">Profile</h3>
      <p className="field__hint" style={{ marginBottom: 10 }}>
        Jedes Profil hat seine eigene Datenbank - Notizen, Aufgaben, Ordner, Labels und
        Einstellungen bleiben getrennt. Der Claude API-Key gilt für alle Profile, er liegt im
        Windows Credential Manager. Ein Wechsel startet Notely neu; nur so ist ausgeschlossen, dass
        eine Abfrage noch Daten des vorherigen Profils sieht.
      </p>

      {profiles.profiles.map((profile) => {
        const active = profile.id === profiles.active;
        return (
          <div className="organize-row" key={profile.id}>
            <span className="field__row">
              <span className="label-chip__dot" data-color={profile.color} aria-hidden="true" />
              <TextInput
                className="input--compact"
                defaultValue={profile.name}
                disabled={busy}
                onBlur={(event) => {
                  const next = event.currentTarget.value.trim();
                  if (!next || next === profile.name) return;
                  void apply(() => api.profiles.rename(profile.id, next));
                }}
              />
              {active ? <span className="tag">aktiv</span> : null}
            </span>

            <span className="field__row">
              {!active ? (
                <Button
                  disabled={busy}
                  title="Notely wechselt das Profil und startet dazu neu"
                  onClick={() => void apply(() => api.profiles.switch(profile.id))}
                >
                  Wechseln
                </Button>
              ) : null}

              {profiles.profiles.length > 1 ? (
                pendingRemoval === profile.id ? (
                  <>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        setPendingRemoval(null);
                        void apply(
                          () => api.profiles.remove(profile.id),
                          `Profil "${profile.name}" entfernt`,
                        );
                      }}
                    >
                      Wirklich entfernen
                    </Button>
                    <Button variant="ghost" onClick={() => setPendingRemoval(null)}>
                      Abbrechen
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    title="Der Ordner wird beiseitegelegt, nicht gelöscht"
                    onClick={() => setPendingRemoval(profile.id)}
                  >
                    Entfernen
                  </Button>
                )
              ) : null}
            </span>
          </div>
        );
      })}

      <div className="divider" />

      <Field
        label="Neues Profil"
        hint={
          full
            ? `Mehr als ${profiles.max} Profile sind nicht vorgesehen.`
            : 'Startet leer. Bestehende Notizen und Aufgaben bleiben im aktuellen Profil.'
        }
      >
        <div className="field__row">
          <TextInput
            className="input--compact"
            value={name}
            placeholder="Arbeit"
            disabled={busy || full}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
          />
          <select
            className="select input--compact"
            value={color}
            disabled={busy || full}
            onChange={(event) => setColor(event.currentTarget.value)}
          >
            {colors.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button disabled={busy || full || !name.trim()} onClick={() => void create()}>
            Anlegen
          </Button>
        </div>
      </Field>

      <p className="field__hint">
        Entfernte Profile landen unter <code>profiles\_entfernt\</code> im Datenordner. Nichts wird
        gelöscht - wer sich vertut, holt den Ordner von Hand zurück.
      </p>
    </section>
  );
}
