import { useRef, type KeyboardEvent } from 'react';
import { Bot, File, Shapes, Variable, Wrench, type LucideIcon } from 'lucide-react';
import { useUi, type NavSection } from '../../state/uiStore';
import { Tooltip } from '../../ui/Tooltip';

export const NAV_ITEMS: { id: NavSection; label: string; icon: LucideIcon }[] = [
  { id: 'file', label: 'File', icon: File },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'assets', label: 'Assets', icon: Shapes },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'variables', label: 'Variables', icon: Variable },
];

/**
 * Primary navigation. Implemented as a vertical tab list: arrow keys move focus
 * (roving tabindex), Enter/Space opens the section, clicking the active one collapses the panel.
 */
export function NavRail() {
  const nav = useUi((s) => s.nav);
  const panelOpen = useUi((s) => s.panelOpen);
  const openSection = useUi((s) => s.openSection);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = NAV_ITEMS.length - 1;
    const next =
      e.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <nav aria-label="Workspaces" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-edge bg-sidebar py-2">
      <div aria-hidden="true" className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-accent font-display text-[11px] font-bold tracking-tight text-white">
        CS
      </div>
      <div role="tablist" aria-orientation="vertical" aria-label="Workspaces" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item, i) => {
          const selected = nav === item.id;
          const Icon = item.icon;
          return (
            <Tooltip key={item.id} label={item.label} side="right">
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`nav-${item.id}`}
                aria-label={item.label}
                aria-selected={selected}
                aria-controls="secondary-panel"
                aria-expanded={selected ? panelOpen : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => openSection(item.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`relative flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                  selected && panelOpen ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                }`}
              >
                {selected && (
                  <span aria-hidden="true" className="absolute -left-1.5 h-5 w-0.5 rounded-r bg-accent" />
                )}
                <Icon size={18} strokeWidth={1.75} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
