import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Boxes,
  Component,
  Diamond,
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  Frame,
  Group,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Minus,
  Pentagon,
  Spline,
  Square,
  SquareDashed,
  Star,
  Type,
  type LucideIcon,
} from 'lucide-react';
import {
  childIdsOf,
  isAncestor,
  isContainer,
  moveNodes,
  topMostIds,
  updateNode,
  type DesignDocument,
  type NodeId,
  type SceneNode,
} from '@canvas-studio/core';
import { selectActivePage, useEditor } from '../../state/editorStore';
import { useContextMenu } from '../../state/contextMenuStore';
import { IconButton } from '../../ui/IconButton';
import { InlineEdit } from '../../ui/InlineEdit';

interface DropHint {
  id: NodeId;
  zone: 'above' | 'below' | 'inside';
}

interface LayersCtx {
  collapsed: ReadonlySet<NodeId>;
  toggleCollapsed: (id: NodeId) => void;
  hint: DropHint | null;
  setHint: (hint: DropHint | null) => void;
}

const LayersContext = createContext<LayersCtx | null>(null);
/** Layers being dragged in the panel (kept outside React; drag events fire very often). */
let draggedIds: NodeId[] = [];

export function LayersSection() {
  const page = useEditor(selectActivePage);
  const selection = useEditor((s) => s.selection);
  const [collapsed, setCollapsed] = useState<Set<NodeId>>(new Set());
  const [hint, setHint] = useState<DropHint | null>(null);
  const topFirst = [...page.childIds].reverse();

  // Reveal layers selected on the canvas by expanding their ancestors.
  useEffect(() => {
    const { doc } = useEditor.getState();
    const open = new Set<NodeId>();
    for (const id of selection) {
      let p = doc.nodes[id]?.parentId ?? null;
      while (p) {
        open.add(p);
        p = doc.nodes[p]?.parentId ?? null;
      }
    }
    setCollapsed((prev) => ([...open].some((id) => prev.has(id)) ? new Set([...prev].filter((id) => !open.has(id))) : prev));
  }, [selection]);

  const ctx = useMemo<LayersCtx>(
    () => ({
      collapsed,
      toggleCollapsed: (id) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      hint,
      setHint,
    }),
    [collapsed, hint],
  );

  return (
    <section aria-label="Layers" className="flex min-h-0 flex-1 flex-col py-1">
      <h3 className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">Layers</h3>
      {topFirst.length === 0 ? (
        <p className="px-3 py-4 text-fg-subtle">
          No layers yet. Press <kbd className="rounded bg-hover px-1">F</kbd> for a frame or{' '}
          <kbd className="rounded bg-hover px-1">R</kbd> for a rectangle, then drag on the canvas.
        </p>
      ) : (
        <LayersContext.Provider value={ctx}>
          <ul role="tree" aria-label="Layers" className="min-h-0 flex-1 overflow-y-auto pb-2">
            {topFirst.map((id) => (
              <LayerRow key={id} id={id} depth={0} />
            ))}
          </ul>
        </LayersContext.Provider>
      )}
    </section>
  );
}

export const typeIcon = (node: SceneNode): LucideIcon => {
  if (node.isMask) return SquareDashed;
  switch (node.type) {
    case 'frame':
      return Frame;
    case 'component':
      return Component;
    case 'component-set':
      return Boxes;
    case 'instance':
      return Diamond;
    case 'group':
      return Group;
    case 'ellipse':
      return Circle;
    case 'rectangle':
      return Square;
    case 'polygon':
      return Pentagon;
    case 'star':
      return Star;
    case 'line':
      return Minus;
    case 'vector':
      return Spline;
    case 'text':
      return Type;
    case 'image':
      return ImageIcon;
  }
};

/** Whether the dragged layers may be dropped at this row/zone (never into themselves). */
function canDrop(doc: DesignDocument, targetId: NodeId, zone: DropHint['zone']): boolean {
  if (draggedIds.length === 0 || draggedIds.includes(targetId)) return false;
  if (draggedIds.some((id) => isAncestor(doc, id, targetId))) return false;
  if (zone === 'inside') return isContainer(doc.nodes[targetId]!);
  return true;
}

