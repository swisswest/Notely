import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import { EVENTS, api, describeError } from '@/lib/ipc';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/types';

type Status = { kind: 'idle' | 'busy' | 'done' | 'error'; message: string };

const IDLE: Status = { kind: 'idle', message: '' };
const CLOSE_DELAY_MS = 900;

/**
 * Eigenes, rahmenloses Fenster. Es lebt unabhängig vom Hauptfenster und
 * kennt bewusst nur eine Aktion: Text aufnehmen und wegspeichern.
 */
export function QuickCapture() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>(IDLE);
  const [theme, setTheme] = useState<ThemeMode>('system');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Eigenes Fenster, eigener DOM - das Theme muss hier separat gesetzt werden.
  useTheme(theme);

  useEffect(() => {
    api.settings
      .status()
      .then((status) => setTheme(status.settings.appearance.theme))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const pending = listen(EVENTS.quickOpened, () => {
      setText('');
      setStatus(IDLE);
      inputRef.current?.focus();
    });
    inputRef.current?.focus();
    return () => {
      void pending.then((off) => off());
    };
  }, []);

  const close = () => {
    setText('');
    setStatus(IDLE);
    void api.quick.hide();
  };

  const submit = async () => {
    if (!text.trim() || status.kind === 'busy') return;
    setStatus({ kind: 'busy', message: 'Speichert...' });

    try {
      const result = await api.quick.capture(text);
      setStatus({ kind: 'done', message: result.message });
      setText('');
      // Bei Rückfragen übernimmt das Hauptfenster - dann nicht doppelt schliessen.
      if (!result.needsConfirmation) {
        window.setTimeout(close, CLOSE_DELAY_MS);
      }
    } catch (error) {
      setStatus({ kind: 'error', message: describeError(error) });
    }
  };

  return (
    <div className="quick">
      <textarea
        ref={inputRef}
        className="quick__input"
        value={text}
        placeholder="Was liegt an? Beispiel: morgen Abend Nico anrufen"
        spellCheck={false}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      <div className="quick__footer">
        <span className="quick__status" data-kind={status.kind}>
          {status.kind === 'busy' ? <span className="spinner" /> : null}
          {status.message || 'Enter speichert · Shift+Enter neue Zeile · Esc schliesst'}
        </span>
        <span className="quick__actions">
          <button type="button" className="button button--ghost" onClick={close}>
            Abbrechen
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={!text.trim() || status.kind === 'busy'}
          >
            Speichern
          </button>
        </span>
      </div>
    </div>
  );
}
