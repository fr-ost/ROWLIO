// Repeated-element detection: find groups of sibling elements with the same structure
// (cards, listings, search results, directory entries).
import type { ExtractionRule, PatternCandidate } from '@/types';
import { t } from '@/i18n';
import { truncate } from '@/utils/text';
import { inlineText, isElement, isHiddenDeep, isOwnOverlay, ownText, tagOf } from './dom';
import { classSignature, selectorForGroup, similar, similarSiblings } from './generate';
import { detectFields } from './fields';
import { queryPage } from './selectors';

const NEVER_RECORDS = new Set([
  'SCRIPT', 'STYLE', 'OPTION', 'OPTGROUP', 'BR', 'HR', 'COL', 'COLGROUP', 'TD', 'TH', 'TR', 'THEAD', 'TBODY',
  'TFOOT', 'SOURCE', 'LINK', 'META', 'INPUT', 'NOSCRIPT', 'TEMPLATE', 'PATH', 'G', 'CIRCLE', 'RECT', 'SVG',
  'HTML', 'BODY', 'HEAD',
]);

/** How much separate content an element holds: text-bearing elements + images (capped). */
export function richness(el: Element): number {
  let score = ownText(el) ? 1 : 0;
  let scanned = 0;
  const walker = el.ownerDocument.createTreeWalker(el, 1);
  for (let node = walker.nextNode(); node && scanned < 120; node = walker.nextNode()) {
    scanned++;
    const child = node as Element;
    const tag = tagOf(child);
    if (tag === 'IMG') score++;
    else if (tag !== 'SCRIPT' && tag !== 'STYLE' && ownText(child)) score++;
    if (score >= 8) break;
  }
  return score;
}

export interface RecordGroup {
  /** The record the user's element belongs to. */
  anchor: Element;
  elements: Element[];
  selector: string;
}

function groupFor(anchor: Element, siblings: Element[]): RecordGroup {
  const selector = selectorForGroup(siblings);
  let elements = siblings;
  try {
    const root = anchor.getRootNode() as ParentNode;
    const found = Array.from(root.querySelectorAll(selector)).filter((el) => !isOwnOverlay(el));
    if (found.length >= siblings.length && found.includes(anchor)) elements = found;
  } catch {
    /* keep the sibling group */
  }
  return { anchor, elements, selector };
}

function repeatingLevels(target: Element): { anchor: Element; siblings: Element[] }[] {
  const levels: { anchor: Element; siblings: Element[] }[] = [];
  for (let node: Element | null = target; node; node = node.parentElement) {
    const tag = tagOf(node);
    if (tag === 'BODY' || tag === 'HTML') break;
    if (NEVER_RECORDS.has(tag) && tag !== 'TR') continue;
    const siblings = similarSiblings(node);
    if (siblings.length >= 2) levels.push({ anchor: node, siblings });
  }
  return levels;
}

/**
 * Find the group of repeated records an element belongs to.
 *
 * Walks up from the element looking for the lowest ancestor that has similar siblings.
 * A level made of single-value leaves (table cells, tags inside a card) is skipped in
 * favour of the enclosing level when every enclosing record holds the same number of
 * them – that is what distinguishes "cells of a row" from "items of a list".
 */
export function findRecordGroup(target: Element): RecordGroup | null {
  const levels = repeatingLevels(target);
  if (levels.length === 0) return null;
  let chosen = levels[0];
  if (richness(chosen.anchor) < 2 && levels.length > 1) {
    const outer = levels[1];
    const inner = chosen;
    const counts = outer.siblings.slice(0, 6).map((record) => {
      let count = 0;
      const candidates = record.getElementsByTagName(inner.anchor.tagName);
      for (let i = 0; i < candidates.length; i++) if (similar(candidates[i], inner.anchor)) count++;
      return count;
    });
    const constant = counts.length >= 2 && counts.every((count) => count === counts[0]) && counts[0] >= 2;
    if (constant) chosen = outer;
  }
  return groupFor(chosen.anchor, chosen.siblings);
}

/** The next repeating level above the current record (the "Wider" button). */
export function widerGroup(current: Element): RecordGroup | null {
  const parent = current.parentElement;
  if (!parent) return null;
  const levels = repeatingLevels(parent);
  if (levels.length > 0) return groupFor(levels[0].anchor, levels[0].siblings);
  const tag = tagOf(parent);
  if (tag === 'BODY' || tag === 'HTML') return null;
  return groupFor(parent, [parent]);
}

/** The next repeating level below, towards the element originally clicked (the "Narrower" button). */
export function narrowerGroup(current: Element, original: Element): RecordGroup | null {
  if (current === original || !current.contains(original)) return null;
  const chain: Element[] = [];
  for (let node: Element | null = original; node && node !== current; node = node.parentElement) chain.unshift(node);
  for (const node of chain) {
    const siblings = similarSiblings(node);
    if (siblings.length >= 2) return groupFor(node, siblings);
  }
  const closest = chain[0];
  return closest ? groupFor(closest, [closest]) : null;
}

