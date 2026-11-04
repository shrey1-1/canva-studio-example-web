import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, Pause, Play, ShieldCheck, X } from 'lucide-react';
import type { PluginPermission, ToolCategory } from '@canvas-studio/core';
import { useCustomTools, MAX_TOOL_CODE } from '../../state/customToolsStore';
import { useUi } from '../../state/uiStore';
import { useAuth } from '../../state/authStore';
import { toolIcon } from '../toolIcons';
import { BUILTIN_TOOLS, defaultValues, type ParamValue, type ToolParam, type ToolResult } from './builtinTools';
import { downloadFile } from './imageIO';
import { findManifest, runTool, useToolUi } from './runTool';
import { CUSTOM_TOOL_TEMPLATE } from './sandbox';
import { Modal as BaseModal } from '../../ui/Modal';

export const PERMISSION_TEXT: Record<PluginPermission, string> = {
  'read-selection': 'Read the selected layers',
  'read-document': 'Read the whole file (layers, variables)',
  'create-nodes': 'Add new layers',
  'modify-nodes': 'Change or delete existing layers',
  'import-assets': 'Add images to the file',
  export: 'Save files to your computer',
};

// While the player is open on top, Escape belongs to it.
const playerOpen = () => !!useToolUi.getState().player;

function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <BaseModal {...props} escapeDisabled={playerOpen} />;
}

