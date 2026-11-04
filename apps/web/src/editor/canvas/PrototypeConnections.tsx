import { memo } from 'react';
import { Arrow, Circle, Group, Rect, RegularPolygon } from 'react-konva';
import { nodeBounds, type DesignDocument, type NodeId, type PageId } from '@canvas-studio/core';

const LINK = '#22D3EE';

/**
 * Prototype connections drawn on the canvas while the Prototype tab is open: one curved arrow
 * from each interactive layer to its destination screen. Selected layers' links are emphasised.
 */
export const PrototypeConnections = memo(function PrototypeConnections({
  doc,
  pageId,
  selection,
  zoom,
  startId,
}: {
  doc: DesignDocument;
  pageId: PageId;
  selection: readonly NodeId[];
  zoom: number;
  startId: NodeId | null;
}) {
  const links: { key: string; from: NodeId; to: NodeId; active: boolean }[] = [];
  for (const node of Object.values(doc.nodes)) {
    if (node.pageId !== pageId || !node.interactions) continue;
    for (const i of node.interactions) {
      const a = i.action;
      if ((a.type === 'navigate' || a.type === 'overlay') && doc.nodes[a.destinationId]) {
        links.push({ key: `${node.id}:${i.id}`, from: node.id, to: a.destinationId, active: selection.includes(node.id) });
      }
    }
  }
  const s = 1 / zoom;
  const start = startId && doc.nodes[startId] ? nodeBounds(doc, startId) : null;
  return (
    <Group listening={false}>
      {links.map((l) => {
        const a = nodeBounds(doc, l.from);
        const b = nodeBounds(doc, l.to);
        const forward = b.x >= a.x + a.width;
        const x1 = forward ? a.x + a.width : a.x;
        const y1 = a.y + a.height / 2;
        const x2 = forward ? b.x : b.x + b.width;
        const y2 = Math.min(Math.max(y1, b.y + 24 * s), b.y + b.height - 24 * s);
        const bend = Math.max(40 * s, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
        return (
          <Group key={l.key} opacity={l.active || selection.length === 0 ? 1 : 0.45}>
            <Rect x={a.x} y={a.y} width={a.width} height={a.height} stroke={LINK} strokeWidth={(l.active ? 2 : 1) * s} />
            <Circle x={x1} y={y1} radius={3.5 * s} fill={LINK} />
            <Arrow
              points={[x1, y1, x1 + bend, y1, x2 - bend, y2, x2, y2]}
              bezier
              stroke={LINK}
              fill={LINK}
              strokeWidth={(l.active ? 2.5 : 1.5) * s}
              pointerLength={8 * s}
              pointerWidth={8 * s}
            />
          </Group>
        );
      })}
      {start && (
        // Play badge left of the flow's starting screen
        <Group x={start.x - 26 * s} y={start.y}>
          <Rect width={20 * s} height={20 * s} cornerRadius={4 * s} fill={LINK} />
          <RegularPolygon x={10.5 * s} y={10 * s} sides={3} radius={6 * s} rotation={90} fill="#0B1220" />
        </Group>
      )}
    </Group>
  );
});