/** Generalise from two examples the user clicked: records are the matching children of their common ancestor. */
export function groupFromExamples(a: Element, b: Element): RecordGroup | null {
  if (a === b || a.contains(b) || b.contains(a)) return null;
  const ancestors = new Set<Element>();
  for (let node: Element | null = a; node; node = node.parentElement) ancestors.add(node);
  let common: Element | null = b;
  while (common && !ancestors.has(common)) common = common.parentElement;
  if (!common) return null;
  const childOf = (el: Element): Element => {
    let node = el;
    while (node.parentElement && node.parentElement !== common) node = node.parentElement;
    return node;
  };
  const first = childOf(a);
  const second = childOf(b);
  if (first.tagName !== second.tagName) return null;
  const siblings: Element[] = [];
  for (let child = common.firstElementChild; child; child = child.nextElementSibling) {
    if (child === first || child === second || similar(child, first) || similar(child, second)) siblings.push(child);
  }
  return siblings.length >= 2 ? groupFor(first, siblings) : null;
}

/** Scan the page for repeated structures, best candidates first. */
export function detectPatterns(doc: Document, limit: number): PatternCandidate[] {
  const body = doc.body;
  if (!body) return [];
  const view = doc.defaultView;
  const pageArea = Math.max(1, (doc.documentElement.scrollWidth || 0) * (doc.documentElement.scrollHeight || 0));
  const bySelector = new Map<string, PatternCandidate>();
  const parents = body.querySelectorAll('*');

  for (let p = 0; p < parents.length; p++) {
    const parent = parents[p];
    if (parent.childElementCount < 3) continue;
    const parentTag = tagOf(parent);
    if (parentTag === 'SVG' || parentTag === 'SELECT' || parentTag === 'TABLE' || parentTag === 'TBODY' || parentTag === 'THEAD' || parentTag === 'TR') continue;
    if (isOwnOverlay(parent) || parent.closest('svg')) continue;

    // Most common (tag + class signature) among the children is the representative.
    const tally = new Map<string, { el: Element; count: number }>();
    for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
      if (NEVER_RECORDS.has(tagOf(child))) continue;
      const key = `${child.tagName}\u001f${classSignature(child)}`;
      const entry = tally.get(key);
      if (entry) entry.count++;
      else tally.set(key, { el: child, count: 1 });
    }
    let representative: Element | null = null;
    let best = 0;
    for (const entry of tally.values()) {
      if (entry.count > best) {
        best = entry.count;
        representative = entry.el;
      }
    }
    if (!representative) continue;
    const group = similarSiblings(representative);
    if (group.length < 3) continue;
    if (isHiddenDeep(parent)) continue;

    const probes = [group[0], group[Math.floor(group.length / 2)], group[group.length - 1]];
    const rich = Math.max(...probes.map((el) => richness(el)));
    if (rich === 0) continue;

    let selector: string;
    try {
      selector = selectorForGroup(group);
    } catch {
      continue;
    }
    let count = group.length;
    let matched: Element[] = group;
    try {
      const found = Array.from(doc.querySelectorAll(selector));
      if (found.length >= group.length) {
        matched = found;
        count = found.length;
      }
    } catch {
      continue;
    }

    let score = Math.min(count, 60) * (1 + Math.min(rich, 8));
    if (parent.closest('nav, header, footer, aside, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"]')) score *= 0.3;
    if (view && typeof parent.getBoundingClientRect === 'function') {
      const rect = parent.getBoundingClientRect();
      const share = Math.min(1, (rect.width * rect.height) / pageArea);
      score *= 1 + share;
    }
    const existing = bySelector.get(selector);
    if (existing && existing.score >= score) continue;
    bySelector.set(selector, {
      selector,
      count,
      samples: matched.slice(0, 3).map((el) => truncate(inlineText(el), 140)),
      score: Math.round(score * 10) / 10,
      label: `${count} × ${representative.tagName.toLowerCase()}${classSignature(representative) ? `.${classSignature(representative).split(' ')[0]}` : ''}`,
    });
  }

  return Array.from(bySelector.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Build a complete extraction rule (row selector + detected fields) for a row selector. */
export function buildRuleForSelector(doc: Document, selector: string): ExtractionRule {
  const rows = queryPage(doc, selector, 'css').nodes.filter(isElement);
  if (rows.length === 0) throw new Error(t('The selector matched nothing on this page.'));
  return { rowSelector: selector, rowSelectorType: 'css', fields: detectFields(rows, doc) };
}
