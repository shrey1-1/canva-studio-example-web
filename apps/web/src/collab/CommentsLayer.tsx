import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { Check, MessageCircle, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { containsPoint, worldMatrix } from '@canvas-studio/core';
import { api } from '../persistence/api';
import { useOpenFile } from '../persistence/serverRepository';
import { useAuth } from '../state/authStore';
import { useEditor } from '../state/editorStore';
import { useCollab } from './collabClient';

export interface Comment {
  id: string;
  parentId: string | null;
  userId: string | null;
  author: string | null;
  pageId: string | null;
  nodeId: string | null;
  x: number | null;
  y: number | null;
  body: string;
  resolved: boolean;
  createdAt: string;
}

interface CommentsUi {
  placing: boolean;
  showResolved: boolean;
  openId: string | null;
  draft: { pageId: string; nodeId: string | null; x: number; y: number; wx: number; wy: number } | null;
  setPlacing: (on: boolean) => void;
}

export const useCommentsUi = create<CommentsUi>()((set) => ({
  placing: false,
  showResolved: false,
  openId: null,
  draft: null,
  setPlacing: (placing) => set({ placing, draft: null, openId: null }),
}));

/** Comment pins and threads over the canvas; in placing mode a click starts a new comment. */
export function CommentsLayer() {
  const fileId = useOpenFile((s) => s.id);
  const role = useOpenFile((s) => s.role);
  const version = useCollab((s) => s.commentsVersion);
  const me = useAuth((s) => s.user);
  const doc = useEditor((s) => s.doc);
  const pageId = useEditor((s) => s.activePageId);
  const viewport = useEditor((s) => s.viewport);
  const { placing, showResolved, openId, draft } = useCommentsUi();
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!fileId) return;
    try {
      setComments((await api<{ comments: Comment[] }>('GET', `/files/${fileId}/comments`)).comments);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load comments');
    }
  }, [fileId]);
  useEffect(() => void load(), [load, version]);
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useCommentsUi.getState().setPlacing(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing]);

  if (!fileId) return null;

  /** A pin's page position: relative to its layer when that layer still exists. */
  const position = (c: Pick<Comment, 'nodeId' | 'x' | 'y'>) => {
    const node = c.nodeId ? doc.nodes[c.nodeId] : undefined;
    if (node) {
      const m = worldMatrix(doc, node.id);
      return { x: m[4] + (c.x ?? 0), y: m[5] + (c.y ?? 0) };
    }
    return { x: c.x ?? 0, y: c.y ?? 0 };
  };
  const toScreen = (p: { x: number; y: number }) => ({ left: p.x * viewport.zoom + viewport.x, top: p.y * viewport.zoom + viewport.y });

  const roots = comments.filter((c) => !c.parentId && c.pageId === pageId && (showResolved || !c.resolved || c.id === openId));
  const allRoots = comments.filter((c) => !c.parentId);

  const startDraft = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - r.left - viewport.x) / viewport.zoom;
    const wy = (e.clientY - r.top - viewport.y) / viewport.zoom;
    // Pin to the top-level frame under the point, so the comment moves with it.
    const page = doc.pages.find((p) => p.id === pageId)!;
    const frame = [...page.childIds].reverse().find((id) => doc.nodes[id]?.visible && 'childIds' in doc.nodes[id]! && containsPoint(doc, id, { x: wx, y: wy }));
    const origin = frame ? worldMatrix(doc, frame) : null;
    useCommentsUi.setState({
      draft: { pageId, nodeId: frame ?? null, x: origin ? wx - origin[4] : wx, y: origin ? wy - origin[5] : wy, wx, wy },
      openId: null,
    });
  };

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const open = roots.find((c) => c.id === openId);
  return (
    <>
      {placing && (
        <div data-testid="comment-placing" className="absolute inset-0 z-20 cursor-crosshair" onClick={startDraft}>
          {!draft && (
            <p className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded bg-sidebar/90 px-3 py-1 text-2xs text-fg-muted">
              Click anywhere to add a comment. Esc to stop.
            </p>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {roots.map((c) => {
          const replies = comments.filter((r) => r.parentId === c.id).length;
          return (
            <button
              key={c.id}
              type="button"
              aria-label={`Comment by ${c.author ?? 'deleted user'}: ${c.body.slice(0, 40)}`}
              onClick={() => useCommentsUi.setState({ openId: c.id === openId ? null : c.id, draft: null })}
              className={`pointer-events-auto absolute flex h-7 min-w-7 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 border-white px-1.5 text-2xs font-semibold text-white shadow-lg ${c.resolved ? 'bg-fg-subtle' : 'bg-accent'}`}
              style={toScreen(position(c))}
            >
              {replies ? replies + 1 : <MessageCircle size={12} />}
            </button>
          );
        })}
        {draft && (
          <Composer
            style={toScreen({ x: draft.wx, y: draft.wy })}
            placeholder="Add a comment…"
            onCancel={() => useCommentsUi.setState({ draft: null })}
            onSubmit={(body) =>
              run(async () => {
                const { comment } = await api<{ comment: Comment }>('POST', `/files/${fileId}/comments`, { body, pageId: draft.pageId, x: draft.x, y: draft.y, ...(draft.nodeId ? { nodeId: draft.nodeId } : {}) });
                useCommentsUi.setState({ draft: null, openId: comment.id, placing: false });
              })
            }
          />
        )}
        {open && (
          <section aria-label="Comment thread" className="pointer-events-auto absolute z-30 ml-8 w-72 -translate-y-full rounded-lg border border-edge bg-sidebar shadow-2xl" style={toScreen(position(open))}>
            <header className="flex items-center gap-1 border-b border-edge px-3 py-2">
              <h3 className="flex-1 text-2xs font-semibold text-fg">Comment</h3>
              {(role !== 'viewer' || open.userId === me?.id) && (
                <button type="button" aria-label={open.resolved ? 'Reopen' : 'Resolve'} title={open.resolved ? 'Reopen' : 'Resolve'} onClick={() => run(() => api('PATCH', `/comments/${open.id}`, { resolved: !open.resolved }))} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
                  {open.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
                </button>
              )}
              {(open.userId === me?.id || role === 'owner') && (
                <button type="button" aria-label="Delete comment" onClick={() => run(async () => { await api('DELETE', `/comments/${open.id}`); useCommentsUi.setState({ openId: null }); })} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
                  <Trash2 size={13} />
                </button>
              )}
              <button type="button" aria-label="Close thread" onClick={() => useCommentsUi.setState({ openId: null })} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
                <X size={13} />
              </button>
            </header>
            <ul className="max-h-64 space-y-2 overflow-y-auto px-3 py-2">
              {[open, ...comments.filter((r) => r.parentId === open.id)].map((c) => (
                <li key={c.id}>
                  <p className="text-2xs text-fg-subtle">
                    <span className="font-medium text-fg">{c.author ?? 'Deleted user'}</span> · {new Date(c.createdAt).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-fg">{c.body}</p>
                </li>
              ))}
            </ul>
            {error && <p role="alert" className="px-3 pb-2 text-danger">{error}</p>}
            <Composer inline placeholder="Reply…" onSubmit={(body) => run(() => api('POST', `/files/${fileId}/comments`, { body, parentId: open.id }))} />
          </section>
        )}
      </div>
      {allRoots.length > 0 && (
        <label className="absolute right-7 bottom-16 z-20 flex items-center gap-1.5 rounded bg-sidebar/90 px-2 py-1 text-2xs text-fg-muted">
          <input type="checkbox" checked={showResolved} onChange={(e) => useCommentsUi.setState({ showResolved: e.target.checked })} className="accent-accent" />
          Show resolved ({allRoots.filter((c) => c.resolved).length})
        </label>
      )}
    </>
  );
}

function Composer({ onSubmit, onCancel, placeholder, style, inline = false }: { onSubmit: (body: string) => Promise<void>; onCancel?: () => void; placeholder: string; style?: React.CSSProperties; inline?: boolean }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    await onSubmit(body.trim());
    setBusy(false);
    setBody('');
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className={inline ? 'flex items-end gap-1 border-t border-edge p-2' : 'pointer-events-auto absolute z-30 ml-3 flex w-64 items-end gap-1 rounded-lg border border-edge bg-sidebar p-2 shadow-2xl'}
      style={style}
    >
      <textarea
        aria-label={placeholder}
        autoFocus
        rows={2}
        maxLength={5000}
        value={body}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') onCancel?.();
        }}
        className="min-h-0 flex-1 resize-none rounded border border-edge bg-app px-2 py-1 text-fg outline-none focus:border-accent"
      />
      <button type="submit" aria-label="Post comment" disabled={!body.trim() || busy} className="rounded bg-accent p-1.5 text-white disabled:opacity-40">
        <Send size={13} />
      </button>
    </form>
  );
}
