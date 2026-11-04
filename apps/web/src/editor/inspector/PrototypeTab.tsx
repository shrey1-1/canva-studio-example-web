import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Play, Plus, Trash2 } from 'lucide-react';
import {
  ACTION_TYPES,
  createId,
  defaultAction,
  EASINGS,
  flowStart,
  isSafeUrl,
  MAX_DELAY_MS,
  MAX_DURATION_MS,
  MAX_INTERACTIONS,
  OVERLAY_POSITIONS,
  screenIds,
  screenOf,
  SCROLL_BEHAVIORS,
  setFlowStart,
  subtreeIds,
  TRANSITIONS,
  TRIGGERS,
  updateNode,
  type ActionType,
  type DesignDocument,
  type Interaction,
  type NodeId,
  type PrototypeAction,
  type ScrollOverflow,
  type Transition,
} from '@canvas-studio/core';
import { selectActivePage, useEditor } from '../../state/editorStore';
import { Checkbox, NumberField, Row, Section, SelectField } from './fields';

const TRIGGER_LABEL: Record<Interaction['trigger'], string> = {
  click: 'On click',
  hover: 'While hovering',
  press: 'While pressing',
  drag: 'On drag',
  'after-delay': 'After delay',
};
const ACTION_LABEL: Record<ActionType, string> = {
  navigate: 'Navigate to',
  back: 'Back',
  overlay: 'Open overlay',
  'close-overlay': 'Close overlay',
  'scroll-to': 'Scroll to',
  url: 'Open link',
};
const TRANSITION_LABEL: Record<Transition['type'], string> = {
  instant: 'Instant',
  dissolve: 'Dissolve',
  'slide-left': 'Slide in ←',
  'slide-right': 'Slide in →',
  'slide-up': 'Slide in ↑',
  'slide-down': 'Slide in ↓',
  'push-left': 'Push ←',
  'push-right': 'Push →',
  'push-up': 'Push ↑',
  'push-down': 'Push ↓',
};
const SCROLL_LABEL: Record<ScrollOverflow, string> = { none: 'No scrolling', vertical: 'Vertical', horizontal: 'Horizontal', both: 'Both directions' };

const nameOf = (doc: DesignDocument, id: NodeId) => doc.nodes[id]?.name ?? 'Missing layer';

/** The Prototype tab: the page's flow start, a screen's scrolling, and a layer's interactions. */
export function PrototypeTab() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const page = useEditor(selectActivePage);
  const dispatch = useEditor((s) => s.dispatch);
  const navigate = useNavigate();
  const { docId } = useParams();
  const screens = screenIds(doc, page);
  const start = flowStart(doc, page);
  const node = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;

  const preview = (from?: NodeId) => navigate(`/file/${docId}/present${from ? `?start=${encodeURIComponent(from)}` : ''}`);

  if (!node) {
    return (
      <>
        <Section title="Flow">
          {screens.length === 0 ? (
            <p className="text-fg-muted">Add a frame to the page to start a prototype. Top-level frames are its screens.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-fg-muted">
                Starting screen
                <SelectField
                  label="Starting screen"
                  value={start ?? ''}
                  options={screens.map((id) => ({ value: id, label: nameOf(doc, id) }))}
                  onChange={(id) => dispatch('Set starting screen', (d) => setFlowStart(d, page.id, id))}
                />
              </label>
              <PreviewButton onClick={() => preview()} />
            </>
          )}
        </Section>
        <p className="px-3 py-3 text-fg-subtle">
          {selection.length > 1 ? 'Select a single layer to edit its interactions.' : 'Select a layer to add interactions such as “On click → Navigate to”.'}
        </p>
      </>
    );
  }

  const screen = screenOf(doc, node.id);
  const isScreen = screen === node.id;
  const interactions = node.interactions ?? [];
  const others = screens.filter((id) => id !== screen);
  const scrollTargets = screen ? subtreeIds(doc, screen).filter((id) => id !== screen) : [];
  const setInteractions = (next: Interaction[], label = 'Edit interaction') =>
    dispatch(label, (d) => updateNode(d, node.id, { interactions: next }));

  const add = () => {
    const action = defaultAction(others.length ? 'navigate' : 'back', others[0] ?? null)!;
    setInteractions([...interactions, { id: createId(), trigger: 'click', delayMs: 0, action }], 'Add interaction');
  };

  return (
    <>
      {isScreen && 'childIds' in node && (
        <Section title="Screen">
          <Checkbox
            label="Starting screen"
            checked={start === node.id && page.flowStartId === node.id}
            onChange={(on) => dispatch('Set starting screen', (d) => setFlowStart(d, page.id, on ? node.id : null))}
          />
          <label className="flex flex-col gap-1 text-fg-muted">
            Overflow scrolling
            <SelectField
              label="Overflow scrolling"
              value={('scroll' in node && node.scroll) || 'none'}
              options={SCROLL_BEHAVIORS.map((v) => ({ value: v, label: SCROLL_LABEL[v] }))}
              onChange={(scroll) => dispatch('Scroll behaviour', (d) => updateNode(d, node.id, { scroll }))}
            />
          </label>
          <PreviewButton label="Preview from here" onClick={() => preview(node.id)} />
        </Section>
      )}
      <Section
        title="Interactions"
        action={
          screen && interactions.length < MAX_INTERACTIONS ? (
            <button type="button" aria-label="Add interaction" onClick={add} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
              <Plus size={14} />
            </button>
          ) : undefined
        }
      >
        {!screen && <p className="text-fg-muted">Put this layer inside a frame to make it interactive. Top-level frames are the prototype's screens.</p>}
        {screen && interactions.length === 0 && <p className="text-fg-subtle">No interactions. Click + to add one.</p>}
        {screen &&
          interactions.map((it, i) => (
            <InteractionEditor
              key={it.id}
              index={i}
              doc={doc}
              interaction={it}
              screens={others}
              scrollTargets={scrollTargets}
              onChange={(next) => setInteractions(interactions.map((x) => (x.id === it.id ? next : x)))}
              onRemove={() => setInteractions(interactions.filter((x) => x.id !== it.id), 'Remove interaction')}
            />
          ))}
      </Section>
    </>
  );
}

