import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { Folder, Label, Note } from '@/types';

/** Wo geklickt wurde und auf welche Notiz. */
export interface MenuTarget {
  noteId: string;
  x: number;
  y: number;
}

interface NoteContextMenuProps {
  /**
   * Die Notiz kommt frisch aus der Liste, nicht aus dem Klick-Ereignis.
   * Sonst haette das Menue eine Kopie von vorhin, und ein zugewiesenes Label
   * bekaeme im Menue kein Haekchen.
   */
  note: Note;
  target: MenuTarget;
  folders: Folder[];
  labels: Label[];
  onSetFolder: (noteId: string, folderId: string) => void;
  onToggleLabel: (noteId: string, labelId: string) => void;
  onDelete: (noteId: string) => void;
  onClose: () => void;
}

/**
 * Kontextmenue fuer eine Notiz in der Liste.
 *
 * Es arbeitet immer auf der Notiz, auf die geklickt wurde - nicht auf der
 * gerade offenen. Das ist der ganze Sinn: umsortieren, ohne den Entwurf im
 * Editor zu verlieren.
 */
export function NoteContextMenu({
  note,
  target,
  folders,
  labels,
  onSetFolder,
  onToggleLabel,
  onDelete,
  onClose,
}: NoteContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: target.y, left: target.x });

  // Nach dem ersten Zeichnen steht die Groesse fest. Erst dann laesst sich
  // sagen, ob das Menue unten oder rechts aus dem Fenster laeuft.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    setPosition({
      top: Math.max(margin, Math.min(target.y, window.innerHeight - box.height - margin)),
      left: Math.max(margin, Math.min(target.x, window.innerWidth - box.width - margin)),
    });
  }, [target.x, target.y]);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('button')?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    // Das Menue schliesst auch beim Scrollen: eine Zeile weiter unten
    // gehoerte es zu einer anderen Notiz.
    const close = () => onClose();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [onClose]);

  const inFolder = note.folderId ?? '';

  return (
    <div
      className="context-menu"
      role="menu"
      ref={menu}
      style={{ top: position.top, left: position.left }}
      // Ohne das schliesst der Mousedown-Horcher oben das Menue, bevor der
      // Klick beim Eintrag ankommt.
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="context-menu__title">{note.folderId ? 'Ordner wechseln' : 'In Ordner legen'}</p>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={inFolder === ''}
        className="context-menu__item"
        onClick={() => {
          onSetFolder(note.id, '');
          onClose();
        }}
      >
        Ohne Ordner
      </button>
      {folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          role="menuitemradio"
          aria-checked={inFolder === folder.id}
          className="context-menu__item"
          onClick={() => {
            onSetFolder(note.id, folder.id);
            onClose();
          }}
        >
          {folder.name}
        </button>
      ))}

      {labels.length > 0 ? (
        <>
          <div className="context-menu__divider" />
          <p className="context-menu__title">Labels</p>
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={note.labels.includes(label.id)}
              className="context-menu__item"
              onClick={() => onToggleLabel(note.id, label.id)}
            >
              <span className="label-chip__dot" data-color={label.color} aria-hidden="true" />
              {label.name}
            </button>
          ))}
        </>
      ) : null}

      <div className="context-menu__divider" />
      <button
        type="button"
        role="menuitem"
        className="context-menu__item context-menu__item--danger"
        onClick={() => {
          onDelete(note.id);
          onClose();
        }}
      >
        In den Papierkorb
      </button>
    </div>
  );
}
