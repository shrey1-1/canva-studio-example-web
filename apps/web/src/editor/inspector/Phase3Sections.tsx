import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, Minus, Plus, RotateCcw, Target, Unlink } from 'lucide-react';
import {
  BINDABLE_TYPES,
  DEFAULT_AUTO_LAYOUT,
  FRAME_PRESETS,
  bindVariable,
  canBind,
  duplicateNodes,
  isFrameLike,
  resizeNode,
  setInstanceVariant,
  unbindVariable,
  updateNode,
  variantOptions,
  type AutoLayout,
  type BindableField,
  type ComponentNode,
  type ConstraintH,
  type ConstraintV,
  type FrameLikeNode,
  type InstanceNode,
  type SceneNode,
  type SizingMode,
} from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import { IconButton } from '../../ui/IconButton';
import * as cmd from '../commands';
import { NumberField, Row, Section, Segmented, SelectField } from './fields';
import type { SetNode } from './PaintSections';

const ACTION = 'flex items-center gap-1.5 rounded border border-edge px-2 py-1 text-fg-muted hover:bg-hover hover:text-fg';

// ----- Components ------------------------------------------------------------

export function ComponentSection({ node, set }: { node: ComponentNode; set: SetNode }) {
  const doc = useEditor((s) => s.doc);
  const dispatch = useEditor((s) => s.dispatch);
  const inSet = node.parentId !== null && doc.nodes[node.parentId]?.type === 'component-set';
  const [description, setDescription] = useState(node.description);
  useEffect(() => setDescription(node.description), [node.description]);
  const entries = Object.entries(node.variantProps);

  const setProps = (variantProps: Record<string, string>, label = 'Variant property') =>
    dispatch(label, (d) => {
      const c = d.nodes[node.id];
      if (c?.type === 'component') c.variantProps = variantProps;
    });

  return (
    <Section title="Main component">
      <textarea
        aria-label="Component description"
        placeholder="Description"
        value={description}
        maxLength={2000}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== node.description && set('Component description', { description } as never)}
        className="h-14 w-full resize-none rounded border border-transparent bg-app p-1.5 text-fg outline-none hover:border-edge focus:border-accent"
      />
      {inSet && (
        <div className="space-y-1.5">
          <p className="text-2xs text-fg-subtle">Variant properties</p>
          {entries.map(([key, value], i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
              <TextInput label={`Property ${i + 1} name`} value={key} onCommit={(k) => setProps(Object.fromEntries(entries.map(([ek, ev]) => (ek === key ? [k, ev] : [ek, ev]))))} />
              <TextInput label={`Property ${i + 1} value`} value={value} onCommit={(v) => setProps({ ...node.variantProps, [key]: v })} />
              <IconButton label={`Remove property ${key}`} onClick={() => setProps(Object.fromEntries(entries.filter(([ek]) => ek !== key)))}>
                <Minus size={13} />
              </IconButton>
            </div>
          ))}
          <button type="button" className={ACTION} onClick={() => setProps({ ...node.variantProps, [`Property ${entries.length + 1}`]: 'Default' }, 'Add variant property')}>
            <Plus size={13} /> Add property
          </button>
        </div>
      )}
      <button type="button" className={ACTION} onClick={() => cmd.insertInstance(node.id)}>
        <Plus size={13} /> Create instance
      </button>
    </Section>
  );
}

export function ComponentSetSection({ node }: { node: FrameLikeNode }) {
  const doc = useEditor((s) => s.doc);
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  const options = variantOptions(doc, node.id);
  const addVariant = () => {
    const last = node.childIds.at(-1);
    if (!last) return;
    let created: string[] = [];
    dispatch('Add variant', (d) => {
      created = duplicateNodes(d, [last], { x: 0, y: d.nodes[last]!.height + 20 });
      const c = d.nodes[created[0]!];
      if (c?.type === 'component') {
        const firstKey = Object.keys(c.variantProps)[0] ?? 'Property';
        c.variantProps = { ...c.variantProps, [firstKey]: `Variant ${node.childIds.length + 1}` };
      }
    });
    select(created);
  };
  return (
    <Section title="Component set">
      {Object.entries(options).map(([prop, values]) => (
        <p key={prop} className="text-fg-muted">
          <span className="text-fg">{prop}:</span> {values.join(', ')}
        </p>
      ))}
      <button type="button" className={ACTION} onClick={addVariant}>
        <Plus size={13} /> Add variant
      </button>
    </Section>
  );
}

