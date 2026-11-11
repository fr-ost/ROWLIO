import { describe, expect, it } from 'vitest';
import { applyTransform, describeOp } from '@/data-processing/transforms';
import { summarizeColumn } from '@/data-processing/summary';
import { detectDelimiter, parseImportFile } from '@/data-processing/importFile';
import { buildExport, clipboardText, EXTENSION, MIME } from '@/export';
import { htmlChunks, toMarkdown } from '@/export/markup';
import { extractContacts } from '@/extraction/contacts';
import { runSpec } from '@/extraction/engine';
import { normalizeUrlList, runBatch, type BatchProgress, type BatchTransport } from '@/pagination/batch';
import { isExtractSpec } from '@/types/guards';
import { CancelledError } from '@/utils/async';
import type { ExportOptions, RawDataset, TableData } from '@/types';
import { brand } from '@/config/brand';
import { setPage } from './helpers';

function table(columns: string[], rows: string[][]): TableData {
  return { columns: columns.map((name, i) => ({ id: `c${i}`, name })), rows: rows.map((cells, i) => ({ id: i + 1, cells })) };
}
const cells = (data: TableData) => data.rows.map((row) => row.cells);

describe('new cleaning tools', () => {
  it('extracts a regex match (or its first group) into a new column', () => {
    const data = table(['Reviews'], [['(128 reviews)'], ['12 reviews'], ['none yet'], ['']]);
    const result = applyTransform(data, { type: 'extractRegex', column: 'c0', pattern: '(\\d+) reviews', caseSensitive: false, target: 'new' });
    expect(result.data.columns.map((c) => c.name)).toEqual(['Reviews', 'Reviews (match)']);
    expect(cells(result.data)).toEqual([['(128 reviews)', '128'], ['12 reviews', '12'], ['none yet', ''], ['', '']]);
    expect(result.changed).toBe(2);
    expect(result.summary).toMatch(/2 cells/);
    expect(result.summary).toMatch(/1 cell without a match was left empty/);
    // The input is untouched.
    expect(data.columns).toHaveLength(1);
  });

  it('replaces in place, leaving cells without a match unchanged', () => {
    const data = table(['Code'], [['Order #A-17'], ['no code'], ['order #b-2']]);
    const result = applyTransform(data, { type: 'extractRegex', column: 'c0', pattern: '#[A-Z]-\\d+', caseSensitive: true, target: 'replace' });
    expect(cells(result.data)).toEqual([['#A-17'], ['no code'], ['order #b-2']]);
    expect(result.data.rows[1]).toBe(data.rows[1]);
    const insensitive = applyTransform(data, { type: 'extractRegex', column: 'c0', pattern: '#[A-Z]-\\d+', caseSensitive: false, target: 'replace' });
    expect(cells(insensitive.data)[2]).toEqual(['#b-2']);
  });

  it('reports nothing matched, and rejects bad patterns', () => {
    const data = table(['A'], [['x']]);
    const none = applyTransform(data, { type: 'extractRegex', column: 'c0', pattern: '\\d+', caseSensitive: false, target: 'new' });
    expect(none.changed).toBe(0);
    expect(none.data).toBe(data);
    expect(() => applyTransform(data, { type: 'extractRegex', column: 'c0', pattern: '(', caseSensitive: false, target: 'new' })).toThrow(/Invalid regular expression/);
    expect(() => applyTransform(data, { type: 'extractRegex', column: 'c0', pattern: '', caseSensitive: false, target: 'new' })).toThrow(/Enter a pattern/);
  });

  it('fills empty cells from the row above', () => {
    const data = table(['Region', 'City'], [['Asia', 'Dhaka'], ['', 'Tokyo'], ['  ', ''], ['Europe', 'Paris'], ['', '']]);
    const all = applyTransform(data, { type: 'fillDown' });
    expect(cells(all.data)).toEqual([['Asia', 'Dhaka'], ['Asia', 'Tokyo'], ['Asia', 'Tokyo'], ['Europe', 'Paris'], ['Europe', 'Paris']]);
    expect(all.changed).toBe(5);
    const one = applyTransform(data, { type: 'fillDown', columns: ['c0'] });
    expect(cells(one.data)[2]).toEqual(['Asia', '']);
    expect(one.data.rows[0]).toBe(data.rows[0]);
    // A leading empty cell has nothing above it and stays empty.
    const leading = applyTransform(table(['A'], [[''], ['x'], ['']]), { type: 'fillDown' });
    expect(cells(leading.data)).toEqual([[''], ['x'], ['x']]);
    expect(applyTransform(table(['A'], [['x'], ['y']]), { type: 'fillDown' }).changed).toBe(0);
  });

  it('adds columns and rows', () => {
    const data = table(['Name'], [['a'], ['b']]);
    expect(cells(applyTransform(data, { type: 'addColumn', name: 'Notes', fill: 'empty' }).data)).toEqual([['a', ''], ['b', '']]);
    expect(cells(applyTransform(data, { type: 'addColumn', name: '#', fill: 'rowNumber' }).data)).toEqual([['a', '1'], ['b', '2']]);
    const constant = applyTransform(data, { type: 'addColumn', name: 'Name', fill: 'value', value: 'বাংলা' });
    expect(constant.data.columns.map((c) => c.name)).toEqual(['Name', 'Name (2)']);
    expect(cells(constant.data)[1]).toEqual(['b', 'বাংলা']);
    expect(() => applyTransform(data, { type: 'addColumn', name: '  ', fill: 'empty' })).toThrow(/name/);

    const added = applyTransform(data, { type: 'addRow' });
    expect(cells(added.data)).toEqual([['a'], ['b'], ['']]);
    expect(new Set(added.data.rows.map((row) => row.id)).size).toBe(3);
    expect(() => applyTransform({ columns: [], rows: [] }, { type: 'addRow' })).toThrow(/column first/);
  });

  it('labels the new operations for the undo history', () => {
    expect(describeOp({ type: 'fillDown' })).toBe('Fill down');
    expect(describeOp({ type: 'addRow' })).toBe('Add row');
    expect(describeOp({ type: 'addColumn', name: 'x', fill: 'empty' })).toBe('Add column');
    expect(describeOp({ type: 'extractRegex', column: 'c0', pattern: 'x', caseSensitive: false, target: 'new' })).toBe('Extract by pattern');
  });
});

