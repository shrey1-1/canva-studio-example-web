import { beforeEach, describe, expect, it } from 'vitest';
import { addNode, BUILT_IN_TOOLS, createDocument, createRectangle, documentProblem, type ToolManifest } from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import { useCustomTools } from '../../state/customToolsStore';
import { useToasts } from '../../state/toastStore';
import { BUILTIN_TOOLS } from './builtinTools';
import { buildSandboxDocument } from './sandbox';
import { PermissionError, safeDownloadName, ToolContext } from './toolHost';
import { runTool } from './runTool';

const manifest = (permissions: ToolManifest['permissions']): ToolManifest => ({ ...BUILT_IN_TOOLS[0]!, id: 'test', name: 'Test tool', source: 'custom', permissions });

beforeEach(() => {
  const doc = createDocument();
  addNode(doc, createRectangle({ pageId: doc.pages[0]!.id, name: 'R' }));
  useEditor.getState().loadDocument(doc);
  useEditor.getState().setCanvasSize({ width: 800, height: 600 });
});

describe('ToolContext permissions', () => {
  it('refuses calls outside the declared permissions', () => {
    const ctx = new ToolContext(manifest(['create-nodes']));
    expect(() => ctx.getSelection()).toThrow(PermissionError);
    expect(() => ctx.getDocument()).toThrow(PermissionError);
    expect(() => ctx.updateNodes([])).toThrow(PermissionError);
    expect(() => ctx.download('x.txt', 'x')).toThrow(PermissionError);
  });

  it('creates validated layers as a single undo step per run', () => {
    const ctx = new ToolContext(manifest(['create-nodes']));
    ctx.createNodes([{ type: 'frame', width: 100, height: 100 }, { type: 'rectangle', parent: '#0', width: 10, height: 10 }]);
    ctx.createNodes([{ type: 'ellipse', width: 5, height: 5 }]);
    const { doc, history } = useEditor.getState();
    expect(ctx.createdIds).toHaveLength(3);
    expect(doc.nodes[ctx.createdIds[1]!]!.parentId).toBe(ctx.createdIds[0]);
    expect(history.past).toHaveLength(1);
    useEditor.getState().undo();
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(1);
  });

  it('rejects malformed specs and structural patches', () => {
    const ctx = new ToolContext(manifest(['create-nodes', 'modify-nodes']));
    expect(() => ctx.createNodes([{ type: 'rectangle', fill: 'javascript:alert(1)' }])).toThrow(/fill/);
    const [id] = ctx.createNodes([{ type: 'rectangle', width: 10, height: 10 }]);
    ctx.updateNodes([{ id, parentId: 'evil', type: 'frame', x: 50 }]);
    const node = useEditor.getState().doc.nodes[id!]!;
    expect({ type: node.type, parentId: node.parentId, x: node.x }).toEqual({ type: 'rectangle', parentId: null, x: 50 });
  });

  it('rejects patches that would leave an invalid layer, so the file stays loadable', () => {
    const ctx = new ToolContext(manifest(['create-nodes', 'modify-nodes']));
    const [id] = ctx.createNodes([{ type: 'rectangle', width: 10, height: 10 }]);
    const bad: unknown[] = [
      { id, fills: 'x' },
      { id, visible: 'yes' },
      { id, effects: [{ type: 'layer-blur', radius: 1e7, visible: true }] },
      { id, fills: Array.from({ length: 51 }, () => ({ type: 'solid', color: '#000000', opacity: 1, visible: true })) },
    ];
    for (const patch of bad) expect(() => ctx.updateNodes([patch])).toThrow();
    expect(documentProblem(useEditor.getState().doc)).toBeNull();
  });

  it('ignores prototype, link and unknown keys in patches', () => {
    const ctx = new ToolContext(manifest(['create-nodes', 'modify-nodes']));
    const [id] = ctx.createNodes([{ type: 'rectangle', width: 10, height: 10 }]);
    const patch = JSON.parse('{"__proto__":{"componentNodeId":"x"},"bindings":{"fill":"v"},"foo":1,"x":7}') as object;
    ctx.updateNodes([{ id, ...patch }]);
    const node = useEditor.getState().doc.nodes[id!]! as unknown as Record<string, unknown>;
    expect(node.x).toBe(7);
    expect(Object.getPrototypeOf(node)).toBe(Object.prototype);
    expect(node.componentNodeId).toBeUndefined();
    expect(node.bindings).toBeUndefined();
    expect(node.foo).toBeUndefined();
  });

  it('read-selection tools can only read the selection and its contents', () => {
    const ctx = new ToolContext(manifest(['read-selection']));
    const other = Object.keys(useEditor.getState().doc.nodes)[0]!;
    useEditor.getState().select([]);
    expect(() => ctx.getNode(other)).toThrow(PermissionError);
    useEditor.getState().select([other]);
    expect(ctx.getNode(other)?.id).toBe(other);
    expect(new ToolContext(manifest(['read-document'])).getNode(other)?.id).toBe(other);
  });

  it('a finished run can no longer edit', () => {
    const ctx = new ToolContext(manifest(['create-nodes']));
    ctx.close();
    expect(() => ctx.createNodes([{ type: 'rectangle', width: 10, height: 10 }])).toThrow(/ended/);
  });

  it('custom tools need "import-assets" for images, label their messages and confirm downloads', async () => {
    const ctx = new ToolContext(manifest(['create-nodes', 'export']));
    await expect(ctx.placeImage({ width: 1, height: 1, data: new Uint8ClampedArray(4) })).rejects.toThrow(PermissionError);
    ctx.notify('Session expired');
    expect(useToasts.getState().toasts.at(-1)?.message).toBe('Test tool: Session expired');
    expect(() => ctx.download('invoice.hta', 'x')).toThrow(/can only save/);
    ctx.download('tokens.json', '{}', 'text/html');
    const toast = useToasts.getState().toasts.at(-1)!;
    expect(toast.message).toContain('"tokens.json"');
    expect(toast.action?.label).toBe('Save');
  });

  it('download names are sanitised and typed by extension', () => {
    expect(safeDownloadName('../a<b>.SVG')).toEqual({ filename: '-a-b-.svg', mime: 'image/svg+xml' });
    expect(() => safeDownloadName('run.bat')).toThrow();
    expect(() => safeDownloadName('noext')).toThrow();
  });
});

