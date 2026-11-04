import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { Group, Layer, Line, Path, Rect, Shape, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import {
  addNode,
  flowStart,
  applyLinear,
  applyMatrix,
  autoLayoutIndexAt,
  isFrameLike,
  computeSnap,
  createLine,
  createNode,
  createText,
  createVector,
  decompose,
  frameAtPoint,
  invert,
  moveNodes,
  niceStep,
  nodeBounds,
  nodeOutline,
  parentWorldMatrix,
  pathBounds,
  resizeNode,
  screenToWorld,
  selectionBounds,
  subtreeIds,
  topMostIds,
  toSvgPath,
  translateWorld,
  updateNode,
  vectorPath,
  vertex,
  worldMatrix,
  zoomAt,
  type CreatableType,
  type Guide,
  type Matrix,
  type NodeId,
  type Point,
  type Rect as RectType,
  type VectorVertex,
} from '@canvas-studio/core';
import { selectActivePage, useEditor, type CanvasTool } from '../../state/editorStore';
import { useUi } from '../../state/uiStore';
import { useContextMenu } from '../../state/contextMenuStore';
import { editableSelection, insertImages, insertInstance } from '../commands';
import { COMPONENT_DRAG_TYPE } from '../panels/AssetsPanel';
import { inkFor, nextName, placeAt, rectsIntersect, visibleWorldRect } from '../placement';
import { isTypingTarget } from '../shortcuts/isTypingTarget';
import { COMPONENT_COLOR, FRAME_LABEL, SCENE_NODE, SceneNodes } from './SceneRenderer';
import { PrototypeConnections } from './PrototypeConnections';
import { Rulers, RULER_SIZE } from './Rulers';
import { TextEditor } from './TextEditor';
import { fitToContent } from './viewportActions';
import { isArtboardBackground, resolveClickTarget, resolveDoubleClickTarget } from './selectionRules';

export const SNAP_SIZE = 8;
/** Screen pixels within which smart guides snap. */
const SNAP_DISTANCE_PX = 6;
/** Screen pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 3;
const ACCENT = '#3B82F6';
const GUIDE = '#F43F5E';

const BOX_TOOLS: CanvasTool[] = ['frame', 'rectangle', 'ellipse', 'polygon', 'star'];
const LINE_TOOLS: CanvasTool[] = ['line', 'arrow'];
const TYPE_NAMES: Record<CreatableType, string> = {
  frame: 'Frame',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  star: 'Star',
};

const snapValue = (v: number, enabled: boolean) => (enabled ? Math.round(v / SNAP_SIZE) * SNAP_SIZE : v);
const state = () => useEditor.getState();

/** Constrains `p` to 45-degree steps around `origin`. */
function constrain45(origin: Point, p: Point): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: origin.x + Math.cos(angle) * len, y: origin.y + Math.sin(angle) * len };
}

const normRect = (a: Point, b: Point): RectType => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});

/** Finds the scene node (and whether its frame label was hit) for a Konva event target. */
function hitInfo(target: Konva.Node): { id: NodeId; isLabel: boolean } | null {
  let node: Konva.Node | null = target;
  const isLabel = target.name() === FRAME_LABEL;
  while (node && node.getType() !== 'Stage') {
    if (node.name() === SCENE_NODE) return { id: node.id(), isLabel };
    node = node.getParent();
  }
  return null;
}

type Gesture =
  | { kind: 'draw'; tool: CanvasTool; start: Point; current: Point }
  | { kind: 'text'; start: Point; current: Point }
  | { kind: 'marquee'; start: Point; scope: NodeId | null; base: NodeId[] }
  | {
      kind: 'drag';
      start: Point;
      ids: NodeId[];
      clicked: NodeId;
      origins: Map<NodeId, Point>;
      toLocal: Map<NodeId, Matrix>;
      bounds: RectType;
      targets: RectType[] | null;
      started: boolean;
      delta: Point;
    };

interface PenState {
  pageId: string;
  parentId: NodeId | null;
  /** Page-space vertices; handles are relative offsets. */
  vertices: VectorVertex[];
  dragging: boolean;
  cursor: Point | null;
}

interface Overlay {
  rect?: RectType & { kind: 'draft' | 'marquee' | 'text'; ellipse?: boolean };
  line?: [Point, Point];
}

