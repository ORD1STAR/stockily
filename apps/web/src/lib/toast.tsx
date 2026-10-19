import { useSyncExternalStore } from 'react';
import './toast.css';

// A lightweight toast system — no toast/notification library exists
// anywhere in this app's dependencies (checked package.json), and pulling
// one in for "show a confirmation bottom-right on save" would be a lot of
// surface area for what's a handful of small components. Same singleton
// pub/sub shape as data-events.ts: a module-level store plus
// useSyncExternalStore, no Context provider to thread through every modal.
export interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const AUTO_DISMISS_MS = 4000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: Toast['kind'], message: string) {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  emit();
  setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
};

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): Toast[] {
  return toasts;
}

export function ToastContainer() {
  const current = useSyncExternalStore(subscribe, getSnapshot);

  if (current.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {current.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          <span className="toast-icon">{t.kind === 'success' ? '✓' : '✕'}</span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
