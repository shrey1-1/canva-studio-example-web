import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../state/editorStore';
import { useContextMenu } from '../state/contextMenuStore';
import { useUi } from '../state/uiStore';
import * as cmd from './commands';
import { fitToContent } from './canvas/viewportActions';

interface Item {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}
type Entry = Item | 'separator';

/** Writes copied layers to the system clipboard too, so they can be pasted in another tab. */
function writeSystemClipboard(text: string | null) {
  if (text) navigator.clipboard?.writeText(text).catch(() => undefined);
}

function buildItems(world: { x: number; y: number } | undefined): Entry[] {
  const { doc, selection } = useEditor.getState();
  const ids = cmd.editableSelection();
  const ui = useUi.getState();
  const paste: Entry[] = [
    { label: 'Paste', shortcut: 'Ctrl+V', run: () => void cmd.pasteFromMenu() },
    ...(world ? [{ label: 'Paste here', run: () => void cmd.pasteFromMenu(world) }] : []),
  ];
  if (selection.length === 0) {
    return [
      ...paste,
      'separator',
      { label: 'Select all', shortcut: 'Ctrl+A', run: cmd.selectAll },
      { label: 'Zoom to fit', shortcut: 'Shift+1', run: fitToContent },
      'separator',
      { label: ui.showGrid ? 'Hide grid' : 'Show grid', shortcut: "Ctrl+'", run: ui.toggleGrid },
      { label: ui.showRulers ? 'Hide rulers' : 'Show rulers', shortcut: 'Shift+R', run: ui.toggleRulers },
    ];
  }
  const none = ids.length === 0;
  const anyVisible = selection.some((id) => doc.nodes[id]?.visible);
  const anyUnlocked = selection.some((id) => !doc.nodes[id]?.locked);
  return [
    { label: 'Copy', shortcut: 'Ctrl+C', run: () => writeSystemClipboard(cmd.copySelection()) },
    { label: 'Cut', shortcut: 'Ctrl+X', disabled: none, run: () => writeSystemClipboard(cmd.cutSelection()) },
    ...paste,
    { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: none, run: cmd.duplicateSelection },
    { label: 'Delete', shortcut: 'Del', disabled: none, run: () => cmd.deleteSelection() },
    'separator',
    { label: 'Bring to front', shortcut: 'Ctrl+Shift+]', disabled: none, run: () => cmd.reorderSelection('front') },
    { label: 'Bring forward', shortcut: 'Ctrl+]', disabled: none, run: () => cmd.reorderSelection('forward') },
    { label: 'Send backward', shortcut: 'Ctrl+[', disabled: none, run: () => cmd.reorderSelection('backward') },
    { label: 'Send to back', shortcut: 'Ctrl+Shift+[', disabled: none, run: () => cmd.reorderSelection('back') },
    'separator',
    { label: 'Group selection', shortcut: 'Ctrl+G', disabled: !cmd.canGroup(), run: () => cmd.groupSelection('group') },
    { label: 'Frame selection', shortcut: 'Ctrl+Alt+G', disabled: !cmd.canGroup(), run: () => cmd.groupSelection('frame') },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', disabled: !cmd.canUngroup(), run: cmd.ungroupSelection },
    { label: cmd.isMaskSelection() ? 'Remove mask' : 'Use as mask', shortcut: 'Ctrl+Alt+M', disabled: none, run: cmd.useAsMask },
    { label: 'Add auto layout', shortcut: 'Shift+A', disabled: none, run: cmd.addAutoLayout },
    'separator',
    { label: 'Create component', shortcut: 'Ctrl+Alt+K', disabled: none, run: cmd.createComponentFromSelection },
    ...(cmd.canCombineVariants() ? [{ label: 'Combine as variants', run: cmd.combineVariants }] : []),
    ...(cmd.canDetach()
      ? [
          { label: 'Go to main component', run: cmd.goToMainComponent },
          { label: 'Reset overrides', run: cmd.resetSelectionOverrides },
          { label: 'Detach instance', shortcut: 'Ctrl+Alt+B', run: cmd.detachSelection },
        ]
      : []),
    'separator',
    { label: anyVisible ? 'Hide' : 'Show', shortcut: 'Ctrl+Shift+H', run: cmd.toggleVisibility },
    { label: anyUnlocked ? 'Lock' : 'Unlock', shortcut: 'Ctrl+Shift+L', run: cmd.toggleLock },
    'separator',
    { label: 'Zoom to selection', shortcut: 'Shift+2', run: cmd.zoomToSelection },
  ];
}

/** Right-click menu for the canvas and the Layers panel. */
export function ContextMenu() {
  const menu = useContextMenu((s) => s.menu);
  const close = useContextMenu((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [entries, setEntries] = useState<Entry[]>([]);

  useLayoutEffect(() => {
    if (!menu) return;
    setEntries(buildItems(menu.world));
    setPos({ x: menu.x, y: menu.y });
  }, [menu]);

  // Keep the menu on screen and focus its first enabled item.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 4);
    const y = Math.min(menu.y, window.innerHeight - r.height - 4);
    if (x !== pos.x || y !== pos.y) setPos({ x: Math.max(4, x), y: Math.max(4, y) });
    el.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [entries]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu, close]);

  if (!menu) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Layer actions"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-56 rounded-md border border-edge bg-sidebar py-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          <div key={`sep${i}`} role="separator" className="my-1 h-px bg-edge" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            aria-disabled={entry.disabled || undefined}
            tabIndex={-1}
            onClick={() => {
              if (entry.disabled) return;
              close();
              entry.run();
            }}
            className={`flex h-7 w-full items-center justify-between gap-6 px-3 text-left outline-none ${
              entry.disabled ? 'cursor-default text-fg-subtle' : 'text-fg hover:bg-accent focus:bg-accent'
            }`}
          >
            <span>{entry.label}</span>
            {entry.shortcut && <kbd className="text-2xs text-fg-subtle">{entry.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
