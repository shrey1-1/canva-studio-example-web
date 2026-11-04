import { useMemo } from 'react';
import { Check, Play, Plus, Search } from 'lucide-react';
import {
  BUILT_IN_TOOLS,
  filterTools,
  toolCategories,
  type ToolCategory,
  type ToolManifest,
  type ToolQuery,
  type ToolSource,
} from '@canvas-studio/core';
import { useUi } from '../../state/uiStore';
import { useCustomTools } from '../../state/customToolsStore';
import { useToolUi } from '../plugins/runTool';
import { toolIcon } from '../toolIcons';
import { PanelHeader } from './UpcomingPanel';

const SOURCES: { value: ToolSource | 'all'; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'built-in', label: 'Built-in' },
  { value: 'community', label: 'Community' },
  { value: 'custom', label: 'Custom' },
];

const INSTALL: { value: ToolQuery['install']; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'installed', label: 'Installed' },
  { value: 'not-installed', label: 'Not installed' },
];

const SORTS: { value: ToolQuery['sort']; label: string }[] = [
  { value: 'suggested', label: 'Suggested' },
  { value: 'popular', label: 'Popular' },
  { value: 'recent', label: 'Recently added' },
  { value: 'name', label: 'Name' },
];

const selectClass =
  'h-7 min-w-0 flex-1 rounded border border-edge bg-app px-1.5 text-fg-muted outline-none hover:border-fg-subtle focus:border-accent';

export function ToolsPanel() {
  const query = useUi((s) => s.toolQuery);
  const setQuery = useUi((s) => s.setToolQuery);
  const installedList = useUi((s) => s.installedTools);
  const usage = useUi((s) => s.toolUsage);

  const customTools = useCustomTools((s) => s.tools);
  const allTools = useMemo(() => [...BUILT_IN_TOOLS, ...customTools.map((t) => t.manifest)], [customTools]);
  // Custom tools are written by the user, so they are always installed.
  const installed = useMemo(() => new Set([...installedList, ...customTools.map((t) => t.manifest.id)]), [installedList, customTools]);
  const categories = useMemo(() => toolCategories(allTools), [allTools]);
  const results = useMemo(() => filterTools(allTools, query, { installed, usage }), [allTools, query, installed, usage]);
  const openEditor = useToolUi((s) => s.openEditor);
  const heading = query.search || query.category !== 'all' || query.source !== 'all' || query.install !== 'all'
    ? `Results (${results.length})`
    : SORTS.find((s) => s.value === query.sort)!.label;

  return (
    <>
      <PanelHeader title="Tools">
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Plus size={13} /> New tool
        </button>
      </PanelHeader>
      <div className="space-y-2 border-b border-edge p-3">
        <label className="relative block">
          <span className="sr-only">Search all tools</span>
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            placeholder="Search all tools"
            value={query.search}
            onChange={(e) => setQuery({ search: e.target.value })}
            className="h-7 w-full rounded border border-edge bg-app pr-2 pl-7 outline-none placeholder:text-fg-subtle focus:border-accent"
          />
        </label>
        <div className="flex gap-2">
          <select aria-label="Source" className={selectClass} value={query.source}
            onChange={(e) => setQuery({ source: e.target.value as ToolQuery['source'] })}>
            {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select aria-label="Category" className={selectClass} value={query.category}
            onChange={(e) => setQuery({ category: e.target.value as ToolCategory | 'all' })}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <select aria-label="Installation status" className={selectClass} value={query.install}
            onChange={(e) => setQuery({ install: e.target.value as ToolQuery['install'] })}>
            {INSTALL.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select aria-label="Sort" className={selectClass} value={query.sort}
            onChange={(e) => setQuery({ sort: e.target.value as ToolQuery['sort'] })}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <h3 className="px-3 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">{heading}</h3>
        {results.length === 0 ? (
          <div className="px-3 py-6 text-center text-fg-subtle">
            <p>No tools match these filters.</p>
            <button type="button" className="mt-2 text-accent hover:underline"
              onClick={() => setQuery({ search: '', source: 'all', category: 'all', install: 'all' })}>
              Clear filters
            </button>
          </div>
        ) : (
          <ul aria-label="Tools" className="space-y-1 px-2 pb-3">
            {results.map((tool) => (
              <ToolCard key={tool.id} tool={tool} installed={installed.has(tool.id)} runs={usage[tool.id] ?? 0} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ToolCard({ tool, installed, runs }: { tool: ToolManifest; installed: boolean; runs: number }) {
  const setInstalled = useUi((s) => s.setToolInstalled);
  const openRun = useToolUi((s) => s.openRun);
  const openEditor = useToolUi((s) => s.openEditor);
  const custom = tool.source === 'custom';
  const Icon = toolIcon(tool.icon);
  return (
    <li className="group flex gap-2.5 rounded-md p-2 hover:bg-hover/60" aria-label={tool.name}>
      <div
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
        style={{ background: `${tool.accent}26`, color: tool.accent }}
      >
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-fg">{tool.name}</p>
          {installed && (
            <span className="flex items-center gap-0.5 text-2xs text-emerald-400">
              <Check size={11} /> Installed
            </span>
          )}
        </div>
        <p className="truncate text-2xs text-fg-subtle">
          {tool.publisher} · {tool.category} · v{tool.version}
        </p>
        <p className="mt-0.5 line-clamp-2 text-2xs text-fg-muted">{tool.description}</p>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-2xs text-fg-subtle">{runs > 0 ? `Run ${runs} time${runs === 1 ? '' : 's'}` : custom ? 'Sandboxed' : 'Not run yet'}</span>
          <div className="flex gap-1">
            {custom ? (
              <button type="button" onClick={() => openEditor(tool.id)} aria-label={`Edit ${tool.name}`} className="rounded border border-edge px-2 py-0.5 text-2xs text-fg-muted hover:bg-hover">
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setInstalled(tool.id, !installed)}
                aria-label={`${installed ? 'Uninstall' : 'Install'} ${tool.name}`}
                className={`rounded px-2 py-0.5 text-2xs font-medium ${
                  installed ? 'border border-edge text-fg-muted hover:bg-hover' : 'bg-accent text-fg hover:bg-accent-hover'
                }`}
              >
                {installed ? 'Uninstall' : 'Install'}
              </button>
            )}
            {installed && (
              <button
                type="button"
                onClick={() => openRun(tool.id)}
                aria-label={`Run ${tool.name}`}
                className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-2xs font-medium text-fg hover:bg-accent-hover"
              >
                <Play size={10} /> Run
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
