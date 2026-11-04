import { X } from 'lucide-react';
import { useToasts } from '../state/toastStore';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-20 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 shadow-xl ${
            t.kind === 'error' ? 'border-danger/60 bg-[#3a1d1d] text-red-200' : 'border-edge bg-sidebar text-fg'
          }`}
        >
          <p className="flex-1">{t.message}</p>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                dismiss(t.id);
                t.action!.run();
              }}
              className="rounded bg-accent px-2 py-0.5 text-white hover:brightness-110"
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-fg-subtle hover:text-fg">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
