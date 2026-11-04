import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addNode, createDocument, createFrame, createRectangle, type InstanceNode } from '@canvas-studio/core';
import { useEditor } from '../state/editorStore';
import * as cmd from './commands';
import { VariablesPanel } from './panels/VariablesPanel';
import { DesignTab } from './inspector/DesignTab';

const ed = () => useEditor.getState();

function load() {
  const doc = createDocument('P3 web');
  const pageId = doc.pages[0]!.id;
  const frame = createFrame({ pageId, x: 0, y: 0, width: 120, height: 40, name: 'Frame 1' });
  const child = createRectangle({ pageId, parentId: frame.id, width: 120, height: 40, name: 'Bg' });
  addNode(doc, frame);
  addNode(doc, child);
  ed().loadDocument(doc);
  ed().setCanvasSize({ width: 1000, height: 800 });
  return { pageId, frame, child };
}

describe('component commands', () => {
  beforeEach(() => ed().loadDocument(createDocument()));

  it('creates a component, inserts an instance, and protects instance layers', () => {
    const { frame } = load();
    ed().select([frame.id]);
    cmd.createComponentFromSelection();
    expect(ed().doc.nodes[frame.id]!.type).toBe('component');
    expect(ed().doc.nodes[frame.id]!.name).toBe('Component 1');

    cmd.insertInstance(frame.id);
    const instId = ed().selection[0]!;
    const inst = ed().doc.nodes[instId] as InstanceNode;
    expect(inst.type).toBe('instance');
    expect(inst.childIds).toHaveLength(1);

    // Deleting a layer inside the instance is refused; the instance itself can be deleted.
    ed().select([inst.childIds[0]!]);
    cmd.deleteSelection();
    expect(ed().doc.nodes[inst.childIds[0]!]).toBeDefined();

    ed().select([instId]);
    cmd.detachSelection();
    expect(ed().doc.nodes[instId]!.type).toBe('frame');
    ed().undo();
    expect(ed().doc.nodes[instId]!.type).toBe('instance');
  });

  it('Shift+A wraps layers in a hugging auto-layout frame', () => {
    const doc = createDocument();
    const pageId = doc.pages[0]!.id;
    const a = createRectangle({ pageId, x: 0, y: 0, width: 50, height: 20 });
    const b = createRectangle({ pageId, x: 100, y: 0, width: 50, height: 20 });
    addNode(doc, a);
    addNode(doc, b);
    ed().loadDocument(doc);
    ed().select([a.id, b.id]);
    cmd.addAutoLayout();
    const f = ed().doc.nodes[ed().selection[0]!]!;
    expect(f.type === 'frame' && f.layout?.direction).toBe('horizontal');
    expect({ w: f.width, h: f.height }).toEqual({ w: 130, h: 40 }); // 10 padding, 10 gap
  });

  it('adds a preset frame', () => {
    load();
    cmd.addPresetFrame({ name: 'iPhone 16', width: 393, height: 852 });
    const f = ed().doc.nodes[ed().selection[0]!]!;
    expect({ name: f.name, w: f.width, h: f.height }).toEqual({ name: 'iPhone 16', w: 393, h: 852 });
  });
});

describe('Variables panel and bindings', () => {
  it('creates a collection and colour variable, binds it, and recolours on edit', async () => {
    const { child } = load();
    render(<VariablesPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Create collection' }));
    await userEvent.click(screen.getByRole('button', { name: /Colour/ }));
    expect(screen.getAllByTestId('variable-row')).toHaveLength(1);
    const variable = ed().doc.variables[0]!;

    ed().select([child.id]);
    render(<DesignTab />);
    await userEvent.selectOptions(screen.getByLabelText('Fill colour variable'), variable.id);
    expect(ed().doc.nodes[child.id]!.bindings?.fill).toBe(variable.id);
    expect(ed().doc.nodes[child.id]!.fills.at(-1)!.color).toBe('#3B82F6');

    const hex = screen.getAllByLabelText(/Colour 1 \(Mode 1\) hex/)[0]!;
    await userEvent.clear(hex);
    await userEvent.type(hex, 'ff8800{Enter}');
    expect(ed().doc.nodes[child.id]!.fills.at(-1)!.color).toBe('#FF8800');
  });
});
