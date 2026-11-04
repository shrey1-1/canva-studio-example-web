# 0006. Real-time collaboration: server-authoritative rooms with per-layer changes

Date: 2026-11-04
Status: Accepted

## Context
Several people need to edit one file at once and see each other. Phase 6 saved whole documents
with optimistic revisions, which refuses the second writer.

## Decision
- **One room per open file.** Each room on the server (WebSocket via `ws`, approved) holds the
  document in memory.
- **Changes are whole layers.** Clients send the layers that changed (plus the page list, the name
  and the variables when those change), computed by diffing immutable documents.
- **Every change is validated.** The room applies it to a copy and runs the full `documentProblem`
  check. Valid changes are broadcast; invalid ones (e.g. a child added to a layer someone just
  deleted) are rejected, and the sender gets the server document.
- **The room persists.** It writes to the database after a short pause, using the same revision
  and automatic-version rules as HTTP saves.

## Alternatives considered
- **CRDT (Yjs / Automerge):** per-property merging and offline-first, but a large dependency, and
  it would duplicate the validated document model in a second data structure.
- **Operational transform on Immer patches:** array-index patches (child order) do not compose
  safely across users.
- **Polling with revisions:** simple, but no live cursors, and conflicts become frequent.

## Consequences
- Edits to different layers merge. Simultaneous edits to the same layer are last-writer-wins.
- A single server process owns each room; scaling out would need sticky routing per file or a
  shared bus.
- Local undo cannot always replay after remote changes. It is validated, and the history is
  cleared with a notice when it cannot.
