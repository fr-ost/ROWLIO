// Selector generation: turn elements the user pointed at (or the detector found) into
// CSS selectors that are short, readable and likely to keep working on similar pages.
import { cssEscape } from '@/utils/css';
import { tagOf } from './dom';

/** Classes that describe transient state or position rather than what the element is. */
const STATE_CLASS =
  /^(active|selected|current|hover|hovered|focus|focused|open|opened|closed|show|shown|hide|hidden|visible|disabled|enabled|first|last|odd|even|loaded|loading|lazyloaded|lazyload|lazy|in-view|inview|animate|animated|fade|fade-in|collapsed|collapse|expanded|highlight|highlighted|checked|is-.+|has-.+|js-.+|ng-.+|v-.+|aos-.+|swiper-slide-.+|slick-(active|current|cloned|slide))$/i;

/**
 * Build-generated class names (CSS modules, styled-components, emotion, …).
 * A "__suffix" only counts as a hash when it mixes letters and digits, so BEM names
 * such as "card__title" stay semantic.
 */
const HASHED_CLASS =
  /^(css|sc|jss|jsx|emotion|styled|svelte|astro|chakra)-[a-z0-9-]{4,}$|__(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{5,}$|^_[a-z0-9]{4,}$|^[a-z]{1,2}[0-9][a-z0-9]{3,}$|^[a-z0-9]*[0-9][a-z0-9]*[A-Z][A-Za-z0-9]*$/;

/** Utility classes (Tailwind / Bootstrap helpers): shared by unrelated elements. */
const UTILITY_CLASS =
  /[:[\]/!@%]|^-?(m[trblxyse]?|p[trblxyse]?|w|h|min-[wh]|max-[wh]|size|gap|space-[xy]|text|bg|font|leading|tracking|rounded|border|shadow|opacity|z|top|left|right|bottom|inset|flex|grid|col|cols|row|rows|order|items|justify|self|content|place|overflow|cursor|transition|duration|ease|object|aspect|ring|divide|float|align|d|g|offset|basis|grow|shrink|fill|stroke|line-clamp|outline|scale|rotate|translate|origin)-[a-z0-9./-]+$|^(flex|grid|block|inline|inline-block|inline-flex|relative|absolute|fixed|sticky|static|container|clearfix|row|col|uppercase|lowercase|capitalize|italic|underline|truncate|sr-only|grow|shrink|border|rounded|shadow|group|peer)$/i;

/** 3 = semantic, 1 = utility, 0 = hashed, -1 = state (never used). */
export function classQuality(cls: string): number {
  if (!cls || STATE_CLASS.test(cls)) return -1;
  if (HASHED_CLASS.test(cls)) return 0;
  if (UTILITY_CLASS.test(cls)) return 1;
  return 3;
}

function classList(el: Element): string[] {
  const raw = el.getAttribute('class');
  if (!raw) return [];
  const out: string[] = [];
  for (const cls of raw.split(/\s+/)) if (cls && !out.includes(cls)) out.push(cls);
  return out;
}

/** Classes usable in selectors (no state classes), best first. */
export function rankedClasses(el: Element): string[] {
  return classList(el)
    .map((cls, index) => ({ cls, index, quality: classQuality(cls) }))
    .filter((entry) => entry.quality >= 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((entry) => entry.cls);
}

/** Order-independent class signature used to compare siblings. */
export function classSignature(el: Element): string {
  return classList(el)
    .filter((cls) => classQuality(cls) >= 0)
    .sort()
    .join(' ');
}

/** Same tag and mostly the same classes: "li.item" ~ "li.item.featured". */
export function similar(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName) return false;
  const ca = classList(a).filter((cls) => classQuality(cls) >= 0);
  const cb = classList(b).filter((cls) => classQuality(cls) >= 0);
  if (ca.length === 0 && cb.length === 0) return true;
  if (ca.length === 0 || cb.length === 0) return false;
  let shared = 0;
  for (const cls of ca) if (cb.includes(cls)) shared++;
  const union = ca.length + cb.length - shared;
  return shared / union >= 0.5;
}

export function similarSiblings(el: Element): Element[] {
  const parent = el.parentElement;
  if (!parent) return [el];
  const out: Element[] = [];
  for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
    if (child === el || similar(child, el)) out.push(child);
  }
  return out;
}

function tagName(el: Element): string {
  return el.tagName.toLowerCase();
}

