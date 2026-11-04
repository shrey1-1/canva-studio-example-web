/**
 * Editor commands shared by keyboard shortcuts, context menus, the toolbar and the inspector.
 * Each command reads the current editor state, applies one undoable change and updates the
 * selection. `canX()` helpers tell menus whether a command applies to the current selection.
 */
import {
  addNode,
  alignNodes,
  childIdsOf,
  copyNodes,
  createFrame,
  createImage,
  createText,
  deleteNodes,
  distributeNodes,
  duplicateNodes,
  fitBounds,
  groupNodes,
  instanceAncestor,
  isContainer,
  isInsideInstance,
  wouldCreateCycle,
  createComponent,
  combineAsVariants,
  createInstance,
  detachInstance,
  resetOverrides,
  isFrameLike,
  DEFAULT_AUTO_LAYOUT,
  DocumentError,
  nodeBounds,
  parseClipboard,
  pasteNodes,
  reorderNodes,
  selectionBounds,
  sortByRenderOrder,
  topMostIds,
  translateWorld,
  ungroupNodes,
  updateNode,
  type AlignMode,
  type ClipboardPayload,
  type DesignDocument,
  type InstanceNode,
  type ImageNode,
  type NodeId,
  type Point,
  type ReorderDirection,
} from '@canvas-studio/core';
import { importImage, ImageImportError } from '../persistence/assetStore';
import { useEditor } from '../state/editorStore';
import { useToasts } from '../state/toastStore';
import { inkFor, nextName, placeAt, rectCenter, rectsIntersect, toLocal, visibleWorldRect } from './placement';

const state = () => useEditor.getState();

/** Selected layers that may be edited (locked layers are skipped). */
/** Selected layers whose structure may change: unlocked and not inside an instance. */
export function editableSelection(): NodeId[] {
  const { doc, selection } = state();
  return topMostIds(doc, selection).filter((id) => !doc.nodes[id]!.locked && !isInsideInstance(doc, id));
}

/** Tells the user why layers inside an instance were skipped. */
function warnInstanceLayers() {
  const { doc, selection } = state();
  if (selection.some((id) => doc.nodes[id] && isInsideInstance(doc, id))) {
    useToasts.getState().push('Layers inside an instance cannot be moved or deleted. Edit the main component, or detach the instance.');
  }
}

/** Nearest parent that can take new children (outside any instance, not a component set). */
function structuralParent(doc: DesignDocument, id: NodeId | null): NodeId | null {
  let current = id;
  while (current) {
    const node = doc.nodes[current];
    if (!node) return null;
    if (instanceAncestor(doc, current) === null && node.type !== 'component-set') return current;
    current = node.parentId;
  }
  return null;
}

// ----- Clipboard -----------------------------------------------------------

/** Last copied payload, kept in memory so the context menu can paste without clipboard permission. */
let clipboard: { payload: ClipboardPayload; pasteCount: number } | null = null;

/** Identifies a payload's content, so the same clipboard parsed twice counts as the same copy. */
const payloadKey = (p: ClipboardPayload) => `${p.roots.join(',')}|${Object.keys(p.nodes).length}`;

export const hasClipboard = () => clipboard !== null;

/** Copies the selection; returns the JSON written to the system clipboard (or null). */
export function copySelection(): string | null {
  const { doc, selection } = state();
  const payload = copyNodes(doc, selection);
  if (!payload) return null;
  clipboard = { payload, pasteCount: 0 };
  return JSON.stringify(payload);
}

export function cutSelection(): string | null {
  const text = copySelection();
  if (text) deleteSelection('Cut');
  return text;
}

/**
 * Pastes next to the selection (or into a selected frame). Pasting again while the originals
 * are on the page offsets each copy, so repeated pastes do not stack invisibly.
 */
