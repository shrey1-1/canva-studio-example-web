import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Numeric input that commits on Enter or blur, reverts on Escape, and steps with
 * ArrowUp/ArrowDown (Shift = x10). Accepts simple math like "100+20".
 */
export function NumberField({ label, prefix, value, onCommit, min, max, step = 1, suffix, precision = 2 }: {
  label: string;
  prefix?: ReactNode;
  value: number;
  onCommit: (value: number, meta: { stepping: boolean }) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  precision?: number;
}) {
  // A non-finite value means the selected layers differ ("Mixed").
  const format = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** precision) / 10 ** precision) : '');
  const [draft, setDraft] = useState(format(value));
  const reverting = useRef(false);
  // Re-sync when the value changes elsewhere (canvas drag, undo).
  useEffect(() => setDraft(Number.isFinite(value) ? String(Math.round(value * 10 ** precision) / 10 ** precision) : ''), [value, precision]);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

  const commit = (text: string, stepping = false) => {
    const parsed = evaluate(text);
    if (parsed === null) {
      setDraft(format(value));
      return;
    }
    const next = clamp(parsed);
    setDraft(format(next));
    // The field shows a rounded value; blurring without editing must not write that rounding back.
    if (format(next) !== format(value)) onCommit(next, { stepping });
  };

  return (
    <label className="flex h-7 min-w-0 items-center gap-1.5 rounded border border-transparent bg-app px-2 text-fg-muted hover:border-edge focus-within:border-accent">
      <span className="shrink-0 text-2xs text-fg-subtle" aria-hidden={typeof prefix !== 'string'}>
        {prefix ?? label}
      </span>
      <input
        aria-label={label}
        inputMode="decimal"
        placeholder={Number.isFinite(value) ? undefined : 'Mixed'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (reverting.current) {
            reverting.current = false;
            return;
          }
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Blurring triggers the single commit in onBlur.
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            // Revert first so the blur-commit sees the original value (a no-op).
            const input = e.target as HTMLInputElement;
            input.value = format(value);
            setDraft(format(value));
            reverting.current = true;
            input.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
            const base = evaluate(draft) ?? value;
            if (Number.isFinite(base)) commit(format(clamp(base + delta)), true);
          }
        }}
        className="w-full min-w-0 bg-transparent text-fg outline-none tabular-nums"
      />
      {suffix && <span className="text-2xs text-fg-subtle">{suffix}</span>}
    </label>
  );
}

/** Parses a number or a simple `a+b`, `a-b`, `a*b`, `a/b` expression. Returns null if invalid. */
export function evaluate(text: string): number | null {
  const t = text.replace(/\s+/g, '').replace(',', '.');
  if (/^-?\d*\.?\d+$/.test(t)) return Number(t);
  const m = /^(-?\d*\.?\d+)([+\-*/])(-?\d*\.?\d+)$/.exec(t);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  const r = m[2] === '+' ? a + b : m[2] === '-' ? a - b : m[2] === '*' ? a * b : b === 0 ? null : a / b;
  return r === null || !Number.isFinite(r) ? null : r;
}

/** Colour swatch + hex text input. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string, live: boolean) => void }) {
  const [draft, setDraft] = useState(value.replace('#', '').toUpperCase());
  useEffect(() => setDraft(value.replace('#', '').toUpperCase()), [value]);
  const id = useId();

  const commitHex = () => {
    const hex = normalizeHex(draft);
    if (hex) onChange(hex, false);
    else setDraft(value.replace('#', '').toUpperCase());
  };

  return (
    <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded bg-app px-1.5">
      <input
        id={id}
        type="color"
        aria-label={`${label} colour picker`}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase(), true)}
        className="h-4 w-4 shrink-0"
      />
      <input
        aria-label={`${label} hex`}
        value={draft}
        maxLength={7}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-full min-w-0 bg-transparent font-mono text-fg uppercase outline-none"
      />
    </div>
  );
}

export function normalizeHex(input: string): string | null {
  let h = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toUpperCase()}` : null;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-edge px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-2xs font-semibold text-fg">{title}</h3>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export const Row = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-2">{children}</div>;

/** Native select styled for the inspector. */
export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => {
        const picked = options.find((o) => String(o.value) === e.target.value);
        if (picked) onChange(picked.value);
      }}
      className={`h-7 min-w-0 rounded border border-transparent bg-app px-1.5 text-fg outline-none hover:border-edge focus:border-accent ${className}`}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A row of mutually exclusive icon buttons (radio group). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-7 rounded bg-app p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={`flex flex-1 items-center justify-center rounded ${
            value === o.value ? 'bg-hover text-fg' : 'text-fg-subtle hover:text-fg'
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-fg-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      {label}
    </label>
  );
}
