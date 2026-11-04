import { describe, expect, it } from 'vitest';
import { BUILT_IN_TOOLS } from './catalog';
import { DEFAULT_TOOL_QUERY, filterTools, matchesSearch, toolCategories } from './filter';

const empty = { installed: new Set<string>(), usage: {} };

describe('tool catalog', () => {
  it('has the 13 required tools with unique ids', () => {
    expect(BUILT_IN_TOOLS).toHaveLength(13);
    expect(new Set(BUILT_IN_TOOLS.map((t) => t.id)).size).toBe(13);
  });
});

describe('filterTools', () => {
  it('searches name, description, category, publisher and tags', () => {
    const byName = BUILT_IN_TOOLS.find((t) => t.id === 'nebula')!;
    expect(matchesSearch(byName, 'nebula')).toBe(true);
    expect(matchesSearch(byName, 'space stars')).toBe(true); // tags/description
    expect(matchesSearch(byName, 'effects')).toBe(true); // category
    expect(matchesSearch(byName, 'canvas studio')).toBe(true); // publisher
    expect(matchesSearch(byName, 'spreadsheet')).toBe(false);
  });

  it('filters by category', () => {
    const result = filterTools(BUILT_IN_TOOLS, { ...DEFAULT_TOOL_QUERY, category: 'Mockups' }, empty);
    expect(result.map((t) => t.id).sort()).toEqual(['generate-mockup', 'phone-mockup']);
  });

  it('filters by install state', () => {
    const state = { installed: new Set(['clouds']), usage: {} };
    expect(filterTools(BUILT_IN_TOOLS, { ...DEFAULT_TOOL_QUERY, install: 'installed' }, state).map((t) => t.id)).toEqual([
      'clouds',
    ]);
    expect(filterTools(BUILT_IN_TOOLS, { ...DEFAULT_TOOL_QUERY, install: 'not-installed' }, state)).toHaveLength(12);
  });

  it('sorts popular by local usage', () => {
    const state = { installed: new Set<string>(), usage: { clouds: 5, nebula: 9 } };
    const result = filterTools(BUILT_IN_TOOLS, { ...DEFAULT_TOOL_QUERY, sort: 'popular' }, state);
    expect(result.slice(0, 2).map((t) => t.id)).toEqual(['nebula', 'clouds']);
  });

  it('puts installed tools first in suggested order', () => {
    const state = { installed: new Set(['clouds']), usage: {} };
    expect(filterTools(BUILT_IN_TOOLS, DEFAULT_TOOL_QUERY, state)[0]!.id).toBe('clouds');
  });

  it('lists categories once each', () => {
    const cats = toolCategories(BUILT_IN_TOOLS);
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toContain('Effects');
  });
});