function ParamField({ param, value, onChange }: { param: ToolParam; value: ParamValue; onChange: (v: ParamValue) => void }) {
  const id = `param-${param.key}`;
  const base = 'h-7 w-full rounded border border-edge bg-app px-1.5 text-fg outline-none focus:border-accent';
  return (
    <div className={param.type === 'boolean' ? 'col-span-2' : ''}>
      {param.type === 'boolean' ? (
        <label className="flex items-center gap-2 text-fg-muted">
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
          {param.label}
        </label>
      ) : (
        <>
          <label htmlFor={id} className="mb-1 block text-2xs text-fg-muted">
            {param.label}
          </label>
          {param.type === 'select' ? (
            <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} className={base}>
              {param.options!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : param.type === 'color' ? (
            <div className="flex items-center gap-2">
              <input id={id} type="color" value={String(value)} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-7 w-8" />
              <span className="font-mono text-fg-muted">{String(value)}</span>
            </div>
          ) : (
            <input
              id={id}
              type="number"
              value={String(value)}
              min={param.min}
              max={param.max}
              step={param.step}
              onChange={(e) => onChange(e.target.value === '' ? param.default : Number(e.target.value))}
              className={base}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Clamps numbers to the parameter limits before running. */
function sanitize(params: ToolParam[], values: Record<string, ParamValue>) {
  const out = { ...values };
  for (const p of params) {
    if (p.type !== 'number') continue;
    const v = Number(out[p.key]);
    out[p.key] = Number.isFinite(v) ? Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v)) : p.default;
  }
  return out;
}

export function ToolRunDialog({ toolId }: { toolId: string }) {
  const close = useToolUi((s) => s.close);
  const openEditor = useToolUi((s) => s.openEditor);
  const manifest = findManifest(toolId);
  const impl = BUILTIN_TOOLS[toolId];
  const params = impl?.params ?? [];
  const [values, setValues] = useState(() => defaultValues(params));
  const [status, setStatus] = useState<{ kind: 'idle' | 'running' | 'done' | 'error'; message?: string }>({ kind: 'idle' });
  const [result, setResult] = useState<ToolResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  if (!manifest) return null;
  const Icon = toolIcon(manifest.icon);

  const run = async () => {
    abort.current = new AbortController();
    setStatus({ kind: 'running' });
    setResult(null);
    try {
      const r = await runTool(toolId, sanitize(params, values), abort.current.signal);
      setResult(r);
      setStatus({ kind: 'done', message: r.message });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <Modal title={manifest.name} onClose={() => (abort.current?.abort(), close())}>
      <div className="mb-3 flex gap-3">
        <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md" style={{ background: `${manifest.accent}26`, color: manifest.accent }}>
          <Icon size={20} />
        </div>
        <div>
          <p className="text-fg-muted">{manifest.description}</p>
          {impl?.hint && <p className="mt-1 text-2xs text-fg-subtle">{impl.hint}</p>}
        </div>
      </div>
      <details className="mb-3 rounded border border-edge px-2 py-1.5 text-fg-muted">
        <summary className="flex cursor-pointer items-center gap-1.5 text-2xs">
          <ShieldCheck size={12} /> Permissions ({manifest.permissions.length}){manifest.source === 'custom' ? ' · runs in a sandbox' : ''}
        </summary>
        <ul className="mt-1.5 list-disc pl-5 text-2xs">
          {manifest.permissions.map((p) => (
            <li key={p}>{PERMISSION_TEXT[p]}</li>
          ))}
        </ul>
      </details>
      {params.length > 0 && (
        <form
          aria-label={`${manifest.name} settings`}
          className="grid grid-cols-2 gap-x-3 gap-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {params.map((p) => (
            <ParamField key={p.key} param={p} value={values[p.key] ?? p.default} onChange={(v) => setValues((s) => ({ ...s, [p.key]: v }))} />
          ))}
          <button type="submit" hidden />
        </form>
      )}
      {status.kind !== 'idle' && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className={`mt-3 rounded px-2 py-1.5 ${status.kind === 'error' ? 'bg-danger/20 text-red-200' : 'bg-app text-fg-muted'}`}>
          {status.kind === 'running' ? 'Running…' : status.message}
        </p>
      )}
      {result?.text && <TextResult text={result.text} />}
      <div className="mt-4 flex justify-end gap-2">
        {manifest.source === 'custom' && (
          <button type="button" onClick={() => openEditor(toolId)} className="rounded border border-edge px-3 py-1.5 text-fg-muted hover:bg-hover">
            Edit code
          </button>
        )}
        {status.kind === 'running' && manifest.source === 'custom' && (
          <button type="button" onClick={() => abort.current?.abort()} className="rounded border border-edge px-3 py-1.5 text-fg-muted hover:bg-hover">
            Stop
          </button>
        )}
        <button type="button" disabled={status.kind === 'running'} onClick={() => void run()} className="rounded bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {status.kind === 'running' ? 'Running…' : 'Run'}
        </button>
      </div>
    </Modal>
  );
}

function TextResult({ text }: { text: { content: string; filename: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-2xs text-fg-subtle">{text.filename}</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(text.content).then(() => setCopied(true), () => setCopied(false))}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-hover"
          >
            <Copy size={11} /> {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={() => downloadFile(text.filename, text.content)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-hover">
            <Download size={11} /> Download
          </button>
        </div>
      </div>
      <pre aria-label="Output" className="max-h-60 overflow-auto rounded bg-app p-2 font-mono text-2xs text-fg">
        {text.content}
      </pre>
    </div>
  );
}

const CATEGORIES: ToolCategory[] = ['Graphics', 'Effects', 'Layout', 'Mockups', 'Animation', 'Presentation', 'Assets', 'Developer'];
const ALL_PERMISSIONS = Object.keys(PERMISSION_TEXT) as PluginPermission[];

export function CustomToolEditor({ toolId }: { toolId: string | null }) {
  const close = useToolUi((s) => s.close);
  const openRun = useToolUi((s) => s.openRun);
  const existing = useCustomTools((s) => s.tools.find((t) => t.manifest.id === toolId));
  const save = useCustomTools((s) => s.save);
  const remove = useCustomTools((s) => s.remove);
  const profile = useAuth((s) => s.user?.name ?? 'You');
  const [name, setName] = useState(existing?.manifest.name ?? '');
  const [description, setDescription] = useState(existing?.manifest.description ?? '');
  const [category, setCategory] = useState<ToolCategory>(existing?.manifest.category ?? 'Graphics');
  const [permissions, setPermissions] = useState<PluginPermission[]>(existing?.manifest.permissions ?? ['read-selection', 'create-nodes']);
  const [code, setCode] = useState(existing?.code ?? CUSTOM_TOOL_TEMPLATE);
  const valid = name.trim().length > 0 && code.trim().length > 0;

  const submit = (andRun: boolean) => {
    if (!valid) return;
    const id = save({ id: existing?.manifest.id, name, description, category, permissions, code, publisher: profile });
    useUi.getState().setToolInstalled(id, true);
    if (andRun) openRun(id);
    else close();
  };

  return (
    <Modal title={existing ? `Edit ${existing.manifest.name}` : 'New tool'} onClose={close} wide>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-2xs text-fg-muted">
          Name
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="mt-1 h-7 w-full rounded border border-edge bg-app px-1.5 text-[12px] text-fg outline-none focus:border-accent" />
        </label>
        <label className="text-2xs text-fg-muted">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as ToolCategory)} className="mt-1 h-7 w-full rounded border border-edge bg-app px-1.5 text-[12px] text-fg outline-none">
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-2xs text-fg-muted">
          Description
          <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} className="mt-1 h-7 w-full rounded border border-edge bg-app px-1.5 text-[12px] text-fg outline-none focus:border-accent" />
        </label>
        <fieldset className="col-span-2">
          <legend className="mb-1 text-2xs text-fg-muted">Permissions (the tool can only do what is ticked)</legend>
          <div className="grid grid-cols-2 gap-1">
            {ALL_PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-fg-muted">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={permissions.includes(p)}
                  onChange={(e) => setPermissions((s) => (e.target.checked ? [...s, p] : s.filter((x) => x !== p)))}
                />
                {PERMISSION_TEXT[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="col-span-2 text-2xs text-fg-muted">
          Code (JavaScript, runs in an isolated sandbox with no network access)
          <textarea
            aria-label="Tool code"
            value={code}
            spellCheck={false}
            maxLength={MAX_TOOL_CODE}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="mt-1 h-72 w-full resize-y rounded border border-edge bg-app p-2 font-mono text-[11px] leading-relaxed text-fg outline-none focus:border-accent"
          />
        </label>
      </div>
      <div className="mt-4 flex justify-between gap-2">
        {existing ? (
          <button
            type="button"
            onClick={() => {
              remove(existing.manifest.id);
              useUi.getState().setToolInstalled(existing.manifest.id, false);
              close();
            }}
            className="rounded border border-danger/50 px-3 py-1.5 text-red-300 hover:bg-danger/20"
          >
            Delete tool
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" disabled={!valid} onClick={() => submit(false)} className="rounded border border-edge px-3 py-1.5 text-fg-muted hover:bg-hover disabled:opacity-50">
            Save
          </button>
          <button type="button" disabled={!valid} onClick={() => submit(true)} className="rounded bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            Save and run
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Full-screen player for Auto-Slide (animated transitions) and Flipbook (page turns). */
export function Player() {
  const player = useToolUi((s) => s.player);
  const show = useToolUi((s) => s.showPlayer);
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    setIndex(0);
    setPrev(null);
    setPlaying(true);
  }, [player]);

  const count = player?.pages.length ?? 0;
  const go = (next: number) => {
    if (!player || next < 0 || next >= count || next === index) return;
    setPrev(index);
    setIndex(next);
  };

  useEffect(() => {
    if (!player) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') show(null);
      else if (e.key === 'ArrowRight' || e.key === ' ') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    if (!player || !playing || player.autoAdvance <= 0) return;
    const t = setTimeout(() => go(index + 1 < count ? index + 1 : 0), player.autoAdvance * 1000 + player.duration);
    return () => clearTimeout(t);
  });

  if (!player) return null;
  const forward = prev === null || index > prev;
  const d = `${player.duration}ms`;
  const anim = (incoming: boolean): string => {
    const dir = forward ? 1 : -1;
    switch (player.transition) {
      case 'fade':
        return incoming ? 'cs-fade-in' : 'cs-fade-out';
      case 'push':
        return incoming ? (dir > 0 ? 'cs-push-in' : 'cs-push-in-rev') : dir > 0 ? 'cs-push-out' : 'cs-push-out-rev';
      case 'zoom':
        return incoming ? 'cs-zoom-in' : 'cs-fade-out';
      case 'flip':
        return incoming ? 'cs-flip-in' : 'cs-flip-out';
      default:
        return incoming ? (dir > 0 ? 'cs-slide-in' : 'cs-slide-in-rev') : dir > 0 ? 'cs-slide-out' : 'cs-slide-out-rev';
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={player.mode === 'flipbook' ? 'Flipbook player' : 'Slideshow player'} className="fixed inset-0 z-[60] flex flex-col bg-[#0b0b0d]">
      <div className="flex h-11 shrink-0 items-center justify-between px-4 text-fg-muted">
        <span>
          {player.mode === 'flipbook' ? 'Flipbook' : 'Slides'} · {index + 1} / {count}
        </span>
        <div className="flex items-center gap-1">
          {player.mode === 'slides' && player.autoAdvance > 0 && (
            <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} className="rounded p-1.5 hover:bg-hover">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
          )}
          <button type="button" aria-label="Close player" onClick={() => show(null)} className="rounded p-1.5 hover:bg-hover">
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ perspective: '2000px' }}>
        {prev !== null && (
          <img key={`p${prev}-${index}`} src={player.pages[prev]} alt="" className={`absolute inset-0 m-auto max-h-full max-w-full object-contain ${anim(false)}`} style={{ animationDuration: d, transformOrigin: 'left center' }} />
        )}
        <img key={`c${index}`} src={player.pages[index]} alt={`Page ${index + 1}`} className={`absolute inset-0 m-auto max-h-full max-w-full object-contain ${prev === null ? '' : anim(true)}`} style={{ animationDuration: d, transformOrigin: 'left center' }} />
        <button type="button" aria-label="Previous page" disabled={index === 0} onClick={() => go(index - 1)} className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white disabled:opacity-20">
          <ChevronLeft size={20} />
        </button>
        <button type="button" aria-label="Next page" disabled={index === count - 1} onClick={() => go(index + 1)} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white disabled:opacity-20">
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}

export function ToolDialogs() {
  const dialog = useToolUi((s) => s.dialog);
  return (
    <>
      {dialog?.kind === 'run' && <ToolRunDialog key={dialog.toolId} toolId={dialog.toolId} />}
      {dialog?.kind === 'edit' && <CustomToolEditor key={dialog.toolId ?? 'new'} toolId={dialog.toolId} />}
      <Player />
    </>
  );
}
