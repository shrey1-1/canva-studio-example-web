import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addNode, createDocument, createRectangle, createStar } from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import { DesignTab } from './DesignTab';
import { evaluate, normalizeHex } from './fields';

function loadWithRect() {
  const doc = createDocument('Test');
  const rect = createRectangle({ pageId: doc.pages[0]!.id, x: 10, y: 20, width: 100, height: 50 });
  addNode(doc, rect);
  useEditor.getState().loadDocument(doc);
  return rect;
}

describe('DesignTab', () => {
  beforeEach(() => useEditor.getState().loadDocument(createDocument()));

  it('shows page properties when nothing is selected', () => {
    render(<DesignTab />);
    expect(screen.getByRole('region', { name: 'Page' })).toBeInTheDocument();
    expect(screen.getByLabelText('Page background hex')).toHaveValue('F3F4F6');
  });

  it('edits the selected node immediately and supports undo', async () => {
    const rect = loadWithRect();
    useEditor.getState().select([rect.id]);
    render(<DesignTab />);

    const x = screen.getByLabelText('X');
    await userEvent.clear(x);
    await userEvent.type(x, '150{Enter}');
    expect(useEditor.getState().doc.nodes[rect.id]!.x).toBe(150);

    const w = screen.getByLabelText('W');
    await userEvent.clear(w);
    await userEvent.type(w, '100*2{Enter}');
    expect(useEditor.getState().doc.nodes[rect.id]!.width).toBe(200);

    useEditor.getState().undo();
    expect(useEditor.getState().doc.nodes[rect.id]!.width).toBe(100);
  });

  it('rejects invalid input and keeps the previous value', async () => {
    const rect = loadWithRect();
    useEditor.getState().select([rect.id]);
    render(<DesignTab />);
    const w = screen.getByLabelText('W');
    await userEvent.clear(w);
    await userEvent.type(w, 'abc{Enter}');
    expect(useEditor.getState().doc.nodes[rect.id]!.width).toBe(100);
    expect(w).toHaveValue('100');
  });

  it('changes fill colour from the hex field', async () => {
    const rect = loadWithRect();
    useEditor.getState().select([rect.id]);
    render(<DesignTab />);
    const hex = screen.getByLabelText('Fill 1 hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, 'ff0000{Enter}');
    expect(useEditor.getState().doc.nodes[rect.id]!.fills[0]!.color).toBe('#FF0000');
  });

  it('adds, edits and removes extra fills and strokes', async () => {
    const rect = loadWithRect();
    useEditor.getState().select([rect.id]);
    render(<DesignTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Add fill' }));
    expect(screen.getAllByTestId('fill-row')).toHaveLength(2);
    const top = screen.getByLabelText('Fill 2 hex');
    await userEvent.clear(top);
    await userEvent.type(top, '00ff00{Enter}');
    const fills = () => useEditor.getState().doc.nodes[rect.id]!.fills;
    expect(fills().map((f) => f.color)).toEqual(['#D9D9D9', '#00FF00']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove fill 1' }));
    expect(fills().map((f) => f.color)).toEqual(['#00FF00']);

    await userEvent.click(screen.getByRole('button', { name: 'Add stroke' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add stroke' }));
    expect(useEditor.getState().doc.nodes[rect.id]!.strokes).toHaveLength(2);
  });

  it('adds a drop shadow and a layer blur, each only once', async () => {
    const rect = loadWithRect();
    useEditor.getState().select([rect.id]);
    render(<DesignTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Add effect' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Drop shadow' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add effect' }));
    expect(screen.queryByRole('menuitem', { name: 'Drop shadow' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Layer blur' }));
    expect(screen.queryByRole('button', { name: 'Add effect' })).toBeNull();
    const effects = useEditor.getState().doc.nodes[rect.id]!.effects;
    expect(effects.map((e) => e.type)).toEqual(['drop-shadow', 'layer-blur']);

    const blur = screen.getByLabelText('Shadow blur');
    await userEvent.clear(blur);
    await userEvent.type(blur, '20{Enter}');
    const shadow = useEditor.getState().doc.nodes[rect.id]!.effects[0]!;
    expect(shadow.type === 'drop-shadow' && shadow.blur).toBe(20);
  });

  it('shows type-specific controls (star points)', async () => {
    const doc = createDocument();
    const star = createStar({ pageId: doc.pages[0]!.id });
    addNode(doc, star);
    useEditor.getState().loadDocument(doc);
    useEditor.getState().select([star.id]);
    render(<DesignTab />);
    const points = screen.getByLabelText('Point count');
    await userEvent.clear(points);
    await userEvent.type(points, '7{Enter}');
    expect((useEditor.getState().doc.nodes[star.id] as { pointCount: number }).pointCount).toBe(7);
  });

  it('aligns two layers from the alignment bar', async () => {
    const doc = createDocument();
    const pageId = doc.pages[0]!.id;
    const a = createRectangle({ pageId, x: 0, y: 0, width: 10, height: 10 });
    const b = createRectangle({ pageId, x: 50, y: 40, width: 10, height: 10 });
    addNode(doc, a);
    addNode(doc, b);
    useEditor.getState().loadDocument(doc);
    useEditor.getState().select([a.id, b.id]);
    render(<DesignTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Align right' }));
    expect(useEditor.getState().doc.nodes[a.id]!.x).toBe(50);
    expect(screen.getByRole('button', { name: 'Distribute horizontal spacing' })).toBeDisabled();
  });

  it('deletes the selected layer', async () => {
    const rect = loadWithRect();
    useEditor.getState().select([rect.id]);
    render(<DesignTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete layer' }));
    expect(useEditor.getState().doc.nodes[rect.id]).toBeUndefined();
    expect(useEditor.getState().selection).toEqual([]);
  });
});

describe('field parsing', () => {
  it('evaluates numbers and simple math', () => {
    expect(evaluate('42')).toBe(42);
    expect(evaluate(' 10 + 5 ')).toBe(15);
    expect(evaluate('100/4')).toBe(25);
    expect(evaluate('1/0')).toBeNull();
    expect(evaluate('abc')).toBeNull();
  });

  it('normalises hex colours', () => {
    expect(normalizeHex('f00')).toBe('#FF0000');
    expect(normalizeHex('#3b82f6')).toBe('#3B82F6');
    expect(normalizeHex('zzz')).toBeNull();
  });
});

describe('NumberField (review fix)', () => {
  it('focusing and leaving a field with a long decimal creates no edit', async () => {
    const doc = createDocument();
    const rect = createRectangle({ pageId: doc.pages[0]!.id, x: 10.123456 });
    addNode(doc, rect);
    useEditor.getState().loadDocument(doc);
    useEditor.getState().select([rect.id]);
    render(<DesignTab />);
    await userEvent.click(screen.getByLabelText('X'));
    await userEvent.tab();
    expect(useEditor.getState().doc.nodes[rect.id]!.x).toBe(10.123456);
    expect(useEditor.getState().history.past).toHaveLength(0);
  });
});
