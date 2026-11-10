// Lists (ol / ul / dl), headings and breadcrumbs.
import type { ListOptions, RawDataset } from '@/types';
import { t } from '@/i18n';
import { resolveUrl } from '@/utils/url';
import { collapseWhitespace } from '@/utils/text';
import type { Pacer } from '@/utils/async';
import { baseUrlOf, collectRoots, inlineText, isOwnOverlay, tagOf } from './dom';

export const LIST_COLUMNS = ['List', 'List name', 'Type', 'Level', 'Position', 'Term', 'Text', 'Link'];

/** Text of a list item without the text of lists nested inside it. */
function itemText(li: Element): string {
  if (!li.querySelector('ul, ol, dl')) return inlineText(li);
  const clone = li.cloneNode(true) as Element;
  clone.querySelectorAll('ul, ol, dl').forEach((nested) => nested.remove());
  return inlineText(clone, { includeHidden: true });
}

function itemLink(li: Element): string {
  const links = li.querySelectorAll('a[href]');
  for (let i = 0; i < links.length; i++) {
    const owner = links[i].closest('li, dd, dt');
    if (owner === li) return resolveUrl(links[i].getAttribute('href') ?? '', baseUrlOf(li));
  }
  return '';
}

function listName(list: Element): string {
  const label = list.getAttribute('aria-label');
  if (label && label.trim()) return collapseWhitespace(label);
  const nav = list.closest('nav[aria-label]');
  if (nav) return collapseWhitespace(nav.getAttribute('aria-label') ?? '');
  const prev = list.previousElementSibling;
  if (prev && /^H[1-6]$/.test(tagOf(prev))) return inlineText(prev);
  return '';
}

function walkList(list: Element, listNo: string, name: string, level: number, rows: string[][]): void {
  const type = tagOf(list) === 'OL' ? 'ordered' : 'unordered';
  let position = 0;
  for (let child = list.firstElementChild; child; child = child.nextElementSibling) {
    if (tagOf(child) !== 'LI') continue;
    position++;
    rows.push([listNo, name, type, String(level), String(position), '', itemText(child), itemLink(child)]);
    const nested = child.querySelectorAll('ul, ol');
    for (let i = 0; i < nested.length; i++) {
      // Only lists that belong directly to this item (not to a deeper item).
      if (nested[i].parentElement?.closest('li') === child) walkList(nested[i], listNo, name, level + 1, rows);
    }
  }
}

function walkDefinitionList(dl: Element, listNo: string, name: string, rows: string[][]): void {
  let terms: string[] = [];
  let position = 0;
  let pendingTerms = false;
  const flushTerms = () => {
    if (pendingTerms && terms.length) {
      position++;
      rows.push([listNo, name, 'definition', '1', String(position), terms.join(' / '), '', '']);
    }
  };
  const visit = (parent: Element) => {
    for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
      const tag = tagOf(child);
      if (tag === 'DIV') {
        visit(child); // HTML allows <div> groups inside <dl>
      } else if (tag === 'DT') {
        if (!pendingTerms) terms = [];
        terms.push(inlineText(child));
        pendingTerms = true;
      } else if (tag === 'DD') {
        position++;
        rows.push([listNo, name, 'definition', '1', String(position), terms.join(' / '), inlineText(child), itemLink(child)]);
        pendingTerms = false;
      }
    }
  };
  visit(dl);
  flushTerms(); // a trailing <dt> without <dd> is kept, with an empty definition
}

export async function extractLists(doc: Document, options: ListOptions, pacer?: Pacer): Promise<RawDataset> {
  const warnings: string[] = [];
  const wanted: string[] = [];
  if (options.ordered) wanted.push('ol');
  if (options.unordered) wanted.push('ul');
  if (options.definition) wanted.push('dl');
  const rows: string[][] = [];
  if (wanted.length === 0) {
    return { key: 'lists', name: t('Lists'), columns: LIST_COLUMNS.map((c) => t(c)), rows, warnings: [t('No list type selected.')], method: 'lists' };
  }

  const scopes: (Document | ShadowRoot | Element)[] = [];
  if (options.containerSelector.trim()) {
    let containers: Element[];
    try {
      containers = Array.from(doc.querySelectorAll(options.containerSelector));
    } catch {
      throw new Error(t('Invalid container selector.'));
    }
    if (containers.length === 0) warnings.push(t('The container selector matched nothing on this page.'));
    scopes.push(...containers);
  } else {
    for (const { root } of collectRoots(doc)) scopes.push(root);
  }

  let listNo = 0;
  let skippedSmall = 0;
  for (const scope of scopes) {
    const lists = scope.querySelectorAll(wanted.join(', '));
    for (let i = 0; i < lists.length; i++) {
      if (pacer) await pacer.tick();
      const list = lists[i];
      if (isOwnOverlay(list)) continue;
      const tag = tagOf(list);
      // Nested ul/ol are emitted as part of their parent list (with a deeper level).
      if (tag !== 'DL' && list.parentElement?.closest('ul, ol')) {
        const parentList = list.parentElement.closest('ul, ol')!;
        if (wanted.includes(parentList.tagName.toLowerCase())) continue;
      }
      const before = rows.length;
      const name = listName(list);
      if (tag === 'DL') walkDefinitionList(list, String(listNo + 1), name, rows);
      else walkList(list, String(listNo + 1), name, 1, rows);
      const added = rows.length - before;
      if (added < options.minItems) {
        rows.length = before;
        if (added > 0) skippedSmall++;
        continue;
      }
      if (added > 0) listNo++;
    }
  }
  if (skippedSmall > 0) {
    warnings.push(t('{count} list(s) with fewer than {min} items were skipped.', { count: skippedSmall, min: options.minItems }));
  }
  return { key: 'lists', name: t('Lists'), columns: LIST_COLUMNS.map((c) => t(c)), rows, warnings, method: 'lists' };
}

