import { useEffect } from 'react';
import { translateWorld } from '@canvas-studio/core';
import { useEditor, type CanvasTool } from '../../state/editorStore';
import { useUi } from '../../state/uiStore';
import { useContextMenu } from '../../state/contextMenuStore';
import { fitToContent, zoomBy, zoomTo } from '../canvas/viewportActions';
import * as cmd from '../commands';
import { isTypingTarget } from './isTypingTarget';

const TOOL_KEYS: Record<string, CanvasTool> = {
  v: 'move',
  h: 'hand',
  f: 'frame',
  r: 'rectangle',
  o: 'ellipse',
  l: 'line',
  p: 'pen',
  t: 'text',
};

/** Event the toolbar listens for to open its image file picker. */
import { useCommentsUi } from '../../collab/CommentsLayer';

export const PLACE_IMAGE_EVENT = 'canvas-studio:place-image';

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'V / H / F / R / O / L / Shift+L / P / T', action: 'Move, Hand, Frame, Rectangle, Ellipse, Line, Arrow, Pen, Text' },
  { keys: 'Ctrl + Shift + K', action: 'Place image' },
  { keys: 'C', action: 'Add a comment' },
  { keys: 'Space + drag', action: 'Pan' },
  { keys: 'Ctrl + scroll', action: 'Zoom at pointer' },
  { keys: 'Ctrl + = / Ctrl + -', action: 'Zoom in / out' },
  { keys: 'Shift + 0 / 1 / 2', action: 'Zoom to 100% / fit / selection' },
  { keys: 'Ctrl + Z / Ctrl + Shift + Z', action: 'Undo / Redo' },
  { keys: 'Ctrl + C / X / V / D', action: 'Copy / Cut / Paste / Duplicate' },
  { keys: 'Ctrl + G / Ctrl + Shift + G', action: 'Group / Ungroup' },
  { keys: 'Ctrl + Alt + G', action: 'Frame selection' },
  { keys: 'Ctrl + Alt + M', action: 'Use as mask' },
  { keys: 'Ctrl + Alt + K / Ctrl + Alt + B', action: 'Create component / Detach instance' },
  { keys: 'Shift + A', action: 'Add auto layout' },
  { keys: 'Ctrl + ] / [ (+Shift)', action: 'Bring forward / Send backward (to front / back)' },
  { keys: 'Ctrl + Shift + H / L', action: 'Show/hide, Lock/unlock' },
  { keys: 'Enter / Shift + Enter', action: 'Edit text or select children / Select parent' },
  { keys: 'Ctrl + A', action: 'Select all' },
  { keys: 'Delete', action: 'Delete selection' },
  { keys: 'Arrows (+Shift)', action: 'Nudge 1px (10px)' },
  { keys: 'Ctrl + S', action: 'Save now' },
  { keys: "Ctrl + ' / Shift + R", action: 'Toggle grid / rulers' },
  { keys: 'Esc', action: 'Clear selection' },
];

/** Global editor keyboard shortcuts. Ignored while typing in a text field. */
export function useEditorShortcuts(saveNow: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || useContextMenu.getState().menu) return;
      const editor = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod) {
        if (key === 'z') return run(() => (e.shiftKey ? editor.redo() : editor.undo()));
        if (key === 'y') return run(editor.redo);
        if (key === 's') return run(saveNow);
        if (key === 'a') return run(cmd.selectAll);
        if (key === 'd') return run(cmd.duplicateSelection);
        if (key === 'g' && e.altKey) return run(() => cmd.groupSelection('frame'));
        if (key === 'g') return run(e.shiftKey ? cmd.ungroupSelection : () => cmd.groupSelection('group'));
        if (key === 'm' && e.altKey) return run(cmd.useAsMask);
        if (key === 'k' && e.altKey) return run(cmd.createComponentFromSelection);
        if (key === 'b' && e.altKey) return run(cmd.detachSelection);
        if (key === 'h' && e.shiftKey) return run(cmd.toggleVisibility);
        if (key === 'l' && e.shiftKey) return run(cmd.toggleLock);
        if (key === 'k' && e.shiftKey) return run(() => window.dispatchEvent(new Event(PLACE_IMAGE_EVENT)));
        if (e.code === 'BracketRight') return run(() => cmd.reorderSelection(e.shiftKey ? 'front' : 'forward'));
        if (e.code === 'BracketLeft') return run(() => cmd.reorderSelection(e.shiftKey ? 'back' : 'backward'));
        if (key === '=' || key === '+') return run(() => zoomBy(1.25));
        if (key === '-') return run(() => zoomBy(1 / 1.25));
        if (key === "'") return run(useUi.getState().toggleGrid);
        // Ctrl+C / X / V are handled by the clipboard events (see useClipboardEvents).
        return;
      }
      if (e.altKey) return;

      if (e.shiftKey && e.code === 'Digit0') return zoomTo(1);
      if (e.shiftKey && e.code === 'Digit1') return fitToContent();
      if (e.shiftKey && e.code === 'Digit2') return cmd.zoomToSelection();
      if (e.shiftKey && key === 'r') return useUi.getState().toggleRulers();
      if (e.shiftKey && key === 'l') return editor.setTool('arrow');
      if (e.shiftKey && key === 'a') return run(cmd.addAutoLayout);

      if (key === 'delete' || key === 'backspace') {
        if (editor.selection.length === 0) return;
        return run(() => cmd.deleteSelection());
      }
      if (key === 'escape') {
        editor.select([]);
        editor.setTool('move');
        return;
      }
      if (key === 'enter') {
        if (e.shiftKey) return run(cmd.selectParent);
        const only = editor.selection.length === 1 ? editor.doc.nodes[editor.selection[0]!] : undefined;
        if (only?.type === 'text' && !only.locked) return run(() => editor.setTextEdit({ id: only.id }));
        return run(cmd.selectChildren);
      }
      if (key.startsWith('arrow') && editor.selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        const ids = cmd.editableSelection();
        editor.dispatch(
          'Nudge',
          (d) => {
            for (const id of ids) translateWorld(d, id, dx, dy);
          },
          { coalesceKey: `nudge:${ids.join(',')}` },
        );
        return;
      }
      if (key === 'c' && !e.shiftKey) {
        const comments = useCommentsUi.getState();
        comments.setPlacing(!comments.placing);
        return;
      }
      const tool = !e.shiftKey ? TOOL_KEYS[key] : undefined;
      if (tool) {
        useCommentsUi.getState().setPlacing(false);
        editor.setTool(tool);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);
}

/** True when the user is selecting/copying page text rather than layers. */
const hasTextSelection = () => (window.getSelection()?.toString() ?? '') !== '';

/**
 * Copy / cut / paste through the browser's clipboard events. This needs no clipboard
 * permission and lets layers travel between tabs as JSON; pasting images or plain text
 * from other apps creates image or text layers.
 */
export function useClipboardEvents() {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (isTypingTarget(e.target) || hasTextSelection()) return;
      if (useEditor.getState().selection.length === 0) return;
      const text = cut ? cmd.cutSelection() : cmd.copySelection();
      if (!text || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || !e.clipboardData) return;
      const files = [...e.clipboardData.files];
      const text = e.clipboardData.getData('text/plain');
      if (files.length === 0 && !text) return;
      e.preventDefault();
      void cmd.pasteFromSystem(text, files);
    };
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', paste);
    };
  }, []);
}
