import { describe, expect, it } from 'vitest';
import { copyNodes, pasteNodes } from './clipboard';
import { createDocument, createFrame, createRectangle } from './factory';
import { finalizeDocument } from './finalize';
import type { DesignDocument, TextNode } from './model';
import { addNode, deleteNodes, updateNode } from './ops';
import {
  applyAction,
  defaultAction,
  flowStart,
  hitInteraction,
  initialPlayerState,
  isSafeUrl,
  screenContentSize,
  type Interaction,
  type PrototypeAction,
} from './prototype';
import { documentProblem } from './validate';

const measure = (n: TextNode, width: number | null) => ({ width: width ?? n.characters.length * 8, height: n.fontSize * n.lineHeight });

function setup() {
  const doc = createDocument();
  const pageId = doc.pages[0]!.id;
  const a = createFrame({ pageId, name: 'Home', x: 0, y: 0, width: 300, height: 600 });
  const b = createFrame({ pageId, name: 'Detail', x: 400, y: 0, width: 300, height: 600 });
  addNode(doc, a);
  addNode(doc, b);
  const button = createRectangle({ pageId, parentId: a.id, name: 'Button', x: 20, y: 500, width: 100, height: 40 });
  addNode(doc, button);
  return { doc, a: a.id, b: b.id, button: button.id, pageId };
}

const interaction = (action: PrototypeAction, trigger: Interaction['trigger'] = 'click'): Interaction => ({ id: 'i1', trigger, delayMs: 0, action });

describe('prototype model', () => {
  it('stores valid interactions and rejects malformed ones', () => {
    const { doc, b, button } = setup();
    updateNode(doc, button, { interactions: [interaction(defaultAction('navigate', b)!)] });
    expect(documentProblem(doc)).toBeNull();
    (doc.nodes[button] as unknown as Record<string, unknown>).interactions = [{ id: 'x', trigger: 'click', delayMs: 0, action: { type: 'eval' } }];
    expect(documentProblem(doc)).toMatch(/interactions/);
  });

  it('drops links to deleted screens and restores nothing stale', () => {
    const { doc, b, button } = setup();
    updateNode(doc, button, { interactions: [interaction(defaultAction('navigate', b)!)] });
    doc.pages[0]!.flowStartId = b;
    deleteNodes(doc, [b]);
    finalizeDocument(doc, measure);
    expect(doc.nodes[button]!.interactions).toEqual([]);
    expect(doc.pages[0]!.flowStartId).toBeUndefined();
  });

  it('copies interactions with the layer', () => {
    const { doc, a, b, button, pageId } = setup();
    updateNode(doc, button, { interactions: [interaction(defaultAction('navigate', b)!)] });
    const [copy] = pasteNodes(doc, copyNodes(doc, [button])!, { pageId, parentId: a });
    expect(doc.nodes[copy!]!.interactions?.[0]?.action).toMatchObject({ type: 'navigate', destinationId: b });
  });

  it('starts at the flow start, else the top-left screen', () => {
    const { doc, a, b } = setup();
    expect(flowStart(doc, doc.pages[0]!)).toBe(a);
    doc.pages[0]!.flowStartId = b;
    expect(flowStart(doc, doc.pages[0]!)).toBe(b);
  });

  it('finds the interactive layer under a point, falling back to ancestors', () => {
    const { doc, a, b, button } = setup();
    updateNode(doc, a, { interactions: [interaction({ type: 'back' })] });
    updateNode(doc, button, { interactions: [interaction(defaultAction('navigate', b)!)] });
    expect(hitInteraction(doc, a, { x: 50, y: 510 }, 'click')?.nodeId).toBe(button);
    expect(hitInteraction(doc, a, { x: 50, y: 100 }, 'click')?.nodeId).toBe(a);
    expect(hitInteraction(doc, a, { x: 50, y: 510 }, 'hover')).toBeNull();
  });

  it('measures scrollable content', () => {
    const { doc, a, pageId } = setup();
    addNode(doc, createRectangle({ pageId, parentId: a, x: 0, y: 1100, width: 10, height: 100 }));
    expect(screenContentSize(doc, a)).toEqual({ width: 300, height: 1200 });
  });

  it('only opens web and mail links', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,x')).toBe(false);
  });
});

describe('player state machine', () => {
  const run = (doc: DesignDocument, start: string, actions: PrototypeAction[]) =>
    actions.reduce((s, act) => applyAction(doc, s, act).state, initialPlayerState(start));

  it('navigates, opens and closes overlays, and goes back', () => {
    const { doc, a, b } = setup();
    let s = run(doc, a, [defaultAction('navigate', b)!]);
    expect(s.history).toEqual([a, b]);
    s = run(doc, a, [defaultAction('navigate', b)!, defaultAction('overlay', a)!]);
    expect(s.overlays).toHaveLength(1);
    // Back closes the overlay first, then returns to the previous screen.
    s = applyAction(doc, s, { type: 'back' }).state;
    expect(s.overlays).toHaveLength(0);
    s = applyAction(doc, s, { type: 'back' }).state;
    expect(s.history).toEqual([a]);
    expect(applyAction(doc, s, { type: 'back' }).effect.kind).toBe('none');
  });

  it('refuses unsafe links', () => {
    const { doc, a } = setup();
    expect(applyAction(doc, initialPlayerState(a), { type: 'url', url: 'javascript:alert(1)' }).effect.kind).toBe('none');
    expect(applyAction(doc, initialPlayerState(a), { type: 'url', url: 'https://example.com' }).effect).toEqual({ kind: 'open-url', url: 'https://example.com' });
  });
});
