// Intelligent field detection: given the elements of repeated records (product cards,
// search results, …) work out which fields they contain, without assuming any field
// exists. Everything runs locally on DOM structure, semantic HTML and Schema.org hints.
import type { ExtractKind, FieldRule, FieldType } from '@/types';
import { t } from '@/i18n';
import { uid } from '@/utils/id';
import { humanize, uniqueNames } from '@/utils/text';
import { isSelfHidden, ownText, tagOf } from './dom';
import { classQuality, genericSelector, rankedClasses, relativeSelector } from './generate';
import { bestImageSource } from './images';
import { queryWithin, readValue } from './selectors';
import { classifyField, FIELD_LABELS, RATING_RE, type FieldHints } from './valueTypes';

const SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'SELECT', 'OPTION', 'INPUT', 'TEXTAREA',
  'FORM', 'LABEL', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'LINK', 'HEAD',
]);
const RECORD_ID_ATTRIBUTES = ['data-product-id', 'data-sku', 'data-asin', 'data-item-id', 'data-id', 'data-pid'];
const MAX_CANDIDATES_PER_RECORD = 80;
const MAX_FIELDS = 30;
const SAMPLE_RECORDS = 12;
const EVALUATE_RECORDS = 40;
const MAX_POSITIONAL = 8;

interface Candidate {
  el: Element;
  extract: ExtractKind;
  attribute?: string;
  selector: string;
  /** How many elements the position-free selector matches in this record. */
  matches: number;
  order: number;
}

function hasContentText(text: string): boolean {
  return /[\p{L}\p{N}\p{Sc}★☆⭐]/u.test(text);
}

function collectCandidates(record: Element): Candidate[] {
  const out: Candidate[] = [];
  let order = 0;
  const add = (el: Element, extract: ExtractKind, attribute?: string) => {
    if (out.length >= MAX_CANDIDATES_PER_RECORD) return;
    const selector = genericSelector(record, el);
    let matches = 1;
    if (selector) {
      try {
        matches = record.querySelectorAll(selector).length;
      } catch {
        matches = 1;
      }
    }
    out.push({ el, extract, attribute, selector, matches, order: order++ });
  };

  for (const name of RECORD_ID_ATTRIBUTES) {
    if (record.getAttribute(name)) {
      add(record, 'attr', name);
      break;
    }
  }

  const visit = (el: Element, textTaken: boolean) => {
    const tag = tagOf(el);
    if (SKIP.has(tag)) return;
    if (tag === 'META') {
      if (el.getAttribute('itemprop') && el.getAttribute('content')) add(el, 'attr', 'content');
      return;
    }
    if (el !== record && isSelfHidden(el)) return;
    if (tag === 'IMG') {
      const source = bestImageSource(el as HTMLImageElement).url;
      if (source && !source.startsWith('data:')) add(el, 'src');
      return;
    }
    if (tag === 'A') {
      const href = (el.getAttribute('href') ?? '').trim();
      if (href && !href.startsWith('#') && !/^javascript:/i.test(href)) add(el, 'href');
    }
    if (tag === 'TIME' && el.getAttribute('datetime')) {
      add(el, 'attr', 'datetime');
      return;
    }
    const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
    if (label && RATING_RE.test(label)) {
      add(el, 'attr', el.hasAttribute('aria-label') ? 'aria-label' : 'title');
      return;
    }
    let taken = textTaken;
    if (!taken) {
      const own = ownText(el);
      if (own && hasContentText(own)) {
        add(el, 'text');
        taken = true; // children are inline formatting of this text; still scan them for links / images
      }
    }
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) visit(child, taken);
  };
  visit(record, false);
  return out;
}

function pickSample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items.slice();
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return Array.from(new Set(out));
}

