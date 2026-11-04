# Canvas Studio

A browser-based visual design editor: frames, shapes, layers, an inspector, a tools/plugin
ecosystem, prototyping and (later) collaboration and AI-agent integration.

**Status:** Phases 1-5 complete (foundation, core editor, design system, tools ecosystem, prototyping). See [docs/PLAN.md](docs/PLAN.md) for the roadmap.

## Requirements

- Node.js **22.12+** (tested on 24.11)
- npm 10+

## Setup

```powershell
cd canvas-studio
npm install
```

## Run

```powershell
npm run dev        # editor at http://localhost:5173
npm run build      # production build -> apps/web/dist
npm run preview    # serve the production build
```

## Quality checks

```powershell
npm run typecheck  # TypeScript, all workspaces
npm test           # unit + component tests (Vitest)
npm run check      # both
```

## Project layout

```
packages/core/   Framework-independent document model, operations, viewport math, tool catalog
apps/web/        React editor (Vite, Tailwind, Zustand, Konva)
docs/            Architecture, plan, decision records (docs/adr)
```

## Using the editor

| Action | How |
|---|---|
| Draw frame / rectangle / ellipse | `F` / `R` / `O`, then drag on the canvas (click = 100×100, Shift = square) |
| Line / arrow / polygon / star | `L` / `Shift+L`, or the shape menu (arrow next to the shape button) |
| Pen | `P`: click to add points, drag for curves, click the first point to close, Enter to finish |
| Text | `T`: click for auto-width text, drag for a fixed-width box. Double-click text (or Enter) to edit |
| Images | Toolbar image button / `Ctrl+Shift+K`, drag files onto the canvas, or paste an image |
| Select, multi-select | Click, Shift+click, or drag a marquee (canvas or Layers panel) |
| Groups | Click selects the group; double-click selects inside it. `Ctrl+G` / `Ctrl+Shift+G` |
| Frame selection / mask | `Ctrl+Alt+G` / `Ctrl+Alt+M` |
| Move / resize / rotate | Drag (smart guides snap to other layers; drop onto a frame to move it inside); handles |
| Copy / cut / paste / duplicate | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` (works across tabs) |
| Stacking order | `Ctrl+]` / `Ctrl+[` (+Shift for front/back), or drag rows in the Layers panel |
| More actions | Right-click a layer or the canvas |
| Components | `Ctrl+Alt+K` makes a component; insert instances from **Assets** (click or drag). Right-click: combine as variants, go to main, reset overrides, detach (`Ctrl+Alt+B`) |
| Auto layout | `Shift+A` on a frame or layers; set direction, gap, padding, alignment, Hug/Fill in the Design panel |
| Constraints / presets | Constraints section for layers in a frame; size presets in Layout, or pick the Frame tool to see them |
| Variables | **Variables** section: collections, modes, values. Bind from the Design panel's *Variables* section; choose a frame's mode under *Variable modes* |
| Tools | **Tools** section: run any of the 13 built-in tools (one undo step per run). **Create** writes a custom tool; it runs in a sandbox with only the permissions you tick (see docs/adr/0004) |
| Prototype | **Prototype** tab: pick the starting screen; select a layer and click + for an interaction (click, hover, press, drag, after delay → navigate, back, overlay, scroll to, open link) with an animation. **Present** plays it: ← back, R restart, Esc exit |
| Pan | Scroll, Space+drag, middle mouse, or `H` |
| Zoom | Ctrl+scroll, Ctrl+= / Ctrl+-, Shift+0 (100%), Shift+1 (fit) |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Delete, nudge | Delete; arrow keys (Shift = 10px) |
| Rename | Double-click a file, page or layer name |
| Save | Automatic (0.8s after edits stop); Ctrl+S saves immediately |
| Present | **Present** button; Esc to exit |

Documents are stored in this browser's localStorage and images in its IndexedDB until the backend
arrives in Phase 6.