describe('column summary', () => {
  it('summarises numbers, lengths and frequent values', () => {
    const data = table(['Price', 'City'], [['10', 'ঢাকা'], ['20', 'ঢাকা'], ['', 'Sylhet'], ['5.5', ''], ['n/a', 'ঢাকা']]);
    const price = summarizeColumn(data, 0);
    expect(price).toMatchObject({ name: 'Price', total: 5, filled: 4, empty: 1, distinct: 4 });
    expect(price.numeric).toEqual({ count: 3, sum: 35.5, min: 5.5, max: 20, mean: 35.5 / 3, median: 10 });
    const city = summarizeColumn(data, 1);
    expect(city.numeric).toBeNull();
    expect(city.top[0]).toEqual({ value: 'ঢাকা', count: 3 });
    expect(city).toMatchObject({ shortest: 4, longest: 6, distinct: 2 });
    expect(summarizeColumn(table(['E'], [[''], ['']]), 0)).toMatchObject({ filled: 0, distinct: 0, shortest: 0, longest: 0, top: [] });
    expect(summarizeColumn(table(['N'], [['1'], ['2'], ['3'], ['4']]), 0).numeric?.median).toBe(2.5);
  });
});

describe('Markdown and HTML export', () => {
  const data = table(['Name', 'Note'], [['Ada | Lin', 'line one\nline two'], ['<b>bold</b>', 'a & b "q"'], ['বাংলা 😀', '=1+1']]);

  it('writes a Markdown table and escapes pipes, markup and line breaks', () => {
    expect(toMarkdown(data)).toBe('| Name | Note |\n| --- | --- |\n| Ada \\| Lin | line one<br>line two |\n| &lt;b>bold&lt;/b> | a &amp; b "q" |\n| বাংলা 😀 | =1+1 |\n');
    expect(clipboardText(data, 'markdown', { formulaGuard: true, includeHeader: true })).toContain('| Name | Note |');
  });

  it('writes a self-contained HTML document with escaped text and no scripts', () => {
    const html = Array.from(htmlChunks(data, { includeHeader: true, title: 'A <test>' })).join('');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>A &lt;test&gt;</title>');
    expect(html).toContain('<th>Name</th><th>Note</th>');
    expect(html).toContain('<td>&lt;b&gt;bold&lt;/b&gt;</td><td>a &amp; b &quot;q&quot;</td>');
    expect(html).toContain('<td>line one<br>line two</td>');
    expect(html).toContain('বাংলা 😀');
    expect(html).not.toMatch(/<script|https?:\/\//);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(parsed.querySelector('tbody td')?.textContent).toBe('Ada | Lin');
    expect(Array.from(htmlChunks(data, { includeHeader: false })).join('')).not.toContain('<thead>');
  });

  it('neutralises formula-like cells in HTML tables, which spreadsheet apps can open', () => {
    const risky = table(['=HYPERLINK("http://x","h")', 'Amount'], [['=1+1', '-12.5'], ['@SUM(A1)', '+cmd|x'], ['plain', '৳ ১২০']]);
    const guarded = new DOMParser().parseFromString(Array.from(htmlChunks(risky, { includeHeader: true })).join(''), 'text/html');
    const cells = Array.from(guarded.querySelectorAll('th, td'), (cell) => cell.textContent);
    expect(cells).toEqual([`'=HYPERLINK("http://x","h")`, 'Amount', `'=1+1`, '-12.5', `'@SUM(A1)`, `'+cmd|x`, 'plain', '৳ ১২০']);
    // The guard is the default; a machine consumer can switch it off explicitly.
    const raw = Array.from(htmlChunks(risky, { includeHeader: true, formulaGuard: false })).join('');
    expect(raw).toContain('<td>=1+1</td>');
  });

  it('is available through buildExport with the right type and extension', async () => {
    const options = (format: ExportOptions['format']): ExportOptions => ({ format, delimiter: ',', bom: true, formulaGuard: true, jsonPretty: true, xlsxTypes: true, includeHeader: true });
    const md = await buildExport([{ name: 'x', data }], options('markdown'));
    expect(md.extension).toBe('md');
    expect(md.mime).toBe(MIME.markdown);
    expect(await md.blob.text()).toBe(toMarkdown(data));
    const html = await buildExport([{ name: 'x', data }], options('html'));
    expect(EXTENSION.html).toBe('html');
    expect(await html.blob.text()).toContain("<td>'=1+1</td>");
    expect(await (await buildExport([{ name: 'x', data }], { ...options('html'), formulaGuard: false })).blob.text()).toContain('<td>=1+1</td>');
    await expect(buildExport([{ name: 'a', data }, { name: 'b', data }], options('markdown'))).rejects.toThrow(/only one table/);
  });
});

describe('file import', () => {
  it('detects the delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('"x,y";b;c')).toBe(';');
    expect(detectDelimiter('single')).toBe(',');
  });

  it('imports CSV with quotes, a BOM and Bengali text', () => {
    const result = parseImportFile('দাম.csv', '﻿নাম,Price,Note\r\n"রহিম, উদ্দিন",10,"line 1\nline 2"\r\nZoë,20,\r\n\r\n');
    expect(result.format).toBe('csv');
    const [raw] = result.raw;
    expect(raw).toMatchObject({ name: 'দাম', columns: ['নাম', 'Price', 'Note'], method: 'import' });
    expect(raw.rows).toEqual([['রহিম, উদ্দিন', '10', 'line 1\nline 2'], ['Zoë', '20', '']]);
  });

  it('imports TSV and semicolon files, and names empty headers', () => {
    expect(parseImportFile('a.tsv', 'x\ty\n1\t2').raw[0].rows).toEqual([['1', '2']]);
    expect(parseImportFile('a.txt', 'x;;x\n1;2;3').raw[0].columns).toEqual(['x', 'Column 2', 'x (2)']);
  });

  it('imports JSON arrays of objects with varying keys and nested values', () => {
    const json = JSON.stringify([{ name: 'A', price: 10, tags: ['x', 'y'] }, { name: 'B', stock: true, meta: { a: 1 } }, 'junk']);
    const [raw] = parseImportFile('items.json', json).raw;
    expect(raw.columns).toEqual(['name', 'price', 'tags', 'stock', 'meta']);
    expect(raw.rows).toEqual([['A', '10', '["x","y"]', '', ''], ['B', '', '', 'true', '{"a":1}']]);
    expect(raw.warnings[0]).toMatch(/1 entries that are not objects were skipped/);
  });

  it('imports wrapped JSON, arrays of arrays and JSON Lines', () => {
    expect(parseImportFile('w.json', '{"total":2,"data":[{"a":1},{"a":2}]}').raw[0]).toMatchObject({ name: 'w – data', columns: ['a'], rows: [['1'], ['2']] });
    expect(parseImportFile('m.json', '[["h1","h2"],[1,null]]').raw[0]).toMatchObject({ columns: ['h1', 'h2'], rows: [['1', '']] });
    const lines = parseImportFile('l.jsonl', '{"a":"x"}\n\n{"a":"y","b":2}\n');
    expect(lines.format).toBe('jsonl');
    expect(lines.raw[0].rows).toEqual([['x', ''], ['y', '2']]);
  });

  it('opens project files as datasets with fresh ids', () => {
    const dataset = { id: 'old', name: 'D', columns: [{ id: 'c', name: 'A' }], rows: [{ id: 1, cells: ['x'] }], warnings: [], source: { url: '', title: '', extractedAt: 0, method: 'table' } };
    const result = parseImportFile('p.rowlio.json', JSON.stringify({ format: 'rowlio-project', version: 1, datasets: [dataset, { broken: true }] }));
    expect(result.format).toBe('project');
    expect(result.project).toHaveLength(1);
    expect(result.project[0].id).not.toBe('old');
    expect(result.project[0].rows[0].cells).toEqual(['x']);
  });

  it('explains what is wrong with unusable files', () => {
    expect(() => parseImportFile('e.csv', '  \n')).toThrow(/empty/);
    expect(() => parseImportFile('b.json', '{oops')).toThrow(/not valid JSON/);
    expect(() => parseImportFile('n.json', '42')).toThrow(/list of records/);
    expect(() => parseImportFile('l.jsonl', '{"a":1}\nnope')).toThrow(/Line 2 is not valid JSON/);
    expect(() => parseImportFile('p.json', '{"format":"rowlio-project","datasets":[{}]}')).toThrow(/no valid datasets/);
  });
});

