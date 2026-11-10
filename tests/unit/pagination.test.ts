import { describe, expect, it, vi } from 'vitest';
import { Accumulator } from '@/pagination/accumulator';
import { activateNextControl, findNextControl } from '@/pagination/nextControl';
import { describeStop, runPagination, type PageTransport, type PaginationProgress } from '@/pagination/runner';
import { runBoundedScroll, type ScrollEnv } from '@/pagination/scroll';
import { waitForChange, waitForDomQuiet } from '@/pagination/settle';
import { CancelledError } from '@/utils/async';
import { DEFAULT_PAGINATION, type ExtractSpec, type NextControlInfo, type PaginationSettings, type RawDataset, type StopReason } from '@/types';
import { $, setPage } from './helpers';

function dataset(rows: string[][], key = 'rule', columns = ['Name']): RawDataset {
  return { key, name: 'Records', columns, rows, warnings: [], method: 'selectors' };
}

describe('finding the next-page control', () => {
  it('prefers rel="next" links', () => {
    setPage('<a href="?page=0" rel="prev">Previous</a><a id="n" href="?page=2" rel="next">→</a><a href="/next-steps">Next steps guide</a>');
    const { info, element } = findNextControl(document, '');
    expect(element).toBe($('#n'));
    expect(info).toMatchObject({ found: true, strategy: 'rel-next', kind: 'navigate', href: 'https://example.test/shop/list?page=2', disabled: false });
  });

  it('recognises "next" text in several languages', () => {
    for (const label of ['Next', 'Next ›', 'next page', 'Older posts', 'Siguiente', 'Suivant', 'Weiter', '次へ', '下一页', 'পরবর্তী', 'التالي']) {
      setPage(`<nav class="pagination"><a href="?p=1">1</a><a id="n" href="?p=2">${label}</a></nav>`);
      expect(findNextControl(document, '').element, label).toBe($('#n'));
    }
  });

  it('uses aria-label and class names for icon-only controls', () => {
    setPage('<button id="p" aria-label="Previous page">‹</button><button id="n" aria-label="Next page"><svg></svg></button>');
    const byAria = findNextControl(document, '');
    expect(byAria.element).toBe($('#n'));
    expect(byAria.info).toMatchObject({ strategy: 'aria', kind: 'click', href: '' });

    setPage('<div class="pager"><a class="pager-prev" href="?p=1"><i></i></a><a id="n" class="pager-next" href="?p=3"><i></i></a></div>');
    expect(findNextControl(document, '').info.strategy).toBe('class');
  });

  it('accepts a bare arrow only inside pagination', () => {
    setPage('<ul class="pagination"><li><a href="?p=1">1</a></li><li><a id="n" href="?p=2">›</a></li></ul>');
    expect(findNextControl(document, '').element).toBe($('#n'));
    setPage('<div class="toolbar"><a href="#more">›</a></div>');
    expect(findNextControl(document, '').info.found).toBe(false);
  });

  it('ignores carousel, calendar and gallery "next" buttons', () => {
    setPage(`
      <div class="carousel"><button class="carousel-next" aria-label="Next slide">›</button></div>
      <div class="datepicker"><button aria-label="Next month">Next</button></div>
      <button aria-label="Next image">Next</button>`);
    expect(findNextControl(document, '').info.found).toBe(false);
  });

  it('ignores hidden controls', () => {
    setPage('<a href="?p=2" style="display:none">Next</a>');
    expect(findNextControl(document, '').info.found).toBe(false);
  });

  it('reports a disabled next control as the last page', () => {
    setPage('<button id="n" disabled>Next</button>');
    expect(findNextControl(document, '').info).toMatchObject({ found: true, disabled: true });
    setPage('<ul class="pagination"><li class="disabled"><a id="n" href="#">Next</a></li></ul>');
    expect(findNextControl(document, '').info).toMatchObject({ found: true, disabled: true });
    setPage('<a id="n" href="?p=2" aria-disabled="true">Next</a>');
    expect(findNextControl(document, '').info.disabled).toBe(true);
  });

  it('follows page numbers when there is no next control', () => {
    setPage('<div class="pager"><a href="?p=1">1</a> <strong class="current">2</strong> <a id="three" href="?p=3">3</a> <a href="?p=4">4</a></div>');
    const { info, element } = findNextControl(document, '');
    expect(element).toBe($('#three'));
    expect(info).toMatchObject({ strategy: 'page-number', currentPage: 2, href: 'https://example.test/shop/list?p=3' });

    setPage('<nav aria-label="Pagination"><a href="?p=1">1</a><a href="?p=2" aria-current="page">2</a></nav>');
    expect(findNextControl(document, '').info.found).toBe(false); // already on the last page
  });

  it('falls back to <link rel="next">', () => {
    setPage('<p>no visible pagination</p>', '<link rel="next" href="/shop/list?page=2">');
    const control = findNextControl(document, '');
    expect(control.element).toBeNull();
    expect(control.navigateTo).toBe('https://example.test/shop/list?page=2');
    expect(control.info).toMatchObject({ found: true, strategy: 'rel-next', kind: 'navigate' });
    document.head.innerHTML = '';
  });

  it('uses a custom selector when given, and rejects an invalid one', () => {
    setPage('<a href="?p=2">Next</a><button id="more" class="load">Show more results</button>');
    const custom = findNextControl(document, '#more');
    expect(custom.element).toBe($('#more'));
    expect(custom.info.strategy).toBe('custom-selector');
    expect(findNextControl(document, '.missing').info.found).toBe(false);
    expect(() => findNextControl(document, 'a[')).toThrow(/Invalid next-page selector/);
  });

  it('activates a control with a real click sequence', () => {
    setPage('<button id="n">Next</button>');
    const events: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) $('#n').addEventListener(type, () => events.push(type));
    activateNextControl(findNextControl(document, ''), window);
    expect(events).toContain('mousedown');
    expect(events[events.length - 1]).toBe('click');
    expect(events.filter((type) => type === 'click')).toHaveLength(1);
  });
});

