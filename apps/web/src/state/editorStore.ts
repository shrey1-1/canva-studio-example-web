import { create } from 'zustand';
import { produce } from 'immer';
import {
  createDocument,
  finalizeDocument as finalizeCore,
  type DesignDocument,
  type NodeId,
  type PageId,
  type TextNode,
  type Viewport,
} from '@canvas-studio/core';
import { measureText } from '../editor/canvas/textMeasure';
import { commit, redo as redoHistory, undo as undoHistory, type CommitOptions, type HistoryState } from './history';

export type ShapeTool = 'rectangle' | 'line' | 'arrow' | 'ellipse' | 'polygon' | 'star';
export type CanvasTool = 'move' | 'hand' | 'frame' | ShapeTool | 'pen' | 'text';
export const SHAPE_TOOLS: readonly ShapeTool[] = ['rectangle', 'line', 'arrow', 'ellipse', 'polygon', 'star'];

/** Text being edited on the canvas. `draft` is set for a new text that is not in the document yet. */
export interface TextEditState {
  id: NodeId;
  draft?: TextNode;
}

/**
 * Invariants restored after every edit, inside the same undo step (see core finalize.ts):
 * instances sync, variables apply, text fits, auto layout runs, groups wrap their children.
 */
export function finalizeDocument(doc: DesignDocument): void {
  finalizeCore(doc, measureText);
}

interface EditorState {
  doc: DesignDocument;
  activePageId: PageId;
  selection: NodeId[];
  history: HistoryState;
  tool: CanvasTool;
  /** Shape shown on the toolbar's shape button (the last one used). */
  lastShapeTool: ShapeTool;
  textEdit: TextEditState | null;
  viewport: Viewport;
  /** Size of the canvas area in CSS pixels (set by the canvas on resize). */
  canvasSize: { width: number; height: number };
  /** Bumped when the canvas should re-fit content to the screen (e.g. after opening a page). */
  fitRequest: number;

  loadDocument: (doc: DesignDocument) => void;
  /** Applies a document change as one undoable step. */
  dispatch: (label: string, recipe: (draft: DesignDocument) => void, options?: CommitOptions) => void;
  undo: () => void;
  redo: () => void;
  setActivePage: (pageId: PageId) => void;
  select: (ids: NodeId[]) => void;
  toggleSelect: (id: NodeId) => void;
  setTool: (tool: CanvasTool) => void;
  setTextEdit: (edit: TextEditState | null) => void;
  setViewport: (viewport: Viewport) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  requestFit: () => void;
}

const emptyHistory = (): HistoryState => ({ past: [], future: [] });

/** Drops selected ids that no longer exist or are not on the active page. */
function validSelection(doc: DesignDocument, pageId: PageId, selection: NodeId[]) {
  return selection.filter((id) => doc.nodes[id]?.pageId === pageId);
}

function validPage(doc: DesignDocument, pageId: PageId): PageId {
  return doc.pages.some((p) => p.id === pageId) ? pageId : doc.pages[0]!.id;
}

const initialDoc = createDocument();

export const useEditor = create<EditorState>()((set, get) => ({
  doc: initialDoc,
  activePageId: initialDoc.pages[0]!.id,
  selection: [],
  history: emptyHistory(),
  tool: 'move',
  lastShapeTool: 'rectangle',
  textEdit: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  canvasSize: { width: 0, height: 0 },
  fitRequest: 0,

  loadDocument: (loaded) =>
    set((s) => ({
      // Bring derived state (instances, layout, text sizes) up to date before the first edit.
      doc: produce(loaded, (d) => finalizeDocument(d)),
      activePageId: loaded.pages[0]!.id,
      selection: [],
      history: emptyHistory(),
      tool: 'move',
      textEdit: null,
      fitRequest: s.fitRequest + 1,
    })),

  dispatch: (label, recipe, options) => {
    const { doc, history, activePageId, selection } = get();
    const result = commit(
      doc,
      history,
      label,
      (draft) => {
        recipe(draft);
        finalizeDocument(draft);
      },
      options,
    );
    if (result.doc === doc) return;
    const pageId = validPage(result.doc, activePageId);
    set({
      doc: result.doc,
      history: result.history,
      activePageId: pageId,
      selection: validSelection(result.doc, pageId, selection),
    });
  },

  undo: () => {
    const { doc, history, activePageId, selection } = get();
    const result = undoHistory(doc, history);
    if (!result) return;
    const pageId = validPage(result.doc, activePageId);
    set({ ...result, activePageId: pageId, selection: validSelection(result.doc, pageId, selection) });
  },

  redo: () => {
    const { doc, history, activePageId, selection } = get();
    const result = redoHistory(doc, history);
    if (!result) return;
    const pageId = validPage(result.doc, activePageId);
    set({ ...result, activePageId: pageId, selection: validSelection(result.doc, pageId, selection) });
  },

  setActivePage: (pageId) =>
    set((s) =>
      s.activePageId === pageId
        ? s
        : { activePageId: validPage(s.doc, pageId), selection: [], textEdit: null, fitRequest: s.fitRequest + 1 },
    ),

  select: (ids) => set((s) => ({ selection: validSelection(s.doc, s.activePageId, ids) })),

  toggleSelect: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : validSelection(s.doc, s.activePageId, [...s.selection, id]),
    })),

  setTool: (tool) =>
    set((s) => ({ tool, lastShapeTool: (SHAPE_TOOLS as readonly string[]).includes(tool) ? (tool as ShapeTool) : s.lastShapeTool })),
  setTextEdit: (textEdit) => set({ textEdit }),
  setViewport: (viewport) => set({ viewport }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
}));

/** Selector helpers. */
export const selectActivePage = (s: EditorState) => s.doc.pages.find((p) => p.id === s.activePageId)!;
export const selectCanUndo = (s: EditorState) => s.history.past.length > 0;
export const selectCanRedo = (s: EditorState) => s.history.future.length > 0;
