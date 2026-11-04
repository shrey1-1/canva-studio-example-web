import { useState } from 'react';
import type { NodeId } from '@canvas-studio/core';
import { EXPORT_SCALES, exportLayers, type ExportFormat } from '../export/exportLayers';
import { Section, SelectField } from './fields';

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF' },
];

/** Export the selected layers as PNG / JPG / SVG / PDF. */
export function ExportSection({ ids }: { ids: readonly NodeId[] }) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(2);
  const [status, setStatus] = useState<{ busy: boolean; error: string | null; done: string | null }>({ busy: false, error: null, done: null });

  const run = async () => {
    setStatus({ busy: true, error: null, done: null });
    try {
      const n = await exportLayers(ids, format, format === 'svg' ? 1 : scale);
      setStatus({ busy: false, error: null, done: `Saved ${n} file${n === 1 ? '' : 's'}.` });
    } catch (e) {
      setStatus({ busy: false, error: e instanceof Error ? e.message : 'Export failed', done: null });
    }
  };

  return (
    <Section title="Export">
      <div className="flex gap-2">
        <SelectField label="Export format" value={format} options={FORMATS} onChange={setFormat} className="flex-1" />
        {format !== 'svg' && (
          <SelectField label="Export scale" value={scale} options={EXPORT_SCALES.map((s) => ({ value: s, label: `${s}x` }))} onChange={setScale} className="w-16" />
        )}
      </div>
      <button type="button" disabled={status.busy} onClick={run} className="h-7 w-full rounded border border-edge text-fg hover:bg-hover disabled:opacity-50">
        {status.busy ? 'Exporting…' : `Export ${ids.length === 1 ? 'layer' : `${ids.length} layers`}`}
      </button>
      {format === 'pdf' && <p className="text-2xs text-fg-subtle">One page per layer (pages are images; text is not selectable).</p>}
      {status.error && <p role="alert" className="text-2xs text-danger">{status.error}</p>}
      {status.done && <p role="status" className="text-2xs text-fg-subtle">{status.done}</p>}
    </Section>
  );
}