export function CanvasView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const doc = useEditor((s) => s.doc);
  const page = useEditor(selectActivePage);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const viewport = useEditor((s) => s.viewport);
  const size = useEditor((s) => s.canvasSize);
  const fitRequest = useEditor((s) => s.fitRequest);
  const textEditId = useEditor((s) => s.textEdit?.id);
  const showGrid = useUi((s) => s.showGrid);
  const showRulers = useUi((s) => s.showRulers);
  const inspectorTab = useUi((s) => s.inspectorTab);

  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>({});
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hoverId, setHoverId] = useState<NodeId | null>(null);
  const [dropTarget, setDropTarget] = useState<NodeId | null>(null);
  const [pen, setPenState] = useState<PenState | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const panStart = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const penRef = useRef<PenState | null>(null);

  const setPen = (next: PenState | null) => {
    penRef.current = next;
    setPenState(next ? { ...next, vertices: [...next.vertices] } : null);
  };

  const panMode = tool === 'hand' || spaceDown;

  // ----- Size, fit, space bar -----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      state().setCanvasSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Refit only on explicit requests and when the canvas first gets a size, not on every resize.
    if (size.width > 0) fitToContent();
  }, [fitRequest, size.width > 0]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false);
    const blur = () => setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ----- Transform handles -----
  const lineOnly = selection.length > 0 && selection.every((id) => doc.nodes[id]?.type === 'line');
  const componentish = selection.length > 0 && selection.every((id) => ['component', 'instance', 'component-set'].includes(doc.nodes[id]?.type ?? ''));
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    // Only top-most layers get handles; resizing a parent already resizes its children.
    const nodes = topMostIds(doc, selection)
      .filter((id) => !doc.nodes[id]!.locked && id !== textEditId)
      .map((id) => stage.findOne(`#${id}`))
      .filter((n): n is Konva.Node => Boolean(n));
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selection, doc, textEditId, tool]);

  const onTransformEnd = useCallback(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const updates = tr.nodes().map((kn) => {
      const id = kn.id();
      const node = state().doc.nodes[id]!;
      const sx = Math.abs(kn.scaleX());
      const sy = Math.abs(kn.scaleY());
      kn.scale({ x: 1, y: 1 });
      return {
        id,
        x: Math.round(kn.x() * 1e4) / 1e4,
        y: Math.round(kn.y() * 1e4) / 1e4,
        rotation: Math.round((((kn.rotation() % 360) + 360) % 360) * 1e4) / 1e4,
        width: Math.max(node.type === 'line' ? 1 : 0.01, node.width * sx),
        height: node.type === 'line' ? 0 : Math.max(0.01, node.height * sy),
      };
    });
    state().dispatch(updates.length > 1 ? 'Transform layers' : 'Transform layer', (d) => {
      for (const { id, width, height, ...pos } of updates) {
        updateNode(d, id, pos);
        resizeNode(d, id, width, height);
      }
    });
  }, []);

  // ----- Coordinates -----
  const clientToWorld = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return screenToWorld(state().viewport, { x: clientX - rect.left, y: clientY - rect.top });
  };

  // ----- Drag (move) -----
  const snapTargets = (ids: NodeId[]): RectType[] => {
    const { doc: d, activePageId } = state();
    const exclude = new Set(ids.flatMap((id) => subtreeIds(d, id)));
    const area = visibleWorldRect();
    const out: RectType[] = [];
    for (const node of Object.values(d.nodes)) {
      if (node.pageId !== activePageId || exclude.has(node.id) || !node.visible) continue;
      const b = nodeBounds(d, node.id);
      if (rectsIntersect(b, area)) out.push(b);
    }
    return out;
  };

  const applyDrag = (g: Extract<Gesture, { kind: 'drag' }>, p: Point, shift: boolean) => {
    // Layers can disappear mid-drag (undo/delete shortcuts); keep only those still present.
    g.ids = g.ids.filter((id) => state().doc.nodes[id]);
    if (g.ids.length === 0) return;
    const zoom = state().viewport.zoom;
    let dx = p.x - g.start.x;
    let dy = p.y - g.start.y;
    if (!g.started) {
      if (Math.hypot(dx, dy) * zoom < DRAG_THRESHOLD_PX) return;
      g.started = true;
      g.targets = snapTargets(g.ids);
      setHoverId(null);
    }
    if (shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const ui = useUi.getState();
    let found: Guide[] = [];
    const moved = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy };
    if (ui.smartGuides && g.targets) {
      const snap = computeSnap(moved, g.targets, SNAP_DISTANCE_PX / zoom);
      dx += snap.dx;
      dy += snap.dy;
      found = snap.guides;
    }
    if (ui.snapToGrid) {
      if (!found.some((gd) => gd.axis === 'x')) dx += snapValue(moved.x, true) - moved.x;
      if (!found.some((gd) => gd.axis === 'y')) dy += snapValue(moved.y, true) - moved.y;
    }
    g.delta = { x: dx, y: dy };
    const stage = stageRef.current;
    for (const id of g.ids) {
      const origin = g.origins.get(id)!;
      const local = applyLinear(g.toLocal.get(id)!, g.delta);
      stage?.findOne(`#${id}`)?.position({ x: origin.x + local.x, y: origin.y + local.y });
    }
    transformerRef.current?.forceUpdate();
    setGuides(found);
    const { doc: d, activePageId } = state();
    const exclude = new Set(g.ids);
    const over = frameAtPoint(d, activePageId, p.x, p.y, exclude);
    setDropTarget(g.ids.some((id) => d.nodes[id]!.parentId !== over && d.nodes[d.nodes[id]!.parentId ?? '']?.type !== 'group') ? over : null);
  };

  const resetDragPositions = (g: Extract<Gesture, { kind: 'drag' }>) => {
    for (const id of g.ids) stageRef.current?.findOne(`#${id}`)?.position(g.origins.get(id)!);
    transformerRef.current?.forceUpdate();
  };

  const finishDrag = (g: Extract<Gesture, { kind: 'drag' }>, p: Point, shift: boolean) => {
    setGuides([]);
    setDropTarget(null);
    if (!g.started) {
      // A click (no drag) on one item of a multi-selection selects just that item.
      const { selection: sel, select } = state();
      if (!shift && sel.length > 1 && sel.includes(g.clicked)) select([g.clicked]);
      return;
    }
    const { dispatch, activePageId, doc: current } = state();
    const { delta } = g;
    const ids = g.ids.filter((id) => current.nodes[id]);
    if (ids.length === 0) return;
    dispatch(ids.length > 1 ? 'Move layers' : 'Move layer', (d) => {
      const target = frameAtPoint(d, activePageId, p.x, p.y, new Set(ids));
      const targetNode = target ? d.nodes[target] : undefined;
      // Dropping into an auto-layout frame inserts at the pointer position in its flow.
      if (targetNode && isFrameLike(targetNode) && targetNode.layout) {
        const local = applyMatrix(invert(worldMatrix(d, target!)), p);
        moveNodes(d, ids, { pageId: activePageId, parentId: target, index: autoLayoutIndexAt(d, target!, local, new Set(ids)) });
        return;
      }
      for (const id of ids) translateWorld(d, id, delta.x, delta.y);
      // Dropping onto a different frame moves the layers into it (layers inside groups stay).
      const movers = ids.filter((id) => {
        const node = d.nodes[id]!;
        const parent = node.parentId ? d.nodes[node.parentId] : null;
        return node.parentId !== target && (!parent || (isFrameLike(parent) && parent.type !== 'component-set'));
      });
      if (movers.length) moveNodes(d, movers, { pageId: activePageId, parentId: target });
    });
  };

  // ----- Marquee -----
  const updateMarquee = (g: Extract<Gesture, { kind: 'marquee' }>, p: Point) => {
    const r = normRect(g.start, p);
    setOverlay({ rect: { ...r, kind: 'marquee' } });
    const { doc: d, activePageId, select } = state();
    const pageNode = d.pages.find((pg) => pg.id === activePageId)!;
    const scopeNode = g.scope ? d.nodes[g.scope] : undefined;
    const candidates = scopeNode && isFrameLike(scopeNode) ? scopeNode.childIds : pageNode.childIds;
    const hits = candidates.filter((id) => {
      const n = d.nodes[id];
      return n && n.visible && !n.locked && rectsIntersect(nodeBounds(d, id), r);
    });
    if (r.width > 0 || r.height > 0) select([...new Set([...g.base, ...hits])]);
  };

  // ----- Drawing -----
  const finishDraw = (g: Extract<Gesture, { kind: 'draw' }>, shift: boolean) => {
    setOverlay({});
    const { doc: d, activePageId, dispatch, select, setTool } = state();
    const snapOn = useUi.getState().snapToGrid;
    if (LINE_TOOLS.includes(g.tool)) {
      let end = g.current;
      if (Math.hypot(end.x - g.start.x, end.y - g.start.y) < 2) end = { x: g.start.x + 100, y: g.start.y };
      if (shift) end = constrain45(g.start, end);
      const angle = (Math.atan2(end.y - g.start.y, end.x - g.start.x) * 180) / Math.PI;
      const length = Math.hypot(end.x - g.start.x, end.y - g.start.y);
      const place = placeAt(d, activePageId, g.start, angle);
      const node = createLine({
        pageId: activePageId,
        parentId: place.parentId,
        x: place.x,
        y: place.y,
        rotation: place.rotation,
        width: Math.round(length * 100) / 100,
        endCap: g.tool === 'arrow' ? 'arrow' : 'none',
        ink: inkFor(d, activePageId, place.parentId),
        name: nextName(d, g.tool === 'arrow' ? 'Arrow' : 'Line'),
      });
      dispatch(`Create ${g.tool}`, (draft) => addNode(draft, node));
      select([node.id]);
      setTool('move');
      return;
    }
    let { x, y, width, height } = normRect(g.start, g.current);
    if (shift) {
      const side = Math.max(width, height);
      x = g.current.x < g.start.x ? g.start.x - side : g.start.x;
      y = g.current.y < g.start.y ? g.start.y - side : g.start.y;
      width = height = side;
    }
    if (width < 2 && height < 2) {
      // A click creates a default-sized shape at the pointer.
      x = g.start.x;
      y = g.start.y;
      width = height = 100;
    }
    const type = g.tool as CreatableType;
    const place = placeAt(d, activePageId, { x: snapValue(x, snapOn), y: snapValue(y, snapOn) });
    const node = createNode(type, {
      pageId: activePageId,
      parentId: place.parentId,
      x: Math.round(place.x * 100) / 100,
      y: Math.round(place.y * 100) / 100,
      rotation: place.rotation,
      width: Math.round(width),
      height: Math.round(height),
      name: nextName(d, TYPE_NAMES[type]),
    });
    dispatch(`Create ${type}`, (draft) => addNode(draft, node));
    select([node.id]);
    setTool('move');
  };

  const finishTextGesture = (g: Extract<Gesture, { kind: 'text' }>) => {
    setOverlay({});
    const { doc: d, activePageId, setTextEdit, setTool, select } = state();
    const r = normRect(g.start, g.current);
    const fixed = r.width * state().viewport.zoom > 4;
    const place = placeAt(d, activePageId, fixed ? { x: r.x, y: r.y } : g.start);
    const draft = createText({
      pageId: activePageId,
      parentId: place.parentId,
      x: Math.round(place.x),
      y: Math.round(place.y),
      rotation: place.rotation,
      width: fixed ? Math.round(r.width) : undefined,
      ink: inkFor(d, activePageId, place.parentId),
    });
    select([]);
    setTool('move');
    setTextEdit({ id: draft.id, draft });
  };

  // ----- Pen -----
  const finishPen = useCallback((closed: boolean) => {
    const p = penRef.current;
    setPen(null);
    if (!p || p.vertices.length < 2) return;
    const { doc: d, activePageId, dispatch, select } = state();
    // A path belongs to the page it was started on; switching pages abandons it.
    if (p.pageId !== activePageId) return;
    const parentId = p.parentId && d.nodes[p.parentId]?.pageId === activePageId ? p.parentId : null;
    const toLocal = invert(parentId ? worldMatrix(d, parentId) : [1, 0, 0, 1, 0, 0]);
    const local = p.vertices.map((v) => {
      const pt = applyMatrix(toLocal, v);
      const inH = applyLinear(toLocal, { x: v.inX, y: v.inY });
      const outH = applyLinear(toLocal, { x: v.outX, y: v.outY });
      return vertex(pt.x, pt.y, { inX: inH.x, inY: inH.y, outX: outH.x, outY: outH.y });
    });
    const b = pathBounds(vectorPath(local, closed));
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const vertices = local.map((v) => ({ ...v, x: r2(v.x - b.x), y: r2(v.y - b.y), inX: r2(v.inX), inY: r2(v.inY), outX: r2(v.outX), outY: r2(v.outY) }));
    const node = createVector({
      pageId: activePageId,
      parentId,
      x: r2(b.x),
      y: r2(b.y),
      width: r2(b.width),
      height: r2(b.height),
      vertices,
      closed,
      ink: inkFor(d, activePageId, parentId),
      name: nextName(d, 'Vector'),
    });
    dispatch('Draw path', (draft) => addNode(draft, node));
    select([node.id]);
  }, []);

  // Leaving the pen tool finishes the path in progress; switching pages abandons it.
  useEffect(() => {
    if (tool !== 'pen' && penRef.current) finishPen(false);
  }, [tool, finishPen]);
  const activePageId = page.id;
  useEffect(() => {
    if (penRef.current && penRef.current.pageId !== activePageId) setPen(null);
  }, [activePageId]);

  const penDown = (p: Point, shift: boolean) => {
    const cur = penRef.current;
    const zoom = state().viewport.zoom;
    if (!cur) {
      const { doc: d, activePageId } = state();
      setPen({ pageId: activePageId, parentId: frameAtPoint(d, activePageId, p.x, p.y), vertices: [vertex(p.x, p.y)], dragging: true, cursor: null });
      return;
    }
    const first = cur.vertices[0]!;
    if (cur.vertices.length >= 2 && Math.hypot(p.x - first.x, p.y - first.y) * zoom <= 8) {
      finishPen(true);
      return;
    }
    const last = cur.vertices[cur.vertices.length - 1]!;
    const pt = shift ? constrain45(last, p) : p;
    setPen({ ...cur, vertices: [...cur.vertices, vertex(pt.x, pt.y)], dragging: true });
  };

  const penMove = (p: Point) => {
    const cur = penRef.current;
    if (!cur) return;
    if (cur.dragging) {
      const last = cur.vertices[cur.vertices.length - 1]!;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (Math.hypot(dx, dy) * state().viewport.zoom < 2) return;
      const vertices = [...cur.vertices];
      vertices[vertices.length - 1] = { ...last, outX: dx, outY: dy, inX: -dx, inY: -dy };
      setPen({ ...cur, vertices });
    } else {
      setPen({ ...cur, cursor: p });
    }
  };

  // Keys for the pen and for cancelling gestures run before the global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const cur = penRef.current;
      if (cur) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          finishPen(false);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          e.stopImmediatePropagation();
          setPen(cur.vertices.length > 1 ? { ...cur, vertices: cur.vertices.slice(0, -1) } : null);
        }
        return;
      }
      const g = gesture.current;
      if (g && e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (g.kind === 'drag') resetDragPositions(g);
        gesture.current = null;
        setOverlay({});
        setGuides([]);
        setDropTarget(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [finishPen]);

  // ----- Pointer gestures (window listeners so they continue outside the canvas) -----
  const startWindowGesture = () => {
    const move = (e: MouseEvent) => {
      const g = gesture.current;
      const p = clientToWorld(e.clientX, e.clientY);
      if (penRef.current) return penMove(p);
      if (!g) return;
      if (g.kind === 'drag') applyDrag(g, p, e.shiftKey);
      else if (g.kind === 'marquee') updateMarquee(g, p);
      else {
        let current = { x: snapValue(p.x, useUi.getState().snapToGrid), y: snapValue(p.y, useUi.getState().snapToGrid) };
        if (g.kind === 'draw' && LINE_TOOLS.includes(g.tool) && e.shiftKey) current = constrain45(g.start, current);
        g.current = current;
        if (g.kind === 'draw' && LINE_TOOLS.includes(g.tool)) setOverlay({ line: [g.start, current] });
        else {
          const r = normRect(g.start, current);
          setOverlay({ rect: { ...r, kind: g.kind === 'text' ? 'text' : 'draft', ellipse: g.kind === 'draw' && g.tool === 'ellipse' } });
        }
      }
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const g = gesture.current;
      gesture.current = null;
      const p = clientToWorld(e.clientX, e.clientY);
      if (penRef.current) {
        setPen({ ...penRef.current, dragging: false });
        return;
      }
      if (!g) return;
      if (g.kind === 'drag') finishDrag(g, p, e.shiftKey);
      else if (g.kind === 'marquee') setOverlay({});
      else if (g.kind === 'text') finishTextGesture(g);
      else finishDraw(g, e.shiftKey);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (panMode || e.evt.button !== 0) return;
    useContextMenu.getState().close();
    const p = clientToWorld(e.evt.clientX, e.evt.clientY);
    const snapOn = useUi.getState().snapToGrid;
    if (tool === 'pen') {
      penDown(p, e.evt.shiftKey);
      startWindowGesture();
      return;
    }
    if (tool === 'text') {
      gesture.current = { kind: 'text', start: p, current: p };
      startWindowGesture();
      return;
    }
    if (BOX_TOOLS.includes(tool) || LINE_TOOLS.includes(tool)) {
      const start = { x: snapValue(p.x, snapOn), y: snapValue(p.y, snapOn) };
      gesture.current = { kind: 'draw', tool, start, current: start };
      startWindowGesture();
      return;
    }
    if (tool !== 'move') return;

    const { doc: d, selection: sel, select, toggleSelect } = state();
    const hit = hitInfo(e.target);
    const shift = e.evt.shiftKey;
    if (hit) {
      const target = hit.isLabel ? hit.id : resolveClickTarget(d, hit.id, sel);
      if (!hit.isLabel && isArtboardBackground(d, target, sel)) {
        if (!shift) select([]);
        gesture.current = { kind: 'marquee', start: p, scope: target, base: shift ? sel : [] };
        startWindowGesture();
        return;
      }
      if (shift) toggleSelect(target);
      else if (!sel.includes(target)) select([target]);
      const ids = editableSelection();
      if (!ids.includes(target) && !ids.some((id) => subtreeIds(d, id).includes(target))) return;
      const after = state().doc;
      gesture.current = {
        kind: 'drag',
        start: p,
        ids,
        clicked: target,
        origins: new Map(ids.map((id) => [id, { x: after.nodes[id]!.x, y: after.nodes[id]!.y }])),
        toLocal: new Map(ids.map((id) => [id, invert(parentWorldMatrix(after, id))])),
        bounds: selectionBounds(after, ids) ?? { x: p.x, y: p.y, width: 0, height: 0 },
        targets: null,
        started: false,
        delta: { x: 0, y: 0 },
      };
    } else {
      if (!shift) select([]);
      gesture.current = { kind: 'marquee', start: p, scope: null, base: shift ? sel : [] };
    }
    startWindowGesture();
  };

  const onStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (gesture.current || tool !== 'move') {
      if (hoverId) setHoverId(null);
      if (tool === 'pen' && penRef.current && !penRef.current.dragging) penMove(clientToWorld(e.evt.clientX, e.evt.clientY));
      return;
    }
    const hit = hitInfo(e.target);
    const { doc: d, selection: sel } = state();
    let id: NodeId | null = null;
    if (hit) {
      const target = hit.isLabel ? hit.id : resolveClickTarget(d, hit.id, sel);
      id = !hit.isLabel && isArtboardBackground(d, target, sel) ? null : target;
    }
    if (id !== hoverId) setHoverId(id);
  };

  const onStageDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'pen') return;
    if (tool !== 'move') return;
    const hit = hitInfo(e.target);
    if (!hit || hit.isLabel) return;
    const { doc: d, selection: sel, select, setTextEdit } = state();
    const node = d.nodes[hit.id];
    if (!node || node.locked) return;
    const target = resolveDoubleClickTarget(d, hit.id, sel);
    if (target === hit.id && node.type === 'text') {
      select([node.id]);
      setTextEdit({ id: node.id });
      return;
    }
    select([target]);
  };

  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent | MouseEvent>) => {
    e.evt.preventDefault();
    if (panMode) return;
    const hit = hitInfo(e.target);
    const { doc: d, selection: sel, select } = state();
    if (hit) {
      const target = hit.isLabel ? hit.id : resolveClickTarget(d, hit.id, sel);
      if (!hit.isLabel && isArtboardBackground(d, target, sel)) select([]);
      else if (!sel.includes(target)) select([target]);
    } else {
      select([]);
    }
    useContextMenu.getState().open({ x: e.evt.clientX, y: e.evt.clientY, world: clientToWorld(e.evt.clientX, e.evt.clientY) });
  };

  // ----- Wheel: scroll pans, Ctrl/Cmd (or pinch) zooms at the pointer -----
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    useContextMenu.getState().close();
    const { viewport: vp, setViewport } = state();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const pointer = stageRef.current?.getPointerPosition();
      if (!pointer) return;
      // Trackpad pinch sends small deltas (smooth zoom); a mouse wheel notch sends ~100,
      // which would jump ~7x, so notches use a fixed 20% step instead.
      const dy = e.evt.deltaMode === 1 ? e.evt.deltaY * 33 : e.evt.deltaY;
      const factor = Math.abs(dy) >= 50 ? (dy < 0 ? 1.2 : 1 / 1.2) : Math.exp(-dy * 0.01);
      setViewport(zoomAt(vp, vp.zoom * factor, pointer));
    } else {
      const dx = e.evt.shiftKey && e.evt.deltaX === 0 ? e.evt.deltaY : e.evt.deltaX;
      const dy = e.evt.shiftKey && e.evt.deltaX === 0 ? 0 : e.evt.deltaY;
      setViewport({ ...vp, x: vp.x - dx, y: vp.y - dy });
    }
  };

  // ----- Panning with hand tool, space+drag or middle mouse (DOM pointer events) -----
  const onPointerDown = (e: PointerEvent) => {
    if (!(panMode && e.button === 0) && e.button !== 1) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const vp = state().viewport;
    panStart.current = { x: e.clientX, y: e.clientY, vx: vp.x, vy: vp.y };
    setPanning(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    const start = panStart.current;
    if (!start) return;
    const vp = state().viewport;
    state().setViewport({ ...vp, x: start.vx + e.clientX - start.x, y: start.vy + e.clientY - start.y });
  };
  const endPan = () => {
    panStart.current = null;
    setPanning(false);
  };

  // ----- Image files dropped from the desktop -----
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const hasComponent = (e: DragEvent) => [...e.dataTransfer.types].includes(COMPONENT_DRAG_TYPE);
  const onDragOver = (e: DragEvent) => {
    if (hasComponent(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setFileOver(true);
  };
  const onDrop = (e: DragEvent) => {
    if (hasComponent(e)) {
      e.preventDefault();
      insertInstance(e.dataTransfer.getData(COMPONENT_DRAG_TYPE), clientToWorld(e.clientX, e.clientY));
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    setFileOver(false);
    void insertImages([...e.dataTransfer.files], clientToWorld(e.clientX, e.clientY));
  };

  const cursor = panning
    ? 'grabbing'
    : panMode
      ? 'grab'
      : tool === 'text'
        ? 'text'
        : tool === 'move'
          ? 'default'
          : 'crosshair';
  const zoom = viewport.zoom;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: page.background, cursor }}
      onPointerDownCapture={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDragOver={onDragOver}
      onDragLeave={() => setFileOver(false)}
      onDrop={onDrop}
      data-testid="canvas"
      aria-label={`Canvas — ${page.name}`}
      role="application"
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseLeave={() => setHoverId(null)}
          onDblClick={onStageDblClick}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
          listening={!panMode}
        >
          {showGrid && (
            <Layer listening={false}>
              <GridShape width={size.width} height={size.height} x={viewport.x} y={viewport.y} zoom={zoom} />
            </Layer>
          )}
          <Layer>
            <Group x={viewport.x} y={viewport.y} scaleX={zoom} scaleY={zoom}>
              <SceneNodes doc={doc} ids={page.childIds} interactive={!panMode && tool === 'move'} zoom={zoom} showFrameLabels />
            </Group>
          </Layer>
          <Layer>
            <Group x={viewport.x} y={viewport.y} scaleX={zoom} scaleY={zoom} listening={false}>
              {inspectorTab === 'prototype' && <PrototypeConnections doc={doc} pageId={page.id} selection={selection} zoom={zoom} startId={flowStart(doc, page)} />}
              {hoverId && !selection.includes(hoverId) && doc.nodes[hoverId] && <NodeOutline id={hoverId} zoom={zoom} />}
              {dropTarget && doc.nodes[dropTarget] && <NodeOutline id={dropTarget} zoom={zoom} width={2} />}
              {guides.map((g, i) => (
                <Line
                  key={i}
                  points={g.axis === 'x' ? [g.position, g.start, g.position, g.end] : [g.start, g.position, g.end, g.position]}
                  stroke={GUIDE}
                  strokeWidth={1 / zoom}
                />
              ))}
              {overlay.rect && (
                <Rect
                  {...overlay.rect}
                  stroke={ACCENT}
                  strokeWidth={1 / zoom}
                  dash={overlay.rect.kind === 'text' ? [4 / zoom, 4 / zoom] : undefined}
                  fill={overlay.rect.kind === 'text' ? undefined : 'rgba(59,130,246,0.08)'}
                  cornerRadius={overlay.rect.ellipse ? Math.max(overlay.rect.width, overlay.rect.height) / 2 : 0}
                />
              )}
              {overlay.line && (
                <Line points={[overlay.line[0].x, overlay.line[0].y, overlay.line[1].x, overlay.line[1].y]} stroke={ACCENT} strokeWidth={1.5 / zoom} />
              )}
              {pen && <PenPreview pen={pen} zoom={zoom} />}
            </Group>
            <Transformer
              ref={transformerRef}
              rotateEnabled
              flipEnabled={false}
              ignoreStroke
              keepRatio={false}
              enabledAnchors={
                lineOnly
                  ? ['middle-left', 'middle-right']
                  : ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right']
              }
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={4}
              borderStroke={componentish ? COMPONENT_COLOR : ACCENT}
              anchorStroke={componentish ? COMPONENT_COLOR : ACCENT}
              anchorFill="#FFFFFF"
              anchorSize={8}
              anchorCornerRadius={1}
              rotateAnchorOffset={18}
              boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 1 || Math.abs(newBox.height) < 0.5 ? oldBox : newBox)}
              onTransformEnd={onTransformEnd}
            />
          </Layer>
        </Stage>
      )}
      <TextEditor />
      {fileOver && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10 text-fg">
          Drop images to place them
        </div>
      )}
      {tool === 'pen' && (
        <p role="status" className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded bg-sidebar/90 px-3 py-1 text-2xs text-fg-muted">
          Click to add points, drag for curves. Click the first point to close; Enter to finish; Backspace removes a point.
        </p>
      )}
      {showRulers && <Rulers viewport={viewport} width={size.width} height={size.height} />}
      {showRulers && <div aria-hidden="true" className="absolute top-0 left-0 bg-sidebar" style={{ width: RULER_SIZE, height: RULER_SIZE }} />}
    </div>
  );
}

