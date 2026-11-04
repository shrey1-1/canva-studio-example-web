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
| 6. Backend | Node server (Fastify), PostgreSQL (approved), auth & sessions, roles, file/project/folder management, server autosave, version history, asset storage | **Done** |
| 7. Integrations | Real-time collaboration (WebSockets via `ws` (approved), presence, comments, conflict handling), MCP server (official SDK, approved) for agents with permission scopes, Agents workspace, advanced export (PNG/JPG/SVG/PDF) | **Done** |
| 8. Hardening | Performance (large documents, code-splitting), integration/E2E suites, accessibility pass, bug fixing | **Done** |

## Known limitations (after Phase 8)

- Prototyping: no Smart Animate (matching layers between screens), no keyboard/gamepad triggers,
  no fixed-position (sticky) layers while scrolling, and no device frames around the preview.
  Links inside a copied screen still point at the original screens.
- Tools:
  - Custom tools are stored in this browser only; they cannot be shared or published yet.
  - Sandbox network blocking is tested in Chrome (`fetch`); other request types and other browsers
    are not covered by automated tests yet (Phase 8). See ADR 0004.
  - Generative tools (Nebula, Clouds, Fractal Noise, Airbrush, Mockups) are procedural and run
    locally; no AI service is connected.
- Accounts and server:
  - Email + password only: no email verification, password reset or OAuth sign-in yet. Sharing
    needs the other person to have an account already.
- Collaboration: concurrent edits merge per layer; two people changing the *same* layer at the same
  moment resolve last-writer-wins (no per-property merge). Undo history is cleared if a
  collaborator changed the layers an undo step refers to. Edits made while offline are re-sent on
  reconnect; closing the tab while offline loses them.
- Export: PDF pages are images (text not selectable). SVG export does not draw line end caps and
  approximates fixed-width text wrapping with explicit line breaks only.
- Agents (MCP) measure text approximately when they add text; the editor re-measures on open.
  - The sign-in rate limit is kept in memory, which is fine for one server process.
  - Unused images are removed by a sweep (start-up and every 6 hours, after a 1-hour grace period).
  - Sign-up asks users to confirm they are 16 or older (self-declared, not verified).
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

## Phase 8 (hardening) summary

- Code-splitting: screens and tool dialogs load on demand; vendor chunks (React, Konva) are
  cached separately. No chunk is over 500 kB; the sign-in screen loads about 100 kB gzipped.
- Performance budget tests for a 5,100-layer file (validation, layout, diff, SVG export).
- Browser test suite in the repo (`npm run e2e`, Playwright with the installed Chrome) covering
  editing, tools and the sandbox, prototyping, accounts, sharing and roles, live collaboration,
  comments, versions, all export formats, an MCP agent over stdio, and an axe WCAG 2.1 AA audit.
- Accessibility: contrast fixed for all text colours (AA), accessible names checked by axe.
- Account data rights: download my data (JSON) and delete account.
- Light visual design (design-system tokens, Host Grotesk / Instrument Sans) with a stacked
  file browser below 760px. The editor itself is built for desktop widths.