export const HEADING_COLUMNS = ['Level', 'Text', 'ID', 'Anchor URL'];

export function extractHeadings(doc: Document): RawDataset {
  const rows: string[][] = [];
  const pageUrl = doc.URL.replace(/#.*$/, '');
  for (const { root } of collectRoots(doc)) {
    const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
    for (let i = 0; i < headings.length; i++) {
      const el = headings[i];
      if (isOwnOverlay(el)) continue;
      const tag = tagOf(el);
      const level = /^H[1-6]$/.test(tag) ? tag.slice(1) : (el.getAttribute('aria-level') ?? '2');
      const text = inlineText(el);
      if (!text) continue;
      const id = el.id || '';
      rows.push([level, text, id, id ? `${pageUrl}#${encodeURIComponent(id)}` : '']);
    }
  }
  return {
    key: 'headings',
    name: t('Headings'),
    columns: HEADING_COLUMNS.map((c) => t(c)),
    rows,
    warnings: rows.length === 0 ? [t('No headings found on this page.')] : [],
    method: 'headings',
  };
}

export const BREADCRUMB_COLUMNS = ['Trail', 'Position', 'Name', 'URL', 'Source'];

const BREADCRUMB_SELECTOR =
  'nav[aria-label*="breadcrumb" i], [role="navigation"][aria-label*="breadcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i], [itemtype*="BreadcrumbList" i]';

export function extractBreadcrumbs(doc: Document, jsonLdTrails: { name: string; url: string }[][] = []): RawDataset {
  const rows: string[][] = [];
  let trail = 0;
  const signatures = new Set<string>();
  const addTrail = (items: { name: string; url: string }[], source: string) => {
    const cleaned = items.filter((item) => item.name);
    if (cleaned.length === 0) return;
    const signature = cleaned.map((item) => item.name).join('\u001f');
    if (signatures.has(signature)) return; // same trail exposed twice (markup + JSON-LD)
    signatures.add(signature);
    trail++;
    cleaned.forEach((item, i) => rows.push([String(trail), String(i + 1), item.name, item.url, source]));
  };

  for (const items of jsonLdTrails) addTrail(items, 'JSON-LD');

  const containers = Array.from(doc.querySelectorAll(BREADCRUMB_SELECTOR)).filter((el) => !isOwnOverlay(el));
  // Keep only outermost matches: a nav.breadcrumb containing ol.breadcrumb is one trail.
  const outer = containers.filter((el) => !containers.some((other) => other !== el && other.contains(el)));
  for (const container of outer) {
    const base = baseUrlOf(container);
    let itemEls: Element[] = Array.from(container.querySelectorAll('li'));
    if (itemEls.length === 0) itemEls = Array.from(container.querySelectorAll('a, [aria-current], span[itemprop="name"]'));
    const items: { name: string; url: string }[] = [];
    const used = new Set<string>();
    for (const el of itemEls) {
      const link = tagOf(el) === 'A' ? el : el.querySelector('a[href]');
      const name = inlineText(link ?? el).replace(/^[\s/›»>|→-]+|[\s/›»>|→-]+$/g, '');
      if (!name) continue;
      const url = link ? resolveUrl(link.getAttribute('href') ?? '', base) : '';
      const key = `${name}\u001f${url}`;
      if (used.has(key)) continue;
      used.add(key);
      items.push({ name, url });
    }
    addTrail(items, 'HTML');
  }
  return {
    key: 'breadcrumbs',
    name: t('Breadcrumbs'),
    columns: BREADCRUMB_COLUMNS.map((c) => t(c)),
    rows,
    warnings: rows.length === 0 ? [t('No breadcrumbs found on this page.')] : [],
    method: 'breadcrumbs',
  };
}
