import { useState } from 'react';

import { Button, Checkbox, Dialog } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshStatus, reportError } from '@/lib/store';

export function OnboardingDialog({ onDone }: { onDone: () => void }) {
  const [autostart, setAutostart] = useState(true);

  const finish = async () => {
    try {
      await api.system.completeOnboarding(autostart);
      await refreshStatus();
    } catch (error) {
      reportError(error);
    } finally {
      onDone();
    }
  };

  return (
    <Dialog
      title="Willkommen bei Notely"
      subtitle="Zwei Einstellungen, dann kann es losgehen."
      onClose={() => void finish()}
      footer={
        <Button variant="primary" onClick={() => void finish()}>
          Los geht's
        </Button>
      }
    >
      <div className="field">
        <Checkbox
          checked={autostart}
          label="Notely mit Windows starten (im Hintergrund)"
          onChange={setAutostart}
        />
      </div>
      <p className="field__hint">
        Notizen, Aufgaben und Erinnerungen funktionieren vollständig offline. Für die automatische
        Aufgabenerkennung wird in den Einstellungen ein Claude API-Key hinterlegt - er landet im
        Windows Credential Manager, nicht in einer Konfigurationsdatei.
      </p>
    </Dialog>
  );
}
