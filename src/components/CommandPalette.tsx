import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(term));
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const runAt = (index: number) => {
    const command = matches[index];
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Befehle">
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Befehl suchen"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              runAt(active);
            }
          }}
        />
        <div className="palette__list">
          {matches.length === 0 ? (
            <p className="palette__hint" style={{ padding: '8px' }}>
              Kein Befehl gefunden
            </p>
          ) : (
            matches.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className="palette__item"
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => runAt(index)}
              >
                <span>{command.label}</span>
                {command.hint ? <span className="palette__hint">{command.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
