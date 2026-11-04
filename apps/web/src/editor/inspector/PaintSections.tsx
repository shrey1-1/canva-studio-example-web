import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Minus, Plus } from 'lucide-react';
import { isOpenPath, type Effect, type EffectType, type NodePatch, type SceneNode } from '@canvas-studio/core';
import { IconButton } from '../../ui/IconButton';
import { ColorField, NumberField, Row, Section } from './fields';

export type SetNode = (label: string, patch: NodePatch, live?: boolean) => void;

/** Replaces one item of a list immutably. */
const replaceAt = <T,>(list: readonly T[], i: number, item: T) => list.map((x, j) => (j === i ? item : x));

const percent = (v: number) => v * 100;

/**
 * Fills, painted bottom-first. The panel lists them top-first, as design tools do,
 * so the top row is the paint you see.
 */
export function FillsSection({ node, set }: { node: SceneNode; set: SetNode }) {
  const fills = node.fills;
  const defaultColor = node.type === 'text' ? '#000000' : '#D9D9D9';
  const disabled = isOpenPath(node);
  return (
    <Section
      title="Fill"
      action={
        !disabled && (
          <IconButton
            label="Add fill"
            onClick={() => set('Add fill', { fills: [...fills, { type: 'solid', color: fills.at(-1)?.color ?? defaultColor, opacity: 1, visible: true }] })}
          >
            <Plus size={14} />
          </IconButton>
        )
      }
    >
      {disabled && <p className="text-fg-subtle">Open paths have no fill. Close the path to fill it.</p>}
      {!disabled &&
        fills
          .map((fill, i) => ({ fill, i }))
          .reverse()
          .map(({ fill, i }) => (
            <div key={i} className="flex items-center gap-1.5" data-testid="fill-row">
              <ColorField label={`Fill ${i + 1}`} value={fill.color} onChange={(color, live) => set('Fill colour', { fills: replaceAt(fills, i, { ...fill, color }) }, live)} />
              <div className="w-16 shrink-0">
                <NumberField
                  label={`Fill ${i + 1} opacity`}
                  prefix=""
                  suffix="%"
                  min={0}
                  max={100}
                  precision={0}
                  value={percent(fill.opacity)}
                  onCommit={(v, m) => set('Fill opacity', { fills: replaceAt(fills, i, { ...fill, opacity: v / 100 }) }, m.stepping)}
                />
              </div>
              <IconButton
                label={fill.visible ? `Hide fill ${i + 1}` : `Show fill ${i + 1}`}
                onClick={() => set('Toggle fill', { fills: replaceAt(fills, i, { ...fill, visible: !fill.visible }) })}
              >
                {fill.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </IconButton>
              <IconButton label={`Remove fill ${i + 1}`} onClick={() => set('Remove fill', { fills: fills.filter((_, j) => j !== i) })}>
                <Minus size={13} />
              </IconButton>
            </div>
          ))}
    </Section>
  );
}

export function StrokesSection({ node, set }: { node: SceneNode; set: SetNode }) {
  const strokes = node.strokes;
  return (
    <Section
      title="Stroke"
      action={
        <IconButton
          label="Add stroke"
          onClick={() =>
            set('Add stroke', { strokes: [...strokes, { color: strokes.at(-1)?.color ?? '#000000', width: strokes.at(-1)?.width ?? 1, opacity: 1, visible: true }] })
          }
        >
          <Plus size={14} />
        </IconButton>
      }
    >
      {strokes
        .map((stroke, i) => ({ stroke, i }))
        .reverse()
        .map(({ stroke, i }) => (
          <div key={i} className="flex items-center gap-1.5" data-testid="stroke-row">
            <ColorField label={`Stroke ${i + 1}`} value={stroke.color} onChange={(color, live) => set('Stroke colour', { strokes: replaceAt(strokes, i, { ...stroke, color }) }, live)} />
            <div className="w-14 shrink-0">
              <NumberField
                label={`Stroke ${i + 1} width`}
                prefix=""
                min={0}
                max={1000}
                value={stroke.width}
                onCommit={(width, m) => set('Stroke width', { strokes: replaceAt(strokes, i, { ...stroke, width }) }, m.stepping)}
              />
            </div>
            <IconButton
              label={stroke.visible ? `Hide stroke ${i + 1}` : `Show stroke ${i + 1}`}
              onClick={() => set('Toggle stroke', { strokes: replaceAt(strokes, i, { ...stroke, visible: !stroke.visible }) })}
            >
              {stroke.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </IconButton>
            <IconButton label={`Remove stroke ${i + 1}`} onClick={() => set('Remove stroke', { strokes: strokes.filter((_, j) => j !== i) })}>
              <Minus size={13} />
            </IconButton>
          </div>
        ))}
    </Section>
  );
}

const EFFECT_LABEL: Record<EffectType, string> = { 'drop-shadow': 'Drop shadow', 'layer-blur': 'Layer blur' };

const newEffect = (type: EffectType): Effect =>
  type === 'drop-shadow'
    ? { type, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25, visible: true }
    : { type, radius: 4, visible: true };

/** One drop shadow and one layer blur per layer (what the renderer can draw faithfully). */
export function EffectsSection({ node, set }: { node: SceneNode; set: SetNode }) {
  const effects = node.effects;
  const available = (['drop-shadow', 'layer-blur'] as const).filter((t) => !effects.some((e) => e.type === t));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const update = (i: number, effect: Effect, label: string, live = false) => set(label, { effects: replaceAt(effects, i, effect) }, live);

  return (
    <Section
      title="Effects"
      action={
        available.length > 0 && (
          <div ref={menuRef} className="relative">
            <IconButton label="Add effect" onClick={() => setMenuOpen((o) => !o)}>
              <Plus size={14} />
            </IconButton>
            {menuOpen && (
              <div role="menu" aria-label="Effect types" className="absolute top-7 right-0 z-20 min-w-36 rounded-md border border-edge bg-sidebar py-1 shadow-2xl">
                {available.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      set(`Add ${EFFECT_LABEL[t].toLowerCase()}`, { effects: [...effects, newEffect(t)] });
                    }}
                    className="flex h-7 w-full items-center px-3 text-left text-fg hover:bg-accent hover:text-white"
                  >
                    {EFFECT_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      }
    >
      {effects.map((effect, i) => (
        <div key={effect.type} className="space-y-2" data-testid="effect-row">
          <div className="flex items-center gap-1.5">
            <span className="flex-1 text-fg">{EFFECT_LABEL[effect.type]}</span>
            <IconButton
              label={effect.visible ? `Hide ${EFFECT_LABEL[effect.type]}` : `Show ${EFFECT_LABEL[effect.type]}`}
              onClick={() => update(i, { ...effect, visible: !effect.visible }, 'Toggle effect')}
            >
              {effect.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </IconButton>
            <IconButton label={`Remove ${EFFECT_LABEL[effect.type]}`} onClick={() => set('Remove effect', { effects: effects.filter((_, j) => j !== i) })}>
              <Minus size={13} />
            </IconButton>
          </div>
          {effect.type === 'drop-shadow' ? (
            <>
              <div className="flex items-center gap-1.5">
                <ColorField label="Shadow" value={effect.color} onChange={(color, live) => update(i, { ...effect, color }, 'Shadow colour', live)} />
                <div className="w-16 shrink-0">
                  <NumberField
                    label="Shadow opacity"
                    prefix=""
                    suffix="%"
                    min={0}
                    max={100}
                    precision={0}
                    value={percent(effect.opacity)}
                    onCommit={(v, m) => update(i, { ...effect, opacity: v / 100 }, 'Shadow opacity', m.stepping)}
                  />
                </div>
              </div>
              <Row>
                <NumberField label="Shadow X" prefix="X" value={effect.x} onCommit={(x, m) => update(i, { ...effect, x }, 'Shadow X', m.stepping)} />
                <NumberField label="Shadow Y" prefix="Y" value={effect.y} onCommit={(y, m) => update(i, { ...effect, y }, 'Shadow Y', m.stepping)} />
              </Row>
              <Row>
                <NumberField label="Shadow blur" prefix="Blur" min={0} max={500} value={effect.blur} onCommit={(blur, m) => update(i, { ...effect, blur }, 'Shadow blur', m.stepping)} />
              </Row>
            </>
          ) : (
            <Row>
              <NumberField label="Blur radius" prefix="Blur" min={0} max={250} value={effect.radius} onCommit={(radius, m) => update(i, { ...effect, radius }, 'Blur radius', m.stepping)} />
            </Row>
          )}
        </div>
      ))}
    </Section>
  );
}
