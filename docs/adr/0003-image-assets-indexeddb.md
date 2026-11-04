# 0003. Store image binaries in IndexedDB, keyed by content hash

Date: 2026-11-04
Status: Accepted

## Context
Phase 2 adds images. Documents are saved as JSON in localStorage, which is limited to about 5 MB
per site; a few photos would fill it and break saving for every file.

## Decision
- Image bytes go into an IndexedDB object store (`canvas-studio` / `assets`) behind an
  `AssetStore` interface. Documents only store `assetId`, the natural size and display settings.
- `assetId` is the SHA-256 of the file bytes, so importing the same image twice stores it once,
  and copy/paste between files in the same browser just works.
- Imports are validated by magic bytes (PNG, JPEG, GIF, WebP), size (up to 20 MB) and decoded
  dimensions (up to 16384 px). SVG is refused because it can contain scripts and external references.

## Alternatives considered
- **Data URLs inside the document**: simplest, but bloats every save and hits the localStorage
  quota almost immediately.
- **Moving the whole document store to IndexedDB now**: possible, but the backend (Phase 6) will
  replace browser storage anyway; only the large binaries need to move today.

## Consequences
- A file opened in a different browser shows "Image not available in this browser" placeholders
  until Phase 6 uploads assets to the server (the `AssetStore` interface is the swap point).
- Unused images are not garbage-collected yet.
- Unit tests use `MemoryAssetStore`; the IndexedDB implementation is covered by the browser E2E run.
