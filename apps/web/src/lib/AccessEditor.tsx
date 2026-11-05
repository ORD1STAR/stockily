import { useState } from 'react';
import { Icon } from './Icon';
import type { GrantableModule, MemberAccess, MemberInput } from './api';
import '../pages/members.css';

export type Level = 'none' | 'view' | 'edit' | 'custom';

export interface AccessState {
  levels: Record<string, Level>;
  /** module key -> selected capability ids (used when level is 'custom') */
  caps: Record<string, string[]>;
  allSites: boolean;
  siteIds: string[];
}

const LEVELS: { key: Exclude<Level, 'custom'>; label: string }[] = [
  { key: 'none', label: 'Aucun' },
  { key: 'view', label: 'Lecture' },
  { key: 'edit', label: 'Écriture' },
];

export function initialAccess(access: MemberAccess | null | undefined, modules: GrantableModule[]): AccessState {
  const levels: Record<string, Level> = {};
  const caps: Record<string, string[]> = {};
  const granted = new Set((access?.modules ?? []).flatMap((m) => m.actions));
  for (const m of access?.modules ?? []) {
    levels[m.key] = m.level;
    if (m.level === 'custom') {
      const mod = modules.find((x) => x.key === m.key);
      caps[m.key] = (mod?.capabilities ?? []).filter((c) => c.actions.every((a) => granted.has(a))).map((c) => c.id);
    }
  }
  return {
    levels,
    caps,
    allSites: access?.sites === 'all' || !access,
    siteIds: access?.sites && access.sites !== 'all' ? access.sites.map((s) => s.id) : [],
  };
}

/** Converts editor state to the API payload, or returns an error message. */
export function buildAccess(state: AccessState, modules: GrantableModule[]): { access: MemberInput['access'] } | { error: string } {
  const chosen = Object.entries(state.levels).filter(([, l]) => l !== 'none');
  if (chosen.length === 0) return { error: 'Attribuez au moins un module.' };
  if (!state.allSites && state.siteIds.length === 0) return { error: 'Sélectionnez au moins un site, ou choisissez « Tous les sites ».' };
  const mods = chosen.map(([key, level]) => {
    if (level !== 'custom') return { key, level: level as 'view' | 'edit' };
    const mod = modules.find((m) => m.key === key);
    const ids = new Set(state.caps[key] ?? []);
    const actions = [...new Set((mod?.capabilities ?? []).filter((c) => ids.has(c.id)).flatMap((c) => c.actions))];
    return { key, level: 'custom' as const, actions };
  });
  return { access: { modules: mods, sites: state.allSites ? 'all' : state.siteIds } };
}

export function AccessEditor({
  modules,
  sites,
  value,
  onChange,
}: {
  modules: GrantableModule[];
  sites: { id: string; name: string }[];
  value: AccessState;
  onChange: (next: AccessState) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const levelOf = (k: string): Level => value.levels[k] ?? 'none';
  const setLevel = (k: string, l: Level) => onChange({ ...value, levels: { ...value.levels, [k]: l } });

  function selectedCaps(mod: GrantableModule): string[] {
    const l = levelOf(mod.key);
    if (l === 'edit') return mod.capabilities.map((c) => c.id);
    if (l === 'custom') return value.caps[mod.key] ?? [];
    return [];
  }

  function toggleCap(mod: GrantableModule, id: string) {
    const cur = new Set(selectedCaps(mod));
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    const all = mod.capabilities.length;
    const level: Level = cur.size === 0 ? 'view' : cur.size === all ? 'edit' : 'custom';
    onChange({ ...value, levels: { ...value.levels, [mod.key]: level }, caps: { ...value.caps, [mod.key]: [...cur] } });
  }

  function toggleSite(id: string) {
    onChange({ ...value, allSites: false, siteIds: value.siteIds.includes(id) ? value.siteIds.filter((x) => x !== id) : [...value.siteIds, id] });
  }

  return (
    <>
      <div className="member-section">Accès aux modules</div>
      <div className="member-access-list">
        {modules.map((mod) => {
          const lvl = levelOf(mod.key);
          const hasAdvanced = mod.capabilities.length > 0 && lvl !== 'none';
          const isOpen = open === mod.key && hasAdvanced;
          const sel = selectedCaps(mod).length;
          return (
            <div className="member-access-block" key={mod.key}>
              <div className="member-access-row">
                <span className="m-name">{mod.name}</span>
                <div className="member-access-right">
                  {hasAdvanced && (
                    <button type="button" className={`adv-btn${isOpen ? ' open' : ''}${lvl === 'custom' ? ' custom' : ''}`} onClick={() => setOpen(isOpen ? null : mod.key)}>
                      {lvl === 'custom' ? `Personnalisé · ${sel}/${mod.capabilities.length}` : 'Avancé'}
                      <Icon name="chevronDown" size={13} />
                    </button>
                  )}
                  <div className="seg" role="group" aria-label={mod.name}>
                    {LEVELS.map((l) => (
                      <button
                        key={l.key}
                        type="button"
                        className={`${lvl === l.key ? 'on' : ''}${l.key === 'edit' ? ' edit' : ''}`}
                        onClick={() => setLevel(mod.key, l.key)}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {isOpen && (
                <div className="cap-panel">
                  <div className="cap-base">
                    <Icon name="check" size={13} /> Consultation toujours incluse
                  </div>
                  <div className="cap-grid">
                    {mod.capabilities.map((c) => {
                      const on = selectedCaps(mod).includes(c.id);
                      return (
                        <button type="button" key={c.id} className={`cap-item${on ? ' on' : ''}`} onClick={() => toggleCap(mod, c.id)} aria-pressed={on}>
                          <span className="cap-switch" />
                          <span className="cap-text">
                            <span className="cap-label">{c.label}</span>
                            {c.hint && <span className="cap-hint">{c.hint}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="member-section">Sites autorisés</div>
      <div className="site-chip-row">
        <button type="button" className={`site-chip all${value.allSites ? ' on' : ''}`} onClick={() => onChange({ ...value, allSites: true, siteIds: [] })}>
          {value.allSites && <Icon name="check" size={13} />} Tous les sites
        </button>
        {sites.map((s) => {
          const on = !value.allSites && value.siteIds.includes(s.id);
          return (
            <button type="button" key={s.id} className={`site-chip${on ? ' on' : ''}`} onClick={() => toggleSite(s.id)}>
              {on && <Icon name="check" size={13} />} {s.name}
            </button>
          );
        })}
      </div>
    </>
  );
}
