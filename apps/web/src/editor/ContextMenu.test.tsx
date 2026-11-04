import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addNode, createDocument, createRectangle } from '@canvas-studio/core';
import { useEditor } from '../state/editorStore';
import { useContextMenu } from '../state/contextMenuStore';
import { ContextMenu } from './ContextMenu';

describe('ContextMenu', () => {
  beforeEach(() => useContextMenu.getState().close());

  it('lists layer actions for a selection and runs them', async () => {
    const doc = createDocument();
    const a = createRectangle({ pageId: doc.pages[0]!.id });
    const b = createRectangle({ pageId: doc.pages[0]!.id });
    addNode(doc, a);
    addNode(doc, b);
    useEditor.getState().loadDocument(doc);
    useEditor.getState().select([a.id, b.id]);
    render(<ContextMenu />);
    useContextMenu.getState().open({ x: 10, y: 10, world: { x: 0, y: 0 } });

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Ungroup/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: /Group selection/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    const selected = useEditor.getState().selection;
    expect(useEditor.getState().doc.nodes[selected[0]!]!.type).toBe('group');
  });

  it('shows canvas actions with nothing selected and closes on Escape', async () => {
    useEditor.getState().loadDocument(createDocument());
    render(<ContextMenu />);
    useContextMenu.getState().open({ x: 10, y: 10, world: { x: 0, y: 0 } });
    expect(await screen.findByRole('menuitem', { name: /Paste here/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Select all/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
