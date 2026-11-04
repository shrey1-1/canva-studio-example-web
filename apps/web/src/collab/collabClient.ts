/**
 * Live collaboration client. While a file is open it keeps a WebSocket to the server room:
 *  - local edits are batched (every 60 ms) into node-level changes and sent;
 *  - collaborators' changes are applied without touching the local undo history;
 *  - presence (cursor, selection, page) is sent at most ~20 times a second;
 *  - after a disconnect it reconnects with backoff, then re-sends the edits made while offline
 *    on top of the server's latest document.
 */
import { create } from 'zustand';
import { applyDocChange, diffDocuments, documentProblem, type DesignDocument, type DocChange } from '@canvas-studio/core';
import { useEditor } from '../state/editorStore';
import { useToasts } from '../state/toastStore';
import { useOpenFile } from '../persistence/serverRepository';

export interface Peer {
  id: string;
  userId: string;
  name: string;
  color: string;
  presence: { pageId?: string; cursor?: { x: number; y: number } | null; selection?: string[] };
}

interface CollabState {
  status: 'off' | 'connecting' | 'live' | 'reconnecting' | 'closed';
  /** True while local changes are waiting for the server to store them. */
  syncing: boolean;
  you: { id: string; color: string } | null;
  peers: Record<string, Peer>;
  /** Bumped when comments change (anyone in the room). */
  commentsVersion: number;
}

export const useCollab = create<CollabState>()(() => ({ status: 'off', syncing: false, you: null, peers: {}, commentsVersion: 0 }));

const BATCH_MS = 60;
const PRESENCE_MS = 50;

