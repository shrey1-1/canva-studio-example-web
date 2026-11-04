import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUi } from '../../state/uiStore';
import { SecondaryPanel } from '../panels/SecondaryPanel';
import { NavRail } from './NavRail';

function renderNav() {
  return render(
    <>
      <NavRail />
      <SecondaryPanel />
    </>,
  );
}

describe('NavRail', () => {
  beforeEach(() => useUi.setState({ nav: 'file', panelOpen: true }));

  it('renders all five workspaces with accessible names', () => {
    renderNav();
    for (const name of ['File', 'Agents', 'Assets', 'Tools', 'Variables']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: 'File' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches the secondary panel without reloading', async () => {
    renderNav();
    await userEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search all tools')).toBeInTheDocument();
  });

  it('collapses the panel when the active section is clicked again', async () => {
    renderNav();
    await userEvent.click(screen.getByRole('tab', { name: 'File' }));
    expect(useUi.getState().panelOpen).toBe(false);
    await userEvent.click(screen.getByRole('tab', { name: 'File' }));
    expect(useUi.getState().panelOpen).toBe(true);
  });

  it('supports arrow-key navigation and Enter to activate', async () => {
    renderNav();
    screen.getByRole('tab', { name: 'File' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Variables' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(useUi.getState().nav).toBe('variables');
  });

  it('persists the navigation state to localStorage', async () => {
    renderNav();
    await userEvent.click(screen.getByRole('tab', { name: 'Assets' }));
    const saved = JSON.parse(localStorage.getItem('canvas-studio:ui')!);
    expect(saved.state.nav).toBe('assets');
  });
});
