import type { ReactNode } from 'react';

type Side = 'right' | 'bottom' | 'top' | 'left';

const sideClass: Record<Side, string> = {
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
};

/**
 * CSS-only tooltip shown on hover and on keyboard focus. The trigger itself must carry
 * an accessible name (aria-label); the tooltip is decorative for screen readers.
 */
export function Tooltip({ label, shortcut, side = 'right', children }: {
  label: string;
  shortcut?: string;
  side?: Side;
  children: ReactNode;
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded bg-black px-2 py-1 text-2xs text-fg opacity-0 shadow-lg transition-opacity delay-300 duration-100 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${sideClass[side]}`}
      >
        {label}
        {shortcut && <span className="ml-2 text-fg-subtle">{shortcut}</span>}
      </span>
    </span>
  );
}
