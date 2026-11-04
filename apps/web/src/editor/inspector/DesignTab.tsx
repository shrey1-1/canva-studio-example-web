import { ExportSection } from './ExportSection';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Eye,
  EyeOff,
  Frame,
  Group,
  RotateCw,
  SquareDashed,
  Trash,
  Ungroup,
} from 'lucide-react';
import {
  FRAME_PRESETS,
  hasCornerRadius,
  isFrameLike,
  resizeNode,
  supportsEffects,
  topMostIds,
  updateNode,
  updatePage,
  type AlignMode,
  type NodeId,
  type NodePatch,
  type SceneNode,
} from '@canvas-studio/core';
import { selectActivePage, useEditor } from '../../state/editorStore';
import { IconButton } from '../../ui/IconButton';
import * as cmd from '../commands';
import { Checkbox, ColorField, NumberField, Row, Section } from './fields';
import { EffectsSection, FillsSection, StrokesSection } from './PaintSections';
import { ImageSection, LineSection, PolygonSection, TextSection, VectorSection } from './TypeSections';
import {
  AutoLayoutSection,
  BindingsSection,
  ComponentSection,
  ComponentSetSection,
  ConstraintsSection,
  InstanceSection,
  MinMaxRows,
  PresetSelect,
  SizingRow,
  VariableModesSection,
} from './Phase3Sections';

export const TYPE_LABEL: Record<SceneNode['type'], string> = {
  frame: 'Frame',
  component: 'Main component',
  'component-set': 'Component set',
  instance: 'Instance',
  group: 'Group',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  vector: 'Vector',
  text: 'Text',
  image: 'Image',
};

export function DesignTab() {
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  if (selection.length === 0 && tool === 'frame') return <FramePresets />;
  if (selection.length === 0) return <PageProperties />;
  return (
    <>
      {selection.length > 1 ? <MultiSelection ids={selection} /> : <NodeProperties id={selection[0]!} />}
      <ExportSection ids={selection} />
    </>
  );
}

/** With the Frame tool active: click a preset to add a frame of that size. */
function FramePresets() {
  const groups = [...new Set(FRAME_PRESETS.map((p) => p.group))];
  return (
    <Section title="Frame presets">
      <p className="text-fg-subtle">Drag on the canvas for a custom size, or pick a preset.</p>
      {groups.map((g) => (
        <div key={g}>
          <p className="mt-2 mb-1 text-2xs font-semibold text-fg-muted">{g}</p>
          {FRAME_PRESETS.filter((p) => p.group === g).map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => cmd.addPresetFrame(p)}
              className="flex h-7 w-full items-center justify-between rounded px-1.5 text-left text-fg hover:bg-hover"
            >
              <span>{p.name}</span>
              <span className="text-2xs text-fg-subtle tabular-nums">
                {p.width}×{p.height}
              </span>
            </button>
          ))}
        </div>
      ))}
    </Section>
  );
}

function PageProperties() {
  const page = useEditor(selectActivePage);
  const dispatch = useEditor((s) => s.dispatch);
  return (
    <Section title="Page">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-fg-muted">Background</span>
        <ColorField
          label="Page background"
          value={page.background}
          onChange={(background, live) =>
            dispatch('Page background', (d) => updatePage(d, page.id, { background }), live ? { coalesceKey: `page-bg:${page.id}` } : undefined)
          }
        />
      </div>
    </Section>
  );
}

