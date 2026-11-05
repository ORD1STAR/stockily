import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './data-views.css';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

type Resolver = (ok: boolean) => void;

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | undefined>(undefined);

// A custom, on-brand replacement for window.confirm — same promise-based
// ergonomics (`if (await confirm({...}))`), but a real modal styled like the
// rest of the app instead of the browser's native dialog.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: Resolver } | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opts, resolve })), []);

  const close = useCallback(
    (ok: boolean) => {
      state?.resolve(ok);
      setState(null);
    },
    [state],
  );

  useEffect(() => {
    if (!state) return;
    confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, close]);

  const danger = state?.opts.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-backdrop open" onMouseDown={() => close(false)}>
          <div className="modal confirm-modal" onMouseDown={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <div className={`confirm-icon${danger ? ' danger' : ''}`}>
              <Icon name={danger ? 'alert' : 'info'} size={22} />
            </div>
            <h3 className="confirm-title">{state.opts.title}</h3>
            {state.opts.message && <div className="confirm-message">{state.opts.message}</div>}
            <div className="confirm-actions">
              <button type="button" className="btn-secondary" onClick={() => close(false)}>
                {state.opts.cancelLabel ?? 'Annuler'}
              </button>
              <button ref={confirmBtn} type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>
                {state.opts.confirmLabel ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
