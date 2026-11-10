// Structured data: JSON-LD and Schema.org microdata, flattened into rows.
import type { RawDataset } from '@/types';
import { t } from '@/i18n';
import { resolveUrl } from '@/utils/url';
import { baseUrlOf, inlineText, tagOf } from './dom';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** Arrays of objects longer than this stay as a JSON string in one cell (no data lost, no column explosion). */
const MAX_EXPANDED_ARRAY = 10;

function isPlainObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flatten nested JSON into dotted keys: { offers: { price: 5 } } → { "offers.price": "5" }. */
export function flattenJson(value: Json, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    if (value.length === 0) return out;
    if (value.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
      out.set(prefix, value.map((item) => (item === null ? '' : String(item))).join(' | '));
    } else if (value.length === 1) {
      flattenJson(value[0], prefix, out);
    } else if (value.length <= MAX_EXPANDED_ARRAY) {
      value.forEach((item, i) => flattenJson(item, `${prefix}[${i}]`, out));
    } else {
      out.set(prefix, JSON.stringify(value));
    }
    return out;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      flattenJson(value[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.set(prefix || 'value', String(value));
  return out;
}

function rowsFromRecords(records: Map<string, string>[], leading: string[]): { columns: string[]; rows: string[][] } {
  const columns: string[] = [];
  const known = new Set<string>();
  const addColumn = (name: string) => {
    if (!known.has(name)) {
      known.add(name);
      columns.push(name);
    }
  };
  // Put identifying columns first when present, then everything else in first-seen order.
  for (const name of leading) if (records.some((record) => record.has(name))) addColumn(name);
  for (const record of records) for (const key of record.keys()) addColumn(key);
  const rows = records.map((record) => columns.map((column) => record.get(column) ?? ''));
  return { columns, rows };
}

export interface JsonLdResult {
  entities: JsonObject[];
  errors: number;
  blocks: number;
}

/** Parse every JSON-LD block; top-level arrays and @graph members become separate entities. */
export function parseJsonLd(doc: Document): JsonLdResult {
  const scripts = doc.querySelectorAll('script[type="application/ld+json" i]');
  const entities: JsonObject[] = [];
  let errors = 0;
  for (let i = 0; i < scripts.length; i++) {
    const raw = (scripts[i].textContent ?? '').trim();
    if (!raw) continue;
    let parsed: Json;
    try {
      parsed = JSON.parse(raw) as Json;
    } catch {
      try {
        // Some sites wrap the JSON in HTML comments or CDATA.
        parsed = JSON.parse(raw.replace(/^\s*(<!--|\/\/\s*<!\[CDATA\[|<!\[CDATA\[)/, '').replace(/(-->|\/\/\s*\]\]>|\]\]>)\s*$/, '')) as Json;
      } catch {
        errors++;
        continue;
      }
    }
    const visit = (value: Json) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (isPlainObject(value)) {
        const graph = value['@graph'];
        if (Array.isArray(graph)) graph.forEach(visit);
        else entities.push(value);
      }
    };
    visit(parsed);
  }
  return { entities, errors, blocks: scripts.length };
}

export function extractJsonLd(doc: Document): RawDataset {
  const { entities, errors, blocks } = parseJsonLd(doc);
  const warnings: string[] = [];
  if (errors > 0) warnings.push(t('{count} JSON-LD block(s) contain invalid JSON and were skipped.', { count: errors }));
  if (blocks === 0) warnings.push(t('This page has no JSON-LD structured data.'));
  const { columns, rows } = rowsFromRecords(entities.map((entity) => flattenJson(entity)), ['@type', '@id', 'name', 'url']);
  return { key: 'jsonld', name: t('JSON-LD'), columns, rows, warnings, method: 'jsonld' };
}

/** Breadcrumb trails declared as BreadcrumbList in JSON-LD. */
export function jsonLdBreadcrumbs(doc: Document): { name: string; url: string }[][] {
  const trails: { name: string; url: string }[][] = [];
  for (const entity of parseJsonLd(doc).entities) {
    const type = entity['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (!types.includes('BreadcrumbList')) continue;
    const list = entity.itemListElement;
    if (!Array.isArray(list)) continue;
    const items = list
      .filter(isPlainObject)
      .map((element) => {
        const item = element.item;
        const name = String(element.name ?? (isPlainObject(item) ? (item.name ?? '') : ''));
        const url = typeof item === 'string' ? item : isPlainObject(item) ? String(item['@id'] ?? item.url ?? '') : '';
        return { position: Number(element.position ?? 0), name: name.trim(), url: resolveUrl(url, doc.baseURI || doc.URL) };
      })
      .sort((a, b) => a.position - b.position)
      .map(({ name, url }) => ({ name, url }));
    if (items.length) trails.push(items);
  }
  return trails;
}

function microdataValue(el: Element): string {
  const tag = tagOf(el);
  const base = baseUrlOf(el);
  if (tag === 'META') return (el.getAttribute('content') ?? '').trim();
  if (tag === 'A' || tag === 'AREA' || tag === 'LINK') return resolveUrl(el.getAttribute('href') ?? '', base);
  if (tag === 'IMG' || tag === 'AUDIO' || tag === 'VIDEO' || tag === 'SOURCE' || tag === 'IFRAME' || tag === 'EMBED' || tag === 'TRACK') {
    return resolveUrl(el.getAttribute('src') ?? '', base);
  }
  if (tag === 'OBJECT') return resolveUrl(el.getAttribute('data') ?? '', base);
  if (tag === 'DATA' || tag === 'METER') return (el.getAttribute('value') ?? '').trim();
  if (tag === 'TIME') return (el.getAttribute('datetime') ?? inlineText(el)).trim();
  const content = el.getAttribute('content');
  if (content !== null) return content.trim();
  return inlineText(el);
}

function readMicrodataItem(scope: Element, depth: number): JsonObject {
  const item: JsonObject = {};
  const type = scope.getAttribute('itemtype');
  if (type) item['@type'] = type.trim().split(/\s+/).map((uri) => uri.replace(/^https?:\/\/schema\.org\//i, '')).join(' ');
  const id = scope.getAttribute('itemid');
  if (id) item['@id'] = id;
  const addProp = (name: string, value: Json) => {
    const existing = item[name];
    if (existing === undefined) item[name] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else item[name] = [existing, value];
  };
  // Properties are descendants with itemprop that are not inside a nested itemscope.
  const walk = (parent: Element) => {
    for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
      const prop = child.getAttribute('itemprop');
      const nested = child.hasAttribute('itemscope');
      if (prop) {
        const value: Json = nested && depth < 8 ? readMicrodataItem(child, depth + 1) : microdataValue(child);
        for (const name of prop.trim().split(/\s+/)) if (name) addProp(name, value);
      }
      if (!nested) walk(child);
    }
  };
  walk(scope);
  return item;
}

export function extractMicrodata(doc: Document): RawDataset {
  const scopes = doc.querySelectorAll('[itemscope]');
  const items: JsonObject[] = [];
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    // Top-level items only: nested ones are read as properties of their parent.
    if (scope.hasAttribute('itemprop') && scope.parentElement?.closest('[itemscope]')) continue;
    items.push(readMicrodataItem(scope, 0));
  }
  const { columns, rows } = rowsFromRecords(items.map((item) => flattenJson(item)), ['@type', '@id', 'name', 'url']);
  return {
    key: 'microdata',
    name: t('Microdata'),
    columns,
    rows,
    warnings: items.length === 0 ? [t('This page has no Schema.org microdata.')] : [],
    method: 'microdata',
  };
}

export function countStructured(doc: Document): { jsonLd: number; microdata: number } {
  return {
    jsonLd: doc.querySelectorAll('script[type="application/ld+json" i]').length,
    microdata: doc.querySelectorAll('[itemscope]:not([itemprop])').length,
  };
}
