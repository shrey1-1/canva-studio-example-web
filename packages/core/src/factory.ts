import {
  SCHEMA_VERSION,
  type AssetId,
  type DesignDocument,
  type EllipseNode,
  type FrameNode,
  type GroupNode,
  type ImageNode,
  type LineCap,
  type LineNode,
  type NodeId,
  type Page,
  type PageId,
  type PolygonNode,
  type RectangleNode,
  type SceneNode,
  type StarNode,
  type TextNode,
  type VectorNode,
  type VectorVertex,
} from './model';

export function createId(): string {
  return crypto.randomUUID();
}

export function createPage(name = 'Page 1'): Page {
  return { id: createId(), name, background: '#F3F4F6', childIds: [] };
}

export function createDocument(name = 'Untitled'): DesignDocument {
  const now = new Date().toISOString();
  return {
    id: createId(),
    name,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    pages: [createPage('Page 1')],
    nodes: {},
    variableCollections: [],
    variables: [],
  };
}

export interface NodeInit {
  pageId: PageId;
  parentId?: NodeId | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  name?: string;
  /** Colour for strokes of lines/vectors and for text; defaults to black. */
  ink?: string;
}

const DEFAULT_SHAPE_FILL = '#D9D9D9';

export const solid = (color: string, opacity = 1) => ({ type: 'solid' as const, color, opacity, visible: true });

function base(init: NodeInit) {
  return {
    id: createId(),
    pageId: init.pageId,
    parentId: init.parentId ?? null,
    x: init.x ?? 0,
    y: init.y ?? 0,
    width: init.width ?? 100,
    height: init.height ?? 100,
    rotation: init.rotation ?? 0,
    opacity: 1,
    visible: true,
    locked: false,
    isMask: false,
    strokes: [],
    effects: [],
    constraints: { horizontal: 'left' as const, vertical: 'top' as const },
    sizing: { horizontal: 'fixed' as const, vertical: 'fixed' as const },
    minWidth: null,
    maxWidth: null,
    minHeight: null,
    maxHeight: null,
  };
}

export function createFrame(init: NodeInit): FrameNode {
  return {
    ...base(init),
    type: 'frame',
    name: init.name ?? 'Frame',
    childIds: [],
    cornerRadius: 0,
    clipContent: true,
    layout: null,
    fills: [solid('#FFFFFF')],
  };
}

export function createGroup(init: NodeInit): GroupNode {
  return { ...base(init), type: 'group', name: init.name ?? 'Group', childIds: [], fills: [] };
}

export function createRectangle(init: NodeInit): RectangleNode {
  return { ...base(init), type: 'rectangle', name: init.name ?? 'Rectangle', cornerRadius: 0, fills: [solid(DEFAULT_SHAPE_FILL)] };
}

export function createEllipse(init: NodeInit): EllipseNode {
  return { ...base(init), type: 'ellipse', name: init.name ?? 'Ellipse', fills: [solid(DEFAULT_SHAPE_FILL)] };
}

export function createPolygon(init: NodeInit): PolygonNode {
  return { ...base(init), type: 'polygon', name: init.name ?? 'Polygon', pointCount: 3, fills: [solid(DEFAULT_SHAPE_FILL)] };
}

export function createStar(init: NodeInit): StarNode {
  return {
    ...base(init),
    type: 'star',
    name: init.name ?? 'Star',
    pointCount: 5,
    innerRadius: 0.38,
    fills: [solid(DEFAULT_SHAPE_FILL)],
  };
}

export function createLine(init: NodeInit & { endCap?: LineCap }): LineNode {
  return {
    ...base(init),
    type: 'line',
    name: init.name ?? (init.endCap && init.endCap !== 'none' ? 'Arrow' : 'Line'),
    height: 0,
    fills: [],
    strokes: [{ color: init.ink ?? '#000000', width: 2, opacity: 1, visible: true }],
    startCap: 'none',
    endCap: init.endCap ?? 'none',
  };
}

export const vertex = (x: number, y: number, handles: Partial<Omit<VectorVertex, 'x' | 'y'>> = {}): VectorVertex => ({
  x,
  y,
  inX: handles.inX ?? 0,
  inY: handles.inY ?? 0,
  outX: handles.outX ?? 0,
  outY: handles.outY ?? 0,
});

export function createVector(init: NodeInit & { vertices: VectorVertex[]; closed: boolean }): VectorNode {
  return {
    ...base(init),
    type: 'vector',
    name: init.name ?? 'Vector',
    vertices: init.vertices,
    closed: init.closed,
    fills: init.closed ? [solid(DEFAULT_SHAPE_FILL)] : [],
    strokes: [{ color: init.ink ?? '#000000', width: 2, opacity: 1, visible: true }],
  };
}

export function createText(init: NodeInit & { characters?: string; fontSize?: number }): TextNode {
  const fontSize = init.fontSize ?? 16;
  return {
    ...base(init),
    type: 'text',
    name: init.name ?? (init.characters?.trim().slice(0, 40) || 'Text'),
    width: init.width ?? 0,
    height: init.height ?? Math.ceil(fontSize * 1.2),
    fills: [solid(init.ink ?? '#000000')],
    characters: init.characters ?? '',
    fontFamily: 'Arial',
    fontSize,
    fontWeight: 400,
    italic: false,
    textAlign: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    textDecoration: 'none',
    autoResize: init.width ? 'height' : 'width-and-height',
    sizing: { horizontal: init.width ? 'fixed' : 'hug', vertical: 'hug' },
  };
}

export function createImage(
  init: NodeInit & { assetId: AssetId; naturalWidth: number; naturalHeight: number },
): ImageNode {
  return {
    ...base(init),
    type: 'image',
    name: init.name ?? 'Image',
    width: init.width ?? init.naturalWidth,
    height: init.height ?? init.naturalHeight,
    fills: [],
    assetId: init.assetId,
    naturalWidth: init.naturalWidth,
    naturalHeight: init.naturalHeight,
    fit: 'fill',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    cornerRadius: 0,
  };
}

/** Node types a drag-to-draw tool can create. */
export type CreatableType = 'frame' | 'rectangle' | 'ellipse' | 'polygon' | 'star';

export function createNode(type: CreatableType, init: NodeInit): SceneNode {
  switch (type) {
    case 'frame':
      return createFrame(init);
    case 'rectangle':
      return createRectangle(init);
    case 'ellipse':
      return createEllipse(init);
    case 'polygon':
      return createPolygon(init);
    case 'star':
      return createStar(init);
  }
}

/** Black or white, whichever reads better on the given background colour. */
export function contrastingInk(background: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!m) return '#000000';
  const n = parseInt(m[1]!, 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum < 0.5 ? '#FFFFFF' : '#000000';
}
