import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { DocumentLoadError } from '../persistence/localRepository';
import { documentRepository, useOpenFile } from '../persistence/serverRepository';
import { useEditor } from '../state/editorStore';
import { EditorLayout } from '../editor/EditorLayout';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export function EditorRoute() {
  const { docId } = useParams();
  const loadedId = useEditor((s) => s.doc.id);
  const [state, setState] = useState<LoadState>(loadedId === docId && useOpenFile.getState().id === docId ? 'ready' : 'loading');
  const [errorText, setErrorText] = useState('The saved data could not be read.');

  useEffect(() => {
    if (!docId) return;
    if (useEditor.getState().doc.id === docId && useOpenFile.getState().id === docId) {
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
        useEditor.getState().setReadOnly(useOpenFile.getState().role === 'viewer');
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorText(error instanceof DocumentLoadError || error instanceof Error ? error.message : 'The file could not be opened.');
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
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-base font-semibold">{state === 'missing' ? 'File not found' : 'Could not open this file'}</h1>
        <p className="text-fg-muted">{state === 'missing' ? 'It may have been deleted, or you no longer have access to it.' : errorText}</p>
        <Link to="/" className="rounded bg-accent px-3 py-1.5 font-medium hover:bg-accent-hover">
          Go to your files
        </Link>
      </div>
    );
  }

  return <EditorLayout />;
}
