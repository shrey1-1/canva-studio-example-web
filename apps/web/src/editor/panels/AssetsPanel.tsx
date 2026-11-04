import { memo, useMemo, useState, useSyncExternalStore } from 'react';
import { Group, Layer, Stage } from 'react-konva';
import { Component, Search, Target } from 'lucide-react';
import { addNode, createImage, listComponents, type ComponentNode, type DesignDocument, type ImageNode } from '@canvas-studio/core';
import { getImageEntry, subscribeImages } from '../../persistence/assetStore';
import { useEditor } from '../../state/editorStore';
import { IconButton } from '../../ui/IconButton';
import { SceneNodes } from '../canvas/SceneRenderer';
import * as cmd from '../commands';
import { rectCenter, visibleWorldRect } from '../placement';
import { PanelHeader } from './PanelHeader';

/** MIME type used when dragging a component from this panel onto the canvas. */
export const COMPONENT_DRAG_TYPE = 'application/x-canvas-studio-component';

const THUMB = 44;

/** Small, non-interactive render of a component. */
const Thumbnail = memo(function Thumbnail({ doc, node }: { doc: DesignDocument; node: ComponentNode }) {
  const scale = Math.min(THUMB / Math.max(1, node.width), THUMB / Math.max(1, node.height), 1);
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-app" aria-hidden="true">
      <Stage width={THUMB} height={THUMB} listening={false}>
        <Layer>
          <Group
            x={(THUMB - node.width * scale) / 2 - node.x * scale}
            y={(THUMB - node.height * scale) / 2 - node.y * scale}
            scaleX={scale}
            scaleY={scale}
          >
            <SceneNodes doc={doc} ids={[node.id]} interactive={false} zoom={scale} />
          </Group>
        </Layer>
      </Stage>
    </div>
  );
});

function ComponentRow({ doc, node, label }: { doc: DesignDocument; node: ComponentNode; label: string }) {
  const select = useEditor((s) => s.select);
  const setActivePage = useEditor((s) => s.setActivePage);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        draggable
        title={`Click to insert ${label}, or drag it onto the canvas`}
        aria-label={`Insert ${label}`}
        onDragStart={(e) => {
          e.dataTransfer.setData(COMPONENT_DRAG_TYPE, node.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => cmd.insertInstance(node.id)}
        onKeyDown={(e) => e.key === 'Enter' && cmd.insertInstance(node.id)}
        className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover"
      >
        <Thumbnail doc={doc} node={node} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-fg">{label}</p>
          {node.description && <p className="truncate text-2xs text-fg-subtle">{node.description}</p>}
        </div>
        <IconButton
          label={`Go to main component ${label}`}
          className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            setActivePage(node.pageId);
            select([node.id]);
            requestAnimationFrame(cmd.zoomToSelection);
          }}
        >
          <Target size={12} />
        </IconButton>
      </div>
    </li>
  );
}

function useImage(assetId: string) {
  return useSyncExternalStore(subscribeImages, () => getImageEntry(assetId));
}

function ImageTile({ node }: { node: ImageNode }) {
  const entry = useImage(node.assetId);
  const insert = () => {
    const { doc, activePageId, dispatch, select } = useEditor.getState();
    void doc;
    const c = rectCenter(visibleWorldRect());
    const copy = createImage({
      pageId: activePageId,
      x: Math.round(c.x - node.width / 2),
      y: Math.round(c.y - node.height / 2),
      width: node.width,
      height: node.height,
      name: node.name,
      assetId: node.assetId,
      naturalWidth: node.naturalWidth,
      naturalHeight: node.naturalHeight,
    });
    dispatch('Insert image', (d) => addNode(d, copy));
    select([copy.id]);
  };
  return (
    <button type="button" onClick={insert} title={`Insert ${node.name}`} aria-label={`Insert image ${node.name}`} className="aspect-square overflow-hidden rounded bg-app hover:ring-1 hover:ring-accent">
      {entry.status === 'ready' ? (
        <img src={entry.image.src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-2xs text-fg-subtle">{entry.status === 'loading' ? '…' : 'Missing'}</span>
      )}
    </button>
  );
}

/** Components and images in this file, searchable, insertable by click or drag. */
export function AssetsPanel() {
  const doc = useEditor((s) => s.doc);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const { sets, singles, images } = useMemo(() => {
    const all = listComponents(doc);
    const match = (c: ComponentNode, setName = '') =>
      !q || `${setName} ${c.name} ${c.description} ${Object.values(c.variantProps).join(' ')}`.toLowerCase().includes(q);
    const setMap = new Map<string, ComponentNode[]>();
    const singles: ComponentNode[] = [];
    for (const { component, setId } of all) {
      if (setId) {
        if (!match(component, doc.nodes[setId]!.name)) continue;
        setMap.set(setId, [...(setMap.get(setId) ?? []), component]);
      } else if (match(component)) {
        singles.push(component);
      }
    }
    const seen = new Set<string>();
    const images = Object.values(doc.nodes).filter(
      (n): n is ImageNode => n.type === 'image' && !seen.has(n.assetId) && !!seen.add(n.assetId) && (!q || n.name.toLowerCase().includes(q)),
    );
    return { sets: [...setMap.entries()], singles, images };
  }, [doc, q]);

  const empty = sets.length === 0 && singles.length === 0 && images.length === 0;

  return (
    <>
      <PanelHeader title="Assets" />
      <div className="border-b border-edge p-2">
        <label className="flex h-7 items-center gap-1.5 rounded bg-app px-2 text-fg-muted focus-within:ring-1 focus-within:ring-accent">
          <Search size={13} aria-hidden="true" />
          <input aria-label="Search assets" placeholder="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full bg-transparent text-fg outline-none" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {empty && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-fg-muted">
            <Component size={20} aria-hidden="true" />
            {q ? (
              <p>No assets match “{query}”.</p>
            ) : (
              <p>
                No components yet. Select a frame or layers and press <kbd className="rounded bg-hover px-1">Ctrl+Alt+K</kbd> to make one.
              </p>
            )}
          </div>
        )}
        {(sets.length > 0 || singles.length > 0) && <h3 className="px-2 pt-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">Components</h3>}
        <ul aria-label="Components">
          {singles.map((c) => (
            <ComponentRow key={c.id} doc={doc} node={c} label={c.name} />
          ))}
        </ul>
        {sets.map(([setId, variants]) => (
          <section key={setId} aria-label={doc.nodes[setId]!.name}>
            <h4 className="px-2 pt-2 text-fg">{doc.nodes[setId]!.name}</h4>
            <ul>
              {variants.map((c) => (
                <ComponentRow key={c.id} doc={doc} node={c} label={Object.values(c.variantProps).join(', ') || c.name} />
              ))}
            </ul>
          </section>
        ))}
        {images.length > 0 && (
          <>
            <h3 className="px-2 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">Images in this file</h3>
            <div className="grid grid-cols-3 gap-1.5 px-2 pb-2">
              {images.map((img) => (
                <ImageTile key={img.assetId} node={img} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
