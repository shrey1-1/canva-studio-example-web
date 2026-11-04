import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Layer, Group, Stage } from 'react-konva';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import {
  applyAction,
  containsPoint,
  currentScreen,
  hitInteraction,
  initialPlayerState,
  nodeBounds,
  offsetInScreen,
  screenContentSize,
  screenOf,
  subtreeIds,
  type DesignDocument,
  type Interaction,
  type NodeId,
  type OverlayState,
  type PlayerState,
  type PrototypeAction,
  type Transition,
  type Trigger,
} from '@canvas-studio/core';
import { SceneNodes } from '../editor/canvas/SceneRenderer';

const DRAG_THRESHOLD = 8;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Keyframes for a screen entering (and, for push, the one leaving). */
function keyframes(t: Transition, reverse: boolean): { enter: Keyframe[]; leave: Keyframe[] | null } {
  const dir = t.type.split('-')[1];
  let dx = dir === 'left' ? 100 : dir === 'right' ? -100 : 0;
  let dy = dir === 'up' ? 100 : dir === 'down' ? -100 : 0;
  if (reverse) [dx, dy] = [-dx, -dy];
  if (t.type === 'dissolve') return { enter: [{ opacity: 0 }, { opacity: 1 }], leave: null };
  const enter = [{ transform: `translate(${dx}%, ${dy}%)` }, { transform: 'translate(0, 0)' }];
  const leave = t.type.startsWith('push') ? [{ transform: 'translate(0, 0)' }, { transform: `translate(${-dx}%, ${-dy}%)` }] : null;
  return { enter, leave };
}

const animOptions = (t: Transition): KeyframeAnimationOptions => ({ duration: reducedMotion() ? 0 : t.durationMs, easing: t.easing, fill: 'both' });

interface Revertible {
  before: PlayerState;
  after: PlayerState;
}

/** The layer a "while hovering" interaction is active for. */
type HoverRef = { current: { screenId: NodeId; nodeId: NodeId; r: Revertible } | null };

/**
 * Runs a prototype: shows one screen at a time (scaled to fit), plays transitions, stacks
 * overlays, scrolls overflowing screens and fires click/hover/press/drag/after-delay interactions.
 */