describe('contact extraction', () => {
  it('finds emails, phone numbers and social profiles from links and text', async () => {
    setPage(`
      <p>Write to <a href="mailto:hello@acme.test?subject=Hi">our team</a> or sales@acme.test. Logo file: logo@2x.png</p>
      <p>Call <a href="tel:+880-1711-000000">the office</a> or +1 (415) 555-0100. Founded 2019-04-01, order 12345678.</p>
      <footer>
        <a href="https://www.facebook.com/acme">Facebook</a>
        <a href="https://x.com/acme" aria-label="Acme on X"></a>
        <a href="https://t.me/acmechannel">Telegram</a>
        <a href="https://github.com/acme/widgets">Code</a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
        <a href="https://twitter.com/">Twitter home</a>
        <a href="mailto:hello@acme.test">again</a>
      </footer>`);
    const dataset = await extractContacts(document);
    expect(dataset.columns).toEqual(['Type', 'Value', 'Label', 'Found in', 'URL']);
    const byType = (type: string) => dataset.rows.filter((row) => row[0] === type).map((row) => row[1]);
    expect(byType('Email')).toEqual(['hello@acme.test', 'sales@acme.test']);
    expect(byType('Phone')).toEqual(['+880-1711-000000', '+1 (415) 555-0100']);
    expect(byType('Facebook')).toEqual(['https://www.facebook.com/acme']);
    expect(byType('X / Twitter')).toEqual(['https://x.com/acme']);
    expect(byType('Telegram')).toEqual(['https://t.me/acmechannel']);
    expect(byType('GitHub')).toEqual(['https://github.com/acme/widgets']);
    expect(dataset.rows.find((row) => row[1] === 'hello@acme.test')).toEqual(['Email', 'hello@acme.test', 'our team', 'mailto link', 'mailto:hello@acme.test?subject=Hi']);
    expect(dataset.rows.find((row) => row[1] === 'https://x.com/acme')?.[2]).toBe('Acme on X');
    // Dates, plain numbers and asset names are not contacts.
    expect(dataset.rows.some((row) => /2019|12345678|2x\.png/.test(row[1]))).toBe(false);
  });

  it('says so when a page has no contact details, and runs through the engine', async () => {
    setPage('<p>Nothing to see.</p>');
    expect(isExtractSpec({ kind: 'contacts' })).toBe(true);
    const [dataset] = await runSpec(document, { kind: 'contacts' });
    expect(dataset.rows).toEqual([]);
    expect(dataset.warnings[0]).toMatch(/No email addresses/);
  });
});

