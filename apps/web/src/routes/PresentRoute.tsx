import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Group, Layer, Stage } from 'react-konva';
import { X } from 'lucide-react';
import { fitBounds, flowStart, screenIds, selectionBounds, type DesignDocument } from '@canvas-studio/core';
import { DocumentLoadError, documentRepository } from '../persistence/localRepository';
import { useEditor } from '../state/editorStore';
import { SceneNodes } from '../editor/canvas/SceneRenderer';
import { PrototypePlayer } from '../prototype/PrototypePlayer';

/**
 * Presentation mode. A page with frames plays as a prototype (screens, interactions,
 * transitions; `?start=<frameId>` picks the first screen). A page without frames is shown
 * fitted to the window.
 */
export function PresentRoute() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const storeDoc = useEditor((s) => s.doc);
  const storePageId = useEditor((s) => s.activePageId);
  const [doc, setDoc] = useState<DesignDocument | null>(storeDoc.id === docId ? storeDoc : null);
  const [pageId, setPageId] = useState<string | null>(storeDoc.id === docId ? storePageId : null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (doc || !docId) return;
    documentRepository
      .load(docId)
      .then((loaded) => {
        if (!loaded) return setMissing(true);
        setDoc(loaded);
        setPageId(loaded.pages[0]!.id);
      })
      .catch((error: unknown) => setLoadError(error instanceof DocumentLoadError ? error.message : 'This file could not be opened.'));
  }, [doc, docId]);

  const exit = () => navigate(`/file/${docId}`);

  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0];
  const requested = search.get('start');
  const start = doc && page ? (requested && screenIds(doc, page).includes(requested) ? requested : flowStart(doc, page)) : null;

  // The prototype player handles its own keys (Esc closes overlays first).
  useEffect(() => {
    if (start) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && navigate(`/file/${docId}`);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docId, navigate, start]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const viewport = useMemo(() => {
    if (!doc || !page) return null;
    const bounds = selectionBounds(
      doc,
      page.childIds.filter((id) => doc.nodes[id]?.visible),
    );
    return bounds ? fitBounds(bounds, size, 48, 4) : null;
  }, [doc, page, size]);

  return (
    <div className="flex h-full flex-col bg-[#111]">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-edge bg-sidebar px-3 text-fg-muted">
        <span className="truncate">{doc ? doc.name : 'Presentation'}</span>
        {doc && doc.pages.length > 1 && (
          <select
            aria-label="Page"
            value={page?.id}
            onChange={(e) => setPageId(e.target.value)}
            className="h-7 rounded border border-edge bg-app px-2 text-fg outline-none"
          >
            {doc.pages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button type="button" onClick={exit} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-hover hover:text-fg">
          <X size={14} /> Exit <kbd className="ml-1 text-2xs text-fg-subtle">Esc</kbd>
        </button>
      </header>
      <div ref={containerRef} className="relative min-h-0 flex-1" style={{ background: page?.background }}>
        {missing && <p className="p-6 text-center text-fg-muted">File not found.</p>}
        {loadError && <p className="p-6 text-center text-fg-muted">{loadError}</p>}
        {doc && page && start && (
          <div className="absolute inset-0">
            <PrototypePlayer key={`${page.id}:${start}`} doc={doc} start={start} onExit={exit} />
          </div>
        )}
        {doc && page && !start && viewport && size.width > 0 && (
          <Stage width={size.width} height={size.height} listening={false}>
            <Layer>
              <Group x={viewport.x} y={viewport.y} scaleX={viewport.zoom} scaleY={viewport.zoom}>
                <SceneNodes doc={doc} ids={page.childIds} interactive={false} zoom={viewport.zoom} />
              </Group>
            </Layer>
          </Stage>
        )}
        {doc && page && !viewport && (
          <p className="absolute inset-0 flex items-center justify-center text-fg-muted">This page is empty.</p>
        )}
      </div>
    </div>
  );
}
