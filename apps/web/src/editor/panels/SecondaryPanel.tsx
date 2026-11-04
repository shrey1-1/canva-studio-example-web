import { useUi } from '../../state/uiStore';
import { ErrorBoundary } from '../../app/ErrorBoundary';
import { NAV_ITEMS } from '../nav/NavRail';
import { FilePanel } from './FilePanel';
import { ToolsPanel } from './ToolsPanel';
import { AgentsPanel } from './AgentsPanel';
import { AssetsPanel } from './AssetsPanel';
import { VariablesPanel } from './VariablesPanel';

/** Contextual sidebar: its content follows the selected navigation item. */
export function SecondaryPanel() {
  const nav = useUi((s) => s.nav);
  const open = useUi((s) => s.panelOpen);
  const label = NAV_ITEMS.find((n) => n.id === nav)?.label ?? '';

  return (
    <aside
      id="secondary-panel"
      role="tabpanel"
      aria-labelledby={`nav-${nav}`}
      aria-label={label}
      // `inert` (not `hidden`) so the width can animate while closed content stays unfocusable.
      inert={!open}
      className={`shrink-0 overflow-hidden border-r border-edge bg-panel transition-[width] duration-150 ${open ? 'w-64' : 'w-0'}`}
    >
      <div className="flex h-full w-64 flex-col">
        <ErrorBoundary area={`${label} panel`} key={nav}>
          {nav === 'file' && <FilePanel />}
          {nav === 'tools' && <ToolsPanel />}
          {nav === 'agents' && <AgentsPanel />}
          {nav === 'assets' && <AssetsPanel />}
          {nav === 'variables' && <VariablesPanel />}
        </ErrorBoundary>
      </div>
    </aside>
  );
}
