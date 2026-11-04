/**
 * Built-in tool (plugin) manifests. Phase 1 uses these for discovery, search,
 * filtering and installation state. Execution (the plugin runtime and each tool's
 * implementation) is added in Phase 4; `entry` names the module that will implement it.
 */

export type ToolSource = 'built-in' | 'community' | 'custom';

export type ToolCategory =
  | 'Graphics'
  | 'Effects'
  | 'Layout'
  | 'Mockups'
  | 'Animation'
  | 'Presentation'
  | 'Assets'
  | 'Developer';

export type PluginPermission =
  | 'read-selection'
  | 'read-document'
  | 'create-nodes'
  | 'modify-nodes'
  | 'import-assets'
  | 'export';

export interface ToolManifest {
  id: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  source: ToolSource;
  category: ToolCategory;
  /** Lucide icon name rendered in the tool card thumbnail. */
  icon: string;
  /** Accent colour for the card thumbnail. */
  accent: string;
  permissions: PluginPermission[];
  /** Module id the plugin runtime loads (Phase 4). */
  entry: string;
  /** ISO date the tool was added to the catalog — drives "Recently added". */
  addedAt: string;
  tags: string[];
}

const PUBLISHER = 'Canvas Studio';

export const BUILT_IN_TOOLS: readonly ToolManifest[] = [
  {
    id: 'image-to-vector',
    name: 'Image to Vector',
    description: 'Trace raster images into editable vector paths and export them as SVG.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Graphics',
    icon: 'spline',
    accent: '#6366F1',
    permissions: ['read-selection', 'create-nodes', 'export'],
    entry: 'tools/image-to-vector',
    addedAt: '2026-11-04',
    tags: ['trace', 'svg', 'vectorize', 'raster'],
  },
  {
    id: 'bento-grid',
    name: 'Bento Grid Builder',
    description: 'Generate bento-style card layouts with mixed card sizes, gaps and spacing.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Layout',
    icon: 'layout-grid',
    accent: '#0EA5E9',
    permissions: ['create-nodes'],
    entry: 'tools/bento-grid',
    addedAt: '2026-11-04',
    tags: ['grid', 'cards', 'layout'],
  },
  {
    id: 'phone-mockup',
    name: 'Phone Mockup',
    description: 'Wrap selected frames in smartphone device frames at real device dimensions.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Mockups',
    icon: 'smartphone',
    accent: '#22C55E',
    permissions: ['read-selection', 'create-nodes'],
    entry: 'tools/phone-mockup',
    addedAt: '2026-11-04',
    tags: ['device', 'iphone', 'android', 'mobile'],
  },
  {
    id: 'auto-slide',
    name: 'Auto-Slide Animator',
    description: 'Create animated transitions between frames with movement and opacity.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Animation',
    icon: 'move-right',
    accent: '#F59E0B',
    permissions: ['read-document', 'modify-nodes'],
    entry: 'tools/auto-slide',
    addedAt: '2026-11-04',
    tags: ['transition', 'motion', 'animate'],
  },
  {
    id: 'flipbook',
    name: 'Flipbook',
    description: 'Turn frames or pages into a flipbook presentation with page-turn animation.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Presentation',
    icon: 'book-open',
    accent: '#EC4899',
    permissions: ['read-document'],
    entry: 'tools/flipbook',
    addedAt: '2026-11-04',
    tags: ['book', 'pages', 'slides'],
  },
  {
    id: 'sticker-pack',
    name: 'Sticker Pack',
    description: 'Insert and scale reusable vector stickers.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Assets',
    icon: 'sticker',
    accent: '#F97316',
    permissions: ['create-nodes'],
    entry: 'tools/sticker-pack',
    addedAt: '2026-11-04',
    tags: ['emoji', 'stickers', 'decoration'],
  },
  {
    id: 'token-exporter',
    name: 'Token Exporter',
    description: 'Export colours, typography, spacing, radii and shadows as JSON, CSS, SCSS or JS.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Developer',
    icon: 'braces',
    accent: '#14B8A6',
    permissions: ['read-document', 'export'],
    entry: 'tools/token-exporter',
    addedAt: '2026-11-04',
    tags: ['tokens', 'css', 'scss', 'json', 'variables'],
  },
  {
    id: 'generate-mockup',
    name: 'Generate Mockup',
    description: 'Place designs or images into product mockup templates and export the result.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Mockups',
    icon: 'monitor-smartphone',
    accent: '#84CC16',
    permissions: ['read-selection', 'create-nodes', 'export'],
    entry: 'tools/generate-mockup',
    addedAt: '2026-11-04',
    tags: ['product', 'template', 'laptop', 'scene'],
  },
  {
    id: 'nebula',
    name: 'Nebula',
    description: 'Procedural space backgrounds with nebula clouds and star particles.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Effects',
    icon: 'sparkles',
    accent: '#A855F7',
    permissions: ['create-nodes'],
    entry: 'tools/nebula',
    addedAt: '2026-11-04',
    tags: ['space', 'stars', 'particles', 'background'],
  },
  {
    id: 'pixel-stretch',
    name: 'Pixel Stretch',
    description: 'Smear a row or column of pixels across an image for a stretched glitch look.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Effects',
    icon: 'stretch-horizontal',
    accent: '#EF4444',
    permissions: ['read-selection', 'create-nodes'],
    entry: 'tools/pixel-stretch',
    addedAt: '2026-11-04',
    tags: ['glitch', 'distort', 'image'],
  },
  {
    id: 'fractal-noise',
    name: 'Fractal Noise',
    description: 'Generate fractal noise textures with scale, frequency, octaves and amplitude.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Effects',
    icon: 'waves-horizontal',
    accent: '#64748B',
    permissions: ['create-nodes'],
    entry: 'tools/fractal-noise',
    addedAt: '2026-11-04',
    tags: ['perlin', 'texture', 'procedural'],
  },
  {
    id: 'grainy-airbrush',
    name: 'Grainy Airbrush',
    description: 'Paint soft grainy airbrush strokes with size, grain, opacity and colour.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Graphics',
    icon: 'spray-can',
    accent: '#D946EF',
    permissions: ['create-nodes'],
    entry: 'tools/grainy-airbrush',
    addedAt: '2026-11-04',
    tags: ['brush', 'grain', 'gradient', 'paint'],
  },
  {
    id: 'clouds',
    name: 'Clouds',
    description: 'Procedural clouds with configurable density, shape and opacity.',
    publisher: PUBLISHER,
    version: '1.0.0',
    source: 'built-in',
    category: 'Effects',
    icon: 'cloud',
    accent: '#38BDF8',
    permissions: ['create-nodes'],
    entry: 'tools/clouds',
    addedAt: '2026-11-04',
    tags: ['sky', 'procedural', 'background'],
  },
];
