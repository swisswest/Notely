import { useEffect } from 'react';

import type { Toast as ToastValue } from '@/lib/store';

const AUTO_HIDE_MS = 6000;

export function Toast({ toast, onClose }: { toast: ToastValue; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);

  return (
    <div className="toast" data-kind={toast.kind} role="status" onClick={onClose}>
      {toast.message}
    </div>
  );
}
