import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { DesignDocument } from '@canvas-studio/core';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Consecutive commits with the same key inside the window merge into one undo step. */
  coalesceKey?: string;
  time: number;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const HISTORY_LIMIT = 200;
export const COALESCE_WINDOW_MS = 1000;

export interface CommitOptions {
  coalesceKey?: string;
  now?: number;
  /** How long after the previous step a same-key step still merges (default 1s). */
  mergeWindowMs?: number;
}

/**
 * Applies `recipe` to `doc` and records an undo entry.
 * Returns the unchanged inputs when the recipe made no change.
 */
export function commit(
  doc: DesignDocument,
  history: HistoryState,
  label: string,
  recipe: (draft: DesignDocument) => void,
  options: CommitOptions = {},
): { doc: DesignDocument; history: HistoryState } {
  const [next, patches, inverse] = produceWithPatches(doc, recipe);
  if (patches.length === 0) return { doc, history };

  const now = options.now ?? Date.now();
  const last = history.past.at(-1);
  if (
    options.coalesceKey &&
    last?.coalesceKey === options.coalesceKey &&
    now - last.time < (options.mergeWindowMs ?? COALESCE_WINDOW_MS)
  ) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...patches],
      inverse: [...inverse, ...last.inverse],
      time: now,
    };
    return { doc: next, history: { past: [...history.past.slice(0, -1), merged], future: [] } };
  }

  const entry: HistoryEntry = { label, patches, inverse, coalesceKey: options.coalesceKey, time: now };
  const past = [...history.past, entry].slice(-HISTORY_LIMIT);
  return { doc: next, history: { past, future: [] } };
}

export function undo(doc: DesignDocument, history: HistoryState) {
  const entry = history.past.at(-1);
  if (!entry) return null;
  return {
    doc: applyPatches(doc, entry.inverse),
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
  };
}

export function redo(doc: DesignDocument, history: HistoryState) {
  const [entry, ...rest] = history.future;
  if (!entry) return null;
  return {
    doc: applyPatches(doc, entry.patches),
    history: { past: [...history.past, entry], future: rest },
  };
}