/** Small text input that commits on Enter/blur. */
function TextInput({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const t = draft.trim();
    if (t && t !== value) onCommit(t);
    else setDraft(value);
  };
  return (
    <input
      aria-label={label}
      value={draft}
      maxLength={100}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="h-7 min-w-0 rounded border border-transparent bg-app px-1.5 text-fg outline-none hover:border-edge focus:border-accent"
    />
  );
}

export function InstanceSection({ node }: { node: InstanceNode }) {
  const doc = useEditor((s) => s.doc);
  const dispatch = useEditor((s) => s.dispatch);
  const comp = doc.nodes[node.componentId] as ComponentNode | undefined;
  const setId = comp?.parentId && doc.nodes[comp.parentId]?.type === 'component-set' ? comp.parentId : null;
  const options = setId ? variantOptions(doc, setId) : {};
  const hasOverrides = (n: SceneNode): boolean =>
    (n.overrides?.length ?? 0) > 0 || ('childIds' in n && n.childIds.some((c) => doc.nodes[c] && hasOverrides(doc.nodes[c]!)));
  return (
    <Section title="Instance">
      <p className="truncate text-fg-muted">
        Of <span className="text-purple-300">{comp?.name ?? 'missing component'}</span>
      </p>
      {comp &&
        Object.entries(options).map(([prop, values]) => (
          <div key={prop} className="grid grid-cols-[5rem_1fr] items-center gap-2">
            <span className="truncate text-fg-muted">{prop}</span>
            <SelectField
              label={prop}
              value={comp.variantProps[prop] ?? values[0]!}
              options={values.map((v) => ({ value: v, label: v }))}
              onChange={(v) => dispatch('Switch variant', (d) => void setInstanceVariant(d, node.id, prop, v))}
            />
          </div>
        ))}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ACTION} onClick={cmd.goToMainComponent}>
          <Target size={13} /> Go to main
        </button>
        <button type="button" className={ACTION} disabled={!hasOverrides(node)} onClick={cmd.resetSelectionOverrides}>
          <RotateCcw size={13} /> Reset
        </button>
        <button type="button" className={ACTION} onClick={cmd.detachSelection}>
          <Unlink size={13} /> Detach
        </button>
      </div>
    </Section>
  );
}

// ----- Layout ------------------------------------------------------------------

/** Fixed / Hug / Fill for each axis. Text maps these to its auto-resize setting. */
export function SizingRow({ node }: { node: SceneNode }) {
  const doc = useEditor((s) => s.doc);
  const dispatch = useEditor((s) => s.dispatch);
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  const inAutoLayout = !!parent && isFrameLike(parent) && !!parent.layout;
  const canHug = (isFrameLike(node) && !!node.layout) || node.type === 'text';
  if (!canHug && !inAutoLayout) return null;
  const options = (axis: 'horizontal' | 'vertical') =>
    [
      { value: 'fixed' as SizingMode, label: 'Fixed' },
      ...(canHug ? [{ value: 'hug' as SizingMode, label: 'Hug' }] : []),
      ...(inAutoLayout && !(node.type === 'line' && axis === 'vertical') ? [{ value: 'fill' as SizingMode, label: 'Fill' }] : []),
    ];
  const change = (axis: 'horizontal' | 'vertical', mode: SizingMode) =>
    dispatch('Resizing', (d) => {
      const n = d.nodes[node.id]!;
      let sizing = { ...n.sizing, [axis]: mode };
      if (n.type !== 'text') return updateNode(d, n.id, { sizing });
      let autoResize = n.autoResize;
      if (axis === 'horizontal') autoResize = mode === 'hug' ? 'width-and-height' : autoResize === 'width-and-height' ? 'height' : autoResize;
      else autoResize = mode === 'hug' ? (autoResize === 'none' ? 'height' : autoResize) : 'none';
      if (autoResize === 'width-and-height') sizing = { horizontal: 'hug', vertical: 'hug' };
      updateNode(d, n.id, { sizing, autoResize });
    });
  return (
    <Row>
      <SelectField label="Horizontal resizing" value={node.sizing.horizontal} options={options('horizontal')} onChange={(m) => change('horizontal', m)} />
      <SelectField label="Vertical resizing" value={node.sizing.vertical} options={options('vertical')} onChange={(m) => change('vertical', m)} />
    </Row>
  );
}

/** Number input where empty means "no limit". */
function OptionalNumber({ label, prefix, value, onCommit }: { label: string; prefix: string; value: number | null; onCommit: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const t = draft.trim();
    const next = t === '' ? null : Number(t);
    if (next !== null && !(Number.isFinite(next) && next >= 0)) return setDraft(value === null ? '' : String(value));
    if (next !== value) onCommit(next);
  };
  return (
    <label className="flex h-7 min-w-0 items-center gap-1.5 rounded border border-transparent bg-app px-2 hover:border-edge focus-within:border-accent">
      <span className="shrink-0 text-2xs text-fg-subtle">{prefix}</span>
      <input
        aria-label={label}
        placeholder="—"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-full min-w-0 bg-transparent text-fg outline-none tabular-nums"
      />
    </label>
  );
}