export function PrototypePlayer({ doc, start, onExit }: { doc: DesignDocument; start: NodeId; onExit: () => void }) {
  const [state, setState] = useState<PlayerState>(() => initialPlayerState(start));
  const [visit, setVisit] = useState(0);
  const [leaving, setLeaving] = useState<{ id: NodeId; transition: Transition; reverse: boolean } | null>(null);
  const [overlayAnim, setOverlayAnim] = useState<Transition | null>(null);
  const [flash, setFlash] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;
  const scrollers = useRef(new Map<NodeId, HTMLDivElement>());
  const deviceRef = useRef<HTMLDivElement>(null);
  const hoverRef: HoverRef = useRef(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setArea({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = currentScreen(state);
  const screen = doc.nodes[current];
  const scale = screen && area.width ? Math.min(1, (area.width - 32) / screen.width, (area.height - 32) / screen.height) : 1;

  const run = useCallback(
    (action: PrototypeAction): Revertible => {
      const before = stateRef.current;
      const { state: after, effect } = applyAction(doc, before, action);
      if (effect.kind === 'transition') {
        setLeaving(effect.transition.type === 'instant' || !effect.from ? null : { id: effect.from, transition: effect.transition, reverse: effect.reverse });
        setVisit((v) => v + 1);
      } else if (effect.kind === 'overlay-open') {
        setOverlayAnim(effect.transition.type === 'instant' ? null : effect.transition);
        setVisit((v) => v + 1);
      } else if (effect.kind === 'scroll') {
        const owner = screenOf(doc, effect.targetId);
        const off = offsetInScreen(doc, effect.targetId);
        const el = owner ? scrollers.current.get(owner) : undefined;
        if (el && off) el.scrollTo({ left: off.x * scale, top: off.y * scale, behavior: effect.smooth && !reducedMotion() ? 'smooth' : 'auto' });
      } else if (effect.kind === 'open-url') {
        window.open(effect.url, '_blank', 'noopener,noreferrer');
      }
      stateRef.current = after;
      setState(after);
      return { before, after };
    },
    [doc, scale],
  );

  /** Undo a hover/press result when the pointer leaves or is released (if nothing else happened since). */
  const revert = useCallback((r: Revertible | null) => {
    if (r && stateRef.current === r.after && r.before !== r.after) {
      stateRef.current = r.before;
      setLeaving(null);
      setState(r.before);
    }
  }, []);

  const restart = useCallback(() => {
    setLeaving(null);
    setState(initialPlayerState(start));
    setVisit((v) => v + 1);
  }, [start]);

  // Keyboard: Esc closes an overlay or exits, ←/Backspace goes back, R restarts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (stateRef.current.overlays.length) run({ type: 'close-overlay' });
        else onExit();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') run({ type: 'back' });
      else if (e.key === 'r' || e.key === 'R') restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, restart, onExit]);

  // "After delay" interactions of the visible screen and the top overlay.
  const top = state.overlays[state.overlays.length - 1];
  useEffect(() => {
    const timers: number[] = [];
    for (const root of [current, top?.screenId]) {
      if (!root || !doc.nodes[root]) continue;
      for (const id of subtreeIds(doc, root)) {
        for (const i of doc.nodes[id]?.interactions ?? []) {
          if (i.trigger === 'after-delay') timers.push(window.setTimeout(() => run(i.action), i.delayMs));
        }
      }
    }
    return () => timers.forEach(clearTimeout);
    // Re-armed on every visit, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit, current, top?.screenId]);

  // Ends a hover interaction once the pointer leaves the hovered layer, wherever the pointer is
  // (the overlay it opened may now cover the layer).
  const checkHover = (e: { clientX: number; clientY: number } | null) => {
    const h = hoverRef.current;
    if (!h) return;
    const frame = doc.nodes[h.screenId];
    const el = scrollers.current.get(h.screenId) ?? deviceRef.current;
    let inside = false;
    if (e && frame && el) {
      const r = el.getBoundingClientRect();
      inside = containsPoint(doc, h.nodeId, {
        x: frame.x + (e.clientX - r.left + el.scrollLeft) / scale,
        y: frame.y + (e.clientY - r.top + el.scrollTop) / scale,
      });
    }
    if (!inside) {
      hoverRef.current = null;
      revert(h.r);
    }
  };

  const onMiss = useCallback(() => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 500);
  }, []);

  if (!screen) return <p className="p-6 text-center text-fg-muted">This screen no longer exists.</p>;

  const box = { width: screen.width * scale, height: screen.height * scale };
  const register = (id: NodeId) => (el: HTMLDivElement | null) => {
    if (el) scrollers.current.set(id, el);
    else scrollers.current.delete(id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-center gap-2 border-b border-edge bg-sidebar px-3 text-fg-muted">
        <button type="button" aria-label="Back" title="Back (←)" disabled={state.history.length < 2 && !state.overlays.length} onClick={() => run({ type: 'back' })} className="rounded p-1 hover:bg-hover hover:text-fg disabled:opacity-40">
          <ChevronLeft size={15} />
        </button>
        <span aria-live="polite" className="min-w-0 truncate text-fg">{screen.name}</span>
        <button type="button" aria-label="Restart" title="Restart (R)" onClick={restart} className="rounded p-1 hover:bg-hover hover:text-fg">
          <RotateCcw size={13} />
        </button>
      </div>
      <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {area.width > 0 && (
          <div
            ref={deviceRef}
            data-testid="prototype-device"
            className="relative overflow-hidden shadow-2xl"
            style={box}
            onPointerMove={(e) => checkHover(e)}
            onPointerLeave={() => checkHover(null)}
          >
            {leaving && leaving.id !== current && doc.nodes[leaving.id] && (
              <AnimatedLayer key={`leave-${visit}`} frames={keyframes(leaving.transition, leaving.reverse).leave} options={animOptions(leaving.transition)} className="pointer-events-none absolute inset-0">
                <ScreenView doc={doc} screenId={leaving.id} scale={scale} />
              </AnimatedLayer>
            )}
            <AnimatedLayer
              key={`screen-${visit}-${current}`}
              frames={leaving ? keyframes(leaving.transition, leaving.reverse).enter : null}
              options={leaving ? animOptions(leaving.transition) : undefined}
              onDone={() => setLeaving(null)}
              className="absolute inset-0"
            >
              <ScreenView doc={doc} screenId={current} scale={scale} interactive={!state.overlays.length} run={run} revert={revert} hoverRef={hoverRef} onMiss={onMiss} flash={flash} scrollRef={register(current)} />
            </AnimatedLayer>
            {state.overlays.map((o, i) => (
              <OverlayView
                key={`${i}-${o.screenId}`}
                doc={doc}
                overlay={o}
                scale={scale}
                box={box}
                isTop={i === state.overlays.length - 1}
                transition={i === state.overlays.length - 1 ? overlayAnim : null}
                onOutside={() => o.closeOnOutside && run({ type: 'close-overlay' })}
              >
                <ScreenView doc={doc} screenId={o.screenId} scale={scale} interactive={i === state.overlays.length - 1} run={run} revert={revert} hoverRef={hoverRef} onMiss={onMiss} flash={flash} scrollRef={register(o.screenId)} />
              </OverlayView>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Plays keyframes once on mount (Web Animations API). */
function AnimatedLayer({
  frames,
  options,
  onDone,
  className,
  style,
  role,
  label,
  children,
}: {
  frames: Keyframe[] | null;
  options?: KeyframeAnimationOptions;
  onDone?: () => void;
  className: string;
  style?: React.CSSProperties;
  role?: string;
  label?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !frames || !options || typeof el.animate !== 'function') return void onDone?.();
    const anim = el.animate(frames, options);
    anim.onfinish = () => onDone?.();
    return () => anim.cancel();
    // Runs once per mount: each transition remounts the layer with a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className={className} style={style} role={role} aria-label={label}>
      {children}
    </div>
  );
}

function OverlayView({
  doc,
  overlay,
  scale,
  box,
  isTop,
  transition,
  onOutside,
  children,
}: {
  doc: DesignDocument;
  overlay: OverlayState;
  scale: number;
  box: { width: number; height: number };
  isTop: boolean;
  transition: Transition | null;
  onOutside: () => void;
  children: React.ReactNode;
}) {
  const node = doc.nodes[overlay.screenId];
  if (!node) return null;
  const w = node.width * scale;
  const h = node.height * scale;
  const pos = {
    center: { left: (box.width - w) / 2, top: (box.height - h) / 2 },
    top: { left: (box.width - w) / 2, top: 0 },
    bottom: { left: (box.width - w) / 2, top: box.height - h },
    left: { left: 0, top: (box.height - h) / 2 },
    right: { left: box.width - w, top: (box.height - h) / 2 },
  }[overlay.position];
  return (
    <div className="absolute inset-0" style={{ pointerEvents: isTop ? 'auto' : 'none' }}>
      <div
        data-testid="overlay-backdrop"
        className="absolute inset-0"
        style={{ background: overlay.dimBackground ? 'rgba(0,0,0,0.45)' : 'transparent' }}
        onClick={onOutside}
      />
      <AnimatedLayer
        frames={transition ? keyframes(transition, false).enter : null}
        options={transition ? animOptions(transition) : undefined}
        className="absolute overflow-hidden"
        style={{ ...pos, width: w, height: h }}
        role="dialog"
        label={node.name}
      >
        {children}
      </AnimatedLayer>
    </div>
  );
}

/** One screen: rendered with the editor's scene renderer, scrollable when its content overflows. */
function ScreenView({
  doc,
  screenId,
  scale,
  interactive = false,
  run,
  revert,
  hoverRef,
  onMiss,
  flash = false,
  scrollRef,
}: {
  doc: DesignDocument;
  screenId: NodeId;
  scale: number;
  interactive?: boolean;
  run?: (a: PrototypeAction) => Revertible;
  revert?: (r: Revertible | null) => void;
  hoverRef?: HoverRef;
  onMiss?: () => void;
  flash?: boolean;
  scrollRef?: (el: HTMLDivElement | null) => void;
}) {
  const frame = doc.nodes[screenId]!;
  const mode = ('scroll' in frame && frame.scroll) || 'none';
  // A scrolling screen is rendered at its content size; the outer box shows the frame's size.
  const { renderDoc, content } = useMemo(() => {
    const full = screenContentSize(doc, screenId);
    const content = {
      width: mode === 'horizontal' || mode === 'both' ? full.width : frame.width,
      height: mode === 'vertical' || mode === 'both' ? full.height : frame.height,
    };
    const renderDoc = content.width === frame.width && content.height === frame.height ? doc : { ...doc, nodes: { ...doc.nodes, [screenId]: { ...frame, ...content } } };
    return { renderDoc, content };
  }, [doc, screenId, frame, mode]);

  const stageBox = useRef<HTMLDivElement>(null);
  const press = useRef<Revertible | null>(null);
  const drag = useRef<{ x: number; y: number; hit: { interaction: Interaction } | null; fired: boolean } | null>(null);
  const [cursor, setCursor] = useState('default');

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = stageBox.current!.getBoundingClientRect();
    return { x: frame.x + (e.clientX - r.left) / scale, y: frame.y + (e.clientY - r.top) / scale };
  };
  const hit = (e: { clientX: number; clientY: number }, trigger: Trigger) => hitInteraction(renderDoc, screenId, toPage(e), trigger);

  const handlers = interactive && run && revert && hoverRef
    ? {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          if (drag.current?.fired) return;
          const h = hit(e, 'click');
          if (h) run(h.interaction.action);
          else if (!hit(e, 'press') && !hit(e, 'drag') && !hit(e, 'hover')) onMiss?.();
        },
        onPointerDown: (e: ReactPointerEvent) => {
          const p = hit(e, 'press');
          if (p) press.current = run(p.interaction.action);
          drag.current = { x: e.clientX, y: e.clientY, hit: hit(e, 'drag'), fired: false };
        },
        onPointerUp: () => {
          revert(press.current);
          press.current = null;
          // Let the click handler see whether this gesture was a drag, then reset.
          window.setTimeout(() => (drag.current = null), 0);
        },
        onPointerMove: (e: ReactPointerEvent) => {
          const d = drag.current;
          if (d?.hit && !d.fired && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD) {
            d.fired = true;
            run(d.hit.interaction.action);
            return;
          }
          // Starting a hover here; the player ends it when the pointer leaves the layer.
          const hv = hit(e, 'hover');
          const cur = hoverRef.current;
          if (hv && hv.nodeId !== cur?.nodeId) {
            if (cur) revert(cur.r);
            hoverRef.current = { screenId, nodeId: hv.nodeId, r: run(hv.interaction.action) };
          }
          setCursor(hit(e, 'click') || hit(e, 'press') || hit(e, 'drag') ? 'pointer' : 'default');
        },
      }
    : {};

  const hotspots = flash && interactive
    ? subtreeIds(doc, screenId)
        .filter((id) => doc.nodes[id]?.interactions?.some((i) => i.trigger !== 'after-delay'))
        .map((id) => ({ id, b: nodeBounds(renderDoc, id) }))
    : [];

  return (
    <div
      ref={scrollRef}
      data-testid="prototype-screen"
      data-screen={frame.name}
      className="absolute inset-0"
      style={{ overflowX: content.width > frame.width ? 'auto' : 'hidden', overflowY: content.height > frame.height ? 'auto' : 'hidden', cursor }}
      {...handlers}
    >
      <div ref={stageBox} className="relative" style={{ width: content.width * scale, height: content.height * scale }}>
        <Stage width={content.width * scale} height={content.height * scale} listening={false}>
          <Layer>
            <Group x={-frame.x * scale} y={-frame.y * scale} scaleX={scale} scaleY={scale}>
              <SceneNodes doc={renderDoc} ids={[screenId]} interactive={false} zoom={scale} />
            </Group>
          </Layer>
        </Stage>
        {hotspots.map(({ id, b }) => (
          <div
            key={id}
            className="pointer-events-none absolute rounded-sm border-2 border-cyan-400 bg-cyan-400/20"
            style={{ left: (b.x - frame.x) * scale, top: (b.y - frame.y) * scale, width: b.width * scale, height: b.height * scale }}
          />
        ))}
      </div>
    </div>
  );
}
