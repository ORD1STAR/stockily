import { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from './Icon';

export interface ActionMenuItem {
  label: string;
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
  onClick: () => void;
}

// "Plus ▾" dropdown for a page's secondary actions, so the header keeps a
// single obvious primary button instead of a row of equal-weight ones.
export function ActionMenu({ items, label = 'Plus' }: { items: ActionMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="action-menu" ref={ref}>
      <button type="button" className="btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <Icon name="chevronDown" size={15} className={`action-menu-chevron${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="action-menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="action-menu-item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon && (
                <span className="action-menu-icon">
                  <Icon name={item.icon} size={16} />
                </span>
              )}
              <span className="action-menu-text">
                <span className="action-menu-label">{item.label}</span>
                {item.hint && <span className="action-menu-hint">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
