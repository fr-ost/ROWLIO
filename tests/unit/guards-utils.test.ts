import { describe, expect, it } from 'vitest';
import { isDataset, isExtractSpec, isExtractionRule, isFieldRule, isPaginationSettings, isRecipe } from '@/types/guards';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_LINK_OPTIONS, DEFAULT_LIST_OPTIONS, DEFAULT_META_OPTIONS, DEFAULT_PAGINATION, DEFAULT_TABLE_OPTIONS } from '@/types';
import { isEventMessage, isInternalMessage, isRequestMessage, PROTOCOL } from '@/messaging/protocol';
import { getLocale, registerCatalog, setLocale, t, tn } from '@/i18n';
import { CancelledError, isCancelled, Pacer, sleep, withTimeout, yieldToMain } from '@/utils/async';
import { cssEscape } from '@/utils/css';
import { uid } from '@/utils/id';
import { collapseWhitespace, humanize, slugify, truncate, uniqueNames } from '@/utils/text';
import { globToRegExp, hostOf, isHttpUrl, isInternalUrl, isRestrictedUrl, matchesUrlPattern, originOf, resolveUrl, suggestUrlPattern } from '@/utils/url';
import { brand } from '@/config/brand';

const FIELD = { id: 'f1', name: 'Title', selector: 'h3', selectorType: 'css', extract: 'text' };
const RULE = { rowSelector: 'li', rowSelectorType: 'css', fields: [FIELD] };

describe('runtime validation of untrusted input', () => {
  it('accepts well-formed field rules and rejects malformed ones', () => {
    expect(isFieldRule(FIELD)).toBe(true);
    expect(isFieldRule({ ...FIELD, extract: 'attr', attribute: 'data-id', multiple: true, joinWith: ', ' })).toBe(true);
    expect(isFieldRule({ ...FIELD, extract: 'script' })).toBe(false);
    expect(isFieldRule({ ...FIELD, selectorType: 'regex' })).toBe(false);
    expect(isFieldRule({ ...FIELD, selector: 'x'.repeat(5000) })).toBe(false);
    expect(isFieldRule({ ...FIELD, multiple: 'yes' })).toBe(false);
    expect(isFieldRule(null)).toBe(false);
    expect(isFieldRule('h3')).toBe(false);
  });

  it('validates rules and every kind of extraction spec', () => {
    expect(isExtractionRule(RULE)).toBe(true);
    expect(isExtractionRule({ ...RULE, fields: 'none' })).toBe(false);
    expect(isExtractionRule({ ...RULE, fields: Array.from({ length: 501 }, () => FIELD) })).toBe(false);

    expect(isExtractSpec({ kind: 'tables', indexes: 'all', options: DEFAULT_TABLE_OPTIONS })).toBe(true);
    expect(isExtractSpec({ kind: 'tables', indexes: [0, 2], options: DEFAULT_TABLE_OPTIONS })).toBe(true);
    expect(isExtractSpec({ kind: 'tables', indexes: [-1], options: DEFAULT_TABLE_OPTIONS })).toBe(false);
    expect(isExtractSpec({ kind: 'tables', indexes: [0.5], options: DEFAULT_TABLE_OPTIONS })).toBe(false);
    expect(isExtractSpec({ kind: 'tables', indexes: 'all', options: { ...DEFAULT_TABLE_OPTIONS, headerMode: 'guess' } })).toBe(false);
    expect(isExtractSpec({ kind: 'rule', rule: RULE, name: 'x', method: 'visual' })).toBe(true);
    expect(isExtractSpec({ kind: 'rule', rule: RULE, method: 'magic' })).toBe(false);
    expect(isExtractSpec({ kind: 'links', options: DEFAULT_LINK_OPTIONS })).toBe(true);
    expect(isExtractSpec({ kind: 'links', options: { ...DEFAULT_LINK_OPTIONS, scope: 'everything' } })).toBe(false);
    expect(isExtractSpec({ kind: 'images', options: DEFAULT_IMAGE_OPTIONS })).toBe(true);
    expect(isExtractSpec({ kind: 'images', options: { ...DEFAULT_IMAGE_OPTIONS, minWidth: -5 } })).toBe(false);
    expect(isExtractSpec({ kind: 'lists', options: DEFAULT_LIST_OPTIONS })).toBe(true);
    expect(isExtractSpec({ kind: 'metadata', options: DEFAULT_META_OPTIONS })).toBe(true);
    for (const kind of ['headings', 'breadcrumbs', 'jsonld', 'microdata']) expect(isExtractSpec({ kind })).toBe(true);
    expect(isExtractSpec({ kind: 'cookies' })).toBe(false);
    expect(isExtractSpec(undefined)).toBe(false);
    expect(isExtractSpec([])).toBe(false);
  });

  it('validates pagination settings, including that a run is always bounded', () => {
    expect(isPaginationSettings(DEFAULT_PAGINATION)).toBe(true);
    expect(isPaginationSettings({ ...DEFAULT_PAGINATION, maxPages: 0 })).toBe(false);
    expect(isPaginationSettings({ ...DEFAULT_PAGINATION, maxPages: Infinity })).toBe(false);
    expect(isPaginationSettings({ ...DEFAULT_PAGINATION, maxScrolls: 0 })).toBe(false);
    expect(isPaginationSettings({ ...DEFAULT_PAGINATION, maxDurationSec: 0 })).toBe(false);
    expect(isPaginationSettings({ ...DEFAULT_PAGINATION, delayMs: -1 })).toBe(false);
    expect(isPaginationSettings({ ...DEFAULT_PAGINATION, mode: 'crawl' })).toBe(false);
    expect(isPaginationSettings({ ...DEFAULT_PAGINATION, maxRecords: 0 })).toBe(true); // 0 = no record cap
  });

  it('validates recipes and datasets', () => {
    const recipe = { id: 'r1', name: 'Products', description: '', urlPattern: 'https://x.test/*', sourceUrl: 'https://x.test/a', spec: { kind: 'rule', rule: RULE }, pagination: null, createdAt: 1, updatedAt: 2 };
    expect(isRecipe(recipe)).toBe(true);
    expect(isRecipe({ ...recipe, pagination: DEFAULT_PAGINATION })).toBe(true);
    expect(isRecipe({ ...recipe, spec: { kind: 'shell', command: 'rm' } })).toBe(false);
    expect(isRecipe({ ...recipe, name: 42 })).toBe(false);

    const dataset = { id: 'd', name: 'D', columns: [{ id: 'c1', name: 'A' }], rows: [{ id: 1, cells: ['x'] }], warnings: [], source: { url: '', title: '', extractedAt: 0, method: 'table' } };
    expect(isDataset(dataset)).toBe(true);
    expect(isDataset({ ...dataset, rows: [{ id: 1, cells: ['x', 'extra'] }] })).toBe(false);
    expect(isDataset({ ...dataset, rows: [{ id: 1, cells: [42] }] })).toBe(false);
    expect(isDataset({ ...dataset, columns: [{ id: 'c1' }] })).toBe(false);
  });

  it('recognises only messages that carry the protocol marker', () => {
    expect(isRequestMessage({ rowlio: PROTOCOL, type: 'ping' })).toBe(true);
    expect(isRequestMessage({ type: 'ping' })).toBe(false);
    expect(isRequestMessage({ rowlio: 2, type: 'ping' })).toBe(false);
    expect(isEventMessage({ rowlio: PROTOCOL, event: 'picker:done', payload: {} })).toBe(true);
    expect(isEventMessage({ rowlio: PROTOCOL, type: 'ping' })).toBe(false);
    expect(isInternalMessage({ rowlio: PROTOCOL, internal: 'open-workspace' })).toBe(true);
    expect(isInternalMessage(null)).toBe(false);
    expect(isInternalMessage('open-workspace')).toBe(false);
  });
});

