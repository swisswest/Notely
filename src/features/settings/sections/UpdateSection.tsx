import { useState } from 'react';

import { Button, Checkbox, Field } from '@/components/ui';
import { api, describeError } from '@/lib/ipc';
import { reportError, showToast } from '@/lib/store';
import type { AppSettings, UpdateInfo } from '@/types';

interface UpdateSectionProps {
  settings: AppSettings;
  version: string;
  onChange: (settings: AppSettings) => void;
}

export function UpdateSection({ settings, version, onChange }: UpdateSectionProps) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const result = await api.updates.check();
      setInfo(result);
      if (!result.available) {
        showToast({ kind: 'info', message: `Version ${result.currentVersion} ist aktuell` });
      }
    } catch (error) {
      reportError(error);
    } finally {
      setChecking(false);
    }
  };

  // Der Aufruf kehrt im Erfolgsfall nicht zurück - die App startet neu.
  const install = async () => {
    setInstalling(true);
    try {
      await api.updates.install();
    } catch (error) {
      setInstalling(false);
      showToast({ kind: 'error', message: describeError(error) });
    }
  };

  return (
    <section className="settings__group">
      <h3 className="settings__group-title">Updates</h3>

      <div className="field">
        <Checkbox
          checked={settings.updates.checkOnStart}
          label="Beim Start nach einer neueren Version sehen"
          onChange={(checked) =>
            onChange({ ...settings, updates: { ...settings.updates, checkOnStart: checked } })
          }
        />
      </div>

      <Field
        label="Installierte Version"
        hint="Updates kommen aus den veröffentlichten Releases im GitHub-Repository. Die Datei wird vor der Installation gegen den eingebauten Schlüssel geprüft."
      >
        <div className="field__row">
          <span className="field__hint" style={{ alignSelf: 'center' }}>
            {version}
          </span>
          <Button onClick={() => void check()} disabled={checking || installing}>
            {checking ? 'Prüfe...' : 'Jetzt prüfen'}
          </Button>
        </div>
      </Field>

      {info?.available && info.version ? (
        <div className="field">
          <p className="field__hint">
            Version {info.version} ist verfügbar. Die App installiert sie und startet neu; deine
            Daten bleiben unberührt.
          </p>
          {info.notes ? (
            <pre className="update__notes">{info.notes}</pre>
          ) : null}
          <Button variant="primary" onClick={() => void install()} disabled={installing}>
            {installing ? 'Wird installiert...' : `Auf ${info.version} aktualisieren`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
