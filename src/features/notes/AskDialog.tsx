import { useEffect, useRef, useState } from 'react';

import { Button, Dialog, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { reportError, requestOpenNote } from '@/lib/store';
import type { NoteAnswer } from '@/types';
import { formatDateTime } from '@/utils/date';
import { summarize } from './NoteSummary';

interface AskDialogProps {
  /** Vorbelegung aus dem Suchfeld - meistens ist das schon die halbe Frage. */
  initial: string;
  onClose: () => void;
}

/**
 * Eine Frage an die eigenen Notizen.
 *
 * Bewusst ein eigener Dialog und ein ausdruecklicher Knopf: anders als die
 * Suche daneben kostet jede Frage einen Aufruf bei Anthropic und schickt
 * Notizen aus dem Haus. Das darf nicht beim Tippen nebenbei passieren.
 */
export function AskDialog({ initial, onClose }: AskDialogProps) {
  const [question, setQuestion] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NoteAnswer | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const ask = async () => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    // Die alte Antwort verschwindet sofort - sonst steht sie neben der neuen
    // Frage und sieht aus, als gehoerte sie dazu.
    setResult(null);
    try {
      setResult(await api.askNotes(text));
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const open = (noteId: string) => {
    void requestOpenNote(noteId);
    onClose();
  };

  return (
    <Dialog
      title="Notizen fragen"
      subtitle="Claude liest die Notizen, die zur Frage passen, und sagt, wo es steht."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Schliessen
          </Button>
          <Button variant="primary" onClick={() => void ask()} disabled={busy || !question.trim()}>
            {busy ? 'Sucht ...' : 'Fragen'}
          </Button>
        </>
      }
    >
      <div className="field__row" style={{ marginBottom: 10 }}>
        <TextInput
          ref={input}
          value={question}
          placeholder="Wo habe ich mein Auto geparkt?"
          maxLength={500}
          onChange={(event) => setQuestion(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void ask();
            }
          }}
          style={{ flex: 1 }}
        />
      </div>

      {busy ? (
        <p className="field__hint">
          <span className="spinner" aria-hidden="true" /> Notizen werden durchsucht ...
        </p>
      ) : null}

      {result ? <Answer result={result} onOpen={open} /> : null}

      <p className="field__hint ask__privacy">
        Fuer eine Frage gehen bis zu acht passende Notizen an Anthropic - nicht alle.
        Was nicht zur Frage passt, verlaesst den Rechner nicht.
      </p>
    </Dialog>
  );
}

interface AnswerProps {
  result: NoteAnswer;
  onOpen: (noteId: string) => void;
}

function Answer({ result, onOpen }: AnswerProps) {
  if (!result.found) {
    return (
      <div className="ask__answer ask__answer--empty">
        <p>
          {result.searched === 0
            ? 'Zu dieser Frage gibt es keine passende Notiz.'
            : `In den ${result.searched} passendsten Notizen steht dazu nichts.`}
        </p>
        <p className="field__hint">
          Das ist eine Antwort, kein Fehler. Erfunden wird hier nichts - ohne Notiz
          als Beleg bleibt die Antwort leer.
        </p>
      </div>
    );
  }

  return (
    <div className="ask__answer">
      <p className="ask__text">{result.answer}</p>
      <p className="field__hint">Steht in:</p>
      <div className="ask__sources">
        {result.sources.map((note) => (
          <button
            key={note.id}
            type="button"
            className="ask__source"
            title="Notiz oeffnen"
            onClick={() => onOpen(note.id)}
          >
            <span className="ask__source-title">{summarize(note.content).title}</span>
            <span className="ask__source-meta">{formatDateTime(note.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