describe('batch URL extraction', () => {
  const pageData = (url: string): RawDataset[] => [{ key: 'rule', name: 'Records', columns: ['Title'], rows: [[`title of ${url}`]], warnings: [], method: 'selectors' }];

  function transport(behaviour: (url: string) => RawDataset[] | Error = pageData) {
    const opened: string[] = [];
    const sleeps: number[] = [];
    let current = '';
    const value: BatchTransport = {
      open: async (url) => {
        opened.push(url);
        current = url;
      },
      extract: async () => {
        const result = behaviour(current);
        if (result instanceof Error) throw result;
        return result;
      },
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        if (signal.aborted) throw new CancelledError();
      },
    };
    return { value, opened, sleeps };
  }
  const settings = { maxUrls: 100, delayMs: 250, sourceColumn: 'Source URL' };
  const SPEC = { kind: 'headings' } as const;

  it('cleans up a pasted list', () => {
    const { urls, invalid, duplicates } = normalizeUrlList(' https://a.test/1 \n\nhttps://a.test/2\nhttps://a.test/1\nnot a url\njavascript:alert(1)\nhttp://b.test');
    expect(urls).toEqual(['https://a.test/1', 'https://a.test/2', 'http://b.test/']);
    expect(invalid).toEqual(['not a url', 'javascript:alert(1)']);
    expect(duplicates).toBe(1);
  });

  it('visits every page, records where each row came from, and paces itself', async () => {
    const t = transport();
    const urls = ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'];
    const progress: BatchProgress[] = [];
    const outcome = await runBatch(t.value, urls, SPEC, settings, (p) => progress.push(p), new AbortController().signal);
    expect(t.opened).toEqual(urls);
    expect(t.sleeps).toEqual([250, 250]); // no pause after the last page
    expect(outcome).toMatchObject({ reason: 'completed', visited: 3, failed: 0, records: 3 });
    expect(outcome.datasets[0].columns).toEqual(['Source URL', 'Title']);
    expect(outcome.datasets[0].rows[1]).toEqual(['https://a.test/2', 'title of https://a.test/2']);
    expect(progress[0]).toMatchObject({ index: 1, total: 3, url: urls[0] });
  });

  it('keeps going when a page fails and reports it', async () => {
    const t = transport((url) => (url.endsWith('/2') ? new Error('Rowlio no longer has access to this tab.') : url.endsWith('/3') ? [{ ...pageData(url)[0], rows: [] }] : pageData(url)));
    const outcome = await runBatch(t.value, ['https://a.test/1', 'https://a.test/2', 'https://a.test/3', 'https://a.test/4'], SPEC, settings, () => undefined, new AbortController().signal);
    expect(outcome).toMatchObject({ reason: 'completed', visited: 3, failed: 1, records: 2 });
    expect(outcome.log.map((entry) => entry.kind)).toEqual(['info', 'error', 'warning', 'info']);
    expect(outcome.log[1].message).toMatch(/no longer has access/);
  });

  it('never visits more pages than the limit', async () => {
    const t = transport();
    const outcome = await runBatch(t.value, ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'], SPEC, { ...settings, maxUrls: 2 }, () => undefined, new AbortController().signal);
    expect(t.opened).toHaveLength(2);
    expect(outcome).toMatchObject({ reason: 'max-pages', visited: 2 });
  });

  it('stops when cancelled and keeps what was collected', async () => {
    const controller = new AbortController();
    const t = transport();
    const outcome = await runBatch(
      t.value,
      ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'],
      SPEC,
      settings,
      (p) => {
        if (p.index === 2) controller.abort();
      },
      controller.signal,
    );
    expect(outcome.reason).toBe('cancelled');
    expect(outcome.records).toBe(1);
    expect(t.opened.length).toBeLessThanOrEqual(2);
  });
});

describe('credits', () => {
  it('come from the brand configuration', () => {
    expect(brand.productOf).toBe('A Product of Unique Labs');
    expect(brand.developer).toEqual({ name: 'Shahriar Ahmed', url: 'https://t.me/igfrostt' });
    expect(brand.urls.homepage).toBe('https://www.uniquelabs.org');
    expect(brand.copyright).toMatch(/^© \d{4} Unique Labs$/);
  });
});
