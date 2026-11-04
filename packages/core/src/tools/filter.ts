import type { ToolCategory, ToolManifest, ToolSource } from './catalog';

export type InstallFilter = 'all' | 'installed' | 'not-installed';
export type ToolSort = 'suggested' | 'popular' | 'recent' | 'name';

export interface ToolQuery {
  search: string;
  source: ToolSource | 'all';
  category: ToolCategory | 'all';
  install: InstallFilter;
  sort: ToolSort;
}

export const DEFAULT_TOOL_QUERY: ToolQuery = {
  search: '',
  source: 'all',
  category: 'all',
  install: 'all',
  sort: 'suggested',
};

export interface ToolState {
  installed: ReadonlySet<string>;
  /** Number of times each tool has been run locally. */
  usage: Readonly<Record<string, number>>;
}

/** Search matches name, description, category, publisher and tags (all words must match). */
export function matchesSearch(tool: ToolManifest, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [tool.name, tool.description, tool.category, tool.publisher, ...tool.tags]
    .join(' ')
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function filterTools(
  tools: readonly ToolManifest[],
  query: ToolQuery,
  state: ToolState,
): ToolManifest[] {
  const result = tools.filter((tool) => {
    if (query.source !== 'all' && tool.source !== query.source) return false;
    if (query.category !== 'all' && tool.category !== query.category) return false;
    const isInstalled = state.installed.has(tool.id);
    if (query.install === 'installed' && !isInstalled) return false;
    if (query.install === 'not-installed' && isInstalled) return false;
    return matchesSearch(tool, query.search);
  });

  const usage = (t: ToolManifest) => state.usage[t.id] ?? 0;
  switch (query.sort) {
    case 'popular':
      return result.sort((a, b) => usage(b) - usage(a) || a.name.localeCompare(b.name));
    case 'recent':
      return result.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name));
    case 'name':
      return result.sort((a, b) => a.name.localeCompare(b.name));
    case 'suggested':
      // Installed tools first, then catalog order.
      return result.sort((a, b) => Number(state.installed.has(b.id)) - Number(state.installed.has(a.id)));
  }
}

export function toolCategories(tools: readonly ToolManifest[]): ToolCategory[] {
  return [...new Set(tools.map((t) => t.category))].sort();
}