export function MinMaxRows({ node, set }: { node: SceneNode; set: SetNode }) {
  const [open, setOpen] = useState(node.minWidth !== null || node.maxWidth !== null || node.minHeight !== null || node.maxHeight !== null);
  if (!open) {
    return (
      <button type="button" className="text-2xs text-fg-subtle hover:text-fg" onClick={() => setOpen(true)}>
        + Min / max size
      </button>
    );
  }
  return (
    <>
      <Row>
        <OptionalNumber label="Min width" prefix="Min W" value={node.minWidth} onCommit={(minWidth) => set('Min width', { minWidth })} />
        <OptionalNumber label="Max width" prefix="Max W" value={node.maxWidth} onCommit={(maxWidth) => set('Max width', { maxWidth })} />
      </Row>
      <Row>
        <OptionalNumber label="Min height" prefix="Min H" value={node.minHeight} onCommit={(minHeight) => set('Min height', { minHeight })} />
        <OptionalNumber label="Max height" prefix="Max H" value={node.maxHeight} onCommit={(maxHeight) => set('Max height', { maxHeight })} />
      </Row>
    </>
  );
}

/** Resize a frame to a common device size; children follow their constraints. */
export function PresetSelect({ node }: { node: FrameLikeNode }) {
  const dispatch = useEditor((s) => s.dispatch);
  const match = FRAME_PRESETS.findIndex((p) => p.width === node.width && p.height === node.height);
  return (
    <SelectField
      label="Size preset"
      value={match}
      className="w-full"
      options={[{ value: -1, label: 'Size preset…' }, ...FRAME_PRESETS.map((p, i) => ({ value: i, label: `${p.group} · ${p.name} (${p.width}×${p.height})` }))]}
      onChange={(i) => {
        const p = FRAME_PRESETS[i];
        if (p) dispatch('Resize to preset', (d) => resizeNode(d, node.id, p.width, p.height));
      }}
    />
  );
}

const ALIGN_OPTIONS = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
] as const;

export function AutoLayoutSection({ node, set }: { node: FrameLikeNode; set: SetNode }) {
  const L = node.layout;
  const update = (patch: Partial<AutoLayout>, live = false, label = 'Auto layout') => set(label, { layout: { ...(L ?? DEFAULT_AUTO_LAYOUT), ...patch } }, live);
  return (
    <Section
      title="Auto layout"
      action={
        L ? (
          <IconButton label="Remove auto layout" onClick={() => set('Remove auto layout', { layout: null })}>
            <Minus size={14} />
          </IconButton>
        ) : (
          <IconButton label="Add auto layout" shortcut="Shift+A" onClick={cmd.addAutoLayout}>
            <Plus size={14} />
          </IconButton>
        )
      }
    >
      {L && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Segmented
              label="Direction"
              value={L.direction}
              onChange={(direction) => update({ direction })}
              options={[
                { value: 'vertical', label: 'Vertical', icon: <ArrowDown size={14} /> },
                { value: 'horizontal', label: 'Horizontal', icon: <ArrowRight size={14} /> },
              ]}
            />
            <NumberField label="Gap" prefix="Gap" min={0} value={L.gap} onCommit={(gap, m) => update({ gap }, m.stepping, 'Gap')} />
          </div>
          <Row>
            <NumberField label="Padding top" prefix="T" min={0} value={L.paddingTop} onCommit={(v, m) => update({ paddingTop: v }, m.stepping, 'Padding')} />
            <NumberField label="Padding right" prefix="R" min={0} value={L.paddingRight} onCommit={(v, m) => update({ paddingRight: v }, m.stepping, 'Padding')} />
          </Row>
          <Row>
            <NumberField label="Padding bottom" prefix="B" min={0} value={L.paddingBottom} onCommit={(v, m) => update({ paddingBottom: v }, m.stepping, 'Padding')} />
            <NumberField label="Padding left" prefix="L" min={0} value={L.paddingLeft} onCommit={(v, m) => update({ paddingLeft: v }, m.stepping, 'Padding')} />
          </Row>
          <Row>
            <SelectField
              label="Align along"
              value={L.primaryAlign}
              options={[...ALIGN_OPTIONS, { value: 'space-between', label: 'Space between' }]}
              onChange={(primaryAlign) => update({ primaryAlign })}
            />
            <SelectField label="Align across" value={L.counterAlign} options={ALIGN_OPTIONS} onChange={(counterAlign) => update({ counterAlign })} />
          </Row>
        </>
      )}
    </Section>
  );
}

