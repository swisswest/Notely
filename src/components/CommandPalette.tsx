import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  /** Liefert Treffer aus Notizen und Tasks zum eingegebenen Text. */
  onSearch?: (term: string) => Promise<Command[]>;
  onClose: () => void;
}

const SEARCH_DELAY_MS = 180;
const MIN_TERM_LENGTH = 2;

export function CommandPalette({ commands, onSearch, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Command[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matchingCommands = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(term));
  }, [commands, query]);

  const entries = useMemo(() => [...matchingCommands, ...results], [matchingCommands, results]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActive(0);
    const term = query.trim();
    if (!onSearch || term.length < MIN_TERM_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      onSearch(term)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, onSearch]);

  const runAt = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    onClose();
    entry.run();
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
          placeholder="Befehl oder Suchbegriff"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, entries.length - 1));
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
          {entries.length === 0 ? (
            <p className="palette__hint" style={{ padding: '8px' }}>
              {searching ? 'Sucht...' : 'Kein Treffer'}
            </p>
          ) : (
            entries.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                className="palette__item"
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => runAt(index)}
              >
                <span>{entry.label}</span>
                {entry.hint ? <span className="palette__hint">{entry.hint}</span> : null}
              </button>
            ))
          )}
          {searching && entries.length > 0 ? (
            <p className="palette__hint" style={{ padding: '6px 8px' }}>
              Sucht...
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
