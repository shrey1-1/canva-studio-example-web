import { memo, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Group, Image as KImage, Path, Rect, Text } from 'react-konva';
import Konva from 'konva';
import {
  isOpenPath,
  localMatrix,
  nodeOutline,
  toSvgPath,
  type DesignDocument,
  type DropShadowEffect,
  type ImageNode,
  type LineCap,
  type LineNode,
  type NodeId,
  type SceneNode,
  type TextNode,
} from '@canvas-studio/core';
import { getImageEntry, getImageVersion, subscribeImages } from '../../persistence/assetStore';

const MAX_CACHE_SIDE = 8192;
import { useEditor } from '../../state/editorStore';
import { toRgba } from './paint';
import { konvaTextProps } from './textMeasure';
import { traceTransformed } from './konvaPath';

interface Props {
  doc: DesignDocument;
  ids: readonly NodeId[];
  /** When false, nothing listens for events (presentation / thumbnails). */
  interactive: boolean;
  zoom: number;
  /** Show frame name labels above top-level frames. */
  showFrameLabels?: boolean;
}

/** Konva name given to every node's root group; hit testing walks up to it. */
export const SCENE_NODE = 'scene-node';
export const FRAME_LABEL = 'frame-label';
/** Accent used for components, instances and component sets. */
export const COMPONENT_COLOR = '#A855F7';

/** Renders a list of sibling nodes (bottom-most first) and their descendants. */
export function SceneNodes({ ids, ...props }: Props) {
  return <>{renderSiblings(props, ids)}</>;
}

/**
 * A visible mask clips every sibling above it, so those siblings are rendered inside a
 * group whose clip is the mask's outline. A later mask nests inside the first.
 */
function renderSiblings(props: Omit<Props, 'ids'>, ids: readonly NodeId[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < ids.length; i++) {
    const node = props.doc.nodes[ids[i]!];
    out.push(<NodeView key={ids[i]} {...props} node={node} topLevel={props.showFrameLabels ?? false} />);
    if (node?.isMask && node.visible) {
      const rest = ids.slice(i + 1);
      if (rest.length > 0) {
        const outline = nodeOutline(node);
        const m = localMatrix(node);
        out.push(
          <Group key={`mask:${node.id}`} clipFunc={(ctx) => traceTransformed(ctx, outline, m)}>
            {renderSiblings(props, rest)}
          </Group>,
        );
      }
      break;
    }
  }
  return out;
}

type NodeViewProps = Omit<Props, 'ids' | 'showFrameLabels'> & { node: SceneNode | undefined; topLevel: boolean };

const visibleShadow = (node: SceneNode) =>
  node.effects.find((e): e is DropShadowEffect => e.type === 'drop-shadow' && e.visible);
const visibleBlur = (node: SceneNode) => node.effects.find((e) => e.type === 'layer-blur' && e.visible && e.radius > 0);

function shadowProps(node: SceneNode) {
  const s = visibleShadow(node);
  return s
    ? { shadowColor: toRgba(s.color, s.opacity), shadowOffsetX: s.x, shadowOffsetY: s.y, shadowBlur: s.blur, shadowForStrokeEnabled: true }
    : {};
}

const NodeView = memo(function NodeView(props: NodeViewProps) {
  const { node, interactive, zoom } = props;
  const groupRef = useRef<Konva.Group>(null);
  const editingText = useEditor((s) => s.textEdit?.id === node?.id);
  const blur = node ? visibleBlur(node) : undefined;
  const blurRadius = blur?.type === 'layer-blur' ? blur.radius : 0;
  // Blurred layers are rasterised; redraw them when an image inside finishes loading.
  useSyncExternalStore(subscribeImages, () => (blurRadius > 0 ? getImageVersion() : 0));

  // Layer blur needs the group rasterised (cached) and filtered; re-cache after every render.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    if (blurRadius > 0) {
      // Keep the cached bitmap under ~8k px per side, whatever the layer size and zoom.
      const box = g.getClientRect({ skipTransform: true });
      const side = Math.max(box.width, box.height) + blurRadius * 4;
      const pixelRatio = Math.min(4, Math.max(0.05, zoom * (window.devicePixelRatio || 1)), MAX_CACHE_SIDE / Math.max(1, side));
      g.cache({ pixelRatio, offset: blurRadius * 2 });
      g.filters([Konva.Filters.Blur]);
      g.blurRadius(blurRadius * pixelRatio);
    } else if (g.isCached()) {
      g.clearCache();
      g.filters([]);
    }
  });

  if (!node || !node.visible) return null;
  const listening = interactive && !node.locked;

  return (
    <Group
      ref={groupRef}
      id={node.id}
      name={SCENE_NODE}
      x={node.x}
      y={node.y}
      rotation={node.rotation}
      // A mask defines a clip region but is not painted itself.
      opacity={node.isMask ? 0 : node.opacity}
      listening={listening}
    >
      <NodeContent {...props} node={node} listening={listening} editingText={editingText} />
    </Group>
  );
}, nodePropsEqual);

