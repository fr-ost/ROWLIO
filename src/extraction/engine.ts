// Entry points of the extraction engine: run any ExtractSpec, scan a page, and compute a
// content signature (used to detect in-page pagination).
import type { ExtractSpec, PageScan, RawDataset } from '@/types';
import type { Pacer } from '@/utils/async';
import { collectRoots, isElement, queryAllDeep } from './dom';
import { collectTables, countDataTables, extractTables } from './tables';
import { extractByRule, queryPage, type RowCache } from './selectors';
import { extractLinks } from './links';
import { extractImages } from './images';
import { extractBreadcrumbs, extractHeadings, extractLists } from './lists';
import { extractMetadata } from './metadata';
import { countStructured, extractJsonLd, extractMicrodata, jsonLdBreadcrumbs } from './structured';
import { detectPatterns } from './patterns';
import { findNextControl } from '@/pagination/nextControl';

export interface RunContext {
  pacer?: Pacer;
  /** Row cache shared across scroll steps. */
  cache?: RowCache;
  onProgress?: (done: number, total: number) => void;
}

/** Execute one extraction spec against a document. Always resolves to ≥ 1 dataset. */
export async function runSpec(doc: Document, spec: ExtractSpec, ctx: RunContext = {}): Promise<RawDataset[]> {
  switch (spec.kind) {
    case 'tables':
      return extractTables(doc, spec.indexes, spec.options, ctx.pacer, ctx.onProgress);
    case 'rule': {
      const result = await extractByRule(doc, spec.rule, {
        pacer: ctx.pacer,
        cache: ctx.cache,
        name: spec.name,
        method: spec.method,
      });
      const { totalRows: _total, ...dataset } = result;
      return [dataset];
    }
    case 'links':
      return [await extractLinks(doc, spec.options, ctx.pacer)];
    case 'images':
      return [await extractImages(doc, spec.options, ctx.pacer)];
    case 'lists':
      return [await extractLists(doc, spec.options, ctx.pacer)];
    case 'headings':
      return [extractHeadings(doc)];
    case 'breadcrumbs':
      return [extractBreadcrumbs(doc, jsonLdBreadcrumbs(doc))];
    case 'metadata':
      return [extractMetadata(doc, spec.options)];
    case 'jsonld':
      return [extractJsonLd(doc)];
    case 'microdata':
      return [extractMicrodata(doc)];
  }
}

/** Quick overview of what a page offers. Cheap enough to run every time the popup opens. */
export function scanPage(doc: Document): PageScan {
  const roots = collectRoots(doc);
  const tables = countDataTables(doc);
  const structured = countStructured(doc);
  let hasNextPage = false;
  try {
    const next = findNextControl(doc, '');
    hasNextPage = next.info.found && !next.info.disabled;
  } catch {
    hasNextPage = false;
  }
  let patterns = 0;
  try {
    patterns = detectPatterns(doc, 8).length;
  } catch {
    patterns = 0;
  }
  return {
    url: doc.URL,
    title: doc.title,
    dataTables: tables.data,
    allTables: tables.all,
    links: queryAllDeep(doc, 'a[href]', roots).length,
    images: queryAllDeep(doc, 'img', roots).length,
    lists: queryAllDeep(doc, 'ul, ol, dl', roots).length,
    headings: queryAllDeep(doc, 'h1, h2, h3, h4, h5, h6', roots).length,
    jsonLd: structured.jsonLd,
    microdata: structured.microdata,
    patterns,
    hasNextPage,
  };
}

function clip(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * A cheap fingerprint of the content a spec targets. When it changes after clicking
 * "next", the page has loaded new records without a full navigation.
 */
export function contentSignature(doc: Document, spec: ExtractSpec): string {
  const parts: string[] = [doc.URL];
  try {
    if (spec.kind === 'rule' && spec.rule.rowSelector.trim()) {
      const rows = queryPage(doc, spec.rule.rowSelector, spec.rule.rowSelectorType).nodes.filter(isElement);
      parts.push(String(rows.length));
      if (rows.length) parts.push(clip(rows[0].textContent), clip(rows[rows.length - 1].textContent));
    } else if (spec.kind === 'tables') {
      const handles = collectTables(doc);
      const indexes = spec.indexes === 'all' ? handles.map((_, i) => i) : spec.indexes;
      for (const index of indexes.slice(0, 10)) {
        const el = handles[index]?.element;
        if (!el) continue;
        const text = el.textContent ?? '';
        parts.push(String(text.length), clip(text), clip(text.slice(-200)));
      }
    } else {
      const text = doc.body?.textContent ?? '';
      parts.push(String(text.length), String(doc.getElementsByTagName('a').length), String(doc.getElementsByTagName('img').length));
    }
  } catch {
    /* an invalid selector simply contributes nothing */
  }
  return parts.join('\u001f');
}
