/**
 * Real-time collaboration over WebSockets (`/api/collab?file=<id>`).
 *
 * One room per open file holds the authoritative document in memory:
 *  - Editors send node-level changes (core `DocChange`). The room applies each change to a copy,
 *    validates the whole document (`documentProblem`) and either broadcasts it or rejects it
 *    (the sender then gets the authoritative document back).
 *  - Presence (cursor, selection, page) is relayed to everyone in the room.
 *  - The room saves to the database shortly after changes stop (and when the last person
 *    leaves), using the same revision + automatic-version rules as HTTP saves.
 * Security: the session cookie is checked on upgrade, the Origin must match the Host
 * (blocks cross-site WebSocket hijacking), viewers cannot send changes, and messages are
 * size-limited.
 */
import type { IncomingMessage, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyDocChange, documentProblem, migrateDocument, type DesignDocument, type DocChange } from '@canvas-studio/core';
import { SESSION_COOKIE, userForSession, type SessionUser } from './auth';
import { requireFile, type Role } from './access';
import type { Db } from './db';
import { persistDocument } from './persist';

const COLORS = ['#F43F5E', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
const SAVE_DELAY_MS = 800;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

export interface Presence {
  pageId?: string;
  cursor?: { x: number; y: number } | null;
  selection?: string[];
}

interface Client {
  id: string;
  ws: WebSocket;
  user: SessionUser;
  role: Role;
  color: string;
  presence: Presence;
}

interface Room {
  fileId: string;
  doc: DesignDocument;
  revision: number;
  clients: Map<string, Client>;
  dirtyBy: string | null;
  timer: NodeJS.Timeout | null;
  saving: Promise<void> | null;
}

const peerInfo = (c: Client) => ({ id: c.id, userId: c.user.id, name: c.user.name, color: c.color, presence: c.presence });

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class CollabHub {
  private rooms = new Map<string, Room>();
  private loading = new Map<string, Promise<Room>>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  constructor(private readonly db: Db, private readonly allowedOrigins: string[] = []) {}

  /** Handles WebSocket upgrades on the HTTP server. */
  attach(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/collab') return;
      void this.authorize(req, url.searchParams.get('file')).then(
        (auth) => {
          if (!auth) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          this.wss.handleUpgrade(req, socket, head, (ws) => void this.join(ws, auth.user, auth.role, auth.fileId));
        },
        () => socket.destroy(),
      );
    });
  }

  private async authorize(req: IncomingMessage, fileId: string | null) {
    if (!fileId || !/^[0-9a-f-]{36}$/.test(fileId)) return null;
    // Same-origin only: browsers attach cookies to cross-site WebSocket requests.
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!origin || !host) return null;
    const originHost = (() => {
      try {
        return new URL(origin).host;
      } catch {
        return '';
      }
    })();
    if (originHost !== host && !this.allowedOrigins.includes(origin)) return null;
    const user = await userForSession(this.db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!user) return null;
    try {
      const { role } = await requireFile(this.db, user, fileId, 'viewer');
      return { user, role, fileId };
    } catch {
      return null;
    }
  }

  private async room(fileId: string): Promise<Room> {
    const existing = this.rooms.get(fileId);
    if (existing) return existing;
    let pending = this.loading.get(fileId);
    if (!pending) {
      pending = (async () => {
        const { rows } = await this.db.query<{ document: unknown; revision: number }>('select document, revision from files where id = $1', [fileId]);
        if (!rows[0]) throw new Error('File not found');
        const room: Room = { fileId, doc: migrateDocument(rows[0].document), revision: rows[0].revision, clients: new Map(), dirtyBy: null, timer: null, saving: null };
        this.rooms.set(fileId, room);
        return room;
      })().finally(() => this.loading.delete(fileId));
      this.loading.set(fileId, pending);
    }
    return pending;
  }

  private async join(ws: WebSocket, user: SessionUser, role: Role, fileId: string) {
    let room: Room;
    try {
      room = await this.room(fileId);
    } catch {
      ws.close(4404, 'File not found');
      return;
    }
    const used = new Set([...room.clients.values()].map((c) => c.color));
    const client: Client = { id: randomUUID(), ws, user, role, color: COLORS.find((c) => !used.has(c)) ?? COLORS[room.clients.size % COLORS.length]!, presence: {} };
    room.clients.set(client.id, client);
    this.send(client, { t: 'init', doc: room.doc, revision: room.revision, role, you: { id: client.id, color: client.color }, peers: [...room.clients.values()].filter((c) => c !== client).map(peerInfo) });
    this.broadcast(room, { t: 'join', peer: peerInfo(client) }, client);

    ws.on('message', (raw) => this.onMessage(room, client, raw.toString()));
    ws.on('close', () => {
      room.clients.delete(client.id);
      this.broadcast(room, { t: 'leave', id: client.id });
      if (room.clients.size === 0) void this.flush(room).finally(() => room.clients.size === 0 && this.rooms.get(fileId) === room && this.rooms.delete(fileId));
    });
  }

  private onMessage(room: Room, client: Client, raw: string) {
    let msg: { t?: string; id?: string; change?: DocChange; presence?: Presence };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'presence' && msg.presence && typeof msg.presence === 'object') {
      const p = msg.presence;
      client.presence = {
        pageId: typeof p.pageId === 'string' ? p.pageId.slice(0, 64) : undefined,
        cursor: p.cursor && Number.isFinite(p.cursor.x) && Number.isFinite(p.cursor.y) ? { x: p.cursor.x, y: p.cursor.y } : null,
        selection: Array.isArray(p.selection) ? p.selection.filter((s): s is string => typeof s === 'string').slice(0, 500) : [],
      };
      this.broadcast(room, { t: 'presence', peer: peerInfo(client) }, client);
      return;
    }
    if (msg.t !== 'change' || !msg.change || typeof msg.change !== 'object') return;
    if (client.role === 'viewer') return this.send(client, { t: 'reject', id: msg.id, reason: 'View only', doc: room.doc });
    let next: DesignDocument;
    try {
      next = applyDocChange(room.doc, msg.change);
    } catch {
      return this.send(client, { t: 'reject', id: msg.id, reason: 'Malformed change', doc: room.doc });
    }
    // Ids must stay what they are (no smuggling a node under another key).
    const problem = documentProblem(next);
    if (problem) return this.send(client, { t: 'reject', id: msg.id, reason: problem, doc: room.doc });
    room.doc = next;
    this.send(client, { t: 'ack', id: msg.id });
    this.broadcast(room, { t: 'change', change: msg.change, from: client.id }, client);
    this.scheduleSave(room, client.user.id);
  }

  private scheduleSave(room: Room, userId: string) {
    room.dirtyBy = userId;
    if (room.timer) clearTimeout(room.timer);
    room.timer = setTimeout(() => void this.flush(room), SAVE_DELAY_MS);
  }

  /** Writes pending changes to the database. */
  async flush(room: Room): Promise<void> {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    if (room.saving) await room.saving;
    if (!room.dirtyBy) return;
    const userId = room.dirtyBy;
    room.dirtyBy = null;
    const doc = room.doc;
    room.saving = (async () => {
      try {
        room.revision = await this.db.transaction((tx) => persistDocument(tx, room.fileId, userId, doc));
        this.broadcast(room, { t: 'saved', revision: room.revision });
      } catch {
        // File deleted meanwhile, or the database is unavailable: keep the changes for the next try.
        if (!room.dirtyBy) room.dirtyBy = userId;
      } finally {
        room.saving = null;
      }
    })();
    await room.saving;
  }

  /** Saves a file's pending live changes (before an HTTP write reads the revision). */
  async flushFile(fileId: string) {
    const room = this.rooms.get(fileId);
    if (room) await this.flush(room);
  }

  /** An HTTP write (agent, restore) replaced the document: everyone in the room reloads it. */
  replaced(fileId: string, doc: DesignDocument, revision: number) {
    const room = this.rooms.get(fileId);
    if (!room) return;
    room.doc = doc;
    room.revision = revision;
    room.dirtyBy = null;
    this.broadcast(room, { t: 'reset', doc, revision });
  }

  /** Tells everyone in a file's room that something else changed (e.g. comments). */
  notify(fileId: string, msg: Record<string, unknown>) {
    const room = this.rooms.get(fileId);
    if (room) this.broadcast(room, msg);
  }

  /** Disconnects everyone from a file (deleted, or access changed). */
  close(fileId: string) {
    const room = this.rooms.get(fileId);
    if (!room) return;
    for (const c of room.clients.values()) c.ws.close(4404, 'File closed');
  }

  async shutdown() {
    await Promise.all([...this.rooms.values()].map((r) => this.flush(r)));
    for (const r of this.rooms.values()) for (const c of r.clients.values()) c.ws.close(1001, 'Server shutting down');
    this.wss.close();
  }

  private send(client: Client, msg: unknown) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  }

  private broadcast(room: Room, msg: unknown, except?: Client) {
    const data = JSON.stringify(msg);
    for (const c of room.clients.values()) if (c !== except && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }
}