export function startCollab(fileId: string): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let everConnected = false;
  let retry = 0;
  let retryTimer: number | undefined;
  let applying = false;
  /** Document as last known to be on the server (unsent local edits are diffed against it). */
  let base: DesignDocument | null = null;
  let batchTimer: number | undefined;
  let seq = 0;
  const unacked = new Set<string>();
  let presenceTimer: number | undefined;
  let lastPresence = '';
  let cursor: { x: number; y: number } | null = null;

  const send = (msg: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const applyRemote = (doc: DesignDocument, finalize = false) => {
    applying = true;
    try {
      useEditor.getState().applyRemoteDoc(doc, { finalize });
    } finally {
      applying = false;
    }
  };

  const flushChanges = () => {
    batchTimer = undefined;
    if (!base || useCollab.getState().status !== 'live') return;
    const current = useEditor.getState().doc;
    const change = diffDocuments(base, current);
    if (!change) return;
    base = current;
    const id = `c${++seq}`;
    unacked.add(id);
    useCollab.setState({ syncing: true });
    send({ t: 'change', id, change });
  };

  const sendPresence = () => {
    presenceTimer = undefined;
    const { activePageId, selection } = useEditor.getState();
    const presence = { pageId: activePageId, cursor, selection };
    const key = JSON.stringify(presence);
    if (key === lastPresence) return;
    lastPresence = key;
    send({ t: 'presence', presence });
  };
  const queuePresence = () => {
    if (presenceTimer === undefined) presenceTimer = window.setTimeout(sendPresence, PRESENCE_MS);
  };

  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.doc !== prev.doc && !applying && s.doc.id === fileId && prev.doc.id === fileId && !s.readOnly) {
      if (batchTimer === undefined) batchTimer = window.setTimeout(flushChanges, BATCH_MS);
    }
    if (s.selection !== prev.selection || s.activePageId !== prev.activePageId) queuePresence();
  });

  const onPointer = (e: PointerEvent) => {
    const el = document.querySelector('[data-testid="canvas"]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const { viewport } = useEditor.getState();
    cursor = inside ? { x: (e.clientX - r.left - viewport.x) / viewport.zoom, y: (e.clientY - r.top - viewport.y) / viewport.zoom } : null;
    queuePresence();
  };
  window.addEventListener('pointermove', onPointer);

  const onMessage = (raw: string) => {
    const m = JSON.parse(raw) as Record<string, unknown> & { t: string };
    switch (m.t) {
      case 'init': {
        const server = m.doc as DesignDocument;
        const local = useEditor.getState().doc;
        let next = server;
        if (everConnected && base && local.id === fileId) {
          // Re-apply what was edited while offline (last writer wins per layer).
          const mine = diffDocuments(base, local);
          if (mine) {
            const merged = applyDocChange(server, mine);
            if (documentProblem(merged)) useToasts.getState().push('Some edits made while offline conflicted with collaborators and were dropped.', 'error');
            else next = merged;
          }
        }
        everConnected = true;
        retry = 0;
        base = server;
        applyRemote(next, true);
        useOpenFile.setState({ revision: m.revision as number });
        const peers = Object.fromEntries((m.peers as Peer[]).map((p) => [p.id, p]));
        useCollab.setState({ status: 'live', you: m.you as CollabState['you'], peers, syncing: false });
        lastPresence = '';
        queuePresence();
        if (next !== server) flushChanges();
        break;
      }
      case 'change': {
        const change = m.change as DocChange;
        if (base) base = applyDocChange(base, change);
        applyRemote(applyDocChange(useEditor.getState().doc, change));
        break;
      }
      case 'ack':
        unacked.delete(m.id as string);
        break;
      case 'reject': {
        unacked.delete(m.id as string);
        const doc = m.doc as DesignDocument;
        base = doc;
        applyRemote(doc, true);
        useToasts.getState().push(m.reason === 'View only' ? 'This file is view only.' : 'A change could not be applied and was undone (it conflicted with a collaborator).', 'error');
        break;
      }
      case 'reset': {
        const doc = m.doc as DesignDocument;
        base = doc;
        applyRemote(doc, true);
        useOpenFile.setState({ revision: m.revision as number });
        break;
      }
      case 'saved':
        useOpenFile.setState({ revision: m.revision as number });
        if (unacked.size === 0 && batchTimer === undefined) useCollab.setState({ syncing: false });
        break;
      case 'join':
      case 'presence': {
        const peer = m.peer as Peer;
        useCollab.setState((s) => ({ peers: { ...s.peers, [peer.id]: peer } }));
        break;
      }
      case 'leave':
        useCollab.setState((s) => {
          const peers = { ...s.peers };
          delete peers[m.id as string];
          return { peers };
        });
        break;
      case 'comments':
        useCollab.setState((s) => ({ commentsVersion: s.commentsVersion + 1 }));
        break;
    }
  };

  const connect = () => {
    if (stopped) return;
    useCollab.setState({ status: everConnected ? 'reconnecting' : 'connecting' });
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/collab?file=${encodeURIComponent(fileId)}`;
    ws = new WebSocket(url);
    ws.onmessage = (e) => {
      try {
        onMessage(String(e.data));
      } catch {
        /* ignore malformed messages */
      }
    };
    ws.onclose = (e) => {
      ws = null;
      if (stopped) return;
      if (e.code === 4404) {
        useCollab.setState({ status: 'closed', peers: {} });
        useToasts.getState().push('This file was deleted or you no longer have access.', 'error');
        return;
      }
      useCollab.setState({ status: everConnected ? 'reconnecting' : 'connecting', peers: {} });
      retryTimer = window.setTimeout(connect, Math.min(15_000, 1000 * 2 ** retry++));
    };
  };
  connect();

  return () => {
    stopped = true;
    flushChanges();
    window.clearTimeout(retryTimer);
    window.clearTimeout(batchTimer);
    window.clearTimeout(presenceTimer);
    window.removeEventListener('pointermove', onPointer);
    unsubscribe();
    ws?.close(1000);
    useCollab.setState({ status: 'off', peers: {}, you: null, syncing: false });
  };
}

/** True when the live connection owns saving (HTTP autosave stays idle). */
export const collabOwnsSaving = () => {
  const s = useCollab.getState().status;
  return s === 'live' || s === 'reconnecting';
};