const LayerRow = memo(function LayerRow({ id, depth }: { id: NodeId; depth: number }) {
  const node = useEditor((s) => s.doc.nodes[id]);
  const selected = useEditor((s) => s.selection.includes(id));
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const ctx = useContext(LayersContext)!;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  if (!node) return null;

  const Icon = typeIcon(node);
  const container = isContainer(node);
  const isCollapsed = ctx.collapsed.has(id);
  const children = container && !isCollapsed ? [...node.childIds].reverse() : [];
  const hint = ctx.hint?.id === id ? ctx.hint.zone : null;

  const zoneAt = (e: DragEvent): DropHint['zone'] => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (container) return t < 0.25 ? 'above' : t > 0.75 ? 'below' : 'inside';
    return t < 0.5 ? 'above' : 'below';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const zone = zoneAt(e);
    ctx.setHint(null);
    const { doc, activePageId } = useEditor.getState();
    if (!canDrop(doc, id, zone)) return;
    const ids = draggedIds;
    draggedIds = [];
    dispatch('Move layers', (d) => {
      const target = d.nodes[id]!;
      if (zone === 'inside') {
        moveNodes(d, ids, { pageId: activePageId, parentId: id });
        return;
      }
      // The panel lists the top-most layer first, so "above" means later in render order.
      const siblings = childIdsOf(d, target.pageId, target.parentId).filter((s) => !ids.includes(s));
      const at = siblings.indexOf(id) + (zone === 'above' ? 1 : 0);
      moveNodes(d, ids, { pageId: activePageId, parentId: target.parentId, index: at });
    });
  };

  return (
    <li role="treeitem" aria-selected={selected} aria-expanded={container && node.childIds.length ? !isCollapsed : undefined}>
      <div
        ref={rowRef}
        tabIndex={0}
        draggable
        data-layer-id={id}
        onClick={(e) => (e.shiftKey ? toggleSelect(id) : select([id]))}
        onKeyDown={(e) => e.key === 'Enter' && select([id])}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!useEditor.getState().selection.includes(id)) select([id]);
          useContextMenu.getState().open({ x: e.clientX, y: e.clientY });
        }}
        onDragStart={(e) => {
          const { doc, selection } = useEditor.getState();
          const ids = selection.includes(id) ? selection : [id];
          if (!selection.includes(id)) select([id]);
          draggedIds = topMostIds(doc, ids).filter((d) => !doc.nodes[d]!.locked);
          if (draggedIds.length === 0) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.name);
        }}
        onDragEnd={() => {
          draggedIds = [];
          ctx.setHint(null);
        }}
        onDragOver={(e) => {
          if (draggedIds.length === 0) return;
          const zone = zoneAt(e);
          if (!canDrop(useEditor.getState().doc, id, zone)) {
            if (hint) ctx.setHint(null);
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (hint !== zone) ctx.setHint({ id, zone });
        }}
        onDrop={onDrop}
        style={{ paddingLeft: 4 + depth * 14 }}
        className={`group relative flex h-7 cursor-default items-center gap-1 pr-2 ${
          selected ? 'bg-accent/25 text-fg' : 'text-fg-muted hover:bg-hover/60'
        } ${node.visible ? '' : 'opacity-50'} ${hint === 'inside' ? 'ring-1 ring-inset ring-accent' : ''}`}
      >
        {hint === 'above' && <span aria-hidden="true" className="absolute top-0 right-0 left-0 h-0.5 bg-accent" />}
        {hint === 'below' && <span aria-hidden="true" className="absolute right-0 bottom-0 left-0 h-0.5 bg-accent" />}
        {container && node.childIds.length > 0 ? (
          <button
            type="button"
            aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
            onClick={(e) => {
              e.stopPropagation();
              ctx.toggleCollapsed(id);
            }}
            className="flex h-5 w-4 shrink-0 items-center justify-center text-fg-subtle hover:text-fg"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Icon size={13} className={`shrink-0 ${node.type === 'component' || node.type === 'instance' || node.type === 'component-set' ? 'text-purple-400' : ''}`} aria-hidden="true" />
        <InlineEdit label="Layer name" value={node.name} onCommit={(name) => dispatch('Rename layer', (d) => updateNode(d, id, { name }))} />
        <IconButton
          label={node.locked ? 'Unlock' : 'Lock'}
          className={`h-6 w-6 ${node.locked ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(node.locked ? 'Unlock' : 'Lock', (d) => updateNode(d, id, { locked: !node.locked }));
          }}
        >
          {node.locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </IconButton>
        <IconButton
          label={node.visible ? 'Hide' : 'Show'}
          className={`h-6 w-6 ${node.visible ? 'opacity-0 group-hover:opacity-100 focus:opacity-100' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(node.visible ? 'Hide' : 'Show', (d) => updateNode(d, id, { visible: !node.visible }));
          }}
        >
          {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </IconButton>
      </div>
      {children.length > 0 && (
        <ul role="group">
          {children.map((childId) => (
            <LayerRow key={childId} id={childId} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
});
