// Cooperative scheduling helpers. Long loops call `await pacer.tick()` so the page stays
// responsive and cancellation is honoured.

export class CancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof CancelledError || (error instanceof Error && error.name === 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

let channel: MessageChannel | null = null;
const pending: Array<() => void> = [];

/**
 * Yield to the event loop without using timers. Timers are throttled to 1/s (or worse) in
 * background tabs, which would make chunked extraction crawl when the workspace tab is in
 * front of the page being read. scheduler.yield / MessageChannel are not throttled.
 */
export function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched && typeof sched.yield === 'function') return sched.yield();
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => pending.shift()?.();
  }
  return new Promise((resolve) => {
    pending.push(resolve);
    channel!.port2.postMessage(0);
  });
}

/** Sleep that rejects with CancelledError when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Time-sliced loop helper: call tick() once per unit of work; it yields roughly every
 * `budgetMs` of synchronous work and throws CancelledError if the signal aborted.
 */
export class Pacer {
  private last = now();
  constructor(
    private readonly signal?: AbortSignal,
    private readonly budgetMs = 24,
  ) {}

  async tick(): Promise<void> {
    if (now() - this.last < this.budgetMs) return;
    throwIfAborted(this.signal);
    await yieldToMain();
    throwIfAborted(this.signal);
    this.last = now();
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
