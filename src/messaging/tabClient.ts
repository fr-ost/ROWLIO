// Client side of the content-script protocol, used by the popup and the workspace.
// Handles on-demand injection, typed requests, and streaming jobs.
import type { RawDataset } from '@/types';
import { t } from '@/i18n';
import { CancelledError, withTimeout } from '@/utils/async';
import { isRestrictedUrl } from '@/utils/url';
import {
  JOB_PORT,
  PROTOCOL,
  type ContentRequests,
  type JobServerMessage,
  type JobStart,
  type JobSummary,
  type Reply,
  type RequestType,
} from './protocol';
import type { ScrollProgress } from '@/types';

export type AccessCode = 'restricted' | 'no-access' | 'closed' | 'failed';

/** Why a tab cannot be used. `code` drives the recovery UI. */
export class TabAccessError extends Error {
  constructor(
    readonly code: AccessCode,
    message: string,
  ) {
    super(message);
    this.name = 'TabAccessError';
  }
}

function classify(error: unknown, url?: string): TabAccessError {
  const message = error instanceof Error ? error.message : String(error);
  if (/No tab with id|tab was closed|Invalid tab ID/i.test(message)) {
    return new TabAccessError('closed', t('The page was closed.'));
  }
  if (/error page|Frame with ID 0 was removed|showing error/i.test(message)) {
    return new TabAccessError('failed', t('The page failed to load, so there is nothing to extract.'));
  }
  if (/cannot be scripted|chrome:\/\/|chrome-extension:\/\/|Cannot access a chrome|extensions gallery|edge:\/\/|about:/i.test(message) || (url && isRestrictedUrl(url))) {
    return new TabAccessError('restricted', t('Chrome does not allow extensions to read this page (browser pages, the Chrome Web Store and similar).'));
  }
  if (/Cannot access contents|must request permission|Missing host permission|permission to access/i.test(message)) {
    return new TabAccessError('no-access', t('Rowlio no longer has access to this tab. Click the Rowlio icon on that page again, or grant access to the site.'));
  }
  return new TabAccessError('failed', message || t('Could not reach the page.'));
}

async function sendRaw<T extends RequestType>(tabId: number, type: T, payload: ContentRequests[T]['req']): Promise<ContentRequests[T]['res']> {
  const reply = (await chrome.tabs.sendMessage(tabId, { rowlio: PROTOCOL, type, payload })) as Reply<ContentRequests[T]['res']> | undefined;
  if (!reply) throw new Error('No response from the page.');
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}

function isDisconnected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection|message port closed|No response from the page|context invalidated/i.test(message);
}

/**
 * Make sure the content script is running in the tab (injecting it if needed) and
 * return the page's current URL and title. Throws TabAccessError when it cannot.
 */
export async function ensureInjected(tabId: number, knownUrl?: string): Promise<{ url: string; title: string }> {
  try {
    const pong = await withTimeout(sendRaw(tabId, 'ping', undefined), 1500, 'ping timeout');
    return { url: pong.url, title: pong.title };
  } catch {
    /* not injected yet (or the page navigated): inject below */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (error) {
    throw classify(error, knownUrl);
  }
  try {
    const pong = await withTimeout(sendRaw(tabId, 'ping', undefined), 4000, 'ping timeout');
    return { url: pong.url, title: pong.title };
  } catch (error) {
    throw classify(error, knownUrl);
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  /** Skip the automatic inject-and-retry (used while a navigation is expected). */
  noRetry?: boolean;
}

/** Send a typed request to the tab's content script, injecting it first if necessary. */
export async function request<T extends RequestType>(
  tabId: number,
  type: T,
  payload: ContentRequests[T]['req'],
  options: RequestOptions = {},
): Promise<ContentRequests[T]['res']> {
  const attempt = () => {
    const promise = sendRaw(tabId, type, payload);
    return options.timeoutMs ? withTimeout(promise, options.timeoutMs, t('The page took too long to respond.')) : promise;
  };
  try {
    return await attempt();
  } catch (error) {
    if (options.noRetry || !isDisconnected(error)) throw error;
    await ensureInjected(tabId);
    return attempt();
  }
}

export interface JobHandlers {
  onProgress?: (done: number, total: number) => void;
  onScrollProgress?: (progress: ScrollProgress) => void;
  /** Called as rows arrive, with the running total across datasets. */
  onRows?: (received: number) => void;
}

export interface JobResult {
  datasets: RawDataset[];
  summary: JobSummary;
}

type StartPayload = JobStart extends infer U ? (U extends { type: 'start' } ? Omit<U, 'type'> : never) : never;

/**
 * Run an extraction job in the tab and collect the streamed datasets.
 * Aborting the signal cancels the job in the page; a cancelled plain extraction rejects
 * with CancelledError, a cancelled scroll resolves with the records collected so far.
 */
export async function runJob(tabId: number, start: StartPayload, handlers: JobHandlers = {}, signal?: AbortSignal): Promise<JobResult> {
  await ensureInjected(tabId);
  return new Promise<JobResult>((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const port = chrome.tabs.connect(tabId, { name: JOB_PORT });
    const datasets = new Map<string, RawDataset>();
    const order: string[] = [];
    let received = 0;
    let finished = false;

    const finish = (action: () => void) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      try {
        port.disconnect();
      } catch {
        /* already closed */
      }
      action();
    };
    const onAbort = () => {
      try {
        port.postMessage({ type: 'cancel' });
      } catch {
        finish(() => reject(new CancelledError()));
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    port.onMessage.addListener((message: JobServerMessage) => {
      switch (message.type) {
        case 'progress':
          handlers.onProgress?.(message.done, message.total);
          break;
        case 'scroll-progress':
          handlers.onScrollProgress?.(message.progress);
          break;
        case 'dataset': {
          const { header } = message;
          datasets.set(header.key, {
            key: header.key,
            name: header.name,
            columns: header.columns,
            rows: [],
            warnings: header.warnings,
            method: header.method,
            detail: header.detail,
          });
          order.push(header.key);
          break;
        }
        case 'rows': {
          const dataset = datasets.get(message.key);
          if (dataset) {
            for (const row of message.rows) dataset.rows.push(row);
            received += message.rows.length;
            handlers.onRows?.(received);
          }
          break;
        }
        case 'done':
          finish(() => resolve({ datasets: order.map((key) => datasets.get(key)!), summary: message.summary }));
          break;
        case 'error':
          finish(() => reject(message.cancelled ? new CancelledError() : new Error(message.message)));
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it as handled.
      void chrome.runtime.lastError;
      finish(() => reject(new Error(t('The page was closed or navigated away before the extraction finished.'))));
    });
    port.postMessage({ type: 'start', ...start });
  });
}

/** Does Rowlio hold a persistent (user-granted) permission for this page's site? */
export async function hasSiteAccess(url: string): Promise<boolean> {
  try {
    const origin = new URL(url).origin;
    if (!/^https?:/.test(origin)) return false;
    return await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

/** Ask the user (Chrome's own prompt) for persistent access to one site. Needs a user gesture. */
export async function requestSiteAccess(url: string): Promise<boolean> {
  try {
    const origin = new URL(url).origin;
    if (!/^https?:/.test(origin)) return false;
    return await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

export async function revokeSiteAccess(originPattern: string): Promise<boolean> {
  try {
    return await chrome.permissions.remove({ origins: [originPattern] });
  } catch {
    return false;
  }
}

export async function listSiteAccess(): Promise<string[]> {
  try {
    const all = await chrome.permissions.getAll();
    return (all.origins ?? []).filter((origin) => /^https?:/.test(origin));
  } catch {
    return [];
  }
}
