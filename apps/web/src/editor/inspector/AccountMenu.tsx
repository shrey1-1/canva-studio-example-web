import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, LogOut } from 'lucide-react';
import { useAuth } from '../../state/authStore';
import { SHORTCUTS } from '../shortcuts/useEditorShortcuts';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'Y';
}

/** Account menu: who is signed in, a way back to the file browser, sign out, and shortcuts. */
export function AccountMenu() {
  const user = useAuth((s) => s.user);
  const name = user?.name ?? 'You';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white text-2xs font-semibold">
          {initials(name)}
        </span>
        <ChevronDown size={12} className="text-fg-muted" />
      </button>
      {open && (
        <div role="dialog" aria-label="Account" className="absolute top-full left-0 z-50 mt-1 w-72 rounded-lg border border-edge bg-sidebar p-3 shadow-2xl">
          <p className="truncate text-xs font-medium text-fg">{name}</p>
          <p className="truncate text-2xs text-fg-subtle">{user?.email}</p>
          <div className="mt-2 flex gap-2">
            <Link to="/" className="flex-1 rounded border border-edge px-2 py-1 text-center text-2xs hover:bg-hover">All files</Link>
            <button type="button" onClick={() => void useAuth.getState().logout()} className="flex flex-1 items-center justify-center gap-1 rounded border border-edge px-2 py-1 text-2xs hover:bg-hover">
              <LogOut size={11} /> Log out
            </button>
          </div>
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