describe('url helpers', () => {
  it('resolves and classifies URLs', () => {
    expect(resolveUrl('../a?b=1', 'https://x.test/dir/page')).toBe('https://x.test/a?b=1');
    expect(resolveUrl('  ', 'https://x.test/')).toBe('');
    expect(resolveUrl('http://[bad', 'https://x.test/')).toBe('');
    expect(isHttpUrl('https://x.test')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isInternalUrl('https://www.x.test/a', 'https://x.test/b')).toBe(true);
    expect(isInternalUrl('https://shop.x.test/a', 'https://x.test/b')).toBe(false);
    expect(isInternalUrl('mailto:a@x.test', 'https://x.test/')).toBe(false);
    expect(hostOf('https://x.test:8080/a')).toBe('x.test');
    expect(originOf('https://x.test:8080/a')).toBe('https://x.test:8080');
    expect(originOf('chrome://settings')).toBe('');
  });

  it('matches URL patterns with * wildcards only', () => {
    expect(matchesUrlPattern('https://shop.test/category/shoes?page=2', 'https://shop.test/category/*')).toBe(true);
    expect(matchesUrlPattern('https://shop.test/other', 'https://shop.test/category/*')).toBe(false);
    expect(matchesUrlPattern('https://shop.test/a.b', 'https://shop.test/a.b')).toBe(true);
    expect(matchesUrlPattern('https://shop.test/aXb', 'https://shop.test/a.b')).toBe(false); // "." is literal
    expect(matchesUrlPattern('https://a.shop.test/x', '*://*.shop.test/*')).toBe(true);
    expect(matchesUrlPattern('https://shop.test/x', '')).toBe(false);
    expect(globToRegExp('a+b(c)*').test('a+b(c)zzz')).toBe(true);
  });

  it('suggests a reusable pattern for a page', () => {
    expect(suggestUrlPattern('https://shop.test/category/shoes?page=2')).toBe('https://shop.test/category/*');
    expect(suggestUrlPattern('https://shop.test/')).toBe('https://shop.test/*');
    expect(suggestUrlPattern('chrome://extensions')).toBe('');
  });

  it('knows which pages Chrome never lets extensions read', () => {
    for (const url of ['chrome://extensions', 'chrome-extension://abc/page.html', 'about:blank', 'edge://settings', 'view-source:https://x.test', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/detail/x', '', undefined]) {
      expect(isRestrictedUrl(url), String(url)).toBe(true);
    }
    for (const url of ['https://x.test/', 'http://localhost:3000', 'file:///home/me/page.html', 'https://chrome.google.com/intl/en/chrome/']) {
      expect(isRestrictedUrl(url), url).toBe(false);
    }
  });
});

describe('text helpers', () => {
  it('normalises names, slugs and long text', () => {
    expect(collapseWhitespace('  a \n\t b c ')).toBe('a b c');
    expect(uniqueNames(['Name', '', 'Name', ' name ', 'Name'])).toEqual(['Name', 'Column 2', 'Name (2)', 'name', 'Name (3)']);
    expect(uniqueNames(['A (2)', 'A', 'A'])).toEqual(['A (2)', 'A', 'A (3)']);
    expect(humanize('product-vendorName_v2')).toBe('Product vendor name v2');
    expect(slugify('Quarterly revenue — 2024!')).toBe('quarterly-revenue-2024');
    expect(slugify('বাংলা তথ্য')).toBe('বাংলা-তথ্য');
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
    expect(slugify('///')).toBe('');
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a'.repeat(20), 10)).toBe(`${'a'.repeat(9)}…`);
    // Never cut an emoji (surrogate pair) in half.
    expect(truncate('ab😀cd', 4)).toBe('ab…');
  });

  it('escapes CSS identifiers', () => {
    expect(cssEscape('md:w-1/2')).toBe('md\\:w-1\\/2');
    expect(cssEscape('1col')).toBe('\\31 col');
    expect(document.createElement('div').matches(`div:not(.${cssEscape('a.b[c]')})`)).toBe(true);
  });

  it('creates unique ids with a prefix', () => {
    const ids = new Set(Array.from({ length: 500 }, () => uid('x')));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^x_[a-z0-9]{10,}$/);
  });
});

