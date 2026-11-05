import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../lib/Icon';

export interface ComboOption { value: string; label: string }

/** Searchable select: type to filter the list, click or Enter to pick. */
export function Combobox({ value, onChange, options, allLabel, disabled, width = 210 }: {
  value: string; onChange: (v: string) => void; options: ComboOption[]; allLabel: string; disabled?: boolean; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const all: ComboOption[] = useMemo(() => [{ value: 'all', label: allLabel }, ...options], [options, allLabel]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? all.filter((o) => o.value !== 'all' && o.label.toLowerCase().includes(t)) : all;
  }, [all, q]);
  const current = all.find((o) => o.value === value)?.label ?? allLabel;

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  const openIt = () => { if (disabled) return; setOpen(true); setHi(0); setTimeout(() => input.current?.focus(), 0); };

  return (
    <div className={`combo${disabled ? ' disabled' : ''}${value !== 'all' ? ' active' : ''}`} ref={root} style={{ width }}>
      <button type="button" className="combo-btn" onClick={() => (open ? setOpen(false) : openIt())} disabled={disabled} title={current}>
        <span className="combo-label">{current}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="combo-pop">
          <input
            ref={input}
            className="combo-search"
            placeholder="Taper pour filtrer…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) pick(list[hi].value); }
              else if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div className="combo-list">
            {list.map((o, i) => (
              <div key={o.value} className={`combo-opt${i === hi ? ' hi' : ''}${o.value === value ? ' sel' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}>
                {o.label}
              </div>
            ))}
            {list.length === 0 && <div className="combo-empty">Aucun résultat</div>}
          </div>
        </div>
      )}
    </div>
  );
}
