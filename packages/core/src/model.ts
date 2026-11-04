import type { Interaction, ScrollOverflow } from './prototype';

/**
 * Canvas Studio document model.
 *
 * Nodes are stored in a flat map keyed by id (normalised). Hierarchy is expressed
 * with `parentId` + ordered `childIds` on containers and pages. This keeps lookups,
 * undo patches, the layer panel, plugins and (later) real-time sync simple.
 *
 * Coordinates: a node's `x`/`y` are relative to its parent container
 * (or to the page origin for top-level nodes). Rotation is in degrees, around the
 * node's top-left corner (matches Konva's default origin).
 *
 * Schema history: v1 (Phase 1) -> v2 adds text/image/line/polygon/star/vector nodes and
 * `isMask` -> v3 adds components/instances, auto layout, constraints, sizing and variables.
 * Stored documents are upgraded by `migrateDocument` (migrate.ts).
 */

export type NodeId = string;
export type PageId = string;
export type DocumentId = string;
export type AssetId = string;

export const SCHEMA_VERSION = 3 as const;
export type VariableId = string;
export type CollectionId = string;
export type ModeId = string;

export interface SolidPaint {
  type: 'solid';
  /** Hex colour, `#RRGGBB`. */
  color: string;
  /** 0..1 */
  opacity: number;
  visible: boolean;
}

/** More paint types (gradients, images) are added in later phases. */
export type Paint = SolidPaint;

export interface Stroke {
  color: string;
  width: number;
  opacity: number;
  visible: boolean;
}

export interface DropShadowEffect {
  type: 'drop-shadow';
  color: string;
  x: number;
  y: number;
  blur: number;
  opacity: number;
  visible: boolean;
}

export interface LayerBlurEffect {
  type: 'layer-blur';
  radius: number;
  visible: boolean;
}

export type Effect = DropShadowEffect | LayerBlurEffect;
export type EffectType = Effect['type'];

export type ConstraintH = 'left' | 'right' | 'left-right' | 'center' | 'scale';
export type ConstraintV = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale';

/** How a layer follows its parent frame when the frame is resized (no auto layout). */
export interface Constraints {
  horizontal: ConstraintH;
  vertical: ConstraintV;
}

/** fixed = own size; hug = wrap content (auto-layout frames, text); fill = take the space left in an auto-layout parent. */
export type SizingMode = 'fixed' | 'hug' | 'fill';

/** Node properties that can be bound to a variable (see variables.ts). */
export type BindableField =
  | 'fill'
  | 'stroke'
  | 'opacity'
  | 'cornerRadius'
  | 'width'
  | 'height'
  | 'gap'
  | 'padding'
  | 'fontSize'
  | 'characters'
  | 'visible';

interface BaseNode {
  id: NodeId;
  name: string;
  pageId: PageId;
  /** `null` when the node sits directly on the page. */
  parentId: NodeId | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Layer opacity, 0..1 */
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** When true the node's outline clips the siblings above it (in the same parent). */
  isMask: boolean;
  /** Painted bottom-first: the last paint is on top. */
  fills: Paint[];
  strokes: Stroke[];
  effects: Effect[];
  constraints: Constraints;
  sizing: { horizontal: SizingMode; vertical: SizingMode };
  minWidth: number | null;
  maxWidth: number | null;
  minHeight: number | null;
  maxHeight: number | null;
  /** Set on layers inside an instance: the matching layer in the main component. */
  componentNodeId?: NodeId;
  /** Instance layers (and instances): properties changed locally, kept when the component changes. */
  overrides?: string[];
  /** Properties driven by variables. */
  bindings?: Partial<Record<BindableField, VariableId>>;
  /** Prototype interactions (click, hover, ...) that run in the preview. */
  interactions?: Interaction[];
}

export type PrimaryAlign = 'start' | 'center' | 'end' | 'space-between';
export type CounterAlign = 'start' | 'center' | 'end';

export interface AutoLayout {
  direction: 'horizontal' | 'vertical';
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  primaryAlign: PrimaryAlign;
  counterAlign: CounterAlign;
}

interface FrameLikeBase extends BaseNode {
  childIds: NodeId[];
  cornerRadius: number;
  clipContent: boolean;
  /** null = children are positioned freely (and follow constraints). */
  layout: AutoLayout | null;
  /** Variable mode chosen per collection for this frame and everything inside it. */
  variableModes?: Record<CollectionId, ModeId>;
  /** Prototype: how a screen scrolls when its content is larger than the frame. */
  scroll?: ScrollOverflow;
}

export interface FrameNode extends FrameLikeBase {
  type: 'frame';
}

/** A reusable main component. In a component set, `variantProps` names this variant. */
export interface ComponentNode extends FrameLikeBase {
  type: 'component';
  description: string;
  variantProps: Record<string, string>;
}

/** Holds the variants (components) of one component. */
export interface ComponentSetNode extends FrameLikeBase {
  type: 'component-set';
}

/** A live copy of a component; its layers are synced from the component except overrides. */
export interface InstanceNode extends FrameLikeBase {
  type: 'instance';
  componentId: NodeId;
}

