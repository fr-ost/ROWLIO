// Bounded infinite-scroll extraction. The loop itself is environment-agnostic (it talks
// to a ScrollEnv), which keeps every limit and stop condition unit-testable.
import type { RawDataset, ScrollProgress, StopReason } from '@/types';
import { isCancelled } from '@/utils/async';
import { Accumulator } from './accumulator';

export interface ScrollEnv {
  /** Extract whatever is currently in the DOM. */
  extract(): Promise<RawDataset[]>;
  /** Scroll one step. atEnd = the scroll position cannot go further. */
  scrollStep(): Promise<{ moved: boolean; atEnd: boolean }>;
  /** Wait for new content; true when the DOM changed. */
  waitForContent(): Promise<boolean>;
  /** Click a "load more" control if configured and present. */
  clickLoadMore(): Promise<boolean>;
  now(): number;
  /** Put the scroll position back where it was. */
  restore(): void;
}

export interface ScrollLimits {
  maxScrolls: number;
  /** 0 = unlimited. */
  maxRecords: number;
  maxDurationMs: number;
  skipDuplicates: boolean;
  /** Consecutive steps without new records at the end of the page before stopping. */
  idleSteps?: number;
}

export interface ScrollOutcome {
  datasets: RawDataset[];
  reason: StopReason;
  scrolls: number;
  records: number;
  duplicates: number;
  elapsedMs: number;
  error?: string;
}

export async function runBoundedScroll(
  env: ScrollEnv,
  limits: ScrollLimits,
  onProgress: (progress: ScrollProgress) => void,
  signal?: AbortSignal,
): Promise<ScrollOutcome> {
  const accumulator = new Accumulator('scroll', limits.skipDuplicates, limits.maxRecords);
  const started = env.now();
  const idleLimit = limits.idleSteps ?? 3;
  let scrolls = 0;
  let idle = 0;
  let reason: StopReason = 'completed';
  let error: string | undefined;
  const report = () =>
    onProgress({ scrolls, records: accumulator.total, elapsedMs: env.now() - started, duplicates: accumulator.duplicates });

  try {
    accumulator.add(await env.extract());
    report();
    for (;;) {
      if (signal?.aborted) {
        reason = 'cancelled';
        break;
      }
      if (accumulator.full) {
        reason = 'max-records';
        break;
      }
      if (scrolls >= limits.maxScrolls) {
        reason = 'max-scrolls';
        break;
      }
      if (env.now() - started >= limits.maxDurationMs) {
        reason = 'max-duration';
        break;
      }
      const clicked = await env.clickLoadMore();
      const step = await env.scrollStep();
      scrolls++;
      const changed = await env.waitForContent();
      if (signal?.aborted) {
        reason = 'cancelled';
        break;
      }
      const { added } = accumulator.add(await env.extract());
      report();
      if (added === 0 && !clicked && !changed && (step.atEnd || !step.moved)) idle++;
      else if (added > 0) idle = 0;
      else idle += 0.5; // content changed but nothing new for us: be patient, but not forever
      if (idle >= idleLimit) {
        reason = 'end-of-content';
        break;
      }
    }
  } catch (caught) {
    if (isCancelled(caught)) {
      reason = 'cancelled';
    } else {
      reason = 'error';
      error = caught instanceof Error ? caught.message : String(caught);
    }
  } finally {
    try {
      env.restore();
    } catch {
      /* restoring the scroll position is best effort */
    }
  }
  return {
    datasets: accumulator.datasets(),
    reason,
    scrolls,
    records: accumulator.total,
    duplicates: accumulator.duplicates,
    elapsedMs: env.now() - started,
    error,
  };
}
