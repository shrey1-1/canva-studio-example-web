import { create } from 'zustand';
import { api, ApiError, setUnauthorizedHandler } from '../persistence/api';

export interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out' | 'offline';
  user: User | null;
  error: string | null;
  check: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

/** The signed-in account. `check` runs once at startup; a 401 anywhere signs the user out. */
export const useAuth = create<AuthState>()((set) => ({
  status: 'loading',
  user: null,
  error: null,
  check: async () => {
    try {
      const { user } = await api<{ user: User }>('GET', '/auth/me');
      set({ status: 'signed-in', user, error: null });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) set({ status: 'signed-out', user: null, error: null });
      else set({ status: 'offline', user: null, error: e instanceof Error ? e.message : 'Server unavailable' });
    }
  },
  login: async (email, password) => {
    const { user } = await api<{ user: User }>('POST', '/auth/login', { email, password });
    set({ status: 'signed-in', user, error: null });
  },
  signup: async (name, email, password) => {
    const { user } = await api<{ user: User }>('POST', '/auth/signup', { name, email, password });
    set({ status: 'signed-in', user, error: null });
  },
  logout: async () => {
    await api('POST', '/auth/logout').catch(() => undefined);
    set({ status: 'signed-out', user: null });
  },
}));

setUnauthorizedHandler(() => {
  if (useAuth.getState().status === 'signed-in') useAuth.setState({ status: 'signed-out', user: null, error: 'Your session ended. Sign in again.' });
});
