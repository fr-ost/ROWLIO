// Link extraction with scope / text / selector filters. URLs are normalised against the
// page's base URL; the original (possibly relative) href is preserved alongside.
import type { LinkOptions, RawDataset } from '@/types';
import { t } from '@/i18n';
import { isInternalUrl, resolveUrl } from '@/utils/url';
import type { Pacer } from '@/utils/async';
import { baseUrlOf, collectRoots, inlineText, isOwnOverlay } from './dom';

export const LINK_COLUMNS = ['Link text', 'URL', 'Relative URL', 'Title', 'Target', 'Rel', 'Type'];

function linkText(a: Element): string {
  const text = inlineText(a);
  if (text) return text;
  const label = a.getAttribute('aria-label');
  if (label && label.trim()) return label.trim();
  const img = a.querySelector('img[alt]');
  return (img?.getAttribute('alt') ?? '').trim();
}

export async function extractLinks(doc: Document, options: LinkOptions, pacer?: Pacer): Promise<RawDataset> {
  const warnings: string[] = [];
  const pageUrl = doc.URL;
  const anchorSelector = options.matchSelector.trim() || 'a[href], area[href]';

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

  const needle = options.textContains.trim().toLowerCase();
  const seen = new Set<string>();
  const seenElements = new Set<Element>();
  const rows: string[][] = [];
  let duplicates = 0;
  let nonLinks = 0;

  for (const scope of scopes) {
    let anchors: NodeListOf<Element>;
    try {
      anchors = scope.querySelectorAll(anchorSelector);
    } catch {
      throw new Error(t('Invalid link selector.'));
    }
    for (let i = 0; i < anchors.length; i++) {
      if (pacer) await pacer.tick();
      let a: Element | null = anchors[i];
      // A custom selector may match something inside or around the link.
      if (!a.hasAttribute('href')) a = a.closest('a[href]') ?? a.querySelector('a[href]');
      if (!a) {
        nonLinks++;
        continue;
      }
      if (seenElements.has(a) || isOwnOverlay(a)) continue;
      seenElements.add(a);
      const raw = (a.getAttribute('href') ?? '').trim();
      const url = resolveUrl(raw, baseUrlOf(a));
      if (!url) continue;
      const internal = isInternalUrl(url, pageUrl);
      const isWeb = /^https?:/i.test(url);
      if (options.scope === 'internal' && !internal) continue;
      if (options.scope === 'external' && (internal || !isWeb)) continue;
      const text = linkText(a);
      if (needle && !text.toLowerCase().includes(needle)) continue;
      if (options.dedupe) {
        if (seen.has(url)) {
          duplicates++;
          continue;
        }
        seen.add(url);
      }
      const type = !isWeb ? url.slice(0, url.indexOf(':')).toLowerCase() : internal ? 'internal' : 'external';
      rows.push([
        text,
        url,
        raw,
        (a.getAttribute('title') ?? '').trim(),
        (a.getAttribute('target') ?? '').trim(),
        (a.getAttribute('rel') ?? '').trim(),
        type,
      ]);
    }
  }
  if (nonLinks > 0) {
    warnings.push(t('{count} element(s) matched by the selector are not links and were skipped.', { count: nonLinks }));
  }
  if (duplicates > 0) {
    warnings.push(t('{count} duplicate link(s) were skipped.', { count: duplicates }));
  }
  return { key: 'links', name: t('Links'), columns: LINK_COLUMNS.map((c) => t(c)), rows, warnings, method: 'links' };
}
