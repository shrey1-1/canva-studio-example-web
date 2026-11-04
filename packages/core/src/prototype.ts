/**
 * Prototyping: interactions on layers, how they are validated and cleaned up, and the pure
 * state machine the preview player runs (screen history + overlay stack).
 */
import { containsPoint, nodeBounds } from './geometry';
import type { DesignDocument, NodeId, Page, SceneNode } from './model';
import { sortByRenderOrder } from './structure';

export const TRIGGERS = ['click', 'hover', 'press', 'drag', 'after-delay'] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const TRANSITIONS = [
  'instant', 'dissolve',
  'slide-left', 'slide-right', 'slide-up', 'slide-down',
  'push-left', 'push-right', 'push-up', 'push-down',
] as const;
export type TransitionType = (typeof TRANSITIONS)[number];

export const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type Easing = (typeof EASINGS)[number];

export const OVERLAY_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export const SCROLL_BEHAVIORS = ['none', 'vertical', 'horizontal', 'both'] as const;
export type ScrollOverflow = (typeof SCROLL_BEHAVIORS)[number];

export interface Transition {
  type: TransitionType;
  durationMs: number;
  easing: Easing;
}

export type PrototypeAction =
  | { type: 'navigate'; destinationId: NodeId; transition: Transition }
  | { type: 'back' }
  | { type: 'overlay'; destinationId: NodeId; position: OverlayPosition; closeOnOutside: boolean; dimBackground: boolean; transition: Transition }
  | { type: 'close-overlay' }
  | { type: 'scroll-to'; destinationId: NodeId; smooth: boolean }
  | { type: 'url'; url: string };

export type ActionType = PrototypeAction['type'];
export const ACTION_TYPES: readonly ActionType[] = ['navigate', 'back', 'overlay', 'close-overlay', 'scroll-to', 'url'];

export interface Interaction {
  id: string;
  trigger: Trigger;
  /** Only for "after-delay": milliseconds after the screen appears. */
  delayMs: number;
  action: PrototypeAction;
}

export const MAX_INTERACTIONS = 20;
export const MAX_DURATION_MS = 10_000;
export const MAX_DELAY_MS = 60_000;

export const DEFAULT_TRANSITION: Transition = { type: 'dissolve', durationMs: 300, easing: 'ease-out' };

/** Builds a sensible default action of a type (destination = first candidate when needed). */
export function defaultAction(type: ActionType, destinationId: NodeId | null): PrototypeAction | null {
  switch (type) {
    case 'navigate':
      return destinationId ? { type, destinationId, transition: { ...DEFAULT_TRANSITION } } : null;
    case 'overlay':
      return destinationId
        ? { type, destinationId, position: 'center', closeOnOutside: true, dimBackground: true, transition: { ...DEFAULT_TRANSITION } }
        : null;
    case 'scroll-to':
      return destinationId ? { type, destinationId, smooth: true } : null;
    case 'url':
      return { type, url: 'https://' };
    default:
      return { type };
  }
}

// ---------------------------------------------------------------------------
// Validation (untrusted input: stored files, clipboard, tools)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const inRange = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const oneOf = (v: unknown, values: readonly string[]) => isStr(v) && values.includes(v);

