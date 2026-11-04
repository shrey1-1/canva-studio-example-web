import { fitBounds, selectionBounds, zoomAt, type Rect } from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';

/** Page-space bounds of the active page's top-level visible layers (rotation-aware). */
export function pageContentBounds(): Rect | null {
  const { doc, activePageId } = useEditor.getState();
  const page = doc.pages.find((p) => p.id === activePageId);
  if (!page) return null;
  return selectionBounds(doc, page.childIds.filter((id) => doc.nodes[id]?.visible));
}

export function zoomBy(factor: number) {
  const { viewport, canvasSize, setViewport } = useEditor.getState();
  const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
  setViewport(zoomAt(viewport, viewport.zoom * factor, center));
}

export function zoomTo(zoom: number) {
  const { viewport, canvasSize, setViewport } = useEditor.getState();
  setViewport(zoomAt(viewport, zoom, { x: canvasSize.width / 2, y: canvasSize.height / 2 }));
}

/** Fits all content on the page; with an empty page, centres the page origin at 100%. */
export function fitToContent() {
  const { canvasSize, setViewport } = useEditor.getState();
  if (canvasSize.width === 0) return;
  const bounds = pageContentBounds();
  if (!bounds) {
    setViewport({ x: canvasSize.width / 2 - 200, y: canvasSize.height / 2 - 150, zoom: 1 });
    return;
  }
  setViewport(fitBounds(bounds, canvasSize, 80, 1));
}