describe('built-in tools', () => {
  it('every catalog tool has an implementation with valid defaults', () => {
    for (const t of BUILT_IN_TOOLS) {
      const impl = BUILTIN_TOOLS[t.id];
      expect(impl, t.id).toBeDefined();
      for (const p of impl!.params) {
        if (p.type === 'select') expect(p.options!.some((o) => o.value === p.default), `${t.id}.${p.key}`).toBe(true);
        if (p.type === 'number') expect(Number(p.default) >= (p.min ?? -Infinity) && Number(p.default) <= (p.max ?? Infinity), `${t.id}.${p.key}`).toBe(true);
      }
    }
  });

  it('Bento Grid and Token Exporter run end to end', async () => {
    const before = Object.keys(useEditor.getState().doc.nodes).length;
    const r = await runTool('bento-grid', { width: 400, height: 300, columns: 3, rows: 2, gap: 10, radius: 8, variety: 0, card: '#EEEEEE', background: '#FFFFFF', seed: 1 });
    expect(Object.keys(useEditor.getState().doc.nodes).length - before).toBe(1 + 6);
    expect(r.message).toMatch(/6 cards/);
    const t = await runTool('token-exporter', { format: 'css', download: false });
    expect(t.text?.content).toContain(':root {');
  });

  it('tools that need a selection explain what to select', async () => {
    useEditor.getState().select([]);
    await expect(runTool('pixel-stretch', { direction: 'vertical', position: 0.5, length: 0.5, side: 'after' })).rejects.toThrow(/Select an image/);
  });
});

describe('sandbox page', () => {
  it('blocks network access and escapes the code', () => {
    const code = 'const s = "</script><script>alert(1)</script>"; // <!--<script>';
    const html = buildSandboxDocument(code);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/connect-src [^']*\*/);
    // The tool's code carries no raw "<": one closing tag (the page's own), no comment opener.
    expect(html.split('</script>')).toHaveLength(2);
    expect(html).not.toContain('<!--');
    expect(html).toContain('\\u003c/script>');
  });

  it('custom tools are saved with chosen permissions', () => {
    const id = useCustomTools.getState().save({ name: 'Dots', description: '', category: 'Graphics', permissions: ['create-nodes'], code: 'x', publisher: 'You' });
    const tool = useCustomTools.getState().tools.find((t) => t.manifest.id === id)!;
    expect(tool.manifest).toMatchObject({ source: 'custom', permissions: ['create-nodes'], version: '1.0.0' });
  });
});