function NodeContent({
  node,
  doc,
  interactive,
  zoom,
  topLevel,
  listening,
  editingText,
}: NodeViewProps & { node: SceneNode; listening: boolean; editingText: boolean }) {
  switch (node.type) {
    case 'frame':
    case 'component':
    case 'component-set':
    case 'instance': {
      const children = <SceneNodes doc={doc} ids={node.childIds} interactive={interactive} zoom={zoom} />;
      const isComponentish = node.type !== 'frame';
      // Components, sets and instances get a purple diamond label; sets show a dashed outline.
      const label = isComponentish ? `${node.type === 'instance' ? '◇' : '❖'} ${node.name}` : node.name;
      return (
        <>
          {(topLevel || node.type === 'component-set' || (node.type === 'component' && doc.nodes[node.parentId ?? '']?.type === 'component-set')) && (
            <Text
              name={FRAME_LABEL}
              text={label}
              y={-16 / zoom}
              fontSize={11 / zoom}
              fill={isComponentish ? COMPONENT_COLOR : '#6B7280'}
              listening={listening}
              perfectDrawEnabled={false}
            />
          )}
          {node.type === 'component-set' && (
            <Rect width={node.width} height={node.height} stroke={COMPONENT_COLOR} strokeWidth={1 / zoom} dash={[6 / zoom, 4 / zoom]} cornerRadius={node.cornerRadius} listening={false} />
          )}
          <ShapePaints node={node} zoom={zoom} strokes={false} />
          <Group
            clipFunc={
              node.clipContent
                ? (ctx) => {
                    const r = Math.min(node.cornerRadius, node.width / 2, node.height / 2);
                    ctx.beginPath();
                    ctx.roundRect(0, 0, node.width, node.height, r);
                    ctx.closePath();
                  }
                : undefined
            }
          >
            {children}
          </Group>
          <ShapePaints node={node} zoom={zoom} fills={false} />
        </>
      );
    }
    case 'group':
      return <SceneNodes doc={doc} ids={node.childIds} interactive={interactive} zoom={zoom} />;
    case 'text':
      return <TextContent node={node} hidden={editingText} />;
    case 'image':
      return <ImageContent node={node} />;
    case 'line':
      return <LineContent node={node} zoom={zoom} />;
    default:
      return <ShapePaints node={node} zoom={zoom} />;
  }
}