export function pastePayload(payload: ClipboardPayload, at?: Point): void {
  const { doc, activePageId, selection, dispatch, select } = state();
  if (!clipboard || payloadKey(clipboard.payload) !== payloadKey(payload)) clipboard = { payload, pasteCount: 0 };
  const sel = topMostIds(doc, selection);
  let parentId: NodeId | null = null;
  let index: number | undefined;
  const only = sel.length === 1 ? doc.nodes[sel[0]!] : undefined;
  if (only && (only.type === 'frame' || only.type === 'component') && !payload.roots.includes(only.id) && !isInsideInstance(doc, only.id)) {
    parentId = only.id;
  } else if (sel.length > 0) {
    const top = doc.nodes[sortByRenderOrder(doc, sel).at(-1)!]!;
    parentId = structuralParent(doc, top.parentId);
    if (parentId === top.parentId) index = childIdsOf(doc, top.pageId, top.parentId).indexOf(top.id) + 1;
  }
  // Pasting an instance of a component into that component would make it contain itself.
  if (Object.values(payload.nodes).some((n) => n.type === 'instance' && wouldCreateCycle(doc, n.componentId, parentId))) {
    parentId = null;
    index = undefined;
  }
  const originalsHere = payload.roots.every((id) => doc.nodes[id]?.pageId === activePageId);
  clipboard.pasteCount++;
  const step = originalsHere && !at ? 10 * clipboard.pasteCount : 0;

  let created: NodeId[] = [];
  dispatch('Paste', (d) => {
    created = pasteNodes(d, payload, { pageId: activePageId, parentId, index, offset: { x: step, y: step } });
    const bounds = selectionBounds(d, created);
    if (!bounds) return;
    const area = parentId ? nodeBounds(d, parentId) : visibleWorldRect();
    let target: Point | null = at ?? null;
    if (!target && !rectsIntersect(bounds, area)) target = rectCenter(area);
    if (target) {
      const c = rectCenter(bounds);
      for (const id of created) translateWorld(d, id, target.x - c.x, target.y - c.y);
    }
  });
  select(created);
}

/** Pastes the in-memory clipboard, falling back to reading the system clipboard. */
export async function pasteFromMenu(at?: Point): Promise<void> {
  if (clipboard) return pastePayload(clipboard.payload, at);
  try {
    const text = await navigator.clipboard.readText();
    const payload = parseClipboard(text);
    if (payload) pastePayload(payload, at);
    else if (text.trim()) insertText(text, at);
    else useToasts.getState().push('The clipboard is empty.');
  } catch {
    useToasts.getState().push('Clipboard access was blocked. Use Ctrl+V instead.', 'error');
  }
}

/** Handles a paste of system clipboard content (images, copied layers or plain text). */
export async function pasteFromSystem(text: string, files: File[]): Promise<void> {
  if (files.length > 0) return insertImages(files);
  const payload = parseClipboard(text);
  if (payload) pastePayload(payload);
  else if (text.trim()) insertText(text);
}

// ----- Insert --------------------------------------------------------------

export function insertText(characters: string, at?: Point): void {
  const { doc, activePageId, dispatch, select } = state();
  const point = at ?? rectCenter(visibleWorldRect());
  const place = placeAt(doc, activePageId, point);
  const node = createText({
    pageId: activePageId,
    parentId: place.parentId,
    x: Math.round(place.x),
    y: Math.round(place.y),
    characters: characters.slice(0, 100_000),
    ink: inkFor(doc, activePageId, place.parentId),
  });
  dispatch('Paste text', (d) => addNode(d, node));
  select([node.id]);
}

const MAX_PLACED_SIDE = 1000;

