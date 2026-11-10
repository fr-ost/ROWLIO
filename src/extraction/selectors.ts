// CSS selector and XPath evaluation, validation, previews, and rule-based extraction.
import type {
  ExtractKind,
  ExtractionRule,
  FieldRule,
  RawDataset,
  SelectorSample,
  SelectorTestResult,
  SelectorType,
} from '@/types';
import { t } from '@/i18n';
import { resolveUrl } from '@/utils/url';
import { truncate, uniqueNames } from '@/utils/text';
import type { Pacer } from '@/utils/async';
import { baseUrlOf, collectRoots, elementText, isElement, isOwnOverlay, tagOf } from './dom';
import { bestImageSource } from './images';

const SELF_SELECTORS = new Set(['', ':scope', '.', 'self::*', 'self::node()']);

/** Returns an error message, or null when the selector / expression is syntactically valid. */
export function validateSelector(selector: string, type: SelectorType, doc: Document): string | null {
  const value = selector.trim();
  if (!value) return t('Enter a selector.');
  if (type === 'css') {
    try {
      doc.createDocumentFragment().querySelector(scopeCss(value));
      return null;
    } catch {
      return t('Invalid CSS selector.');
    }
  }
  try {
    doc.createExpression(value, null);
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/^.*?:\s*/, '') : '';
    return detail ? t('Invalid XPath expression: {detail}', { detail }) : t('Invalid XPath expression.');
  }
}

/** A CSS selector starting with a combinator ("> a") is made relative to the context element. */
function scopeCss(selector: string): string {
  return /^[>+~]/.test(selector) ? `:scope ${selector}` : selector;
}

export interface XPathOutcome {
  nodes: Node[];
  /** Set when the expression evaluates to a string / number / boolean instead of nodes. */
  scalar?: string;
}

export function evaluateXPath(expression: string, context: Node, doc: Document): XPathOutcome {
  // XPathResult.ANY_TYPE = 0; node sets come back as an unordered iterator (4).
  const result = doc.evaluate(expression, context, null, 0, null);
  switch (result.resultType) {
    case 1:
      return { nodes: [], scalar: String(result.numberValue) };
    case 2:
      return { nodes: [], scalar: result.stringValue };
    case 3:
      return { nodes: [], scalar: String(result.booleanValue) };
    default: {
      const ordered = doc.evaluate(expression, context, null, 7 /* ORDERED_NODE_SNAPSHOT */, null);
      const nodes: Node[] = [];
      for (let i = 0; i < ordered.snapshotLength; i++) {
        const node = ordered.snapshotItem(i);
        if (node && !(isElement(node) && isOwnOverlay(node))) nodes.push(node);
      }
      return { nodes };
    }
  }
}

/** All matches for a selector in the page (CSS also searches open shadow roots / same-origin frames). */
export function queryPage(doc: Document, selector: string, type: SelectorType): XPathOutcome {
  const value = selector.trim();
  if (type === 'xpath') return evaluateXPath(value, doc, doc);
  const nodes: Node[] = [];
  for (const { root } of collectRoots(doc)) {
    const found = root.querySelectorAll(value);
    for (let i = 0; i < found.length; i++) {
      if (!isOwnOverlay(found[i])) nodes.push(found[i]);
    }
  }
  return { nodes };
}

/** Matches for a field selector relative to one row element. */
export function queryWithin(row: Element, selector: string, type: SelectorType, doc: Document): XPathOutcome {
  const value = selector.trim();
  if (SELF_SELECTORS.has(value)) return { nodes: [row] };
  if (type === 'xpath') {
    // "//x" would search the whole page for every row, which is never what a per-row
    // field means. Treat it as ".//x" (documented in the Advanced Selectors help).
    const relative = value.startsWith('//') ? `.${value}` : value;
    return evaluateXPath(relative, row, doc);
  }
  return { nodes: Array.from(row.querySelectorAll(scopeCss(value))) };
}