/** Draws the node outline once per visible fill (bottom first), then once per stroke. */
function ShapePaints({ node, zoom, fills = true, strokes = true }: { node: SceneNode; zoom: number; fills?: boolean; strokes?: boolean }) {
  const data = useMemo(() => toSvgPath(nodeOutline(node)), [node]);
  const open = isOpenPath(node);
  const visibleFills = fills && !open ? node.fills.filter((p) => p.visible) : [];
  const visibleStrokes = strokes ? node.strokes.filter((s) => s.visible && s.width > 0) : [];
  const shadow = shadowProps(node);
  let shadowUsed = false;
  const takeShadow = () => {
    if (shadowUsed) return {};
    shadowUsed = true;
    return shadow;
  };

  return (
    <>
      {/* Keeps shapes without paint clickable. */}
      {fills && visibleFills.length === 0 && !open && <Path data={data} fill="rgba(0,0,0,0)" perfectDrawEnabled={false} />}
      {visibleFills.map((p, i) => (
        <Path key={`f${i}`} data={data} fill={toRgba(p.color, p.opacity)} perfectDrawEnabled={false} {...takeShadow()} />
      ))}
      {visibleStrokes.map((s, i) => (
        <Path
          key={`s${i}`}
          data={data}
          stroke={toRgba(s.color, s.opacity)}
          strokeWidth={s.width}
          lineJoin="round"
          lineCap="round"
          fillEnabled={false}
          hitStrokeWidth={Math.max(s.width, 10 / zoom)}
          perfectDrawEnabled={false}
          {...takeShadow()}
        />
      ))}
      {open && visibleStrokes.length === 0 && strokes && (
        <Path data={data} stroke="rgba(0,0,0,0)" strokeWidth={1} hitStrokeWidth={10 / zoom} fillEnabled={false} />
      )}
    </>
  );
}

/** Length of an arrow head / end cap for a given stroke width. */
const capSize = (strokeWidth: number) => Math.max(8, strokeWidth * 4);

function capShape(cap: LineCap, x: number, dir: 1 | -1, sw: number, color: string, key: string) {
  const L = capSize(sw);
  const H = L * 0.6;
  if (cap === 'arrow') {
    const back = x - dir * L;
    return (
      <Path key={key} data={`M${back} ${-H} L${x} 0 L${back} ${H}`} stroke={color} strokeWidth={sw} lineCap="round" lineJoin="round" fillEnabled={false} listening={false} />
    );
  }
  if (cap === 'triangle') {
    const back = x - dir * L;
    return <Path key={key} data={`M${back} ${-H} L${x} 0 L${back} ${H} Z`} fill={color} listening={false} />;
  }
  if (cap === 'circle') {
    const r = Math.max(3, sw * 1.5);
    return <Path key={key} data={`M${x - r} 0 a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`} fill={color} listening={false} />;
  }
  return null;
}

function LineContent({ node, zoom }: { node: LineNode; zoom: number }) {
  const strokes = node.strokes.filter((s) => s.visible && s.width > 0);
  const top = strokes[strokes.length - 1];
  const sw = top?.width ?? 1;
  // Pull the line back under filled caps so its blunt end does not poke past the tip.
  const inset = (cap: LineCap) => (cap === 'triangle' ? capSize(sw) * 0.5 : 0);
  const x0 = Math.min(inset(node.startCap), node.width / 2);
  const x1 = Math.max(node.width - inset(node.endCap), node.width / 2);
  const shadow = shadowProps(node);
  return (
    <>
      {/* Gives the selection box the stroke's thickness (a line has no height). */}
      <Rect y={-sw / 2} width={node.width} height={sw} fill="rgba(0,0,0,0)" />
      {strokes.map((s, i) => (
        <Path
          key={i}
          data={`M${x0} 0 L${x1} 0`}
          stroke={toRgba(s.color, s.opacity)}
          strokeWidth={s.width}
          lineCap={node.startCap === 'none' && node.endCap === 'none' ? 'butt' : 'round'}
          hitStrokeWidth={Math.max(s.width, 10 / zoom)}
          perfectDrawEnabled={false}
          {...(i === 0 ? shadow : {})}
        />
      ))}
      {top && capShape(node.startCap, 0, -1, sw, toRgba(top.color, top.opacity), 'start')}
      {top && capShape(node.endCap, node.width, 1, sw, toRgba(top.color, top.opacity), 'end')}
    </>
  );
}