/** Imports image files and places them, side by side, at `at` (default: centre of the screen). */
export async function insertImages(files: readonly File[], at?: Point): Promise<void> {
  const images = files.filter((f) => f.type.startsWith('image/') || f.type === '');
  if (images.length === 0) {
    useToasts.getState().push('Only image files (PNG, JPEG, GIF, WebP) can be placed on the canvas.', 'error');
    return;
  }
  // Import everything first, then place all images as one undo step.
  const imported = [];
  for (const file of images) {
    try {
      imported.push(await importImage(file));
    } catch (error) {
      const message = error instanceof ImageImportError ? error.message : `${file.name || 'Image'} could not be imported.`;
      useToasts.getState().push(message, 'error');
    }
  }
  if (imported.length === 0) return;
  const { doc, activePageId, dispatch } = state();
  const nodes: ImageNode[] = [];
  let cursor = at ?? rectCenter(visibleWorldRect());
  for (const img of imported) {
    const scale = Math.min(1, MAX_PLACED_SIDE / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);
    // The frame under the image's centre becomes its parent.
    const { parentId } = placeAt(doc, activePageId, cursor);
    const local = toLocal(doc, parentId, cursor.x - width / 2, cursor.y - height / 2);
    nodes.push(
      createImage({
        pageId: activePageId,
        parentId,
        x: Math.round(local.x),
        y: Math.round(local.y),
        rotation: local.rotation,
        width,
        height,
        name: img.name,
        assetId: img.assetId,
        naturalWidth: img.width,
        naturalHeight: img.height,
      }),
    );
    cursor = { x: cursor.x + width + 20, y: cursor.y };
  }
  dispatch(nodes.length > 1 ? 'Place images' : 'Place image', (d) => nodes.forEach((n) => addNode(d, n)));
  state().select(nodes.map((n) => n.id));
}

// ----- Structure -----------------------------------------------------------

export function deleteSelection(label = 'Delete'): void {
  warnInstanceLayers();
  const ids = editableSelection();
  if (ids.length) state().dispatch(label, (d) => deleteNodes(d, ids));
}

export function duplicateSelection(): void {
  warnInstanceLayers();
  const ids = editableSelection();
  if (!ids.length) return;
  let created: NodeId[] = [];
  state().dispatch('Duplicate', (d) => {
    created = duplicateNodes(d, ids, { x: 10, y: 10 });
  });
  state().select(created);
}

export const canGroup = () => editableSelection().length > 0;

export function groupSelection(kind: 'group' | 'frame' = 'group'): void {
  const ids = editableSelection();
  if (!ids.length) return;
  let id = '';
  state().dispatch(kind === 'group' ? 'Group' : 'Frame selection', (d) => {
    id = groupNodes(d, ids, kind);
    if (kind === 'frame') d.nodes[id]!.name = nextName(d, 'Frame');
  });
  if (id) state().select([id]);
}

export const canUngroup = () => {
  const { doc } = state();
  return editableSelection().some((id) => isContainer(doc.nodes[id]!));
};

export function ungroupSelection(): void {
  const { doc } = state();
  const ids = editableSelection().filter((id) => isContainer(doc.nodes[id]!));
  if (!ids.length) return;
  let released: NodeId[] = [];
  state().dispatch('Ungroup', (d) => {
    released = ungroupNodes(d, ids);
  });
  state().select(released);
}

export function reorderSelection(direction: ReorderDirection): void {
  const ids = editableSelection();
  if (!ids.length) return;
  const labels = { forward: 'Bring forward', backward: 'Send backward', front: 'Bring to front', back: 'Send to back' };
  state().dispatch(labels[direction], (d) => reorderNodes(d, ids, direction));
}

export function toggleVisibility(): void {
  const { doc, selection, dispatch } = state();
  const ids = topMostIds(doc, selection);
  if (!ids.length) return;
  const show = ids.every((id) => !doc.nodes[id]!.visible);
  dispatch(show ? 'Show' : 'Hide', (d) => ids.forEach((id) => updateNode(d, id, { visible: show })));
}

export function toggleLock(): void {
  const { doc, selection, dispatch } = state();
  const ids = topMostIds(doc, selection);
  if (!ids.length) return;
  const lock = ids.some((id) => !doc.nodes[id]!.locked);
  dispatch(lock ? 'Lock' : 'Unlock', (d) => ids.forEach((id) => updateNode(d, id, { locked: lock })));
}

/**
 * One layer: toggles it as a mask for the layers above it.
 * Several layers: groups them and makes the bottom-most one the mask.
 */
