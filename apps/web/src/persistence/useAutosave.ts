import { useEffect, useRef, useState } from 'react';
import type { DesignDocument } from '@canvas-studio/core';
import { useEditor } from '../state/editorStore';
import type { DocumentRepository } from './repository';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export const AUTOSAVE_DELAY_MS = 800;

/**
 * Debounced autosave: waits until edits pause for AUTOSAVE_DELAY_MS before writing.
 * Also flushes on tab hide/close so pending edits aren't lost.
 * Returns the save status and a `saveNow` function for manual save (Ctrl+S).
 */
export function useAutosave(repo: DocumentRepository) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef<DesignDocument | null>(useEditor.getState().doc);
  const timer = useRef<number | undefined>(undefined);

  const saveNow = useRef(async () => {
    window.clearTimeout(timer.current);
    const doc = useEditor.getState().doc;
    if (doc === lastSaved.current) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    try {
      await repo.save(doc);
      lastSaved.current = doc;
      setError(null);
      // Edits may have happened while saving.
      setStatus(useEditor.getState().doc === doc ? 'saved' : 'unsaved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setStatus('error');
    }
  }).current;

  useEffect(() => {
    // A freshly loaded document counts as saved.
    const unsubLoad = useEditor.subscribe((s, prev) => {
      if (s.doc.id !== prev.doc.id) {
        lastSaved.current = s.doc;
        setStatus('saved');
        return;
      }
      if (s.doc !== prev.doc) {
        setStatus('unsaved');
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
      }
    });

    const flush = () => {
      if (useEditor.getState().doc !== lastSaved.current) void saveNow();
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubLoad();
      window.clearTimeout(timer.current);
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [saveNow]);

  return { status, error, saveNow };
}