function looksStableId(id: string): boolean {
  if (!id || id.length > 60) return false;
  if (/^[0-9]/.test(id) && /^\d+$/.test(id)) return false;
  // React useId (":r1:"), ember/uuid/hash-like ids change between page loads.
  if (/[:.]/.test(id) && /^:/.test(id)) return false;
  if (/\d{4,}/.test(id)) return false;
  if (/^(ember|react|radix|headlessui|mui|rc)[-_:]?\d/i.test(id)) return false;
  if (/^[a-f0-9-]{16,}$/i.test(id)) return false;
  return true;
}

function rootOf(el: Element): Document | ShadowRoot {
  return el.getRootNode() as Document | ShadowRoot;
}

function countMatches(root: ParentNode, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return -1;
  }
}

/** "tag.bestClass" (optionally with a second class). */
function partFor(el: Element, maxClasses = 1): string {
  const classes = rankedClasses(el)
    .filter((cls) => classQuality(cls) >= 1)
    .slice(0, maxClasses);
  return tagName(el) + classes.map((cls) => `.${cssEscape(cls)}`).join('');
}

function nthOfType(el: Element): string {
  const parent = el.parentElement;
  if (!parent) return '';
  let index = 0;
  let total = 0;
  for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
    if (child.tagName === el.tagName) {
      total++;
      if (child === el) index = total;
    }
  }
  return total > 1 ? `:nth-of-type(${index})` : '';
}

/** A selector matching exactly this element inside its root (document or shadow root). */
export function uniqueSelector(el: Element): string {
  const root = rootOf(el);
  const tag = tagOf(el);
  if (tag === 'HTML') return 'html';
  if (tag === 'BODY') return 'body';
  if (el.id && looksStableId(el.id)) {
    const byId = `#${cssEscape(el.id)}`;
    if (countMatches(root, byId) === 1) return byId;
  }
  const parts: string[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const nodeTag = tagOf(node);
    if (nodeTag === 'HTML') break;
    if (nodeTag === 'BODY') {
      parts.unshift('body');
      break;
    }
    if (node !== el && node.id && looksStableId(node.id)) {
      const byId = `#${cssEscape(node.id)}`;
      if (countMatches(root, byId) === 1) {
        parts.unshift(byId);
        break;
      }
    }
    // Prefer a class-qualified part; add a position only when siblings would also match.
    let part = partFor(node, 2);
    const parent = node.parentElement;
    if (parent) {
      let sameCount = 0;
      for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
        try {
          if (child.matches(part)) sameCount++;
        } catch {
          sameCount = 2;
          break;
        }
      }
      if (sameCount > 1) part = `${tagName(node)}${nthOfType(node)}`;
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    if (countMatches(root, candidate) === 1) return candidate;
  }
  return parts.join(' > ');
}

function matchesOnly(row: Element, selector: string, target: Element): boolean {
  try {
    const found = row.querySelectorAll(selector);
    return found.length === 1 && found[0] === target;
  } catch {
    return false;
  }
}

const TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-test-id', 'data-automation-id'];

function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/** Candidate selectors for an element on its own, most meaningful first. */
export function simpleCandidates(el: Element): string[] {
  const tag = tagName(el);
  const out: string[] = [];
  const itemprop = el.getAttribute('itemprop');
  if (itemprop && !/\s/.test(itemprop.trim())) out.push(attrSelector('itemprop', itemprop.trim()));
  for (const name of TEST_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value && value.length < 80 && !/\d{3,}/.test(value)) out.push(attrSelector(name, value));
  }
  const classes = rankedClasses(el);
  const semantic = classes.filter((cls) => classQuality(cls) === 3);
  for (const cls of semantic.slice(0, 3)) out.push(`${tag}.${cssEscape(cls)}`);
  if (semantic.length >= 2) out.push(`${tag}.${cssEscape(semantic[0])}.${cssEscape(semantic[1])}`);
  const rel = el.getAttribute('rel');
  if (tag === 'a' && rel && /^(author|tag|category|bookmark|nofollow|next|prev)$/i.test(rel.trim())) out.push(`a${attrSelector('rel', rel.trim())}`);
  out.push(tag);
  const lesser = classes.filter((cls) => classQuality(cls) < 3);
  if (lesser.length) out.push(`${tag}.${cssEscape(lesser[0])}`);
  if (lesser.length >= 2) out.push(`${tag}.${cssEscape(lesser[0])}.${cssEscape(lesser[1])}`);
  return out;
}

