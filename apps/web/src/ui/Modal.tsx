import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Centered dialog: focuses its first field, closes on Esc and on a click outside. */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  escapeDisabled,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** When this returns true, Esc is left to something on top (e.g. a player). */
  escapeDisabled?: () => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Close"])')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !escapeDisabled?.()) {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, escapeDisabled]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-full w-full flex-col rounded-lg border border-edge bg-sidebar shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export const inputClass = 'h-8 w-full rounded border border-edge bg-app px-2 text-fg outline-none focus:border-accent';
export const primaryButton = 'rounded bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover disabled:opacity-50';
export const secondaryButton = 'rounded border border-edge px-3 py-1.5 hover:bg-hover disabled:opacity-50';
