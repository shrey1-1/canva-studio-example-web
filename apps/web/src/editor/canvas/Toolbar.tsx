import { useEffect, useRef, useState } from 'react';
import {
  ChevronUp,
  Circle,
  Crosshair,
  Frame,
  Grid3x3,
  Hand,
  ImagePlus,
  Magnet,
  Maximize,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenTool,
  Pentagon,
  Redo2,
  Ruler,
  Square,
  Star,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
  MessageCircle,
} from 'lucide-react';
import { useCommentsUi } from '../../collab/CommentsLayer';
import { SHAPE_TOOLS, selectCanRedo, selectCanUndo, useEditor, type CanvasTool, type ShapeTool } from '../../state/editorStore';
import { useUi } from '../../state/uiStore';
import { ACCEPTED_IMAGE_TYPES } from '../../persistence/assetStore';
import { IconButton } from '../../ui/IconButton';
import { insertImages } from '../commands';
import { PLACE_IMAGE_EVENT } from '../shortcuts/useEditorShortcuts';
import { fitToContent, zoomBy, zoomTo } from './viewportActions';

const SHAPES: Record<ShapeTool, { label: string; key?: string; icon: LucideIcon }> = {
  rectangle: { label: 'Rectangle', key: 'R', icon: Square },
  line: { label: 'Line', key: 'L', icon: Minus },
  arrow: { label: 'Arrow', key: 'Shift+L', icon: MoveUpRight },
  ellipse: { label: 'Ellipse', key: 'O', icon: Circle },
  polygon: { label: 'Polygon', icon: Pentagon },
  star: { label: 'Star', icon: Star },
};

const Divider = () => <span aria-hidden="true" className="mx-1 h-5 w-px bg-edge" />;

function ToolButton({ id, label, shortcut, icon: Icon }: { id: CanvasTool; label: string; shortcut?: string; icon: LucideIcon }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <IconButton label={label} shortcut={shortcut} tooltipSide="top" active={tool === id} onClick={() => setTool(id)}>
      <Icon size={15} />
    </IconButton>
  );
}

/** Shape button showing the last used shape, plus a menu of all shapes. */
function ShapeTools() {
  const tool = useEditor((s) => s.tool);
  const last = useEditor((s) => s.lastShapeTool);
  const setTool = useEditor((s) => s.setTool);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = SHAPES[last];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center">
      <IconButton
        label={current.label}
        shortcut={current.key}
        tooltipSide="top"
        active={(SHAPE_TOOLS as readonly string[]).includes(tool)}
        onClick={() => setTool(last)}
      >
        <current.icon size={15} />
      </IconButton>
      <button
        type="button"
        aria-label="Shape tools"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-4 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
      >
        <ChevronUp size={11} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Shape tools"
          className="absolute bottom-9 left-0 z-20 min-w-44 rounded-md border border-edge bg-sidebar py-1 shadow-2xl"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          {SHAPE_TOOLS.map((id) => {
            const s = SHAPES[id];
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={tool === id}
                onClick={() => {
                  setTool(id);
                  setOpen(false);
                }}
                className="flex h-7 w-full items-center gap-2 px-3 text-left text-fg hover:bg-accent hover:text-white focus:bg-accent focus:text-white focus:outline-none"
              >
                <s.icon size={14} aria-hidden="true" />
                <span className="flex-1">{s.label}</span>
                {s.key && <kbd className="text-2xs text-fg-subtle">{s.key}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CommentButton() {
  const placing = useCommentsUi((s) => s.placing);
  const setPlacing = useCommentsUi((s) => s.setPlacing);
  return (
    <IconButton label="Comment" shortcut="C" tooltipSide="top" active={placing} onClick={() => setPlacing(!placing)}>
      <MessageCircle size={15} />
    </IconButton>
  );
}

/** Floating toolbar at the bottom of the canvas. */
export function Toolbar() {
  const zoom = useEditor((s) => s.viewport.zoom);
  const canUndo = useEditor(selectCanUndo);
  const canRedo = useEditor(selectCanRedo);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const { showGrid, showRulers, snapToGrid, smartGuides, toggleGrid, toggleRulers, toggleSnap, toggleSmartGuides } = useUi();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const open = () => fileInput.current?.click();
    window.addEventListener(PLACE_IMAGE_EVENT, open);
    return () => window.removeEventListener(PLACE_IMAGE_EVENT, open);
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-edge bg-sidebar p-1 shadow-xl"
    >
      <ToolButton id="move" label="Move" shortcut="V" icon={MousePointer2} />
      <ToolButton id="hand" label="Hand" shortcut="H" icon={Hand} />
      <ToolButton id="frame" label="Frame" shortcut="F" icon={Frame} />
      <ShapeTools />
      <ToolButton id="pen" label="Pen" shortcut="P" icon={PenTool} />
      <ToolButton id="text" label="Text" shortcut="T" icon={Type} />
      <IconButton label="Place image" shortcut="Ctrl+Shift+K" tooltipSide="top" onClick={() => fileInput.current?.click()}>
        <ImagePlus size={15} />
      </IconButton>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        hidden
        aria-label="Image files"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void insertImages(files);
        }}
      />
      <CommentButton />
      <Divider />
      <IconButton label="Undo" shortcut="Ctrl+Z" tooltipSide="top" disabled={!canUndo} onClick={undo}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label="Redo" shortcut="Ctrl+Shift+Z" tooltipSide="top" disabled={!canRedo} onClick={redo}>
        <Redo2 size={15} />
      </IconButton>
      <Divider />
      <IconButton label={showGrid ? 'Hide grid' : 'Show grid'} shortcut="Ctrl+'" tooltipSide="top" active={showGrid} onClick={toggleGrid}>
        <Grid3x3 size={15} />
      </IconButton>
      <IconButton label={showRulers ? 'Hide rulers' : 'Show rulers'} shortcut="Shift+R" tooltipSide="top" active={showRulers} onClick={toggleRulers}>
        <Ruler size={15} />
      </IconButton>
      <IconButton label={snapToGrid ? 'Snap to grid: on' : 'Snap to grid: off'} tooltipSide="top" active={snapToGrid} onClick={toggleSnap}>
        <Magnet size={15} />
      </IconButton>
      <IconButton label={smartGuides ? 'Smart guides: on' : 'Smart guides: off'} tooltipSide="top" active={smartGuides} onClick={toggleSmartGuides}>
        <Crosshair size={15} />
      </IconButton>
      <Divider />
      <IconButton label="Zoom out" shortcut="Ctrl+-" tooltipSide="top" onClick={() => zoomBy(1 / 1.25)}>
        <ZoomOut size={15} />
      </IconButton>
      <button
        type="button"
        aria-label={`Zoom ${Math.round(zoom * 100)}%. Reset to 100%`}
        title="Reset to 100% (Shift+0)"
        onClick={() => zoomTo(1)}
        className="h-7 w-12 rounded text-center tabular-nums text-fg-muted hover:bg-hover hover:text-fg"
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="Zoom in" shortcut="Ctrl+=" tooltipSide="top" onClick={() => zoomBy(1.25)}>
        <ZoomIn size={15} />
      </IconButton>
      <IconButton label="Zoom to fit" shortcut="Shift+1" tooltipSide="top" onClick={fitToContent}>
        <Maximize size={15} />
      </IconButton>
    </div>
  );
}