/** Only web and mail links may be opened from a prototype. */
export function isSafeUrl(url: string): boolean {
  if (url.length > 2000) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function transitionOk(t: unknown): boolean {
  return isObj(t) && oneOf(t.type, TRANSITIONS) && inRange(t.durationMs, 0, MAX_DURATION_MS) && oneOf(t.easing, EASINGS);
}

function actionOk(a: unknown): boolean {
  if (!isObj(a)) return false;
  switch (a.type) {
    case 'navigate':
      return isStr(a.destinationId) && transitionOk(a.transition);
    case 'overlay':
      return (
        isStr(a.destinationId) && oneOf(a.position, OVERLAY_POSITIONS) && typeof a.closeOnOutside === 'boolean' &&
        typeof a.dimBackground === 'boolean' && transitionOk(a.transition)
      );
    case 'scroll-to':
      return isStr(a.destinationId) && typeof a.smooth === 'boolean';
    case 'url':
      // Kept even while being typed; the player only opens safe URLs.
      return isStr(a.url) && a.url.length <= 2000;
    case 'back':
    case 'close-overlay':
      return true;
    default:
      return false;
  }
}

export function interactionsProblem(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > MAX_INTERACTIONS) return 'bad interactions';
  for (const i of v) {
    if (!isObj(i) || !isStr(i.id) || !oneOf(i.trigger, TRIGGERS) || !inRange(i.delayMs, 0, MAX_DELAY_MS) || !actionOk(i.action)) {
      return 'bad interaction';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

const FRAME_LIKE = new Set(['frame', 'component', 'component-set', 'instance']);

/** Top-level frames of a page: the screens of a prototype. */
export function screenIds(doc: DesignDocument, page: Page): NodeId[] {
  return page.childIds.filter((id) => FRAME_LIKE.has(doc.nodes[id]?.type ?? ''));
}

/** The top-level frame (screen) that contains a node. */
export function screenOf(doc: DesignDocument, id: NodeId): NodeId | null {
  let cur = doc.nodes[id];
  while (cur?.parentId) cur = doc.nodes[cur.parentId];
  return cur && FRAME_LIKE.has(cur.type) ? cur.id : null;
}

function destinationOk(doc: DesignDocument, owner: SceneNode, action: PrototypeAction): boolean {
  if (!('destinationId' in action)) return true;
  const dest = doc.nodes[action.destinationId];
  if (!dest || dest.pageId !== owner.pageId) return false;
  if (action.type === 'scroll-to') return screenOf(doc, dest.id) === screenOf(doc, owner.id) && dest.id !== screenOf(doc, owner.id);
  return dest.parentId === null && FRAME_LIKE.has(dest.type);
}

/**
 * Removes interactions whose destination was deleted or moved off the page, and clears a flow
 * start that no longer points at a screen. Idempotent; runs in finalizeDocument.
 */
export function pruneInteractions(doc: DesignDocument): void {
  for (const node of Object.values(doc.nodes)) {
    if (!node.interactions) continue;
    const kept = node.interactions.filter((i) => destinationOk(doc, node, i.action));
    if (kept.length !== node.interactions.length) node.interactions = kept;
  }
  for (const page of doc.pages) {
    if (page.flowStartId && !screenIds(doc, page).includes(page.flowStartId)) delete page.flowStartId;
  }
}

/** The screen a prototype starts on: the page's flow start, else its first screen with content. */
export function flowStart(doc: DesignDocument, page: Page): NodeId | null {
  const screens = screenIds(doc, page);
  if (page.flowStartId && screens.includes(page.flowStartId)) return page.flowStartId;
  // Top-left-most screen, the way people lay out flows.
  const sorted = [...screens].sort((a, b) => doc.nodes[a]!.y - doc.nodes[b]!.y || doc.nodes[a]!.x - doc.nodes[b]!.x);
  return sorted[0] ?? null;
}

/**
 * The top-most layer under a point (in the screen's page coordinates) that has an interaction
 * with the trigger, searching from the deepest layer up through its ancestors.
 */
export function hitInteraction(doc: DesignDocument, screenId: NodeId, p: { x: number; y: number }, trigger: Trigger): { nodeId: NodeId; interaction: Interaction } | null {
  const hits: NodeId[] = [];
  const walk = (id: NodeId) => {
    const n = doc.nodes[id];
    if (!n || !n.visible) return;
    if (!containsPoint(doc, id, p)) {
      // Unclipped containers can have children outside their box.
      if (!('childIds' in n) || ('clipContent' in n && n.clipContent)) return;
    } else {
      hits.push(id);
    }
    if ('childIds' in n) for (const c of n.childIds) walk(c);
  };
  walk(screenId);
  // Deepest, then top-most in render order.
  const ordered = sortByRenderOrder(doc, hits).reverse();
  ordered.sort((a, b) => depth(doc, b) - depth(doc, a));
  for (const id of ordered) {
    for (let cur: SceneNode | undefined = doc.nodes[id]; cur; cur = cur.parentId ? doc.nodes[cur.parentId] : undefined) {
      if (!hits.includes(cur.id)) continue;
      const interaction = cur.interactions?.find((i) => i.trigger === trigger);
      if (interaction) return { nodeId: cur.id, interaction };
    }
  }
  return null;
}

function depth(doc: DesignDocument, id: NodeId): number {
  let d = 0;
  for (let cur = doc.nodes[id]; cur?.parentId; cur = doc.nodes[cur.parentId]) d++;
  return d;
}

/** A layer's position inside its screen (for scroll-to). */
export function offsetInScreen(doc: DesignDocument, id: NodeId): { x: number; y: number } | null {
  const screen = screenOf(doc, id);
  if (!screen) return null;
  const a = nodeBounds(doc, id);
  const s = doc.nodes[screen]!;
  return { x: a.x - s.x, y: a.y - s.y };
}

/** Extent of a screen's content (its box united with its children), relative to the screen. */
export function screenContentSize(doc: DesignDocument, screenId: NodeId): { width: number; height: number } {
  const s = doc.nodes[screenId]!;
  let w = s.width;
  let h = s.height;
  if ('childIds' in s) {
    for (const c of s.childIds) {
      const n = doc.nodes[c];
      if (!n || !n.visible) continue;
      const b = nodeBounds(doc, c);
      w = Math.max(w, b.x + b.width - s.x);
      h = Math.max(h, b.y + b.height - s.y);
    }
  }
  return { width: Math.ceil(w), height: Math.ceil(h) };
}

// ---------------------------------------------------------------------------
// Player state machine
// ---------------------------------------------------------------------------

export interface OverlayState {
  screenId: NodeId;
  position: OverlayPosition;
  closeOnOutside: boolean;
  dimBackground: boolean;
}

export interface PlayerState {
  /** Visited screens; the last one is showing. */
  history: NodeId[];
  overlays: OverlayState[];
}

export type PlayerEffect =
  | { kind: 'transition'; from: NodeId | null; to: NodeId; transition: Transition; reverse: boolean }
  | { kind: 'overlay-open'; transition: Transition }
  | { kind: 'scroll'; targetId: NodeId; smooth: boolean }
  | { kind: 'open-url'; url: string }
  | { kind: 'none' };

export function initialPlayerState(start: NodeId): PlayerState {
  return { history: [start], overlays: [] };
}

export const currentScreen = (s: PlayerState): NodeId => s.history[s.history.length - 1]!;

/** Applies an action. Returns the next state and what the player must animate or do. */
export function applyAction(doc: DesignDocument, state: PlayerState, action: PrototypeAction): { state: PlayerState; effect: PlayerEffect } {
  switch (action.type) {
    case 'navigate': {
      if (!doc.nodes[action.destinationId]) return { state, effect: { kind: 'none' } };
      const from = currentScreen(state);
      // Navigating closes overlays, like leaving the page.
      return {
        state: { history: [...state.history, action.destinationId].slice(-200), overlays: [] },
        effect: { kind: 'transition', from, to: action.destinationId, transition: action.transition, reverse: false },
      };
    }
    case 'back': {
      if (state.overlays.length) return { state: { ...state, overlays: state.overlays.slice(0, -1) }, effect: { kind: 'none' } };
      if (state.history.length < 2) return { state, effect: { kind: 'none' } };
      const history = state.history.slice(0, -1);
      return {
        state: { history, overlays: [] },
        effect: { kind: 'transition', from: currentScreen(state), to: history[history.length - 1]!, transition: { ...DEFAULT_TRANSITION, durationMs: 200 }, reverse: true },
      };
    }
    case 'overlay': {
      if (!doc.nodes[action.destinationId] || state.overlays.length >= 10) return { state, effect: { kind: 'none' } };
      const overlay: OverlayState = { screenId: action.destinationId, position: action.position, closeOnOutside: action.closeOnOutside, dimBackground: action.dimBackground };
      return { state: { ...state, overlays: [...state.overlays, overlay] }, effect: { kind: 'overlay-open', transition: action.transition } };
    }
    case 'close-overlay':
      return { state: { ...state, overlays: state.overlays.slice(0, -1) }, effect: { kind: 'none' } };
    case 'scroll-to':
      return { state, effect: { kind: 'scroll', targetId: action.destinationId, smooth: action.smooth } };
    case 'url':
      return { state, effect: isSafeUrl(action.url) ? { kind: 'open-url', url: action.url } : { kind: 'none' } };
  }
}