const H_OPTIONS: { value: ConstraintH; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'left-right', label: 'Left & right' },
  { value: 'center', label: 'Center' },
  { value: 'scale', label: 'Scale' },
];
const V_OPTIONS: { value: ConstraintV; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'top-bottom', label: 'Top & bottom' },
  { value: 'center', label: 'Center' },
  { value: 'scale', label: 'Scale' },
];

/** Shown for layers inside a frame without auto layout. */
export function ConstraintsSection({ node, set }: { node: SceneNode; set: SetNode }) {
  const parent = useEditor((s) => (node.parentId ? s.doc.nodes[node.parentId] : undefined));
  if (!parent || !isFrameLike(parent) || parent.layout) return null;
  return (
    <Section title="Constraints">
      <Row>
        <SelectField label="Horizontal constraint" value={node.constraints.horizontal} options={H_OPTIONS} onChange={(horizontal) => set('Constraints', { constraints: { ...node.constraints, horizontal } })} />
        <SelectField label="Vertical constraint" value={node.constraints.vertical} options={V_OPTIONS} onChange={(vertical) => set('Constraints', { constraints: { ...node.constraints, vertical } })} />
      </Row>
    </Section>
  );
}

// ----- Variables -----------------------------------------------------------------

/** Which mode of each multi-mode collection this frame (and its contents) uses. */
export function VariableModesSection({ node }: { node: FrameLikeNode }) {
  const collections = useEditor((s) => s.doc.variableCollections).filter((c) => c.modes.length > 1);
  const dispatch = useEditor((s) => s.dispatch);
  if (collections.length === 0) return null;
  return (
    <Section title="Variable modes">
      {collections.map((c) => (
        <div key={c.id} className="grid grid-cols-[5rem_1fr] items-center gap-2">
          <span className="truncate text-fg-muted">{c.name}</span>
          <SelectField
            label={`${c.name} mode`}
            value={node.variableModes?.[c.id] ?? ''}
            options={[{ value: '', label: 'Inherit' }, ...c.modes.map((m) => ({ value: m.id, label: m.name }))]}
            onChange={(modeId) =>
              dispatch('Variable mode', (d) => {
                const f = d.nodes[node.id];
                if (!f || !isFrameLike(f)) return;
                const next = { ...f.variableModes };
                if (modeId) next[c.id] = modeId;
                else delete next[c.id];
                if (Object.keys(next).length) updateNode(d, f.id, { variableModes: next });
                else updateNode(d, f.id, { variableModes: undefined });
              })
            }
          />
        </div>
      ))}
    </Section>
  );
}

const FIELD_LABEL: Record<BindableField, string> = {
  fill: 'Fill colour',
  stroke: 'Stroke colour',
  opacity: 'Opacity (%)',
  cornerRadius: 'Corner radius',
  width: 'Width',
  height: 'Height',
  gap: 'Gap',
  padding: 'Padding',
  fontSize: 'Font size',
  characters: 'Text',
  visible: 'Visible',
};

/** Binds properties of the selected layer to variables of the matching type. */
export function BindingsSection({ node }: { node: SceneNode }) {
  const variables = useEditor((s) => s.doc.variables);
  const collections = useEditor((s) => s.doc.variableCollections);
  const dispatch = useEditor((s) => s.dispatch);
  if (variables.length === 0) return null;
  const fields = (Object.keys(BINDABLE_TYPES) as BindableField[]).filter((f) => canBind(node, f));
  const colName = (id: string) => collections.find((c) => c.id === id)?.name ?? '';
  return (
    <Section title="Variables">
      {fields.map((field) => {
        const matching = variables.filter((v) => v.type === BINDABLE_TYPES[field]);
        if (matching.length === 0 && !node.bindings?.[field]) return null;
        return (
          <div key={field} className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
            <span className="truncate text-fg-muted">{FIELD_LABEL[field]}</span>
            <SelectField
              label={`${FIELD_LABEL[field]} variable`}
              value={node.bindings?.[field] ?? ''}
              options={[{ value: '', label: 'Not bound' }, ...matching.map((v) => ({ value: v.id, label: `${colName(v.collectionId)} / ${v.name}` }))]}
              onChange={(variableId) =>
                dispatch(variableId ? 'Bind variable' : 'Unbind variable', (d) =>
                  variableId ? bindVariable(d, node.id, field, variableId) : unbindVariable(d, node.id, field),
                )
              }
            />
          </div>
        );
      })}
    </Section>
  );
}