export function useAsMask(): void {
  const { doc } = state();
  const ids = sortByRenderOrder(doc, editableSelection());
  if (ids.length === 0) return;
  if (ids.length === 1) {
    const node = doc.nodes[ids[0]!]!;
    state().dispatch(node.isMask ? 'Remove mask' : 'Use as mask', (d) => updateNode(d, node.id, { isMask: !node.isMask }));
    return;
  }
  let groupId = '';
  state().dispatch('Use as mask', (d) => {
    groupId = groupNodes(d, ids);
    d.nodes[groupId]!.name = 'Mask group';
    updateNode(d, ids[0]!, { isMask: true });
  });
  state().select([groupId]);
}

export const isMaskSelection = () => {
  const ids = editableSelection();
  return ids.length === 1 && state().doc.nodes[ids[0]!]!.isMask;
};

// ----- Selection -----------------------------------------------------------

/** Selects all siblings of the current selection, or every top-level layer on the page. */
export function selectAll(): void {
  const { doc, activePageId, selection, select } = state();
  const first = selection[0] ? doc.nodes[selection[0]] : undefined;
  const ids = childIdsOf(doc, activePageId, first ? first.parentId : null);
  select(ids.filter((id) => !doc.nodes[id]!.locked));
}

export function selectChildren(): void {
  const { doc, selection, select } = state();
  const children = selection.flatMap((id) => {
    const node = doc.nodes[id];
    return node && isContainer(node) ? node.childIds : [];
  });
  if (children.length) select(children);
}

export function selectParent(): void {
  const { doc, selection, select } = state();
  const parents = [...new Set(selection.map((id) => doc.nodes[id]?.parentId).filter((p): p is string => !!p))];
  if (parents.length) select(parents);
}

export function zoomToSelection(): void {
  const { doc, selection, canvasSize, setViewport } = state();
  const bounds = selectionBounds(doc, selection);
  if (bounds && canvasSize.width > 0) setViewport(fitBounds(bounds, canvasSize, 80, 4));
}

// ----- Alignment -----------------------------------------------------------

export function alignSelection(mode: AlignMode): void {
  const ids = editableSelection();
  if (!ids.length) return;
  state().dispatch('Align', (d) => {
    alignNodes(d, ids, mode);
  });
}

export function distributeSelection(axis: 'horizontal' | 'vertical'): void {
  const ids = editableSelection();
  if (ids.length < 3) return;
  state().dispatch('Distribute', (d) => {
    distributeNodes(d, ids, axis);
  });
}

/** Single layers align to their parent; several align to their combined bounds. */
export function canAlign(): boolean {
  const ids = editableSelection();
  return ids.length > 1 || (ids.length === 1 && state().doc.nodes[ids[0]!]!.parentId !== null);
}

// ----- Components ------------------------------------------------------------

/** Runs an edit that may be refused by the document rules, showing the reason instead of failing. */
function attempt(label: string, recipe: Parameters<ReturnType<typeof state>['dispatch']>[1]): boolean {
  try {
    state().dispatch(label, recipe);
    return true;
  } catch (error) {
    useToasts.getState().push(error instanceof DocumentError ? error.message : `${label} failed.`, 'error');
    return false;
  }
}

export function createComponentFromSelection(): void {
  const ids = editableSelection();
  if (!ids.length) return;
  let id = '';
  if (
    attempt('Create component', (d) => {
      id = createComponent(d, ids);
      if (d.nodes[id]!.name.startsWith('Frame')) d.nodes[id]!.name = nextName(d, 'Component');
    })
  ) {
    state().select([id]);
  }
}

export const canCombineVariants = () => {
  const { doc } = state();
  const ids = editableSelection();
  return ids.length >= 2 && ids.every((id) => doc.nodes[id]!.type === 'component');
};

export function combineVariants(): void {
  const ids = editableSelection();
  let id = '';
  if (attempt('Combine as variants', (d) => (id = combineAsVariants(d, ids)))) state().select([id]);
}

/** Places an instance of a component (at `at`, default the centre of the screen). */
export function insertInstance(componentId: NodeId, at?: Point): void {
  const { doc, activePageId } = state();
  const comp = doc.nodes[componentId];
  if (!comp || comp.type !== 'component') return;
  const centre = at ?? rectCenter(visibleWorldRect());
  let { parentId } = placeAt(doc, activePageId, centre);
  if (wouldCreateCycle(doc, componentId, parentId)) parentId = null;
  const local = toLocal(doc, parentId, centre.x - comp.width / 2, centre.y - comp.height / 2);
  let id = '';
  if (
    attempt('Insert instance', (d) => {
      id = createInstance(d, componentId, { pageId: activePageId, parentId, x: Math.round(local.x), y: Math.round(local.y) });
    })
  ) {
    state().select([id]);
  }
}