describe('localisation layer', () => {
  it('interpolates parameters and falls back to the English source text', () => {
    expect(t('{count} rows', { count: 3 })).toBe('3 rows');
    expect(t('Hello {name}', {})).toBe('Hello {name}');
    expect(tn(1, '{count} row', '{count} rows')).toBe('1 row');
    expect(tn(5, '{count} row', '{count} rows')).toBe('5 rows');
    registerCatalog('bn', { '{count} rows': '{count}টি সারি' });
    setLocale('bn');
    expect(getLocale()).toBe('bn');
    expect(t('{count} rows', { count: 3 })).toBe('3টি সারি');
    expect(t('Untranslated text')).toBe('Untranslated text');
    setLocale('en');
    expect(t('{count} rows', { count: 3 })).toBe('3 rows');
  });
});

describe('async helpers', () => {
  it('yields, sleeps, times out and cancels', async () => {
    await yieldToMain();
    await sleep(5);
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    await expect(sleep(1, controller.signal)).rejects.toBeInstanceOf(CancelledError);
    expect(isCancelled(new CancelledError())).toBe(true);
    expect(isCancelled(new Error('x'))).toBe(false);
    await expect(withTimeout(new Promise(() => undefined), 20, 'too slow')).rejects.toThrow('too slow');
    await expect(withTimeout(Promise.resolve(7), 1000, 'too slow')).resolves.toBe(7);
    const pacer = new Pacer(undefined, -1);
    await pacer.tick(); // yields without throwing
    await expect(new Pacer(controller.signal, -1).tick()).rejects.toBeInstanceOf(CancelledError);
  });
});

describe('brand configuration', () => {
  it('is the single source of product identity', () => {
    expect(brand.name).toBe('Rowlio');
    expect(brand.storeTitle).toBe('Rowlio: Web Scraper & Data Extractor');
    expect(brand.tagline).toBe('Turn any webpage into structured data.');
    expect(brand.company).toBe('Unique Labs');
    expect(brand.shortDescription.length).toBeLessThanOrEqual(132);
  });
});
