import { useEffect, useMemo, useRef, useState } from 'react';
import './SearchableSelect.css';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Shown muted next to the label (a SKU, a NIF) and included in the search match. */
  sublabel?: string;
}

// A type-to-filter combobox for the three lookups that matter most as a
// business grows past a handful of rows — clients, fournisseurs, products
// — where a plain <select> means scrolling a long, alphabetically-fixed
// list to find one row. Typing narrows it instead, the way every modern
// picker (an OS app switcher, a command palette) already works. Built as
// one shared component rather than per-form logic so every picker in the
// app behaves identically.
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  emptyLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  /** Placeholder shown when nothing is typed/selected yet. */
  placeholder?: string;
  /** Label for the "no selection" row — e.g. "— non spécifié —". Omit to require a real selection. */
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  // Reflects the committed selection when not actively searching — typing
  // replaces this display value until a pick (or blur) commits it again.
  const displayValue = open ? query : (selected?.label ?? '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter((o) => `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(q)) : options;
    return base.slice(0, 50);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      setQuery('');
      setHighlight(0);
      return;
    }
    if (!open) return;
    const rowCount = filtered.length + (emptyLabel ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, rowCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (emptyLabel && highlight === 0) pick('');
      else {
        const opt = filtered[highlight - (emptyLabel ? 1 : 0)];
        if (opt) pick(opt.value);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }

  return (
    <div className="searchable-select" ref={rootRef}>
      <input
        ref={inputRef}
        className="searchable-select-input"
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setHighlight(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // A blur not caused by clicking a dropdown row (that path calls
          // pick() first, which already closes it) — just revert to
          // whatever was last actually selected.
          setTimeout(() => {
            setOpen(false);
            setQuery('');
          }, 120);
        }}
        autoComplete="off"
      />
      {open && (
        <div className="searchable-select-dropdown">
          {emptyLabel && (
            <button
              type="button"
              className={`searchable-select-option${highlight === 0 ? ' highlighted' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick('')}
            >
              {emptyLabel}
            </button>
          )}
          {filtered.length === 0 && <div className="searchable-select-empty">Aucun résultat.</div>}
          {filtered.map((o, i) => {
            const idx = i + (emptyLabel ? 1 : 0);
            return (
              <button
                type="button"
                key={o.value}
                className={`searchable-select-option${idx === highlight ? ' highlighted' : ''}${o.value === value ? ' current' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => pick(o.value)}
              >
                <span>{o.label}</span>
                {o.sublabel && <span className="searchable-select-sublabel mono">{o.sublabel}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