function hintsFor(el: Element, extract: ExtractKind, attribute: string | undefined): FieldHints {
  const tokens: string[] = [];
  for (let node: Element | null = el, depth = 0; node && depth < 2; node = node.parentElement, depth++) {
    tokens.push(node.getAttribute('class') ?? '', node.id ?? '', node.getAttribute('itemprop') ?? '', node.getAttribute('data-testid') ?? '');
  }
  if (attribute && attribute.startsWith('data-')) tokens.push(attribute.slice(5));
  return {
    tag: tagOf(el),
    tokens: tokens.join(' ').toLowerCase(),
    itemprop: (el.getAttribute('itemprop') ?? '').trim().split(/\s+/)[0] ?? '',
    extract,
    attribute: attribute ?? '',
    inAddress: !!el.closest('address'),
  };
}

function hasQualifier(selector: string): boolean {
  return /[.[#]/.test(selector);
}

interface Draft {
  selector: string;
  extract: ExtractKind;
  attribute?: string;
  multiple: boolean;
  order: number;
  sampleEl: Element;
}

/**
 * Detect the fields shared by a set of record elements.
 * A field is kept when it appears in at least two sampled records (or in the only one).
 */
export function detectFields(records: Element[], doc: Document): FieldRule[] {
  if (records.length === 0) return [];
  const sample = pickSample(records, SAMPLE_RECORDS);
  const perRecord = sample.map((record) => collectCandidates(record));

  interface Stat {
    support: number;
    counts: number[];
    order: number;
    first: Candidate[];
    firstRecord: Element;
    extract: ExtractKind;
    attribute?: string;
    selector: string;
  }
  const stats = new Map<string, Stat>();
  perRecord.forEach((candidates, recordIndex) => {
    const seenInRecord = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const key = `${candidate.selector}\u001f${candidate.extract}\u001f${candidate.attribute ?? ''}`;
      const list = seenInRecord.get(key);
      if (list) list.push(candidate);
      else seenInRecord.set(key, [candidate]);
    }
    for (const [key, list] of seenInRecord) {
      let stat = stats.get(key);
      if (!stat) {
        stat = {
          support: 0,
          counts: [],
          order: list[0].order + recordIndex * 0.001,
          first: list,
          firstRecord: sample[recordIndex],
          extract: list[0].extract,
          attribute: list[0].attribute,
          selector: list[0].selector,
        };
        stats.set(key, stat);
      }
      stat.support++;
      stat.counts.push(Math.max(list.length, list[0].matches));
    }
  });

  const minSupport = sample.length >= 4 ? 2 : 1;
  const drafts: Draft[] = [];
  for (const stat of stats.values()) {
    if (stat.support < minSupport) continue;
    const max = Math.max(...stat.counts);
    const constant = stat.counts.every((count) => count === max);
    if (max <= 1) {
      drafts.push({ selector: stat.selector, extract: stat.extract, attribute: stat.attribute, multiple: false, order: stat.order, sampleEl: stat.first[0].el });
      continue;
    }
    const listLike = hasQualifier(stat.selector) || /(^|\s|>)(li|a)$/.test(stat.selector);
    if (!constant && listLike) {
      // Variable-length group of like elements (tags, features): one multi-valued field.
      drafts.push({ selector: stat.selector, extract: stat.extract, attribute: stat.attribute, multiple: true, order: stat.order, sampleEl: stat.first[0].el });
      continue;
    }
    // Fixed number of siblings (cells of a row): one field per position.
    let siblings: Element[];
    try {
      siblings = Array.from(stat.firstRecord.querySelectorAll(stat.selector));
    } catch {
      siblings = stat.first.map((candidate) => candidate.el);
    }
    siblings.slice(0, MAX_POSITIONAL).forEach((el, i) => {
      drafts.push({
        selector: relativeSelector(stat.firstRecord, el),
        extract: stat.extract,
        attribute: stat.attribute,
        multiple: false,
        order: stat.order + i * 0.0001,
        sampleEl: el,
      });
    });
  }
  drafts.sort((a, b) => a.order - b.order);

  // Evaluate every draft on real records to get sample values, then drop empty and
  // duplicate fields (e.g. image link and title link pointing at the same URL).
  const evaluated = pickSample(records, EVALUATE_RECORDS);
  const kept: { draft: Draft; values: string[]; type: FieldType }[] = [];
  const signatures = new Set<string>();
  for (const draft of drafts) {
    if (kept.length >= MAX_FIELDS) break;
    const values = evaluated.map((record) => {
      try {
        const outcome = queryWithin(record, draft.selector, 'css', doc);
        if (outcome.nodes.length === 0) return '';
        if (draft.multiple) {
          return outcome.nodes.map((node) => readValue(node, draft.extract, draft.attribute)).filter(Boolean).join(', ');
        }
        return readValue(outcome.nodes[0], draft.extract, draft.attribute);
      } catch {
        return '';
      }
    });
    if (values.every((value) => value === '')) continue;
    const signature = `${draft.extract === 'text' ? 'text' : draft.extract}\u001f${values.join('\u001f')}`;
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const type = classifyField(values, hintsFor(draft.sampleEl, draft.extract, draft.attribute));
    kept.push({ draft, values, type });
  }

  // Exactly one field should be the title: prefer headings, then the first typed title,
  // otherwise promote the first plain text field with title-like length.
  if (!kept.some((field) => field.type === 'title')) {
    const candidate = kept.find((field) => {
      if (field.type !== 'text' || field.draft.extract !== 'text') return false;
      const filled = field.values.filter(Boolean);
      const average = filled.reduce((sum, value) => sum + value.length, 0) / Math.max(filled.length, 1);
      return average >= 3 && average <= 160;
    });
    if (candidate) candidate.type = 'title';
  }

  const typeCounts = new Map<FieldType, number>();
  const names = kept.map(({ draft, type }) => {
    const seen = (typeCounts.get(type) ?? 0) + 1;
    typeCounts.set(type, seen);
    const generic = type === 'text' || type === 'unknown' || type === 'number';
    if (!generic && seen === 1) return t(FIELD_LABELS[type]);
    // Later fields of the same type, and untyped ones, are named after their class.
    const cls = rankedClasses(draft.sampleEl).find((name) => classQuality(name) === 3);
    const itemprop = draft.sampleEl.getAttribute('itemprop');
    const derived = humanize(itemprop || cls || '');
    if (derived) return derived;
    return generic ? '' : t(FIELD_LABELS[type]);
  });
  const unique = uniqueNames(names, t('Field'));

  return kept.map(({ draft, type }, index) => {
    const rule: FieldRule = {
      id: uid('f'),
      name: unique[index],
      selector: draft.selector,
      selectorType: 'css',
      extract: draft.extract,
      detectedType: type,
    };
    if (draft.attribute) rule.attribute = draft.attribute;
    if (draft.multiple) {
      rule.multiple = true;
      rule.joinWith = ', ';
    }
    return rule;
  });
}

/** Build a single field for an element the user clicked inside a record. */
export function fieldForElement(record: Element, target: Element, records: Element[], doc: Document): FieldRule {
  const tag = tagOf(target);
  let extract: ExtractKind = 'text';
  if (tag === 'IMG' || tag === 'PICTURE') extract = 'src';
  else if (tag === 'A' && !ownText(target) && !target.textContent?.trim()) extract = 'href';
  // Prefer a selector that works across records: try the position-free one first.
  let selector = genericSelector(record, target);
  let matches = 1;
  try {
    matches = selector ? record.querySelectorAll(selector).length : 1;
  } catch {
    matches = 1;
  }
  if (matches !== 1) selector = relativeSelector(record, target);
  const values = pickSample(records, EVALUATE_RECORDS).map((row) => {
    try {
      const outcome = queryWithin(row, selector, 'css', doc);
      return outcome.nodes.length ? readValue(outcome.nodes[0], extract, undefined) : '';
    } catch {
      return '';
    }
  });
  const type = classifyField(values, hintsFor(target, extract, undefined));
  const cls = rankedClasses(target).find((name) => classQuality(name) === 3);
  const generic = type === 'text' || type === 'unknown' || type === 'number';
  const name = generic ? humanize(cls ?? '') || t('Field') : t(FIELD_LABELS[type]);
  return { id: uid('f'), name, selector, selectorType: 'css', extract, detectedType: type };
}
