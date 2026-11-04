import { create } from 'zustand';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  /** Optional button; the toast closes after it is clicked. */
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: Toast['kind'], opts?: { action?: ToastAction; durationMs?: number }) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const DURATION_MS = 5000;

/** Short, non-blocking notices (e.g. an image that could not be imported). */
export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (message, kind = 'info', opts = {}) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind, action: opts.action }] }));
    setTimeout(() => get().dismiss(id), opts.durationMs ?? DURATION_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
