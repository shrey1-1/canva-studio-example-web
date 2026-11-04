import { create } from 'zustand';
import type { Point } from '@canvas-studio/core';

export interface ContextMenuRequest {
  /** Viewport (client) coordinates where the menu opens. */
  x: number;
  y: number;
  /** Page-space point under the pointer, for "Paste here" (canvas only). */
  world?: Point;
}

interface ContextMenuState {
  menu: ContextMenuRequest | null;
  open: (menu: ContextMenuRequest) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuState>()((set) => ({
  menu: null,
  open: (menu) => set({ menu }),
  close: () => set({ menu: null }),
}));