/** Outline of a layer in page space (hover highlight / drop target). */
function NodeOutline({ id, zoom, width = 1.5 }: { id: NodeId; zoom: number; width?: number }) {
  const doc = useEditor((s) => s.doc);
  const node = doc.nodes[id]!;
  const t = decompose(worldMatrix(doc, id));
  const data = node.type === 'line' ? `M0 0 L${node.width} 0` : toSvgPath(nodeOutline(node.type === 'group' || node.type === 'text' ? { ...node, type: 'rectangle', cornerRadius: 0 } as never : node));
  return <Path x={t.x} y={t.y} rotation={t.rotation} data={data} stroke={ACCENT} strokeWidth={width / zoom} fillEnabled={false} />;
}

function PenPreview({ pen, zoom }: { pen: PenState; zoom: number }) {
  const vs = pen.vertices;
  const last = vs[vs.length - 1]!;
  const s = 6 / zoom;
  return (
    <>
      <Path data={toSvgPath(vectorPath(vs, false))} stroke={ACCENT} strokeWidth={1.5 / zoom} fillEnabled={false} />
      {pen.cursor && !pen.dragging && (
        <Line points={[last.x, last.y, pen.cursor.x, pen.cursor.y]} stroke={ACCENT} strokeWidth={1 / zoom} dash={[4 / zoom, 4 / zoom]} />
      )}
      {(last.outX !== 0 || last.outY !== 0) && (
        <Line
          points={[last.x + last.inX, last.y + last.inY, last.x + last.outX, last.y + last.outY]}
          stroke={ACCENT}
          strokeWidth={1 / zoom}
        />
      )}
      {vs.map((v, i) => (
        <Rect key={i} x={v.x - s / 2} y={v.y - s / 2} width={s} height={s} fill={i === 0 ? ACCENT : '#FFFFFF'} stroke={ACCENT} strokeWidth={1 / zoom} />
      ))}
    </>
  );
}

/** Adaptive grid drawn in screen space so line width stays 1px at any zoom. */
function GridShape({ width, height, x, y, zoom }: { width: number; height: number; x: number; y: number; zoom: number }) {
  return (
    <Shape
      stroke="rgba(255,255,255,0.06)"
      strokeWidth={1}
      perfectDrawEnabled={false}
      sceneFunc={(ctx, shape) => {
        const step = niceStep(zoom, 32) * zoom;
        ctx.beginPath();
        const startX = ((x % step) + step) % step;
        for (let sx = startX; sx < width; sx += step) {
          ctx.moveTo(Math.round(sx) + 0.5, 0);
          ctx.lineTo(Math.round(sx) + 0.5, height);
        }
        const startY = ((y % step) + step) % step;
        for (let sy = startY; sy < height; sy += step) {
          ctx.moveTo(0, Math.round(sy) + 0.5);
          ctx.lineTo(width, Math.round(sy) + 0.5);
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}
