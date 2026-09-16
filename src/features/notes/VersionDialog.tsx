import { useCallback, useEffect, useState } from 'react';

import { Button, Dialog, EmptyState } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshNotes, reportError, showToast } from '@/lib/store';
import type { NoteVersion } from '@/types';
import { formatDateTime } from '@/utils/date';

interface VersionDialogProps {
  noteId: string;
  onRestored: (content: string) => void;
  onClose: () => void;
}

const PREVIEW_CHARS = 400;

export function VersionDialog({ noteId, onRestored, onClose }: VersionDialogProps) {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.notes
      .versions(noteId)
      .then(setVersions)
      .catch((error) => {
        reportError(error);
        setVersions([]);
      });
  }, [noteId]);

  useEffect(load, [load]);

  const restore = async (version: NoteVersion) => {
    setBusy(true);
    try {
      const note = await api.notes.restoreVersion(noteId, version.id);
      onRestored(note.content);
      await refreshNotes();
      showToast({ kind: 'success', message: 'Frühere Fassung wiederhergestellt' });
      onClose();
    } catch (error) {
      reportError(error);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Frühere Fassungen"
      subtitle="Jede Änderung legt den vorherigen Stand ab. Die letzten 20 bleiben erhalten."
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Schliessen
        </Button>
      }
    >
      {versions === null ? (
        <p className="field__hint">Wird geladen...</p>
      ) : versions.length === 0 ? (
        <EmptyState>
          Noch keine frühere Fassung. Sobald du den Text änderst, wird der alte Stand hier
          abgelegt.
        </EmptyState>
      ) : (
        <div className="version-list">
          {versions.map((version) => (
            <div className="version" key={version.id}>
              <div className="version__head">
                <span className="field__hint">{formatDateTime(version.createdAt)}</span>
                <span className="field__row">
                  <Button
                    variant="ghost"
                    onClick={() => setOpenId(openId === version.id ? null : version.id)}
                  >
                    {openId === version.id ? 'Zuklappen' : 'Ansehen'}
                  </Button>
                  <Button disabled={busy} onClick={() => void restore(version)}>
                    Wiederherstellen
                  </Button>
                </span>
              </div>
              <p className="version__preview">
                {openId === version.id
                  ? version.content
                  : version.content.replace(/\s+/g, ' ').slice(0, PREVIEW_CHARS)}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="field__hint" style={{ marginTop: 12 }}>
        Wiederherstellen überschreibt nichts endgültig: der aktuelle Stand wird davor selbst als
        Fassung abgelegt.
      </p>
    </Dialog>
  );
}
