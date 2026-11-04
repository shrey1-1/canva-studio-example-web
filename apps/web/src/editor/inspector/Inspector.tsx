import { useRef, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Play } from 'lucide-react';
import { useEditor } from '../../state/editorStore';
import { useUi, type InspectorTab } from '../../state/uiStore';
import { ErrorBoundary } from '../../app/ErrorBoundary';
import { Tooltip } from '../../ui/Tooltip';
import { AccountMenu } from './AccountMenu';
import { DesignTab } from './DesignTab';
import { PrototypeTab } from './PrototypeTab';

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'design', label: 'Design' },
  { id: 'prototype', label: 'Prototype' },
];

export function Inspector() {
  const tab = useUi((s) => s.inspectorTab);
  const setTab = useUi((s) => s.setInspectorTab);
  const docId = useEditor((s) => s.doc.id);
  const navigate = useNavigate();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next]!.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <aside aria-label="Properties" className="flex w-60 shrink-0 flex-col border-l border-edge bg-inspector">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-edge px-2">
        <AccountMenu />
        <Tooltip label="Present" side="bottom">
          <button
            type="button"
            aria-label="Present"
            onClick={() => navigate(`/file/${docId}/present`)}
            className="btn flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 font-medium text-white hover:bg-accent-hover"
          >
            <Play size={12} fill="currentColor" /> Present
          </button>
        </Tooltip>
      </div>

      <div role="tablist" aria-label="Inspector" className="flex h-9 shrink-0 items-center gap-1 border-b border-edge px-2">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`inspector-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="inspector-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`rounded px-2 py-1 font-medium ${tab === t.id ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="inspector-panel" role="tabpanel" aria-labelledby={`inspector-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
        <ErrorBoundary area="Inspector" key={tab}>
          {tab === 'design' ? <DesignTab /> : <PrototypeTab />}
        </ErrorBoundary>
      </div>
    </aside>
  );
}