const selectedInstances = () => {
  const { doc, selection } = state();
  return selection.filter((id) => doc.nodes[id]?.type === 'instance');
};
export const canDetach = () => selectedInstances().length > 0;

export function detachSelection(): void {
  const ids = selectedInstances();
  if (ids.length) attempt('Detach instance', (d) => ids.forEach((id) => detachInstance(d, id)));
}

export function resetSelectionOverrides(): void {
  const ids = selectedInstances();
  if (ids.length) attempt('Reset overrides', (d) => ids.forEach((id) => resetOverrides(d, id)));
}

/** Selects (and shows) the main component of the selected instance. */
export function goToMainComponent(): void {
  const { doc, selection, setActivePage, select, activePageId } = state();
  const inst = selection.map((id) => doc.nodes[id]).find((n): n is InstanceNode => n?.type === 'instance');
  const comp = inst ? doc.nodes[inst.componentId] : undefined;
  if (!comp) return;
  if (comp.pageId !== activePageId) setActivePage(comp.pageId);
  select([comp.id]);
  requestAnimationFrame(zoomToSelection);
}

/**
 * Adds auto layout: a selected frame gets it directly; other layers are wrapped in a new
 * auto-layout frame that hugs them. The direction follows how the layers are arranged.
 */
export function addAutoLayout(): void {
  const { doc } = state();
  const ids = editableSelection();
  if (!ids.length) return;
  const only = ids.length === 1 ? doc.nodes[ids[0]!] : undefined;
  let frameId = '';
  attempt('Add auto layout', (d) => {
    if (only && isFrameLike(only) && only.type !== 'instance' && !only.layout) {
      frameId = only.id;
    } else {
      frameId = groupNodes(d, ids, 'frame');
      d.nodes[frameId]!.name = nextName(d, 'Frame');
    }
    const f = d.nodes[frameId]!;
    if (!isFrameLike(f)) return;
    const kids = f.childIds.map((c) => d.nodes[c]!).filter(Boolean);
    const spanX = kids.length ? Math.max(...kids.map((k) => k.x + k.width)) - Math.min(...kids.map((k) => k.x)) : 0;
    const spanY = kids.length ? Math.max(...kids.map((k) => k.y + k.height)) - Math.min(...kids.map((k) => k.y)) : 0;
    // Keep the children's current order along the chosen axis.
    const direction = spanX > spanY ? 'horizontal' : 'vertical';
    f.childIds = [...f.childIds].sort((a, b) => (direction === 'horizontal' ? d.nodes[a]!.x - d.nodes[b]!.x : d.nodes[a]!.y - d.nodes[b]!.y));
    f.layout = { ...DEFAULT_AUTO_LAYOUT, direction };
    f.sizing = { horizontal: 'hug', vertical: 'hug' };
  });
  if (frameId) state().select([frameId]);
}

/** Adds a frame of a preset size to the right of the page content (or at the screen centre). */
export function addPresetFrame(preset: { name: string; width: number; height: number }): void {
  const { doc, activePageId, dispatch, select, setTool } = state();
  const page = doc.pages.find((p) => p.id === activePageId)!;
  const bounds = selectionBounds(doc, page.childIds);
  const centre = rectCenter(visibleWorldRect());
  const x = bounds ? Math.round(bounds.x + bounds.width + 80) : Math.round(centre.x - preset.width / 2);
  const y = bounds ? Math.round(bounds.y) : Math.round(centre.y - preset.height / 2);
  const frame = createFrame({ pageId: activePageId, x, y, width: preset.width, height: preset.height, name: preset.name });
  dispatch('Add frame', (d) => addNode(d, frame));
  select([frame.id]);
  setTool('move');
  requestAnimationFrame(zoomToSelection);
}
