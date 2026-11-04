import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  tooltipSide?: 'right' | 'bottom' | 'top' | 'left';
  children: ReactNode;
}

/** Square icon button with an accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, shortcut, active = false, tooltipSide = 'bottom', className = '', children, ...rest },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active || undefined}
        className={`inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40 ${
          active ? 'bg-accent text-white hover:bg-accent' : ''
        } ${className}`}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});
