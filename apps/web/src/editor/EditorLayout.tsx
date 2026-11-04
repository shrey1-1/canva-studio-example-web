import { useEffect } from 'react';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { documentRepository, useOpenFile } from '../persistence/serverRepository';
import { useAutosave, type SaveStatus } from '../persistence/useAutosave';
import { selectActivePage, useEditor } from '../state/editorStore';
import { CanvasView } from './canvas/CanvasView';
import { Toolbar } from './canvas/Toolbar';
import { Inspector } from './inspector/Inspector';
import { NavRail } from './nav/NavRail';
import { SecondaryPanel } from './panels/SecondaryPanel';
import { useClipboardEvents, useEditorShortcuts } from './shortcuts/useEditorShortcuts';
import { ContextMenu } from './ContextMenu';
import { Toasts } from './Toasts';
import { ToolDialogs } from './plugins/ToolDialogs';

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Not saved',
};

export function EditorLayout() {
  const { status, error, saveNow } = useAutosave(documentRepository);
  useEditorShortcuts(saveNow);
  useClipboardEvents();
  const docName = useEditor((s) => s.doc.name);
  const pageName = useEditor((s) => selectActivePage(s).name);
  const viewOnly = useOpenFile((s) => s.role === 'viewer');

  useEffect(() => {
    document.title = `${docName} – Canvas Studio`;
  }, [docName]);

  return (
    <div className="flex h-full w-full bg-app text-fg">
      <NavRail />
      <SecondaryPanel />
      <main className="relative min-w-0 flex-1" aria-label="Design canvas">
        <ErrorBoundary area="Canvas">
          <CanvasView />
        </ErrorBoundary>
        <div className="pointer-events-none absolute top-7 left-7 z-10 flex items-center gap-2 text-2xs">
          <span className="rounded bg-sidebar/90 px-2 py-1 text-fg-muted">
            {docName} <span className="text-fg-subtle">/ {pageName}</span>
          </span>
          <span
            role="status"
            title={error ?? undefined}
            className={`rounded px-2 py-1 ${status === 'error' ? 'bg-danger/20 text-red-300' : 'bg-sidebar/90 text-fg-subtle'}`}
          >
            {viewOnly ? 'View only' : STATUS_TEXT[status]}
            {status === 'error' && error ? ` — ${error}` : ''}
          </span>
          {status === 'error' && error?.startsWith('Someone else saved') && (
            <button type="button" onClick={() => window.location.reload()} className="pointer-events-auto rounded bg-accent px-2 py-1 text-white">
              Reload
            </button>
          )}
        </div>
        <Toolbar />
      </main>
      <Inspector />
      <ContextMenu />
      <ToolDialogs />
      <Toasts />
    </div>
  );
}
