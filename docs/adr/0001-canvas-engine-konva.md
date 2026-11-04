# 0001. Use Konva (react-konva) as the canvas engine

Date: 2026-11-04
Status: Accepted

## Context
The editor needs fast 2D rendering of thousands of objects, hit-testing, selection with
resize/rotate handles, layering, clipping and raster export, while React drives the UI.

## Decision
Konva 10 with react-konva 19, rendering from our own normalised document model.

## Alternatives considered
- **Fabric.js** — rich features and SVG export, but its imperative object model duplicates
  state and fights React, making layers/inspector sync harder.
- **Custom SVG** — trivial SVG export, but DOM-per-node performance degrades on large documents
  and every handle/guide must be hand-built.
- **Raw Canvas API** — maximum control, but hit-testing, transforms and handles are weeks of work.

## Consequences
- Selection handles (`Transformer`), hit detection and PNG/JPG export come built in.
- SVG and PDF export will be generated from the document model, not from Konva (Phase 7).
- Konva cannot render in jsdom, so canvas behaviour is verified with browser end-to-end tests;
  logic lives in `core` and is unit tested.
