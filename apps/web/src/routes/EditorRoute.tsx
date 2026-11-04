import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { createDocument } from '@canvas-studio/core';
import { DocumentLoadError, documentRepository } from '../persistence/localRepository';
import { useEditor } from '../state/editorStore';
import { EditorLayout } from '../editor/EditorLayout';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export function EditorRoute() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const loadedId = useEditor((s) => s.doc.id);
  const [state, setState] = useState<LoadState>(loadedId === docId ? 'ready' : 'loading');
  const [errorText, setErrorText] = useState('The saved data could not be read.');

  useEffect(() => {
    if (!docId) return;
    if (useEditor.getState().doc.id === docId) {
      setState('ready');
      return;
    }
    let cancelled = false;
    setState('loading');
    documentRepository
      .load(docId)
      .then((doc) => {
        if (cancelled) return;
        if (!doc) return setState('missing');
        useEditor.getState().loadDocument(doc);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DocumentLoadError) setErrorText(error.message);
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted" role="status">
        Loading file…
      </div>
    );
  }

  if (state === 'missing' || state === 'error') {
    const createNew = async () => {
      const doc = createDocument('Untitled');
      await documentRepository.save(doc);
      navigate(`/file/${doc.id}`);
    };
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-base font-semibold">{state === 'missing' ? 'File not found' : 'Could not open this file'}</h1>
        <p className="text-fg-muted">
          {state === 'missing'
            ? 'It may have been deleted, or it was created in another browser.'
            : errorText}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={createNew} className="rounded bg-accent px-3 py-1.5 font-medium hover:bg-accent-hover">
            Create a new file
          </button>
          <Link to="/" className="rounded border border-edge px-3 py-1.5 hover:bg-hover">
            Open recent file
          </Link>
        </div>
      </div>
    );
  }

  return <EditorLayout />;
}
