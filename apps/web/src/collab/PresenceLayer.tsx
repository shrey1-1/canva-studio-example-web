import { selectionBounds } from '@canvas-studio/core';
import { useEditor } from '../state/editorStore';
import { useCollab, type Peer } from './collabClient';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

/** Collaborators' cursors and selections on the current page (HTML over the canvas). */
export function PresenceLayer() {
  const peers = useCollab((s) => s.peers);
  const doc = useEditor((s) => s.doc);
  const pageId = useEditor((s) => s.activePageId);
  const viewport = useEditor((s) => s.viewport);
  const here = Object.values(peers).filter((p) => p.presence.pageId === pageId);
  const toScreen = (x: number, y: number) => ({ left: x * viewport.zoom + viewport.x, top: y * viewport.zoom + viewport.y });

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {here.map((p) => {
        const ids = (p.presence.selection ?? []).filter((id) => doc.nodes[id]?.pageId === pageId);
        const b = ids.length ? selectionBounds(doc, ids) : null;
        return b ? (
          <div
            key={`sel-${p.id}`}
            className="absolute"
            style={{ ...toScreen(b.x, b.y), width: b.width * viewport.zoom, height: b.height * viewport.zoom, outline: `2px solid ${p.color}` }}
          />
        ) : null;
      })}
      {here.map((p) =>
        p.presence.cursor ? (
          <div key={`cur-${p.id}`} data-testid="peer-cursor" className="absolute transition-[left,top] duration-75" style={toScreen(p.presence.cursor.x, p.presence.cursor.y)}>
            <svg width="16" height="16" viewBox="0 0 16 16" className="-mt-px -ml-px drop-shadow">
              <path d="M1 1 L1 13 L4.5 9.5 L7 15 L9 14 L6.5 8.5 L11.5 8.5 Z" fill={p.color} stroke="white" strokeWidth="1" />
            </svg>
            <span className="ml-3 rounded px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap text-white" style={{ background: p.color }}>
              {p.name}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}

/** Who else has the file open (top-right of the canvas). */
export function PeerAvatars() {
  const peers = useCollab((s) => s.peers);
  const list: Peer[] = Object.values(peers);
  const setActivePage = useEditor((s) => s.setActivePage);
  if (!list.length) return null;
  return (
    <ul aria-label="People in this file" className="absolute top-7 right-7 z-10 flex -space-x-1.5">
      {list.slice(0, 6).map((p) => (
        <li key={p.id}>
          <button
            type="button"
            title={`${p.name} — go to their page`}
            aria-label={p.name}
            onClick={() => p.presence.pageId && setActivePage(p.presence.pageId)}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-app text-2xs font-semibold text-white"
            style={{ background: p.color }}
          >
            {initials(p.name)}
          </button>
        </li>
      ))}
      {list.length > 6 && <li className="flex h-7 items-center rounded-full bg-hover px-2 text-2xs text-fg-muted">+{list.length - 6}</li>}
    </ul>
  );
}
