// The "target": the browser tab the workspace is connected to.
import { create } from 'zustand';
import type { PageScan } from '@/types';
import { ensureInjected, request, TabAccessError, type AccessCode } from '@/messaging/tabClient';
import { isRestrictedUrl } from '@/utils/url';

export type TargetStatus = 'none' | 'connecting' | 'ready' | AccessCode;

interface TargetState {
  tabId: number | null;
  url: string;
  title: string;
  status: TargetStatus;
  error: string;
  scan: PageScan | null;
  scanning: boolean;
  /** True while a pagination / scroll run owns the tab (suppresses automatic rescans). */
  busy: boolean;
  bind(tabId: number, url?: string, title?: string): Promise<void>;
  connect(): Promise<boolean>;
  setBusy(busy: boolean): void;
  markError(error: unknown): void;
}

let connectSeq = 0;

export const useTarget = create<TargetState>((set, get) => ({
  tabId: null,
  url: '',
  title: '',
  status: 'none',
  error: '',
  scan: null,
  scanning: false,
  busy: false,

  bind: async (tabId, url = '', title = '') => {
    set({ tabId, url, title, status: 'connecting', error: '', scan: null });
    await get().connect();
  },

  connect: async () => {
    const { tabId } = get();
    if (tabId === null) return false;
    const seq = ++connectSeq;
    set({ status: 'connecting', error: '', scanning: true });
    try {
      // tab.url is only visible while Rowlio has access to the tab.
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw new TabAccessError('closed', 'The page was closed.');
      const knownUrl = tab.url || get().url;
      if (tab.url && isRestrictedUrl(tab.url)) {
        if (seq === connectSeq) set({ url: tab.url, title: tab.title ?? '', status: 'restricted', error: '', scanning: false, scan: null });
        return false;
      }
      const page = await ensureInjected(tabId, knownUrl);
      const scan = await request(tabId, 'scan', undefined, { timeoutMs: 20_000 });
      if (seq !== connectSeq) return false;
      set({ url: page.url, title: page.title, status: 'ready', error: '', scan, scanning: false });
      return true;
    } catch (error) {
      if (seq !== connectSeq) return false;
      if (error instanceof TabAccessError) set({ status: error.code, error: error.message, scanning: false, scan: null });
      else set({ status: 'failed', error: error instanceof Error ? error.message : String(error), scanning: false, scan: null });
      return false;
    }
  },

  setBusy: (busy) => set({ busy }),

  markError: (error) => {
    if (error instanceof TabAccessError) set({ status: error.code, error: error.message, scan: null });
  },
}));

/** Keep the connection in sync with the tab's lifecycle. Call once at startup. */
export function initTargetListeners(): void {
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    const state = useTarget.getState();
    if (tabId !== state.tabId || state.busy) return;
    if (change.status === 'complete') void state.connect();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    const state = useTarget.getState();
    if (tabId !== state.tabId) return;
    useTarget.setState({ status: 'closed', error: '', scan: null });
  });
}

export async function focusTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
}

export async function focusTargetTab(): Promise<void> {
  const { tabId } = useTarget.getState();
  if (tabId !== null) await focusTab(tabId).catch(() => undefined);
}

export async function focusWorkspace(): Promise<void> {
  const self = await chrome.tabs.getCurrent();
  if (self?.id !== undefined) await focusTab(self.id).catch(() => undefined);
}

/** Throws a friendly error when there is no usable page. Returns the tab id otherwise. */
export function requireTarget(): number {
  const { tabId, status } = useTarget.getState();
  if (tabId === null || status === 'none') throw new Error('Open a webpage and click the Rowlio icon there to connect it.');
  return tabId;
}