function TextContent({ node, hidden }: { node: TextNode; hidden: boolean }) {
  const base = konvaTextProps(node);
  const box = {
    width: node.autoResize === 'width-and-height' ? undefined : node.width,
    height: node.autoResize === 'none' ? node.height : undefined,
    wrap: node.autoResize === 'width-and-height' ? 'none' : 'word',
  };
  const fills = node.fills.filter((p) => p.visible);
  const strokes = node.strokes.filter((s) => s.visible && s.width > 0);
  const shadow = shadowProps(node);
  return (
    <Group visible={!hidden}>
      <Rect width={node.width} height={node.height} fill="rgba(0,0,0,0)" />
      {fills.map((p, i) => (
        <Text key={`f${i}`} {...base} {...box} fill={toRgba(p.color, p.opacity)} perfectDrawEnabled={false} {...(i === 0 ? shadow : {})} />
      ))}
      {strokes.map((s, i) => (
        <Text key={`s${i}`} {...base} {...box} fillEnabled={false} stroke={toRgba(s.color, s.opacity)} strokeWidth={s.width} perfectDrawEnabled={false} />
      ))}
    </Group>
  );
}

function useImageEntry(assetId: string) {
  return useSyncExternalStore(subscribeImages, () => getImageEntry(assetId));
}

/** Where to draw the image inside the box, and which part of the source to use. */
export function imageLayout(node: ImageNode) {
  const W = node.naturalWidth;
  const H = node.naturalHeight;
  const w = node.width;
  const h = node.height;
  switch (node.fit) {
    case 'stretch':
      return { x: 0, y: 0, width: w, height: h, crop: { x: 0, y: 0, width: W, height: H } };
    case 'fit': {
      const s = Math.min(w / W, h / H);
      return { x: (w - W * s) / 2, y: (h - H * s) / 2, width: W * s, height: H * s, crop: { x: 0, y: 0, width: W, height: H } };
    }
    case 'crop':
      return {
        x: 0,
        y: 0,
        width: w,
        height: h,
        crop: { x: node.crop.x * W, y: node.crop.y * H, width: node.crop.width * W, height: node.crop.height * H },
      };
    case 'fill':
    default: {
      const s = Math.max(w / W, h / H) || 1;
      const cw = w / s;
      const ch = h / s;
      return { x: 0, y: 0, width: w, height: h, crop: { x: (W - cw) / 2, y: (H - ch) / 2, width: cw, height: ch } };
    }
  }
}

function ImageContent({ node }: { node: ImageNode }) {
  const entry = useImageEntry(node.assetId);
  const r = Math.min(node.cornerRadius, node.width / 2, node.height / 2);
  const fontSize = Math.max(8, Math.min(14, node.width / 14));
  return (
    <>
      <ShapePaints node={node} zoom={1} strokes={false} />
      <Group
        clipFunc={(ctx) => {
          ctx.beginPath();
          ctx.roundRect(0, 0, node.width, node.height, r);
          ctx.closePath();
        }}
      >
        {entry.status === 'ready' ? (
          <KImage image={entry.image} {...imageLayout(node)} {...shadowProps(node)} />
        ) : (
          <>
            <Rect width={node.width} height={node.height} fill={entry.status === 'loading' ? '#E4E4E7' : '#3F3F46'} />
            <Text
              width={node.width}
              height={node.height}
              align="center"
              verticalAlign="middle"
              padding={4}
              fontSize={fontSize}
              fill={entry.status === 'loading' ? '#52525B' : '#E4E4E7'}
              text={entry.status === 'loading' ? 'Loading image…' : 'Image not available in this browser'}
              listening={false}
            />
          </>
        )}
      </Group>
      <ShapePaints node={node} zoom={1} fills={false} />
    </>
  );
}

/**
 * Immer keeps unchanged nodes referentially equal, so a leaf only re-renders when its own
 * node object changes. Containers also depend on `doc` (to resolve children). Zoom matters
 * for frame labels, hit widths of thin strokes, and the resolution of blurred layers.
 */
function nodePropsEqual(prev: NodeViewProps, next: NodeViewProps): boolean {
  if (prev.node !== next.node || prev.interactive !== next.interactive || prev.topLevel !== next.topLevel) return false;
  const node = next.node;
  if (!node) return true;
  if ('childIds' in node && prev.doc !== next.doc) return false;
  if (prev.zoom !== next.zoom) {
    const zoomDependent =
      ('childIds' in node && node.type !== 'group') ||
      node.type === 'line' ||
      node.type === 'vector' ||
      node.strokes.length > 0 ||
      visibleBlur(node) !== undefined;
    if (zoomDependent) return false;
  }
  return true;
}