const ALIGN: { mode: AlignMode; label: string; icon: typeof AlignStartVertical }[] = [
  { mode: 'left', label: 'Align left', icon: AlignStartVertical },
  { mode: 'h-center', label: 'Align horizontal centres', icon: AlignCenterVertical },
  { mode: 'right', label: 'Align right', icon: AlignEndVertical },
  { mode: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { mode: 'v-center', label: 'Align vertical centres', icon: AlignCenterHorizontal },
  { mode: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
];

/** Alignment to the selection bounds (several layers) or to the parent frame (one layer). */
function AlignBar() {
  // Re-render on document/selection changes so enabled states stay current.
  useEditor((s) => s.doc);
  useEditor((s) => s.selection);
  const can = cmd.canAlign();
  const canDistribute = cmd.editableSelection().length >= 3;
  return (
    <div role="toolbar" aria-label="Alignment" className="flex items-center justify-between border-b border-edge px-2 py-1.5">
      {ALIGN.map((a) => (
        <IconButton key={a.mode} label={a.label} disabled={!can} onClick={() => cmd.alignSelection(a.mode)}>
          <a.icon size={14} />
        </IconButton>
      ))}
      <IconButton label="Distribute horizontal spacing" disabled={!canDistribute} onClick={() => cmd.distributeSelection('horizontal')}>
        <AlignHorizontalDistributeCenter size={14} />
      </IconButton>
      <IconButton label="Distribute vertical spacing" disabled={!canDistribute} onClick={() => cmd.distributeSelection('vertical')}>
        <AlignVerticalDistributeCenter size={14} />
      </IconButton>
    </div>
  );
}

function MultiSelection({ ids }: { ids: NodeId[] }) {
  const doc = useEditor((s) => s.doc);
  const dispatch = useEditor((s) => s.dispatch);
  const top = topMostIds(doc, ids);
  const nodes = top.map((id) => doc.nodes[id]!);
  const sameOpacity = nodes.every((n) => n.opacity === nodes[0]!.opacity);
  return (
    <>
      <div className="border-b border-edge px-3 py-2.5">
        <p className="font-medium">{ids.length} layers selected</p>
      </div>
      <AlignBar />
      <Section title="Selection">
        <div className="flex flex-wrap gap-1.5">
          <ActionButton icon={<Group size={13} />} label="Group" onClick={() => cmd.groupSelection('group')} />
          <ActionButton icon={<Frame size={13} />} label="Frame" onClick={() => cmd.groupSelection('frame')} />
          <ActionButton icon={<SquareDashed size={13} />} label="Mask" onClick={cmd.useAsMask} />
          <ActionButton icon={<Trash size={13} />} label="Delete" onClick={() => cmd.deleteSelection()} />
        </div>
      </Section>
      <Section title="Appearance">
        <Row>
          <NumberField
            label="Opacity"
            prefix="Op"
            suffix="%"
            min={0}
            max={100}
            precision={0}
            value={sameOpacity ? nodes[0]!.opacity * 100 : NaN}
            onCommit={(v, m) =>
              dispatch('Opacity', (d) => top.forEach((id) => updateNode(d, id, { opacity: v / 100 })), m.stepping ? { coalesceKey: `opacity:${top.join()}` } : undefined)
            }
          />
        </Row>
      </Section>
    </>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 rounded border border-edge px-2 py-1 text-fg-muted hover:bg-hover hover:text-fg">
      {icon} {label}
    </button>
  );
}

function NodeProperties({ id }: { id: NodeId }) {
  const node = useEditor((s) => s.doc.nodes[id]);
  const dispatch = useEditor((s) => s.dispatch);
  if (!node) return null;

  /** One undo step per field; continuous changes (arrow keys, colour drag) merge. */
  const set = (label: string, patch: NodePatch, live = false) =>
    dispatch(label, (d) => updateNode(d, id, patch), live ? { coalesceKey: `${id}:${label}` } : undefined);
  const resize = (label: string, width: number, height: number, live: boolean) =>
    dispatch(label, (d) => resizeNode(d, id, width, height), live ? { coalesceKey: `${id}:${label}` } : undefined);

  return (
    <>
      <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-medium">{node.name}</p>
          <p className="text-2xs text-fg-subtle">
            {TYPE_LABEL[node.type]}
            {node.isMask ? ' · Mask' : ''}
            {node.locked ? ' · Locked' : ''}
          </p>
        </div>
        <div className="flex items-center">
          {(node.type === 'group' || node.type === 'frame') && (
            <IconButton label={node.type === 'group' ? 'Ungroup' : 'Remove frame'} onClick={cmd.ungroupSelection}>
              <Ungroup size={14} />
            </IconButton>
          )}
          <IconButton label="Delete layer" onClick={() => cmd.deleteSelection()}>
            <Trash size={14} />
          </IconButton>
        </div>
      </div>
      <AlignBar />

      {node.type === 'component' && <ComponentSection node={node} set={set} />}
      {node.type === 'component-set' && <ComponentSetSection node={node} />}
      {node.type === 'instance' && <InstanceSection node={node} />}

      <Section title="Position">
        <Row>
          <NumberField label="X" value={node.x} onCommit={(x, m) => set('X', { x }, m.stepping)} />
          <NumberField label="Y" value={node.y} onCommit={(y, m) => set('Y', { y }, m.stepping)} />
        </Row>
        <Row>
          <NumberField
            label="Rotation"
            prefix={<RotateCw size={11} aria-hidden="true" />}
            suffix="°"
            value={node.rotation}
            onCommit={(r, m) => set('Rotation', { rotation: ((r % 360) + 360) % 360 }, m.stepping)}
          />
        </Row>
      </Section>

      <Section title="Layout">
        <Row>
          <NumberField
            label={node.type === 'line' ? 'Length' : 'W'}
            prefix={node.type === 'line' ? 'L' : 'W'}
            value={node.width}
            min={node.type === 'line' ? 1 : 0.01}
            onCommit={(width, m) => resize('Width', width, node.height, m.stepping)}
          />
          {node.type !== 'line' && (
            <NumberField label="H" value={node.height} min={0.01} onCommit={(height, m) => resize('Height', node.width, height, m.stepping)} />
          )}
        </Row>
        {hasCornerRadius(node) && (
          <Row>
            <NumberField
              label="Corner radius"
              prefix="R"
              min={0}
              value={node.cornerRadius}
              onCommit={(cornerRadius, m) => set('Corner radius', { cornerRadius }, m.stepping)}
            />
          </Row>
        )}
        <SizingRow node={node} />
        <MinMaxRows node={node} set={set} />
        {isFrameLike(node) && node.type !== 'component-set' && <PresetSelect node={node} />}
        {isFrameLike(node) && <Checkbox label="Clip content" checked={node.clipContent} onChange={(clipContent) => set('Clip content', { clipContent })} />}
      </Section>

      {isFrameLike(node) && node.type !== 'component-set' && <AutoLayoutSection node={node} set={set} />}
      <ConstraintsSection node={node} set={set} />
      {isFrameLike(node) && <VariableModesSection node={node} />}

      {node.type === 'text' && <TextSection node={node} set={set} />}
      {node.type === 'image' && <ImageSection node={node} set={set} />}
      {(node.type === 'polygon' || node.type === 'star') && <PolygonSection node={node} set={set} />}
      {node.type === 'line' && <LineSection node={node} set={set} />}
      {node.type === 'vector' && <VectorSection node={node} set={set} />}

      <Section title="Appearance">
        <Row>
          <NumberField
            label="Opacity"
            prefix="Op"
            suffix="%"
            min={0}
            max={100}
            precision={0}
            value={node.opacity * 100}
            onCommit={(v, m) => set('Opacity', { opacity: v / 100 }, m.stepping)}
          />
          <button
            type="button"
            onClick={() => set(node.visible ? 'Hide' : 'Show', { visible: !node.visible })}
            className="flex h-7 items-center justify-center gap-1.5 rounded bg-app text-fg-muted hover:text-fg"
          >
            {node.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            {node.visible ? 'Visible' : 'Hidden'}
          </button>
        </Row>
        <Checkbox label="Use as mask" checked={node.isMask} onChange={(isMask) => set(isMask ? 'Use as mask' : 'Remove mask', { isMask })} />
      </Section>

      {node.type !== 'group' && <FillsSection node={node} set={set} />}
      {node.type !== 'group' && <StrokesSection node={node} set={set} />}
      {supportsEffects(node) && <EffectsSection node={node} set={set} />}
      <BindingsSection node={node} />
    </>
  );
}