function linkOf(el: Element): string {
  const tag = tagOf(el);
  let target: Element | null = el;
  if (!(tag === 'A' || tag === 'AREA' || tag === 'LINK') || !el.hasAttribute('href')) {
    target = el.closest('a[href]') ?? el.querySelector('a[href]');
  }
  if (!target) return '';
  return resolveUrl(target.getAttribute('href') ?? '', baseUrlOf(el));
}

function sourceOf(el: Element): string {
  const tag = tagOf(el);
  const base = baseUrlOf(el);
  if (tag === 'IMG') return bestImageSource(el as HTMLImageElement).url;
  if (tag === 'PICTURE') {
    const img = el.querySelector('img');
    if (img) return bestImageSource(img).url;
  }
  if (tag === 'VIDEO') {
    const direct = el.getAttribute('src') || el.querySelector('source[src]')?.getAttribute('src') || el.getAttribute('poster');
    return resolveUrl(direct ?? '', base);
  }
  if (tag === 'SOURCE' || tag === 'AUDIO' || tag === 'IFRAME' || tag === 'EMBED' || tag === 'TRACK' || tag === 'SCRIPT') {
    const src = el.getAttribute('src') || (el.getAttribute('srcset') ?? '').split(',')[0]?.trim().split(/\s+/)[0] || '';
    return resolveUrl(src, base);
  }
  const img = el.querySelector('img');
  return img ? bestImageSource(img).url : '';
}

/** Read the configured value out of a matched node. Attribute and text nodes are supported for XPath. */
export function readValue(node: Node, extract: ExtractKind, attribute: string | undefined): string {
  if (node.nodeType === 2) {
    const attr = node as Attr;
    if (extract === 'href' || extract === 'src') return resolveUrl(attr.value, baseUrlOf(attr.ownerElement ?? node));
    return attr.value.trim();
  }
  if (node.nodeType === 3 || node.nodeType === 4) {
    return ((node as CharacterData).data ?? '').replace(/[\s ]+/g, ' ').trim();
  }
  if (!isElement(node)) return (node.textContent ?? '').trim();
  switch (extract) {
    case 'text':
      return elementText(node);
    case 'html':
      return node.innerHTML.trim();
    case 'href':
      return linkOf(node);
    case 'src':
      return sourceOf(node);
    case 'attr':
      return attribute ? (node.getAttribute(attribute) ?? '').trim() : '';
    default:
      return '';
  }
}

function sampleOf(node: Node, index: number, extract: ExtractKind, attribute: string | undefined): SelectorSample {
  if (!isElement(node)) {
    const value = readValue(node, extract, attribute);
    return {
      index,
      tag: node.nodeType === 2 ? `@${(node as Attr).name}` : '#text',
      text: truncate(value, 300),
      html: '',
      value: truncate(value, 300),
      attributes: [],
    };
  }
  const attributes: [string, string][] = [];
  for (let i = 0; i < node.attributes.length && attributes.length < 12; i++) {
    const attr = node.attributes[i];
    attributes.push([attr.name, truncate(attr.value, 200)]);
  }
  return {
    index,
    tag: node.tagName.toLowerCase(),
    text: truncate(elementText(node).replace(/\n+/g, ' '), 300),
    // Shown as plain text in the UI, never rendered as HTML.
    html: truncate(node.outerHTML.replace(/\s+/g, ' '), 600),
    value: truncate(readValue(node, extract, attribute), 300),
    attributes,
  };
}

export interface SelectorTestRequest {
  selector: string;
  selectorType: SelectorType;
  extract?: ExtractKind;
  attribute?: string;
  limit: number;
  /** When set, the selector is evaluated relative to each row matched by this selector. */
  rowSelector?: string;
  rowSelectorType?: SelectorType;
}

