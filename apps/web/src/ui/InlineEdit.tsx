import { useEffect, useRef, useState } from 'react';

/**
 * Text that turns into an input on double-click (or Enter/F2 when focused).
 * Enter or blur commits, Escape cancels. Empty values are rejected.
 */
export function InlineEdit({ value, onCommit, label, className = '' }: {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={`min-w-0 flex-1 rounded border border-accent bg-app px-1 py-0.5 outline-none ${className}`}
      />
    );
  }

  return (
    <span
      title={`${value} — double-click to rename`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          e.preventDefault();
          setDraft(value);
          setEditing(true);
        }
      }}
      className={`min-w-0 flex-1 truncate ${className}`}
    >
      {value}
    </span>
  );
}
