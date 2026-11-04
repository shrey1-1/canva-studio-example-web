import { useEffect, useRef, useState } from 'react';
import {
  addNode,
  decompose,
  deleteNodes,
  localMatrix,
  multiply,
  updateNode,
  worldMatrix,
  worldToScreen,
  type TextNode,
} from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import { toRgba } from './paint';
import { cssFontFamily, measureText } from './textMeasure';

/** Default layer name for text: its first characters, until the user renames it. */
export const textLayerName = (characters: string) => characters.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Text';

/**
 * Edits a text layer in place: a transparent textarea laid exactly over the layer, using the
 * same font metrics. Escape, Ctrl+Enter or clicking elsewhere commits; an emptied text is removed.
 */
export function TextEditor() {
  const edit = useEditor((s) => s.textEdit);
  const liveNode = useEditor((s) => (s.textEdit && !s.textEdit.draft ? s.doc.nodes[s.textEdit.id] : undefined));
  const doc = useEditor((s) => s.doc);
  const viewport = useEditor((s) => s.viewport);
  const node = (edit?.draft ?? liveNode) as TextNode | undefined;
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    if (!edit) return;
    committed.current = false;
    const current = edit.draft ?? (useEditor.getState().doc.nodes[edit.id] as TextNode | undefined);
    setValue(current?.characters ?? '');
    // Focus after the textarea is positioned.
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }, [edit?.id]);

  if (!edit || !node || node.type !== 'text') return null;

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const { dispatch, select, setTextEdit, doc: d } = useEditor.getState();
    setTextEdit(null);
    const text = value;
    if (edit.draft) {
      if (text.trim() === '') return;
      const created = { ...edit.draft, characters: text, name: textLayerName(text) };
      dispatch('Add text', (draft) => addNode(draft, created));
      select([created.id]);
      return;
    }
    const existing = d.nodes[edit.id];
    if (!existing || existing.type !== 'text') return;
    if (text.trim() === '') {
      dispatch('Delete text', (draft) => deleteNodes(draft, [edit.id]));
      return;
    }
    if (text !== existing.characters) {
      const autoNamed = existing.name === textLayerName(existing.characters) || existing.name === 'Text';
      dispatch('Edit text', (draft) =>
        updateNode(draft, edit.id, { characters: text, ...(autoNamed ? { name: textLayerName(text) } : {}) }),
      );
    }
    select([edit.id]);
  };

  const parent = node.parentId && doc.nodes[node.parentId] ? worldMatrix(doc, node.parentId) : null;
  const world = decompose(parent ? multiply(parent, localMatrix(node)) : localMatrix(node));
  const screen = worldToScreen(viewport, world);
  const autoWidth = node.autoResize === 'width-and-height';
  const measured = measureText({ ...node, characters: value }, autoWidth ? null : node.width);
  const width = autoWidth ? measured.width + node.fontSize * 0.6 : node.width;
  const height = node.autoResize === 'none' ? node.height : measured.height;
  const fill = [...node.fills].reverse().find((f) => f.visible);
  const zoom = viewport.zoom;

  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          commit();
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute z-20 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
      style={{
        left: screen.x,
        top: screen.y,
        width,
        height,
        transform: `rotate(${world.rotation}deg) scale(${zoom})`,
        transformOrigin: '0 0',
        fontFamily: cssFontFamily(node.fontFamily),
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        fontStyle: node.italic ? 'italic' : 'normal',
        lineHeight: node.lineHeight,
        letterSpacing: node.letterSpacing,
        textAlign: node.textAlign,
        textDecoration: node.textDecoration === 'none' ? 'none' : node.textDecoration,
        color: fill ? toRgba(fill.color, fill.opacity) : 'transparent',
        caretColor: '#3B82F6',
        whiteSpace: autoWidth ? 'pre' : 'pre-wrap',
        overflowWrap: 'break-word',
        boxShadow: `0 0 0 ${1 / zoom}px #3B82F6`,
      }}
    />
  );
}
