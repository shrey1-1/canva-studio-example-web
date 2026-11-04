# Implementation plan

Each phase ends with typecheck + tests + a browser end-to-end check, and a report.
Later phases build on the `core` model and the `DocumentRepository` boundary.

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Monorepo, theme, layout (nav rail, contextual panel, canvas, inspector), routing, Konva canvas with zoom/pan/grid/rulers, frame/rect/ellipse drawing, selection, drag, resize/rotate, layers, pages, inspector basics, undo/redo, local autosave, present mode, tools discovery (search/filter/install) | **Done** |
| 2. Core editor | Text, images (upload/crop/mask), line/arrow/polygon/star/vector paths, copy/cut/paste/duplicate, group/ungroup, layer reordering & reparenting, context menus, alignment guides & smart snapping, effects (shadow/blur UI), multiple fills/strokes | **Done** |
| 3. Design system | Components, instances, overrides, variants, nested components, Auto Layout (direction, padding, gap, hug/fill/fixed, min/max), constraints, responsive frame presets, Variables (collections, modes, bindings), Assets workspace | **Done** |
| 4. Tools ecosystem | Sandboxed plugin runtime (iframe/worker + permission-checked API), Create/register custom tool, and the 13 tools: Image to Vector, Bento Grid, Phone Mockup, Auto-Slide, Flipbook, Sticker Pack, Token Exporter, Generate Mockup, Nebula, Pixel Stretch, Fractal Noise, Grainy Airbrush, Clouds | **Done** |
| 5. Prototyping | Interactions (click/hover/drag), navigation, overlays, scroll, transitions, preview engine | **Done** |
| 6. Backend | Node server (Fastify), PostgreSQL (approved), auth & sessions, roles, file/project/folder management, server autosave, version history, asset storage | Next |
| 7. Integrations | Real-time collaboration (WebSockets via `ws` (approved), presence, comments, conflict handling), MCP server (official SDK, approved) for agents with permission scopes, Agents workspace, advanced export (PNG/JPG/SVG/PDF) | |
| 8. Hardening | Performance (large documents, code-splitting), integration/E2E suites, accessibility pass, bug fixing | |

## Known limitations (after Phase 5)

- The Agents section shows an honest "planned" state (Phase 7).
- Prototyping: no Smart Animate (matching layers between screens), no keyboard/gamepad triggers,
  no fixed-position (sticky) layers while scrolling, and no device frames around the preview.
  Links inside a copied screen still point at the original screens.
- Tools:
  - Custom tools are stored in this browser only; they cannot yet be shared or published (Phase 6/7).
  - Sandbox network blocking is tested in Chrome (`fetch`); other request types and other browsers
    are not covered by automated tests yet (Phase 8). See ADR 0004.
  - Generative tools (Nebula, Clouds, Fractal Noise, Airbrush, Mockups) are procedural and run
    locally; no AI service is connected.
- Accounts are a local display name only (Phase 6).
- Images live in this browser's IndexedDB. A file opened in another browser shows "Image not
  available" placeholders until server asset storage arrives (Phase 6). Unused images are not
  garbage-collected yet.
- Vector paths are drawn with the pen tool; editing individual points after creation is not
  implemented yet (planned for Phase 8).
- Image crop is set numerically in the inspector (left/top/width/height %); there are no on-canvas
  crop handles yet.
- Only solid paints. Gradients and image fills are not implemented yet.
- One drop shadow and one layer blur per layer. Groups have no effects; inner shadow and background
  blur are not implemented.
- Masks clip by the mask layer's outline (vector shape), not by its pixel alpha; text and image masks
  clip by their box.
- Smart guides snap edges and centres while moving; resizing with handles and drawing do not snap to
  other layers yet (grid snapping still applies to drawing).
- Resizing a group whose children are rotated scales each child along its own axes, so the result
  can differ slightly from the handles' box (exact skew-free scaling is not implemented).
- Components: a main component cannot contain another main component (instances of other components
  are fine). Deleting a main component detaches its instances into frames (undo restores them).
- Switching an instance to another variant keeps overrides on the instance itself but not on its inner
  layers (they belong to the previous variant's layers).
- Auto layout: no wrapping, no absolutely-positioned children inside auto-layout frames, and
  rotated children are straightened. Baseline alignment is not available.
- Variables: no aliases (a variable referring to another), no scoping rules, and opacity variables
  are percentages. Variables are per file (no shared libraries until the backend exists).
- Fonts are limited to ones installed on all major desktop systems (Arial, Georgia, ...); web-font
  loading comes later.
- Production bundle is ~270 KB gzip in one chunk; code-splitting is scheduled for Phase 8.