export type FrameLikeNode = FrameNode | ComponentNode | ComponentSetNode | InstanceNode;

/** A group's bounds always wrap its children (see `normalizeGroups`). */
export interface GroupNode extends BaseNode {
  type: 'group';
  childIds: NodeId[];
}

export interface RectangleNode extends BaseNode {
  type: 'rectangle';
  cornerRadius: number;
}

export interface EllipseNode extends BaseNode {
  type: 'ellipse';
}

/** Regular polygon inscribed in the node's box (first point at the top). */
export interface PolygonNode extends BaseNode {
  type: 'polygon';
  /** 3..60 */
  pointCount: number;
}

export interface StarNode extends BaseNode {
  type: 'star';
  /** 3..60 */
  pointCount: number;
  /** Inner radius as a fraction of the outer radius, 0.01..1 */
  innerRadius: number;
}

export type LineCap = 'none' | 'arrow' | 'triangle' | 'circle';

/** A straight line from (0,0) to (width,0) in local space; direction comes from `rotation`. */
export interface LineNode extends BaseNode {
  type: 'line';
  startCap: LineCap;
  endCap: LineCap;
}

/** A path vertex; `in*`/`out*` are bezier handle offsets relative to the vertex (0 = none). */
export interface VectorVertex {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

export interface VectorNode extends BaseNode {
  type: 'vector';
  /** In local coordinates; the node box is the path's bounding box. */
  vertices: VectorVertex[];
  closed: boolean;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type TextDecoration = 'none' | 'underline' | 'line-through';
/** How the box follows the text: grow both ways, grow height at a fixed width, or fixed box. */
export type TextAutoResize = 'width-and-height' | 'height' | 'none';

/** Text colour comes from `fills`. */
export interface TextNode extends BaseNode {
  type: 'text';
  characters: string;
  fontFamily: string;
  fontSize: number;
  /** 100..900 */
  fontWeight: number;
  italic: boolean;
  textAlign: TextAlign;
  /** Multiple of the font size. */
  lineHeight: number;
  /** In pixels. */
  letterSpacing: number;
  textDecoration: TextDecoration;
  autoResize: TextAutoResize;
}

export type ImageFit = 'fill' | 'fit' | 'stretch' | 'crop';

/** Crop window as fractions (0..1) of the source image. Used when `fit` is `crop`. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageNode extends BaseNode {
  type: 'image';
  /** Key of the binary in the asset store. */
  assetId: AssetId;
  naturalWidth: number;
  naturalHeight: number;
  fit: ImageFit;
  crop: CropRect;
  cornerRadius: number;
}

/** Union of every node type the editor can render. Extended phase by phase. */
export type SceneNode =
  | FrameNode
  | ComponentNode
  | ComponentSetNode
  | InstanceNode
  | GroupNode
  | RectangleNode
  | EllipseNode
  | PolygonNode
  | StarNode
  | LineNode
  | VectorNode
  | TextNode
  | ImageNode;
export type NodeType = SceneNode['type'];
export type ContainerNode = FrameLikeNode | GroupNode;

export const NODE_TYPES: readonly NodeType[] = [
  'frame',
  'component',
  'component-set',
  'instance',
  'group',
  'rectangle',
  'ellipse',
  'polygon',
  'star',
  'line',
  'vector',
  'text',
  'image',
];

export interface Page {
  id: PageId;
  name: string;
  /** Canvas background colour for this page. */
  background: string;
  /** Top-level node order, bottom-most first (render order). */
  childIds: NodeId[];
  /** Prototype: the screen the preview starts on. */
  flowStartId?: NodeId;
}

export interface DesignDocument {
  id: DocumentId;
  name: string;
  schemaVersion: typeof SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  pages: Page[];
  nodes: Record<NodeId, SceneNode>;
  variableCollections: VariableCollection[];
  variables: Variable[];
}

export type VariableType = 'color' | 'number' | 'string' | 'boolean';
export type VariableValue = string | number | boolean;

export interface VariableCollection {
  id: CollectionId;
  name: string;
  modes: { id: ModeId; name: string }[];
  defaultModeId: ModeId;
}

export interface Variable {
  id: VariableId;
  name: string;
  collectionId: CollectionId;
  type: VariableType;
  valuesByMode: Record<ModeId, VariableValue>;
}

export interface DocumentMeta {
  id: DocumentId;
  name: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
}

export function isFrameLike(node: SceneNode | undefined): node is FrameLikeNode {
  return !!node && (node.type === 'frame' || node.type === 'component' || node.type === 'component-set' || node.type === 'instance');
}

export function isContainer(node: SceneNode): node is ContainerNode {
  return isFrameLike(node) || node.type === 'group';
}

export function hasCornerRadius(node: SceneNode): node is FrameLikeNode | RectangleNode | ImageNode {
  return isFrameLike(node) || node.type === 'rectangle' || node.type === 'image';
}

/** Node types that support drop shadow / layer blur rendering. Groups do not (yet). */
export function supportsEffects(node: SceneNode): boolean {
  return node.type !== 'group';
}
