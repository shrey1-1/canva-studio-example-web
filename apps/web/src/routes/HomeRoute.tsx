import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { createDocument } from '@canvas-studio/core';
import { documentRepository } from '../persistence/localRepository';

/**
 * Entry point: opens the most recently edited file, or creates the first one.
 * (A full file browser with projects/folders arrives with Phase 6 file management.)
 */
export function HomeRoute() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recent] = await documentRepository.list();
        let id = recent?.id;
        if (!id) {
          const doc = createDocument('Untitled');
          await documentRepository.save(doc);
          id = doc.id;
        }
        if (!cancelled) navigate(`/file/${id}`, { replace: true });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open files');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex h-full items-center justify-center text-fg-muted" role="status">
      {error ?? 'Opening your files…'}
    </div>
  );
}
