// Waiting for a page to finish rendering / for in-page (AJAX) pagination to take effect.
import { CancelledError } from '@/utils/async';

/**
 * Resolve when the DOM has been free of mutations for `quietMs`, or after `timeoutMs`.
 * Returns whether the page actually went quiet.
 */
export function waitForDomQuiet(doc: Document, quietMs: number, timeoutMs: number, signal?: AbortSignal): Promise<{ settled: boolean; mutated: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const view = doc.defaultView;
    const Observer = view ? (view as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver : undefined;
    let mutated = false;
    let quietTimer: ReturnType<typeof setTimeout>;
    const finish = (settled: boolean) => {
      clearTimeout(quietTimer);
      clearTimeout(deadline);
      observer?.disconnect();
      signal?.removeEventListener('abort', onAbort);
      resolve({ settled, mutated });
    };
    const onAbort = () => {
      clearTimeout(quietTimer);
      clearTimeout(deadline);
      observer?.disconnect();
      reject(new CancelledError());
    };
    const observer = Observer
      ? new Observer(() => {
          mutated = true;
          clearTimeout(quietTimer);
          quietTimer = setTimeout(() => finish(true), quietMs);
        })
      : null;
    observer?.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    quietTimer = setTimeout(() => finish(true), quietMs);
    const deadline = setTimeout(() => finish(false), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wait until `signature()` differs from `before` (content was replaced or appended),
 * then for the DOM to go quiet. Resolves false when nothing changed within `timeoutMs`.
 */
export function waitForChange(
  doc: Document,
  signature: () => string,
  before: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const view = doc.defaultView;
    const Observer = view ? (view as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver : undefined;
    let done = false;
    let scheduled = false;
    const cleanup = () => {
      done = true;
      clearTimeout(deadline);
      clearInterval(poll);
      observer?.disconnect();
      signal?.removeEventListener('abort', onAbort);
    };
    const check = () => {
      scheduled = false;
      if (done) return;
      let current: string;
      try {
        current = signature();
      } catch {
        return;
      }
      if (current !== before) {
        cleanup();
        waitForDomQuiet(doc, 350, 5000, signal).then(() => resolve(true), reject);
      }
    };
    const schedule = () => {
      if (scheduled || done) return;
      scheduled = true;
      setTimeout(check, 60);
    };
    const onAbort = () => {
      cleanup();
      reject(new CancelledError());
    };
    const observer = Observer ? new Observer(schedule) : null;
    observer?.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
    // URL-only changes (history.pushState) and attribute-driven UIs are caught by polling.
    const poll = setInterval(schedule, 400);
    const deadline = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
