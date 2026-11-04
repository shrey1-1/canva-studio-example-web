import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createId, type PluginPermission, type ToolCategory, type ToolManifest } from '@canvas-studio/core';

export interface CustomTool {
  manifest: ToolManifest;
  code: string;
}

export const MAX_TOOL_CODE = 200_000;

interface CustomToolsState {
  tools: CustomTool[];
  save: (tool: { id?: string; name: string; description: string; category: ToolCategory; permissions: PluginPermission[]; code: string; publisher: string }) => string;
  remove: (id: string) => void;
}

/** Tools the user wrote in this browser. They always run in the sandbox. */
export const useCustomTools = create<CustomToolsState>()(
  persist(
    (set, get) => ({
      tools: [],
      save: (t) => {
        const id = t.id ?? `custom-${createId()}`;
        const existing = get().tools.find((x) => x.manifest.id === id);
        const manifest: ToolManifest = {
          id,
          name: t.name.trim().slice(0, 80) || 'Untitled tool',
          description: t.description.trim().slice(0, 300),
          publisher: t.publisher,
          version: existing ? bump(existing.manifest.version) : '1.0.0',
          source: 'custom',
          category: t.category,
          icon: 'puzzle',
          accent: '#14B8A6',
          permissions: [...new Set(t.permissions)],
          entry: 'sandbox',
          addedAt: existing?.manifest.addedAt ?? new Date().toISOString().slice(0, 10),
          tags: ['custom'],
        };
        const tool = { manifest, code: t.code.slice(0, MAX_TOOL_CODE) };
        set((s) => ({ tools: existing ? s.tools.map((x) => (x.manifest.id === id ? tool : x)) : [...s.tools, tool] }));
        return id;
      },
      remove: (id) => set((s) => ({ tools: s.tools.filter((x) => x.manifest.id !== id) })),
    }),
    { name: 'canvas-studio:custom-tools', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);

function bump(version: string) {
  const [a, b, c] = version.split('.').map(Number);
  return `${a || 1}.${b || 0}.${(c || 0) + 1}`;
}