function chainBetween(row: Element, target: Element): Element[] {
  const chain: Element[] = [];
  for (let node: Element | null = target; node && node !== row; node = node.parentElement) chain.unshift(node);
  return chain;
}

/**
 * A selector that, evaluated with row.querySelectorAll, matches exactly `target`.
 * Returns '' when target is the row itself.
 */
export function relativeSelector(row: Element, target: Element): string {
  if (row === target) return '';
  if (!row.contains(target)) return '';
  for (const candidate of simpleCandidates(target)) {
    if (matchesOnly(row, candidate, target)) return candidate;
  }
  const chain = chainBetween(row, target);
  const plain = chain.map((el) => partFor(el));
  for (let start = chain.length - 2; start >= 0; start--) {
    const selector = plain.slice(start).join(' > ');
    if (matchesOnly(row, selector, target)) return selector;
  }
  const positional = chain.map((el) => `${partFor(el)}${nthOfType(el)}`);
  for (let start = chain.length - 1; start >= 0; start--) {
    const selector = positional.slice(start).join(' > ');
    if (matchesOnly(row, selector, target)) return selector;
  }
  return `:scope > ${positional.join(' > ')}`;
}

function sameParent(nodes: ArrayLike<Element>): boolean {
  for (let i = 1; i < nodes.length; i++) if (nodes[i].parentElement !== nodes[0].parentElement) return false;
  return true;
}

function includes(nodes: ArrayLike<Element>, target: Element): boolean {
  for (let i = 0; i < nodes.length; i++) if (nodes[i] === target) return true;
  return false;
}

/**
 * A position-free selector for `target` inside `row`. It may match several sibling
 * elements of the same kind (tags, list items, cells); callers decide whether those are
 * separate fields or one multi-valued field.
 */
export function genericSelector(row: Element, target: Element): string {
  if (row === target) return '';
  const accept = (selector: string): boolean => {
    try {
      const found = row.querySelectorAll(selector);
      return found.length > 0 && includes(found, target) && (found.length === 1 || sameParent(found));
    } catch {
      return false;
    }
  };
  for (const candidate of simpleCandidates(target)) if (accept(candidate)) return candidate;
  const plain = chainBetween(row, target).map((el) => partFor(el));
  for (let start = plain.length - 2; start >= 0; start--) {
    const selector = plain.slice(start).join(' > ');
    if (accept(selector)) return selector;
  }
  return relativeSelector(row, target);
}

function sharedClasses(elements: Element[]): string[] {
  let shared = rankedClasses(elements[0]);
  for (let i = 1; i < elements.length && shared.length; i++) {
    const own = classList(elements[i]);
    shared = shared.filter((cls) => own.includes(cls));
  }
  return shared;
}

/**
 * A selector for a group of sibling records. Prefers a short class-based selector when it
 * selects the same kind of element everywhere on the page; otherwise anchors on the parent.
 */
export function selectorForGroup(elements: Element[]): string {
  const first = elements[0];
  const parent = first.parentElement;
  const root = rootOf(first);
  const tag = tagName(first);
  const shared = sharedClasses(elements);
  const semantic = shared.filter((cls) => classQuality(cls) === 3);
  const usable = (semantic.length ? semantic : shared.filter((cls) => classQuality(cls) >= 0)).slice(0, semantic.length ? 1 : 2);
  const child = tag + usable.map((cls) => `.${cssEscape(cls)}`).join('');

  if (semantic.length && parent) {
    const found = root.querySelectorAll(child);
    if (found.length === elements.length) return child;
    // Same component repeated in sibling containers (cards in several sections).
    let cousins = true;
    for (let i = 0; i < found.length; i++) {
      const p = found[i].parentElement;
      if (!p || (p !== parent && !similar(p, parent))) {
        cousins = false;
        break;
      }
    }
    if (cousins) return child;
  }
  if (!parent) return child;
  const parentSelector = uniqueSelector(parent);
  let selector = `${parentSelector} > ${child}`;
  if (usable.length === 0) {
    // Classless records: keep out same-tag siblings that do carry classes (ads, headers).
    let foreign = false;
    for (let sibling = parent.firstElementChild; sibling; sibling = sibling.nextElementSibling) {
      if (sibling.tagName === first.tagName && !elements.includes(sibling)) foreign = true;
    }
    if (foreign && elements.every((el) => !el.getAttribute('class')?.trim())) {
      selector = `${parentSelector} > ${tag}:not([class])`;
    }
  }
  return selector;
}
