import { useEffect } from 'react';

import type { ThemeMode } from '@/types';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** Setzt das Theme am Wurzelelement und folgt der Systemeinstellung. */
export function useTheme(mode: ThemeMode): void {
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset['theme'] = resolve(mode);
    };
    apply();

    if (mode !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);
}
