import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_TOOL_QUERY, type ToolQuery } from '@canvas-studio/core';

export type NavSection = 'file' | 'agents' | 'assets' | 'tools' | 'variables';
export type InspectorTab = 'design' | 'prototype';

interface UiState {
  nav: NavSection;
  /** Whether the secondary (contextual) sidebar is open. */
  panelOpen: boolean;
  inspectorTab: InspectorTab;
  showGrid: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  /** Snap moving layers to other layers' edges and centres, showing guide lines. */
  smartGuides: boolean;
  profileName: string;
  toolQuery: ToolQuery;
  installedTools: string[];
  toolUsage: Record<string, number>;

  /** Opens a section; clicking the active section again collapses the panel. */
  openSection: (nav: NavSection) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  toggleGrid: () => void;
  toggleRulers: () => void;
  toggleSnap: () => void;
  toggleSmartGuides: () => void;
  setProfileName: (name: string) => void;
  setToolQuery: (patch: Partial<ToolQuery>) => void;
  setToolInstalled: (id: string, installed: boolean) => void;
  /** Counts a successful run (drives the "Popular" sort). */
  recordToolRun: (id: string) => void;
}

/** Persisted per-browser UI preferences (navigation state, toggles, tool installs). */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      nav: 'file',
      panelOpen: true,
      inspectorTab: 'design',
      showGrid: true,
      showRulers: true,
      snapToGrid: false,
      smartGuides: true,
      profileName: 'You',
      toolQuery: DEFAULT_TOOL_QUERY,
      installedTools: [],
      toolUsage: {},

      openSection: (nav) =>
        set((s) => (s.nav === nav ? { panelOpen: !s.panelOpen } : { nav, panelOpen: true })),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
      toggleRulers: () => set((s) => ({ showRulers: !s.showRulers })),
      toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
      toggleSmartGuides: () => set((s) => ({ smartGuides: !s.smartGuides })),
      setProfileName: (name) => set({ profileName: name.trim() || 'You' }),
      setToolQuery: (patch) => set((s) => ({ toolQuery: { ...s.toolQuery, ...patch } })),
      recordToolRun: (id) => set((s) => ({ toolUsage: { ...s.toolUsage, [id]: (s.toolUsage[id] ?? 0) + 1 } })),
      setToolInstalled: (id, installed) =>
        set((s) => ({
          installedTools: installed
            ? [...new Set([...s.installedTools, id])]
            : s.installedTools.filter((t) => t !== id),
        })),
    }),
    {
      name: 'canvas-studio:ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
