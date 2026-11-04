import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_TOOL_QUERY } from '@canvas-studio/core';
import { useUi } from '../../state/uiStore';
import { ToolsPanel } from './ToolsPanel';

const toolNames = () =>
  within(screen.getByRole('list', { name: 'Tools' }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'));

describe('ToolsPanel', () => {
  beforeEach(() => useUi.setState({ toolQuery: DEFAULT_TOOL_QUERY, installedTools: [], toolUsage: {} }));

  it('lists all 13 tools with publisher and category', () => {
    render(<ToolsPanel />);
    expect(toolNames()).toHaveLength(13);
    // Nebula, Pixel Stretch, Fractal Noise and Clouds are the four Effects tools.
    expect(screen.getAllByText('Canvas Studio · Effects · v1.0.0')).toHaveLength(4);
  });

  it('searches by name and by description', async () => {
    render(<ToolsPanel />);
    const search = screen.getByPlaceholderText('Search all tools');
    await userEvent.type(search, 'bento');
    expect(toolNames()).toEqual(['Bento Grid Builder']);
    await userEvent.clear(search);
    await userEvent.type(search, 'device');
    expect(toolNames()).toEqual(['Phone Mockup']);
  });

  it('filters by category and shows an empty state with a reset', async () => {
    render(<ToolsPanel />);
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Mockups');
    expect(toolNames().sort()).toEqual(['Generate Mockup', 'Phone Mockup']);
    await userEvent.selectOptions(screen.getByLabelText('Installation status'), 'installed');
    expect(screen.getByText('No tools match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(toolNames()).toHaveLength(13);
  });

  it('installs and uninstalls a tool and persists it', async () => {
    render(<ToolsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Install Clouds' }));
    expect(useUi.getState().installedTools).toEqual(['clouds']);
    expect(JSON.parse(localStorage.getItem('canvas-studio:ui')!).state.installedTools).toEqual(['clouds']);
    // Installed tools move to the top of "Suggested".
    expect(toolNames()[0]).toBe('Clouds');
    await userEvent.click(screen.getByRole('button', { name: 'Uninstall Clouds' }));
    expect(useUi.getState().installedTools).toEqual([]);
  });
});
