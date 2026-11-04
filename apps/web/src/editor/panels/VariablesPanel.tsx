import { useEffect, useState } from 'react';
import { CaseSensitive, Hash, Palette, Plus, ToggleLeft, Trash, Variable as VariableIcon, X } from 'lucide-react';
import {
  addCollection,
  addMode,
  addVariable,
  deleteCollection,
  deleteMode,
  deleteVariable,
  renameCollection,
  renameMode,
  renameVariable,
  setVariableValue,
  type Variable,
  type VariableCollection,
  type VariableType,
  type VariableValue,
} from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import { IconButton } from '../../ui/IconButton';
import { InlineEdit } from '../../ui/InlineEdit';
import { ColorField } from '../inspector/fields';
import { PanelHeader } from './UpcomingPanel';

const TYPE_ICON: Record<VariableType, typeof Hash> = { color: Palette, number: Hash, string: CaseSensitive, boolean: ToggleLeft };
const TYPE_LABEL: Record<VariableType, string> = { color: 'Colour', number: 'Number', string: 'String', boolean: 'Boolean' };

function ValueEditor({ variable, modeId, modeName }: { variable: Variable; modeId: string; modeName: string }) {
  const dispatch = useEditor((s) => s.dispatch);
  const value = variable.valuesByMode[modeId];
  const set = (v: VariableValue, live = false) =>
    dispatch('Variable value', (d) => setVariableValue(d, variable.id, modeId, v), live ? { coalesceKey: `var:${variable.id}:${modeId}` } : undefined);
  const label = `${variable.name} (${modeName})`;
  switch (variable.type) {
    case 'color':
      return <ColorField label={label} value={String(value ?? '#000000')} onChange={(c, live) => set(c, live)} />;
    case 'boolean':
      return (
        <label className="flex h-7 items-center gap-2 text-fg-muted">
          <input type="checkbox" aria-label={label} checked={Boolean(value)} onChange={(e) => set(e.target.checked)} className="accent-accent" />
          {value ? 'True' : 'False'}
        </label>
      );
    default:
      return <TextValue label={label} numeric={variable.type === 'number'} value={value} onCommit={set} />;
  }
}

function TextValue({ label, numeric, value, onCommit }: { label: string; numeric: boolean; value: VariableValue | undefined; onCommit: (v: VariableValue) => void }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => setDraft(String(value ?? '')), [value]);
  const commit = () => {
    if (!numeric) return draft !== value && onCommit(draft);
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(value ?? ''));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      aria-label={label}
      inputMode={numeric ? 'decimal' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="h-7 w-full min-w-0 rounded border border-transparent bg-app px-1.5 text-fg outline-none hover:border-edge focus:border-accent"
    />
  );
}

function CollectionView({ collection }: { collection: VariableCollection }) {
  const variables = useEditor((s) => s.doc.variables).filter((v) => v.collectionId === collection.id);
  const dispatch = useEditor((s) => s.dispatch);
  const add = (type: VariableType) => dispatch('Add variable', (d) => void addVariable(d, collection.id, type, `${TYPE_LABEL[type]} ${variables.length + 1}`));
  return (
    <>
      <section aria-label="Modes" className="border-b border-edge px-3 py-2">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Modes</h3>
          <IconButton label="Add mode" onClick={() => dispatch('Add mode', (d) => void addMode(d, collection.id))}>
            <Plus size={13} />
          </IconButton>
        </div>
        <ul className="space-y-0.5">
          {collection.modes.map((m) => (
            <li key={m.id} className="group flex h-7 items-center gap-1.5">
              <InlineEdit label="Mode name" value={m.name} onCommit={(name) => dispatch('Rename mode', (d) => renameMode(d, collection.id, m.id, name))} />
              {m.id === collection.defaultModeId && <span className="text-2xs text-fg-subtle">default</span>}
              {collection.modes.length > 1 && (
                <IconButton label={`Delete mode ${m.name}`} className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => dispatch('Delete mode', (d) => deleteMode(d, collection.id, m.id))}>
                  <X size={12} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Variables" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {variables.length === 0 && <p className="py-2 text-fg-subtle">No variables yet. Add one below, then bind it from the Design panel.</p>}
        <ul className="space-y-3">
          {variables.map((v) => {
            const Icon = TYPE_ICON[v.type];
            return (
              <li key={v.id} className="group space-y-1" data-testid="variable-row">
                <div className="flex items-center gap-1.5">
                  <Icon size={13} className="shrink-0 text-fg-subtle" aria-label={TYPE_LABEL[v.type]} />
                  <InlineEdit label="Variable name" value={v.name} onCommit={(name) => dispatch('Rename variable', (d) => renameVariable(d, v.id, name))} />
                  <IconButton label={`Delete variable ${v.name}`} className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => dispatch('Delete variable', (d) => deleteVariable(d, v.id))}>
                    <Trash size={12} />
                  </IconButton>
                </div>
                {collection.modes.map((m) => (
                  <div key={m.id} className="grid grid-cols-[4.5rem_1fr] items-center gap-1.5 pl-5">
                    <span className="truncate text-2xs text-fg-subtle">{m.name}</span>
                    <ValueEditor variable={v} modeId={m.id} modeName={m.name} />
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </section>
      <div className="grid grid-cols-2 gap-1.5 border-t border-edge p-2">
        {(Object.keys(TYPE_LABEL) as VariableType[]).map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <button key={t} type="button" onClick={() => add(t)} className="flex items-center justify-center gap-1.5 rounded border border-edge py-1 text-fg-muted hover:bg-hover hover:text-fg">
              <Icon size={13} aria-hidden="true" /> {TYPE_LABEL[t]}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Variable collections, modes and values. Bindings are made from the Design panel. */
export function VariablesPanel() {
  const collections = useEditor((s) => s.doc.variableCollections);
  const dispatch = useEditor((s) => s.dispatch);
  const [activeId, setActiveId] = useState<string | null>(collections[0]?.id ?? null);
  const active = collections.find((c) => c.id === activeId) ?? collections[0];

  const create = () => {
    let id = '';
    dispatch('Add collection', (d) => {
      id = addCollection(d).id;
    });
    setActiveId(id);
  };

  return (
    <>
      <PanelHeader title="Variables">
        <IconButton label="Add collection" onClick={create}>
          <Plus size={14} />
        </IconButton>
      </PanelHeader>
      {!active ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-fg-muted">
          <VariableIcon size={20} aria-hidden="true" />
          <p>Variables store reusable colours, numbers, text and switches, with modes such as Light and Dark.</p>
          <button type="button" onClick={create} className="rounded bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover">
            Create collection
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-edge px-3 py-2">
            <select
              aria-label="Collection"
              value={active.id}
              onChange={(e) => setActiveId(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded border border-transparent bg-app px-1.5 text-fg outline-none hover:border-edge"
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <IconButton label="Delete collection" onClick={() => dispatch('Delete collection', (d) => deleteCollection(d, active.id))}>
              <Trash size={13} />
            </IconButton>
          </div>
          <div className="border-b border-edge px-3 py-1.5">
            <InlineEdit label="Collection name" value={active.name} onCommit={(name) => dispatch('Rename collection', (d) => renameCollection(d, active.id, name))} />
          </div>
          <CollectionView collection={active} />
        </>
      )}
    </>
  );
}