describe('accumulating records', () => {
  it('appends pages and skips records already seen when asked', () => {
    const acc = new Accumulator('pages', true);
    expect(acc.add([dataset([['a'], ['b']])])).toEqual({ added: 2, duplicates: 0 });
    expect(acc.add([dataset([['b'], ['c'], ['c']])])).toEqual({ added: 1, duplicates: 2 });
    expect(acc.datasets()[0].rows).toEqual([['a'], ['b'], ['c']]);
    expect(acc.total).toBe(3);
    expect(acc.duplicates).toBe(2);
  });

  it('keeps duplicates across pages when not asked to skip them', () => {
    const acc = new Accumulator('pages', false);
    acc.add([dataset([['a']])]);
    acc.add([dataset([['a']])]);
    expect(acc.datasets()[0].rows).toEqual([['a'], ['a']]);
  });

  it('aligns columns by name and adds columns that appear later', () => {
    const acc = new Accumulator('pages', false);
    acc.add([dataset([['Ada', '36']], 'rule', ['Name', 'Age'])]);
    acc.add([dataset([['London', 'Lin']], 'rule', ['City', 'Name'])]);
    const [merged] = acc.datasets();
    expect(merged.columns).toEqual(['Name', 'Age', 'City']);
    expect(merged.rows).toEqual([
      ['Ada', '36', ''],
      ['Lin', '', 'London'],
    ]);
  });

  it('keeps separate datasets apart and merges warnings once', () => {
    const acc = new Accumulator('pages', false);
    acc.add([{ ...dataset([['1']], 'table-0'), warnings: ['w'] }, dataset([['x']], 'table-1')]);
    acc.add([{ ...dataset([['2']], 'table-0'), warnings: ['w', 'other'] }]);
    const [a, b] = acc.datasets();
    expect(a.rows).toEqual([['1'], ['2']]);
    expect(a.warnings).toEqual(['w', 'other']);
    expect(b.rows).toEqual([['x']]);
  });

  it('stops at the record limit', () => {
    const acc = new Accumulator('pages', false, 3);
    acc.add([dataset([['a'], ['b']])]);
    expect(acc.full).toBe(false);
    expect(acc.add([dataset([['c'], ['d'], ['e']])]).added).toBe(1);
    expect(acc.full).toBe(true);
    expect(acc.total).toBe(3);
  });

  it('scroll mode: re-reading a growing page never duplicates rows', () => {
    const acc = new Accumulator('scroll', false);
    acc.add([dataset([['a'], ['b']])]);
    acc.add([dataset([['a'], ['b'], ['c']])]);
    acc.add([dataset([['a'], ['b'], ['c'], ['d']])]);
    expect(acc.datasets()[0].rows).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(acc.duplicates).toBe(0);
  });

  it('scroll mode: genuine repeats visible together are kept unless skipping duplicates', () => {
    const keep = new Accumulator('scroll', false);
    keep.add([dataset([['x'], ['x'], ['y']])]);
    keep.add([dataset([['x'], ['x'], ['y'], ['x']])]);
    expect(keep.datasets()[0].rows).toEqual([['x'], ['x'], ['y'], ['x']]);

    const skip = new Accumulator('scroll', true);
    skip.add([dataset([['x'], ['x'], ['y']])]);
    expect(skip.datasets()[0].rows).toEqual([['x'], ['y']]);
    expect(skip.duplicates).toBe(1);
  });

  it('scroll mode: a virtualised list that drops old rows still accumulates everything', () => {
    const acc = new Accumulator('scroll', false);
    acc.add([dataset([['1'], ['2'], ['3']])]);
    acc.add([dataset([['3'], ['4'], ['5']])]);
    acc.add([dataset([['5'], ['6']])]);
    expect(acc.datasets()[0].rows.map((row) => row[0])).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

// ---- pagination runner with a scripted transport ------------------------------------------------

const SPEC: ExtractSpec = { kind: 'headings' };
const NEXT: NextControlInfo = { found: true, strategy: 'text', kind: 'navigate', href: '/p', text: 'Next', selector: 'a.next', disabled: false, currentPage: null };
const NONE: NextControlInfo = { ...NEXT, found: false, strategy: 'none', kind: 'none', href: '', text: '' };

interface Script {
  pages: (RawDataset[] | Error)[];
  next?: (page: number) => NextControlInfo;
  change?: (page: number) => 'changed' | 'unchanged' | 'navigated';
}

function fakeTransport(script: Script) {
  let page = 0;
  let extractCalls = 0;
  const calls: string[] = [];
  const transport: PageTransport = {
    ensureReady: async () => {
      calls.push('ready');
    },
    extract: async () => {
      const result = script.pages[extractCalls++];
      calls.push(`extract:${page + 1}`);
      if (result instanceof Error) throw result;
      if (!result) throw new Error('script exhausted');
      return result;
    },
    advance: async () => {
      calls.push(`advance:${page + 1}`);
      const info = script.next ? script.next(page + 1) : NEXT;
      if (info.found && !info.disabled) page++;
      return info;
    },
    awaitChange: async () => (script.change ? script.change(page) : 'navigated'),
    waitForNavigation: async () => {
      calls.push('navigation');
    },
    sleep: async (_ms, signal) => {
      if (signal.aborted) throw new CancelledError();
    },
  };
  return { transport, calls };
}

const settings = (patch: Partial<PaginationSettings> = {}): PaginationSettings => ({ ...DEFAULT_PAGINATION, delayMs: 0, retries: 1, ...patch });

async function run(script: Script, patch: Partial<PaginationSettings> = {}, signal = new AbortController().signal) {
  const { transport, calls } = fakeTransport(script);
  const progress: PaginationProgress[] = [];
  const outcome = await runPagination(transport, SPEC, settings(patch), (p) => progress.push(p), signal);
  return { outcome, calls, progress };
}

describe('pagination runner', () => {
  const page = (n: number, size = 2) => [dataset(Array.from({ length: size }, (_, i) => [`p${n}-${i}`]))];

  it('collects pages until there is no next control', async () => {
    const { outcome, calls, progress } = await run({ pages: [page(1), page(2), page(3)], next: (n) => (n < 3 ? NEXT : NONE) });
    expect(outcome).toMatchObject({ reason: 'no-next', pages: 3, records: 6, duplicates: 0 });
    expect(outcome.datasets[0].rows).toHaveLength(6);
    expect(calls.filter((call) => call === 'navigation')).toHaveLength(2);
    expect(progress[progress.length - 1]).toMatchObject({ phase: 'done', records: 6 });
    expect(outcome.log.map((entry) => entry.message)).toContain('Page 2: 2 records');
  });

  it('never goes past the page limit', async () => {
    const { outcome, calls } = await run({ pages: [page(1), page(2), page(3), page(4)] }, { maxPages: 2 });
    expect(outcome).toMatchObject({ reason: 'max-pages', pages: 2, records: 4 });
    expect(calls).not.toContain('extract:3');
    expect(calls).not.toContain('advance:2'); // does not even click "next" on the final page
  });

  it('stops exactly at the record limit', async () => {
    const { outcome } = await run({ pages: [page(1, 5), page(2, 5), page(3, 5)] }, { maxRecords: 7 });
    expect(outcome).toMatchObject({ reason: 'max-records', pages: 2, records: 7 });
  });

  it('stops when the next control is disabled', async () => {
    const { outcome } = await run({ pages: [page(1), page(2)], next: (n) => (n < 2 ? NEXT : { ...NEXT, disabled: true }) });
    expect(outcome).toMatchObject({ reason: 'next-disabled', pages: 2 });
  });

  it('stops when clicking next changes nothing', async () => {
    const { outcome } = await run({ pages: [page(1), page(1)], change: () => 'unchanged' });
    expect(outcome).toMatchObject({ reason: 'no-change', pages: 1, records: 2 });
    expect(outcome.log.some((entry) => entry.kind === 'warning' && /did not load new content/.test(entry.message))).toBe(true);
  });

  it('handles in-place (single-page app) updates without waiting for a navigation', async () => {
    const { outcome, calls } = await run({ pages: [page(1), page(2)], next: (n) => (n < 2 ? NEXT : NONE), change: () => 'changed' });
    expect(outcome).toMatchObject({ reason: 'no-next', pages: 2, records: 4 });
    expect(calls).not.toContain('navigation');
  });

  it('detects a "next" link that leads back to the same records (loop guard)', async () => {
    const { outcome } = await run({ pages: [page(1), page(1), page(1)] }, { skipDuplicates: false, maxPages: 50 });
    expect(outcome).toMatchObject({ reason: 'no-new-records', pages: 1, records: 2 });
  });

  it('stops when a page adds nothing new, and counts skipped duplicates', async () => {
    const mixed = [dataset([['p1-1'], ['p1-0'], ['fresh']])];
    const repeat = [dataset([['fresh'], ['p1-0']])];
    const { outcome } = await run({ pages: [page(1), mixed, repeat] }, { maxPages: 50 });
    expect(outcome).toMatchObject({ reason: 'no-new-records', records: 3, duplicates: 4 });
  });

  it('retries a failing page and continues', async () => {
    const { outcome } = await run({ pages: [page(1), new Error('timeout'), page(2)], next: (n) => (n < 2 ? NEXT : NONE) }, { retries: 2 });
    expect(outcome).toMatchObject({ reason: 'no-next', pages: 2, records: 4 });
    expect(outcome.log.some((entry) => entry.kind === 'warning' && /Retrying \(1\/2\)/.test(entry.message))).toBe(true);
  });

  it('keeps what was collected when a page keeps failing', async () => {
    const { outcome } = await run({ pages: [page(1), new Error('boom'), new Error('boom'), new Error('boom')] }, { retries: 2 });
    expect(outcome).toMatchObject({ reason: 'error', pages: 1, records: 2 });
    expect(outcome.datasets[0].rows).toHaveLength(2);
    expect(outcome.log[outcome.log.length - 1]).toMatchObject({ kind: 'error' });
    expect(outcome.log[outcome.log.length - 1].message).toMatch(/Page 2 failed: boom/);
  });

  it('can be cancelled and keeps the records collected so far', async () => {
    const controller = new AbortController();
    const { transport } = fakeTransport({ pages: [page(1), page(2), page(3)] });
    const original = transport.advance;
    transport.advance = async (...args) => {
      controller.abort();
      return original(...args);
    };
    transport.awaitChange = async () => {
      throw new CancelledError();
    };
    const outcome = await runPagination(transport, SPEC, settings(), () => undefined, controller.signal);
    expect(outcome).toMatchObject({ reason: 'cancelled', pages: 1, records: 2 });
    expect(outcome.log.some((entry) => /Stopped by you/.test(entry.message))).toBe(true);
  });

  it('does nothing when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { outcome, calls } = await run({ pages: [page(1)] }, {}, controller.signal);
    expect(outcome).toMatchObject({ reason: 'cancelled', pages: 0, records: 0 });
    expect(calls).toEqual([]);
  });

  it('explains every stop reason in plain language', () => {
    const reasons: StopReason[] = ['completed', 'max-pages', 'max-records', 'max-scrolls', 'max-duration', 'no-next', 'next-disabled', 'no-change', 'no-new-records', 'end-of-content', 'cancelled', 'error'];
    for (const reason of reasons) expect(describeStop(reason).length).toBeGreaterThan(5);
  });
});

// ---- bounded scrolling with a scripted environment ---------------------------------------------

function fakeScroll(options: { total: number; batch: number; virtualWindow?: number; loadMoreUntil?: number }) {
  let loaded = Math.min(options.batch, options.total);
  let clock = 0;
  let restored = 0;
  let steps = 0;
  const env: ScrollEnv = {
    extract: async () => {
      const from = options.virtualWindow ? Math.max(0, loaded - options.virtualWindow) : 0;
      return [dataset(Array.from({ length: loaded - from }, (_, i) => [`item ${from + i + 1}`]))];
    },
    scrollStep: async () => {
      steps++;
      clock += 500;
      const before = loaded;
      if (!options.loadMoreUntil) loaded = Math.min(options.total, loaded + options.batch);
      return { moved: loaded !== before, atEnd: loaded >= options.total };
    },
    waitForContent: async () => false,
    clickLoadMore: async () => {
      if (!options.loadMoreUntil || loaded >= options.loadMoreUntil) return false;
      loaded = Math.min(options.total, loaded + options.batch);
      return true;
    },
    now: () => clock,
    restore: () => {
      restored++;
    },
  };
  return { env, state: () => ({ steps, restored, loaded }) };
}

const limits = { maxScrolls: 100, maxRecords: 0, maxDurationMs: 600_000, skipDuplicates: true };

describe('bounded infinite scroll', () => {
  it('collects everything, stops at the end of the content and restores the scroll position', async () => {
    const { env, state } = fakeScroll({ total: 45, batch: 10 });
    const progress: number[] = [];
    const outcome = await runBoundedScroll(env, limits, (p) => progress.push(p.records));
    expect(outcome).toMatchObject({ reason: 'end-of-content', records: 45, duplicates: 0 });
    expect(outcome.datasets[0].rows).toHaveLength(45);
    expect(state().restored).toBe(1);
    expect(progress[0]).toBe(10);
    expect(progress[progress.length - 1]).toBe(45);
    // A few idle steps confirm the end, but it does not scroll forever.
    expect(outcome.scrolls).toBeLessThanOrEqual(8);
  });

  it('never exceeds the scroll limit', async () => {
    const { env, state } = fakeScroll({ total: 10_000, batch: 10 });
    const outcome = await runBoundedScroll(env, { ...limits, maxScrolls: 5 }, () => undefined);
    expect(outcome).toMatchObject({ reason: 'max-scrolls', scrolls: 5, records: 60 });
    expect(state().steps).toBe(5);
    expect(state().restored).toBe(1);
  });

  it('never exceeds the record limit', async () => {
    const { env } = fakeScroll({ total: 10_000, batch: 10 });
    const outcome = await runBoundedScroll(env, { ...limits, maxRecords: 25 }, () => undefined);
    expect(outcome).toMatchObject({ reason: 'max-records', records: 25 });
    expect(outcome.datasets[0].rows).toHaveLength(25);
  });

  it('never exceeds the time limit', async () => {
    const { env } = fakeScroll({ total: 10_000, batch: 10 });
    const outcome = await runBoundedScroll(env, { ...limits, maxDurationMs: 2000 }, () => undefined);
    expect(outcome.reason).toBe('max-duration');
    expect(outcome.scrolls).toBe(4); // 4 × 500 ms
  });

  it('supports virtualised lists that only keep a window of rows', async () => {
    const { env } = fakeScroll({ total: 60, batch: 10, virtualWindow: 15 });
    const outcome = await runBoundedScroll(env, limits, () => undefined);
    expect(outcome.records).toBe(60);
    expect(outcome.datasets[0].rows[59]).toEqual(['item 60']);
  });

  it('clicks "load more" while it is available', async () => {
    const { env } = fakeScroll({ total: 40, batch: 10, loadMoreUntil: 40 });
    const outcome = await runBoundedScroll(env, limits, () => undefined);
    expect(outcome).toMatchObject({ reason: 'end-of-content', records: 40 });
  });

  it('stops when cancelled and returns what it has', async () => {
    const { env, state } = fakeScroll({ total: 10_000, batch: 10 });
    const controller = new AbortController();
    const outcome = await runBoundedScroll(
      env,
      limits,
      (p) => {
        if (p.scrolls === 3) controller.abort();
      },
      controller.signal,
    );
    expect(outcome).toMatchObject({ reason: 'cancelled', scrolls: 3, records: 40 });
    expect(outcome.datasets[0].rows).toHaveLength(40);
    expect(state().restored).toBe(1);
  });

  it('reports errors, keeps partial data and still restores the scroll position', async () => {
    const { env, state } = fakeScroll({ total: 100, batch: 10 });
    const extract = env.extract;
    let calls = 0;
    env.extract = async () => {
      if (++calls === 3) throw new Error('page changed');
      return extract();
    };
    const outcome = await runBoundedScroll(env, limits, () => undefined);
    expect(outcome).toMatchObject({ reason: 'error', error: 'page changed', records: 20 });
    expect(state().restored).toBe(1);
  });
});

describe('waiting for the page', () => {
  it('resolves once the DOM has been quiet', async () => {
    setPage('<div id="box"></div>');
    setTimeout(() => $('#box').append(document.createElement('p')), 20);
    const result = await waitForDomQuiet(document, 80, 2000);
    expect(result).toEqual({ settled: true, mutated: true });
    expect((await waitForDomQuiet(document, 30, 2000)).mutated).toBe(false);
  });

  it('gives up after the timeout on a page that never settles', async () => {
    setPage('<div id="box"></div>');
    const timer = setInterval(() => $('#box').append(document.createElement('i')), 10);
    const result = await waitForDomQuiet(document, 200, 250);
    clearInterval(timer);
    expect(result.settled).toBe(false);
  });

  it('detects in-place content changes and their absence', async () => {
    setPage('<ul id="list"><li>a</li></ul>');
    const signature = () => $('#list').textContent ?? '';
    setTimeout(() => ($('#list').innerHTML = '<li>b</li>'), 30);
    expect(await waitForChange(document, signature, 'a', 3000)).toBe(true);
    expect(await waitForChange(document, signature, 'b', 200)).toBe(false);
  });

  it('can be aborted', async () => {
    setPage('<p>x</p>');
    const controller = new AbortController();
    const pending = waitForDomQuiet(document, 5000, 10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    const spy = vi.fn();
    await waitForChange(document, () => 'same', 'same', 10_000, controller.signal).catch(spy);
    expect(spy).toHaveBeenCalled();
  });
});
