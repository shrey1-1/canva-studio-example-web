import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useUi } from '../../state/uiStore';
import { SHORTCUTS } from '../shortcuts/useEditorShortcuts';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'Y';
}

/** Local profile menu. Real accounts and sign-in arrive with the backend (phase 6). */
export function AccountMenu() {
  const name = useUi((s) => s.profileName);
  const setName = useUi((s) => s.setProfileName);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(name);
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, name]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-2xs font-semibold">
          {initials(name)}
        </span>
        <ChevronDown size={12} className="text-fg-muted" />
      </button>
      {open && (
        <div role="dialog" aria-label="Account" className="absolute top-full left-0 z-50 mt-1 w-72 rounded-lg border border-edge bg-sidebar p-3 shadow-2xl">
          <label className="block text-2xs text-fg-muted">
            Display name
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setName(draft)}
              onKeyDown={(e) => e.key === 'Enter' && setName(draft)}
              className="mt-1 h-7 w-full rounded border border-edge bg-app px-2 text-xs text-fg outline-none focus:border-accent"
            />
          </label>
          <p className="mt-2 text-2xs text-fg-subtle">
            Local profile stored in this browser. Accounts, sign-in and sharing arrive in phase 6.
          </p>
          <h4 className="mt-3 mb-1 text-2xs font-semibold text-fg">Keyboard shortcuts</h4>
          <dl className="max-h-48 space-y-1 overflow-y-auto text-2xs">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex justify-between gap-2">
                <dt className="text-fg-muted">{s.action}</dt>
                <dd className="shrink-0 font-mono text-fg-subtle">{s.keys}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
