import { useEffect } from 'react';

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

function describe(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  parts.push(event.key.toLowerCase());
  return parts.join('+');
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Globale Tastaturkürzel. Kombinationen ohne Modifier greifen nicht,
 * solange der Fokus in einem Eingabefeld steht.
 */
export function useHotkeys(map: HotkeyMap): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const combination = describe(event);
      const handler = map[combination];
      if (!handler) return;

      // Funktionstasten greifen auch im Eingabefeld: F1 will man gerade
      // dann, wenn man mitten im Schreiben nicht weiterweiss.
      const isFunctionKey = /^f\d{1,2}$/.test(event.key.toLowerCase());
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      if (!hasModifier && !isFunctionKey && isTextEntry(event.target)) return;

      event.preventDefault();
      handler(event);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [map]);
}
