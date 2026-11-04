# 0004. Run custom tools in a Worker inside a sandboxed iframe

Date: 2026-11-04
Status: Accepted

## Context
Phase 4 lets users write their own tools in JavaScript. That code is untrusted: it may be buggy
(endless loops, huge allocations) or hostile (reading the file, sending it somewhere, corrupting
it so it no longer opens). Built-in tools are first-party code and use the same API.

## Decision
- **Isolation:**
  - Custom code runs in a dedicated Worker, created from a `blob:` URL inside an
    `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, so the origin is opaque).
  - The frame has a CSP of `default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:`,
    so no network requests are allowed.
  - Removing the frame kills the worker. That is how timeouts (60 s) and the Stop button work, and
    an endless loop never blocks the editor's thread.
- **Communication:**
  - The only channel is `postMessage`.
  - The host accepts messages only from its own frame (`e.source`). It looks the method up in a
    fixed allow-list (`Object.hasOwn`) and calls `ToolContext`.
  - `ToolContext` checks the manifest's permissions on every call.
- **Untrusted input is validated:**
  - New layers go through `nodeFromSpec`.
  - An update may only touch existing, non-protected fields. Structure, component links,
    variable bindings, asset ids and `__proto__` are ignored. The patched layer must still pass
    `nodeProblem`, so a tool can never leave the file unloadable.
- **Read scope:** with `read-selection`, a tool can read only the selected layers and their
  contents. `read-document` is needed for anything else.
- **Budgets per run:**
  - Size: 20,000 messages, 5,000 layers, 200,000 vector points, 2 M characters and 50 images.
  - Data: 70 MB per message and 300 MB in total, enforced by the relay inside the frame before
    data reaches the editor.
  - Calls are handled one at a time, and edits that arrive after a run ends are refused.
- **Side effects:**
  - Downloads are limited to .svg/.png/.json/.txt/.css/.csv/.md. The MIME type comes from the
    extension, and the user confirms each file by clicking Save on a notice.
  - Notices are prefixed with the tool's name.
  - `createImage` needs the "Add images" (`import-assets`) permission.
- **One undo step:** all edits of a run merge into one undo step (`coalesceKey: tool:<runId>`).

## Alternatives considered
- **`new Function` / `eval` in the page:** no isolation at all.
- **iframe only (no Worker):** a sandboxed `srcdoc` frame may share the editor's thread, so an
  endless loop would freeze the editor.
- **QuickJS/WASM interpreter:** strongest isolation, but a large new dependency and much slower
  for pixel work. Reconsider if tools are ever shared between users.
- **Separate origin for the sandbox:** gives a real CSP header instead of a `<meta>` tag. It
  needs a second host, so it is deferred to the backend phase.

## Consequences
- Network blocking depends on the blob worker inheriting the frame's CSP.
  - The browser test confirms `fetch` is blocked in Chrome.
  - WebSocket, `importScripts` and nested workers, and other browsers, are not covered by
    automated tests yet (planned for Phase 8).
- The sandboxed frame may still share the editor's process. A tool that allocates a lot of
  memory inside its own worker can still slow down or crash the tab.
- Images a tool adds stay in IndexedDB after undo (assets are not garbage-collected yet).
