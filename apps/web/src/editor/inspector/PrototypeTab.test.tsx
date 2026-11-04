import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { addNode, createDocument, createFrame, createRectangle } from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import { PrototypeTab } from './PrototypeTab';

function setup() {
  const doc = createDocument('Proto');
  const pageId = doc.pages[0]!.id;
  const home = createFrame({ pageId, name: 'Home', x: 0, y: 0, width: 300, height: 600 });
  const detail = createFrame({ pageId, name: 'Detail', x: 400, y: 0, width: 300, height: 600 });
  addNode(doc, home);
  addNode(doc, detail);
  const button = createRectangle({ pageId, parentId: home.id, name: 'Button', x: 20, y: 20, width: 80, height: 30 });
  addNode(doc, button);
  useEditor.getState().loadDocument(doc);
  return { home: home.id, detail: detail.id, button: button.id };
}

const renderTab = () => render(<MemoryRouter><PrototypeTab /></MemoryRouter>);

describe('PrototypeTab', () => {
  beforeEach(() => useEditor.getState().loadDocument(createDocument()));

  it('picks the starting screen when nothing is selected', async () => {
    const { detail } = setup();
    renderTab();
    await userEvent.selectOptions(screen.getByLabelText('Starting screen'), detail);
    expect(useEditor.getState().doc.pages[0]!.flowStartId).toBe(detail);
  });

  it('adds a click → navigate interaction and edits it, as undoable steps', async () => {
    const { button, detail } = setup();
    useEditor.getState().select([button]);
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add interaction' }));
    const node = () => useEditor.getState().doc.nodes[button]!;
    expect(node().interactions?.[0]).toMatchObject({ trigger: 'click', action: { type: 'navigate', destinationId: detail } });

    await userEvent.selectOptions(screen.getByLabelText('Trigger'), 'hover');
    await userEvent.selectOptions(screen.getByLabelText('Animation'), 'push-left');
    expect(node().interactions?.[0]).toMatchObject({ trigger: 'hover', action: { transition: { type: 'push-left' } } });

    await userEvent.selectOptions(screen.getByLabelText('Action'), 'url');
    const url = screen.getByLabelText('Link URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'javascript:alert(1){Enter}');
    expect(screen.getByText(/other links are not opened/)).toBeInTheDocument();

    useEditor.getState().undo();
    useEditor.getState().undo();
    expect(node().interactions?.[0]?.action.type).toBe('navigate');

    await userEvent.click(screen.getByRole('button', { name: 'Remove interaction' }));
    expect(node().interactions).toEqual([]);
  });

  it('sets a screen to scroll and explains layers outside frames', async () => {
    const { home } = setup();
    useEditor.getState().select([home]);
    const { unmount } = renderTab();
    await userEvent.selectOptions(screen.getByLabelText('Overflow scrolling'), 'vertical');
    expect(useEditor.getState().doc.nodes[home]).toMatchObject({ scroll: 'vertical' });
    unmount();

    const doc = useEditor.getState().doc;
    const loose = createRectangle({ pageId: doc.pages[0]!.id, name: 'Loose', x: 900, y: 0, width: 10, height: 10 });
    useEditor.getState().dispatch('add', (d) => addNode(d, loose));
    useEditor.getState().select([loose.id]);
    renderTab();
    expect(screen.getByText(/Put this layer inside a frame/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add interaction' })).toBeNull();
  });
});
