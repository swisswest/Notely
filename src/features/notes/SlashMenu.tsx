import { useEffect, useRef, useState } from 'react';

import type { SlashCommand } from './slashCommands';

interface SlashMenuProps {
  commands: SlashCommand[];
  /** Position relativ zum umgebenden Editor, in Pixeln. */
  top: number;
  left: number;
  onPick: (command: SlashCommand) => void;
  onClose: () => void;
}

/**
 * Die Liste zum Slash-Befehl. Bedient wird sie ausschliesslich über die
 * Tastatur - wer gerade tippt, nimmt nicht die Hand von der Tastatur, nur um
 * eine Überschrift einzufügen. Angeklickt werden kann sie trotzdem.
 *
 * Die Tastendrücke fängt der Editor ab und meldet die Auswahl hier herein;
 * so bleibt der Cursor im Textfeld und das Menü braucht keinen Fokus.
 */
export function SlashMenu({ commands, top, left, onPick, onClose }: SlashMenuProps) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  // Ändert sich die Trefferliste beim Weitertippen, beginnt die Auswahl oben.
  useEffect(() => {
    setActive(0);
  }, [commands]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape zuerst: ein Menü ohne Treffer muss sich trotzdem schliessen lassen.
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (commands.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((value) => (value + 1) % commands.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((value) => (value - 1 + commands.length) % commands.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const chosen = commands[active];
        if (chosen) onPick(chosen);
      }
    };

    // Capture, damit das Textfeld Enter nicht vorher als Zeilenumbruch nimmt.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [commands, active, onPick, onClose]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className="slash" style={{ top, left }} ref={list} role="listbox" aria-label="Bausteine">
      {commands.length === 0 ? (
        <p className="slash__empty">Kein Baustein passt. Esc schliesst.</p>
      ) : (
        commands.map((command, index) => (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-selected={index === active}
            data-index={index}
            data-active={index === active}
            className="slash__item"
            // Der Klick darf dem Textfeld nicht den Fokus nehmen, sonst
            // springt der Cursor und der Baustein landet an der falschen Stelle.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(command);
            }}
            onMouseEnter={() => setActive(index)}
          >
            <span>{command.label}</span>
            <span className="slash__hint">{command.hint}</span>
          </button>
        ))
      )}
    </div>
  );
}
