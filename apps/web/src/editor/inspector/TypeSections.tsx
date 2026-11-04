import {
  ArrowLeftRight,
  Italic,
  MoveHorizontal,
  MoveVertical,
  Scaling,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  X,
} from 'lucide-react';
import {
  FONT_FAMILIES,
  FONT_WEIGHTS,
  type CropRect,
  type ImageFit,
  type ImageNode,
  type LineCap,
  type LineNode,
  type PolygonNode,
  type StarNode,
  type TextAutoResize,
  type TextNode,
  type VectorNode,
} from '@canvas-studio/core';
import { IconButton } from '../../ui/IconButton';
import { Checkbox, NumberField, Row, Section, Segmented, SelectField } from './fields';
import type { SetNode } from './PaintSections';

export function TextSection({ node, set }: { node: TextNode; set: SetNode }) {
  const families = (FONT_FAMILIES as readonly string[]).includes(node.fontFamily) ? FONT_FAMILIES : [node.fontFamily, ...FONT_FAMILIES];
  return (
    <Section title="Text">
      <SelectField
        label="Font family"
        value={node.fontFamily}
        options={families.map((f) => ({ value: f, label: f }))}
        onChange={(fontFamily) => set('Font', { fontFamily })}
        className="w-full"
      />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <SelectField
          label="Font weight"
          value={node.fontWeight}
          options={FONT_WEIGHTS}
          onChange={(fontWeight) => set('Font weight', { fontWeight })}
        />
        <IconButton label={node.italic ? 'Italic: on' : 'Italic: off'} active={node.italic} onClick={() => set('Italic', { italic: !node.italic })}>
          <Italic size={14} />
        </IconButton>
      </div>
      <Row>
        <NumberField label="Font size" prefix="Size" min={1} max={2000} value={node.fontSize} onCommit={(fontSize, m) => set('Font size', { fontSize }, m.stepping)} />
        <NumberField
          label="Line height"
          prefix="LH"
          suffix="%"
          min={10}
          max={1000}
          precision={0}
          value={node.lineHeight * 100}
          onCommit={(v, m) => set('Line height', { lineHeight: v / 100 }, m.stepping)}
        />
      </Row>
      <Row>
        <NumberField label="Letter spacing" prefix="LS" min={-100} max={1000} value={node.letterSpacing} onCommit={(letterSpacing, m) => set('Letter spacing', { letterSpacing }, m.stepping)} />
      </Row>
      <Segmented
        label="Text alignment"
        value={node.textAlign}
        onChange={(textAlign) => set('Text align', { textAlign })}
        options={[
          { value: 'left', label: 'Align left', icon: <TextAlignStart size={14} /> },
          { value: 'center', label: 'Align centre', icon: <TextAlignCenter size={14} /> },
          { value: 'right', label: 'Align right', icon: <TextAlignEnd size={14} /> },
          { value: 'justify', label: 'Justify', icon: <TextAlignJustify size={14} /> },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <Segmented
          label="Decoration"
          value={node.textDecoration}
          onChange={(textDecoration) => set('Text decoration', { textDecoration })}
          options={[
            { value: 'none', label: 'No decoration', icon: <X size={13} /> },
            { value: 'underline', label: 'Underline', icon: <Underline size={14} /> },
            { value: 'line-through', label: 'Strikethrough', icon: <Strikethrough size={14} /> },
          ]}
        />
        <Segmented<TextAutoResize>
          label="Resizing"
          value={node.autoResize}
          onChange={(autoResize) => set('Text resizing', { autoResize })}
          options={[
            { value: 'width-and-height', label: 'Auto width', icon: <MoveHorizontal size={14} /> },
            { value: 'height', label: 'Auto height', icon: <MoveVertical size={14} /> },
            { value: 'none', label: 'Fixed size', icon: <Scaling size={14} /> },
          ]}
        />
      </div>
    </Section>
  );
}

const FIT_OPTIONS: { value: ImageFit; label: string }[] = [
  { value: 'fill', label: 'Fill (cover)' },
  { value: 'fit', label: 'Fit (contain)' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'crop', label: 'Crop' },
];

/** Keeps a crop window inside the image (fractions 0..1, at least 1%). */
export function clampCrop(c: CropRect): CropRect {
  const width = Math.min(1, Math.max(0.01, c.width));
  const height = Math.min(1, Math.max(0.01, c.height));
  return {
    x: Math.min(1 - width, Math.max(0, c.x)),
    y: Math.min(1 - height, Math.max(0, c.y)),
    width,
    height,
  };
}

export function ImageSection({ node, set }: { node: ImageNode; set: SetNode }) {
  // Changing the crop keeps the box width and matches the box to the cropped area's shape.
  const setCrop = (patch: Partial<CropRect>, live: boolean) => {
    const crop = clampCrop({ ...node.crop, ...patch });
    const aspect = (crop.height * node.naturalHeight) / (crop.width * node.naturalWidth);
    set('Crop image', { crop, height: Math.round(node.width * aspect * 100) / 100 }, live);
  };
  const pct = (v: number) => Math.round(v * 1000) / 10;
  return (
    <Section title="Image">
      <SelectField label="Image fit" value={node.fit} options={FIT_OPTIONS} onChange={(fit) => set('Image fit', { fit })} className="w-full" />
      {node.fit === 'crop' && (
        <>
          <Row>
            <NumberField label="Crop left" prefix="L" suffix="%" min={0} max={99} precision={1} value={pct(node.crop.x)} onCommit={(v, m) => setCrop({ x: v / 100 }, m.stepping)} />
            <NumberField label="Crop top" prefix="T" suffix="%" min={0} max={99} precision={1} value={pct(node.crop.y)} onCommit={(v, m) => setCrop({ y: v / 100 }, m.stepping)} />
          </Row>
          <Row>
            <NumberField label="Crop width" prefix="W" suffix="%" min={1} max={100} precision={1} value={pct(node.crop.width)} onCommit={(v, m) => setCrop({ width: v / 100 }, m.stepping)} />
            <NumberField label="Crop height" prefix="H" suffix="%" min={1} max={100} precision={1} value={pct(node.crop.height)} onCommit={(v, m) => setCrop({ height: v / 100 }, m.stepping)} />
          </Row>
          <button type="button" onClick={() => setCrop({ x: 0, y: 0, width: 1, height: 1 }, false)} className="rounded border border-edge px-2 py-1 text-fg-muted hover:bg-hover hover:text-fg">
            Reset crop
          </button>
        </>
      )}
      <div className="flex items-center justify-between text-fg-subtle">
        <span>
          Original {node.naturalWidth} × {node.naturalHeight}
        </span>
        <button
          type="button"
          onClick={() => set('Reset image size', { width: node.naturalWidth, height: node.naturalHeight })}
          className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-hover hover:text-fg"
        >
          Reset size
        </button>
      </div>
    </Section>
  );
}

export function PolygonSection({ node, set }: { node: PolygonNode | StarNode; set: SetNode }) {
  return (
    <Section title={node.type === 'star' ? 'Star' : 'Polygon'}>
      <Row>
        <NumberField label="Point count" prefix="Points" min={3} max={60} precision={0} value={node.pointCount} onCommit={(v, m) => set('Point count', { pointCount: Math.round(v) }, m.stepping)} />
        {node.type === 'star' && (
          <NumberField
            label="Inner radius"
            prefix="Ratio"
            suffix="%"
            min={1}
            max={100}
            precision={0}
            value={node.innerRadius * 100}
            onCommit={(v, m) => set('Star ratio', { innerRadius: v / 100 }, m.stepping)}
          />
        )}
      </Row>
    </Section>
  );
}

const CAP_OPTIONS: { value: LineCap; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'circle', label: 'Circle' },
];

export function LineSection({ node, set }: { node: LineNode; set: SetNode }) {
  return (
    <Section title="Line ends">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        <SelectField label="Start" value={node.startCap} options={CAP_OPTIONS} onChange={(startCap) => set('Line start', { startCap })} />
        <IconButton label="Swap line ends" onClick={() => set('Swap line ends', { startCap: node.endCap, endCap: node.startCap })}>
          <ArrowLeftRight size={13} />
        </IconButton>
        <SelectField label="End" value={node.endCap} options={CAP_OPTIONS} onChange={(endCap) => set('Line end', { endCap })} />
      </div>
    </Section>
  );
}

export function VectorSection({ node, set }: { node: VectorNode; set: SetNode }) {
  return (
    <Section title="Path">
      <p className="text-fg-subtle">{node.vertices.length} points</p>
      <Checkbox
        label="Closed path"
        checked={node.closed}
        onChange={(closed) =>
          set(closed ? 'Close path' : 'Open path', {
            closed,
            // A newly closed path gets a fill so it is visibly a shape.
            ...(closed && node.fills.length === 0 ? { fills: [{ type: 'solid', color: '#D9D9D9', opacity: 1, visible: true }] } : {}),
          })
        }
      />
    </Section>
  );
}
