// UI-level state: route, toasts, settings.
import { create } from 'zustand';
import type { Settings } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { loadSettings, saveSettings } from '@/storage/settings';

// ---- routing (hash based: works from a chrome-extension:// page without a server) ----------

export const ROUTES = ['/', '/tables', '/visual', '/selectors', '/pagination', '/data', '/projects', '/recipes', '/settings', '/help'] as const;
export type Route = (typeof ROUTES)[number];

function parseHash(): Route {
  const path = window.location.hash.replace(/^#/, '').split('?')[0] || '/';
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : '/';
}

export function navigate(route: Route): void {
  if (parseHash() === route) return;
  window.location.hash = route;
}

// ---- toasts -----------------------------------------------------------------------------------

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

interface UiState {
  route: Route;
  toasts: Toast[];
  settings: Settings;
  settingsLoaded: boolean;
  setRoute(route: Route): void;
  pushToast(toast: Omit<Toast, 'id'>): number;
  dismissToast(id: number): void;
  loadSettings(): Promise<void>;
  updateSettings(patch: DeepPartial<Settings>): Promise<void>;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

let nextToastId = 1;
let settingsTicket = 0;

function mergeDeep<T>(base: T, patch: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value) && current !== null && typeof current === 'object'
        ? mergeDeep(current, value as DeepPartial<typeof current>)
        : value;
  }
  return result as T;
}

export const useUi = create<UiState>((set, get) => ({
  route: parseHash(),
  toasts: [],
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  setRoute: (route) => set({ route }),
  pushToast: (toast) => {
    const id = nextToastId++;
    set({ toasts: [...get().toasts.slice(-4), { ...toast, id }] });
    const ttl = toast.kind === 'error' ? 12_000 : toast.kind === 'warning' ? 9_000 : 5_000;
    window.setTimeout(() => get().dismissToast(id), ttl);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  loadSettings: async () => {
    try {
      set({ settings: await loadSettings(), settingsLoaded: true });
    } catch {
      set({ settingsLoaded: true });
    }
  },
  updateSettings: async (patch) => {
    // Apply immediately so controls respond at once, then persist. Only the most recent
    // save may overwrite the store, so quick successive changes never flicker back.
    const ticket = ++settingsTicket;
    set({ settings: mergeDeep(get().settings, patch) });
    const saved = await saveSettings(patch);
    if (ticket === settingsTicket) set({ settings: saved });
  },
}));

window.addEventListener('hashchange', () => useUi.getState().setRoute(parseHash()));

export const toast = {
  success: (message: string, detail?: string) => useUi.getState().pushToast({ kind: 'success', message, detail }),
  error: (message: string, detail?: string) => useUi.getState().pushToast({ kind: 'error', message, detail }),
  info: (message: string, detail?: string) => useUi.getState().pushToast({ kind: 'info', message, detail }),
  warning: (message: string, detail?: string) => useUi.getState().pushToast({ kind: 'warning', message, detail }),
};

/** Apply the theme setting to <html>. */
export function applyTheme(theme: Settings['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