function PreviewButton({ onClick, label = 'Preview prototype' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-edge text-fg hover:bg-hover">
      <Play size={12} fill="currentColor" /> {label}
    </button>
  );
}

function InteractionEditor({
  index,
  doc,
  interaction,
  screens,
  scrollTargets,
  onChange,
  onRemove,
}: {
  index: number;
  doc: DesignDocument;
  interaction: Interaction;
  screens: NodeId[];
  scrollTargets: NodeId[];
  onChange: (next: Interaction) => void;
  onRemove: () => void;
}) {
  const { action } = interaction;
  const setAction = (a: PrototypeAction) => onChange({ ...interaction, action: a });
  const available = ACTION_TYPES.filter((t) => (t === 'navigate' || t === 'overlay' ? screens.length > 0 : t === 'scroll-to' ? scrollTargets.length > 0 : true));
  const destinations = (ids: NodeId[]) => ids.map((id) => ({ value: id, label: nameOf(doc, id) }));

  return (
    <div role="group" aria-label={`Interaction ${index + 1}`} className="space-y-2 rounded border border-edge p-2">
      <div className="flex items-center gap-1">
        <SelectField
          label="Trigger"
          className="flex-1"
          value={interaction.trigger}
          options={TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABEL[t] }))}
          onChange={(trigger) => onChange({ ...interaction, trigger, delayMs: trigger === 'after-delay' && !interaction.delayMs ? 800 : interaction.delayMs })}
        />
        <button type="button" aria-label="Remove interaction" onClick={onRemove} className="rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg">
          <Trash2 size={13} />
        </button>
      </div>
      {interaction.trigger === 'after-delay' && (
        <NumberField label="Delay" suffix="ms" value={interaction.delayMs} min={0} max={MAX_DELAY_MS} step={100} precision={0} onCommit={(delayMs) => onChange({ ...interaction, delayMs })} />
      )}
      <SelectField
        label="Action"
        value={action.type}
        options={available.map((t) => ({ value: t, label: ACTION_LABEL[t] }))}
        onChange={(type) => {
          const next = defaultAction(type, type === 'scroll-to' ? (scrollTargets[0] ?? null) : (screens[0] ?? null));
          if (next) setAction(next);
        }}
        className="w-full"
      />
      {(action.type === 'navigate' || action.type === 'overlay') && (
        <SelectField label="Destination" className="w-full" value={action.destinationId} options={destinations(screens)} onChange={(destinationId) => setAction({ ...action, destinationId })} />
      )}
      {action.type === 'overlay' && (
        <>
          <SelectField
            label="Overlay position"
            className="w-full"
            value={action.position}
            options={OVERLAY_POSITIONS.map((p) => ({ value: p, label: `Position: ${p}` }))}
            onChange={(position) => setAction({ ...action, position })}
          />
          <Checkbox label="Close when clicking outside" checked={action.closeOnOutside} onChange={(closeOnOutside) => setAction({ ...action, closeOnOutside })} />
          <Checkbox label="Dim background" checked={action.dimBackground} onChange={(dimBackground) => setAction({ ...action, dimBackground })} />
        </>
      )}
      {(action.type === 'navigate' || action.type === 'overlay') && (
        <TransitionEditor value={action.transition} onChange={(transition) => setAction({ ...action, transition })} />
      )}
      {action.type === 'scroll-to' && (
        <>
          <SelectField label="Scroll target" className="w-full" value={action.destinationId} options={destinations(scrollTargets)} onChange={(destinationId) => setAction({ ...action, destinationId })} />
          <Checkbox label="Animate" checked={action.smooth} onChange={(smooth) => setAction({ ...action, smooth })} />
        </>
      )}
      {action.type === 'url' && <UrlField value={action.url} onCommit={(url) => setAction({ ...action, url })} />}
    </div>
  );
}

function TransitionEditor({ value, onChange }: { value: Transition; onChange: (t: Transition) => void }) {
  return (
    <>
      <SelectField
        label="Animation"
        className="w-full"
        value={value.type}
        options={TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABEL[t] }))}
        onChange={(type) => onChange({ ...value, type })}
      />
      {value.type !== 'instant' && (
        <Row>
          <SelectField label="Easing" value={value.easing} options={EASINGS.map((e) => ({ value: e, label: e }))} onChange={(easing) => onChange({ ...value, easing })} />
          <NumberField label="Duration" suffix="ms" value={value.durationMs} min={0} max={MAX_DURATION_MS} step={50} precision={0} onCommit={(durationMs) => onChange({ ...value, durationMs })} />
        </Row>
      )}
    </>
  );
}

function UrlField({ value, onCommit }: { value: string; onCommit: (url: string) => void }) {
  const [draft, setDraft] = useState(value);
  const commit = () => draft !== value && onCommit(draft.trim().slice(0, 2000));
  return (
    <div className="space-y-1">
      <input
        aria-label="Link URL"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-7 w-full rounded border border-transparent bg-app px-1.5 text-fg outline-none hover:border-edge focus:border-accent"
      />
      {!isSafeUrl(value) && <p className="text-2xs text-danger">Enter a full https:// or mailto: link; other links are not opened.</p>}
    </div>
  );
}
