import { useEffect, useState } from 'react';

import { Button } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshStatus, reportError, showToast, useStore } from '@/lib/store';
import type { AppSettings } from '@/types';
import { ClaudeSection } from './sections/ClaudeSection';
import { DataSection } from './sections/DataSection';
import { DaypartsSection } from './sections/DaypartsSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { QualitySection } from './sections/QualitySection';
import { SystemSection } from './sections/SystemSection';
import { UpdateSection } from './sections/UpdateSection';

export function SettingsView() {
  const status = useStore((state) => state.status);
  const [draft, setDraft] = useState<AppSettings | null>(status?.settings ?? null);
  const [logPath, setLogPath] = useState('');

  useEffect(() => {
    if (status?.settings && !draft) setDraft(status.settings);
  }, [status, draft]);

  useEffect(() => {
    api.system
      .logFilePath()
      .then(setLogPath)
      .catch(() => setLogPath(''));
  }, []);

  if (!draft || !status) {
    return <div className="main__body">Einstellungen werden geladen...</div>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(status.settings);

  const save = async () => {
    try {
      await api.settings.save(draft);
      await refreshStatus();
      showToast({ kind: 'success', message: 'Einstellungen gespeichert' });
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="main__body">
      <div className="settings">
        <ClaudeSection settings={draft} onChange={setDraft} />
        <DaypartsSection settings={draft} onChange={setDraft} />
        <NotificationsSection settings={draft} onChange={setDraft} />
        <SystemSection settings={draft} onChange={setDraft} />
        <QualitySection settings={draft} onChange={setDraft} />
        <DataSection settings={draft} onChange={setDraft} />
        <UpdateSection settings={draft} version={status.appVersion} onChange={setDraft} />

        <section className="settings__group">
          <h3 className="settings__group-title">Info</h3>
          <p className="field__hint">Version {status.appVersion}</p>
          <p className="field__hint">
            Zeitzone {draft.timezone || 'unbekannt'} · Autostart im System{' '}
            {status.autostartEnabled ? 'aktiv' : 'inaktiv'}
          </p>
          {logPath ? <p className="field__hint">Logdatei: {logPath}</p> : null}
        </section>

        <div className="settings__footer">
          <Button variant="primary" onClick={() => void save()} disabled={!dirty}>
            Speichern
          </Button>
          <Button variant="ghost" onClick={() => setDraft(status.settings)} disabled={!dirty}>
            Zurücksetzen
          </Button>
          {dirty ? (
            <span className="field__hint" style={{ alignSelf: 'center' }}>
              Ungespeicherte Änderungen
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