/** Validate + evaluate a selector and return counts and sample matches for the UI. */
export function testSelector(doc: Document, request: SelectorTestRequest): SelectorTestResult {
  const extract = request.extract ?? 'text';
  const empty: SelectorTestResult = { valid: false, count: 0, samples: [] };
  const inRow = !!request.rowSelector?.trim();
  const isSelf = SELF_SELECTORS.has(request.selector.trim());
  if (!(inRow && isSelf)) {
    const error = validateSelector(request.selector, request.selectorType, doc);
    if (error) return { ...empty, error };
  }
  try {
    if (!inRow) {
      const outcome = queryPage(doc, request.selector, request.selectorType);
      if (outcome.scalar !== undefined) return { valid: true, count: 1, scalar: outcome.scalar, samples: [] };
      return {
        valid: true,
        count: outcome.nodes.length,
        samples: outcome.nodes.slice(0, request.limit).map((node, i) => sampleOf(node, i, extract, request.attribute)),
      };
    }
    const rowType = request.rowSelectorType ?? 'css';
    const rowError = validateSelector(request.rowSelector!, rowType, doc);
    if (rowError) return { ...empty, error: t('Row selector: {error}', { error: rowError }) };
    const rows = queryPage(doc, request.rowSelector!, rowType).nodes.filter(isElement);
    let matched = 0;
    const samples: SelectorSample[] = [];
    let scalar: string | undefined;
    for (let i = 0; i < rows.length; i++) {
      const outcome = queryWithin(rows[i], request.selector, request.selectorType, doc);
      if (outcome.scalar !== undefined) {
        if (outcome.scalar !== '') matched++;
        if (scalar === undefined) scalar = outcome.scalar;
        continue;
      }
      if (outcome.nodes.length > 0) {
        matched++;
        if (samples.length < request.limit) samples.push(sampleOf(outcome.nodes[0], i, extract, request.attribute));
      }
    }
    return { valid: true, count: matched, rowCount: rows.length, scalar, samples };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}

function fieldValue(row: Element, field: FieldRule, doc: Document): { value: string; matched: boolean } {
  const outcome = queryWithin(row, field.selector, field.selectorType, doc);
  if (outcome.scalar !== undefined) return { value: outcome.scalar, matched: outcome.scalar !== '' };
  if (outcome.nodes.length === 0) return { value: '', matched: false };
  if (field.multiple) {
    const values: string[] = [];
    for (const node of outcome.nodes) {
      const value = readValue(node, field.extract, field.attribute);
      if (value) values.push(value);
    }
    return { value: values.join(field.joinWith ?? ', '), matched: true };
  }
  return { value: readValue(outcome.nodes[0], field.extract, field.attribute), matched: true };
}

/** Cache used by scroll extraction so unchanged rows are not re-read on every step. */
export type RowCache = WeakMap<Element, { signature: string; cells: string[] }>;

function rowSignature(row: Element): string {
  let signature = row.textContent ?? '';
  const images = row.getElementsByTagName('img');
  for (let i = 0; i < images.length; i++) signature += `\u0001${images[i].getAttribute('src') ?? ''}`;
  return signature;
}

export interface RuleExtractOptions {
  pacer?: Pacer;
  /** Stop after this many rows (previews). */
  limit?: number;
  cache?: RowCache;
  name?: string;
  method?: 'visual' | 'selectors';
}

export interface RuleExtraction extends RawDataset {
  /** Total number of rows matched on the page (may exceed rows.length when limited). */
  totalRows: number;
}

/** Throws when a selector in the rule is invalid. */
export function assertRuleValid(doc: Document, rule: ExtractionRule): void {
  if (rule.fields.length === 0) throw new Error(t('Add at least one field.'));
  if (rule.rowSelector.trim()) {
    const error = validateSelector(rule.rowSelector, rule.rowSelectorType, doc);
    if (error) throw new Error(t('Row selector: {error}', { error }));
  }
  for (const field of rule.fields) {
    if (SELF_SELECTORS.has(field.selector.trim())) {
      if (!rule.rowSelector.trim()) {
        throw new Error(t('Field "{name}": enter a selector (an empty selector means "the row itself" and needs a row selector).', { name: field.name }));
      }
      continue;
    }
    const error = validateSelector(field.selector, field.selectorType, doc);
    if (error) throw new Error(t('Field "{name}": {error}', { name: field.name, error }));
    if (field.extract === 'attr' && !field.attribute?.trim()) {
      throw new Error(t('Field "{name}": enter the attribute name to extract.', { name: field.name }));
    }
  }
}

/** Run an extraction rule against the page. */
export async function extractByRule(
  doc: Document,
  rule: ExtractionRule,
  options: RuleExtractOptions = {},
): Promise<RuleExtraction> {
  assertRuleValid(doc, rule);
  const columns = uniqueNames(rule.fields.map((field) => field.name), t('Field'));
  const warnings: string[] = [];
  const rows: string[][] = [];
  const limit = options.limit ?? Infinity;
  const base: Omit<RuleExtraction, 'rows' | 'totalRows' | 'warnings'> = {
    key: 'rule',
    name: options.name || t('Extracted records'),
    columns,
    method: options.method ?? 'selectors',
    detail: rule.rowSelector || t('Column mode'),
  };

  if (rule.rowSelector.trim()) {
    const rowEls = queryPage(doc, rule.rowSelector, rule.rowSelectorType).nodes.filter(isElement);
    const matchedPerField = new Array<number>(rule.fields.length).fill(0);
    const take = Math.min(rowEls.length, limit);
    for (let r = 0; r < take; r++) {
      if (options.pacer) await options.pacer.tick();
      const rowEl = rowEls[r];
      const signature = options.cache ? rowSignature(rowEl) : '';
      const cached = options.cache?.get(rowEl);
      if (cached && cached.signature === signature) {
        rows.push(cached.cells);
        for (let f = 0; f < cached.cells.length; f++) if (cached.cells[f] !== '') matchedPerField[f]++;
        continue;
      }
      const cells = new Array<string>(rule.fields.length);
      for (let f = 0; f < rule.fields.length; f++) {
        const { value, matched } = fieldValue(rowEl, rule.fields[f], doc);
        cells[f] = value;
        if (matched) matchedPerField[f]++;
      }
      rows.push(cells);
      options.cache?.set(rowEl, { signature, cells });
    }
    if (rowEls.length === 0) {
      warnings.push(t('The row selector matched nothing on this page.'));
    } else {
      rule.fields.forEach((field, f) => {
        if (matchedPerField[f] === 0) {
          warnings.push(t('Field "{name}" matched nothing in any row.', { name: columns[f] }));
        }
      });
    }
    return { ...base, rows, warnings, totalRows: rowEls.length };
  }

  // Column mode: each field is matched across the whole page and zipped by position.
  const columnsValues: string[][] = [];
  for (const field of rule.fields) {
    if (options.pacer) await options.pacer.tick();
    const outcome = queryPage(doc, field.selector, field.selectorType);
    if (outcome.scalar !== undefined) columnsValues.push([outcome.scalar]);
    else columnsValues.push(outcome.nodes.map((node) => readValue(node, field.extract, field.attribute)));
  }
  const counts = columnsValues.map((values) => values.length);
  const total = Math.max(0, ...counts);
  const take = Math.min(total, limit);
  for (let r = 0; r < take; r++) {
    rows.push(columnsValues.map((values) => values[r] ?? ''));
  }
  if (total === 0) {
    warnings.push(t('No field matched anything on this page.'));
  } else if (new Set(counts).size > 1) {
    warnings.push(
      t('Fields matched different numbers of elements ({counts}). Rows are aligned by position and may be misaligned. Add a row selector for reliable records.', {
        counts: columns.map((name, i) => `${name}: ${counts[i]}`).join(', '),
      }),
    );
  }
  return { ...base, rows, warnings, totalRows: total };
}
