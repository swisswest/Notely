import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { App } from '@/App';
import { QuickCapture } from '@/features/quick/QuickCapture';
import '@/styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root-Element nicht gefunden');
}

/** Beide Fenster laden dasselbe Bundle - das Label entscheidet über den Inhalt. */
const isQuickWindow = getCurrentWindow().label === 'quick';

createRoot(container).render(
  <StrictMode>{isQuickWindow ? <QuickCapture /> : <App />}</StrictMode>,
);
