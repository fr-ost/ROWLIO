// Page metadata: title, description, canonical, Open Graph, Twitter Cards, other <meta>
// tags and informative <link> tags.
import type { MetaOptions, RawDataset } from '@/types';
import { t } from '@/i18n';
import { resolveUrl } from '@/utils/url';

export const META_COLUMNS = ['Group', 'Name', 'Value'];

const LINK_RELS = new Set([
  'canonical', 'alternate', 'icon', 'shortcut icon', 'apple-touch-icon', 'manifest', 'next', 'prev',
  'author', 'license', 'amphtml', 'shortlink', 'search', 'me',
]);
const BASIC_META = new Set(['description', 'keywords', 'author', 'robots', 'generator', 'viewport', 'theme-color', 'application-name', 'referrer']);

export function extractMetadata(doc: Document, options: MetaOptions): RawDataset {
  const rows: string[][] = [];
  const base = doc.baseURI || doc.URL;
  const add = (group: string, name: string, value: string | null | undefined) => {
    const v = (value ?? '').trim();
    if (v) rows.push([group, name, v]);
  };

  const metas = Array.from(doc.querySelectorAll('meta'));
  if (options.basic) {
    add('Basic', 'title', doc.title);
    add('Basic', 'url', doc.URL);
    add('Basic', 'canonical', resolveUrl(doc.querySelector('link[rel~="canonical" i]')?.getAttribute('href') ?? '', base));
    add('Basic', 'lang', doc.documentElement.getAttribute('lang'));
    add('Basic', 'charset', doc.characterSet);
    for (const meta of metas) {
      const name = (meta.getAttribute('name') ?? '').toLowerCase();
      if (BASIC_META.has(name)) add('Basic', name, meta.getAttribute('content'));
    }
  }
  for (const meta of metas) {
    const key = (meta.getAttribute('property') ?? meta.getAttribute('name') ?? '').trim();
    const lower = key.toLowerCase();
    const content = meta.getAttribute('content');
    if (!key) {
      if (options.otherMeta) {
        const equiv = meta.getAttribute('http-equiv');
        if (equiv) add('Other meta', `http-equiv: ${equiv}`, content);
        const itemprop = meta.getAttribute('itemprop');
        if (itemprop) add('Other meta', `itemprop: ${itemprop}`, content);
      }
      continue;
    }
    if (/^(og|article|book|profile|music|video|product|fb):/.test(lower)) {
      if (options.openGraph) add('Open Graph', key, content);
    } else if (lower.startsWith('twitter:')) {
      if (options.twitter) add('Twitter Card', key, content);
    } else if (!BASIC_META.has(lower)) {
      if (options.otherMeta) add('Other meta', key, content);
    }
  }
  if (options.linkTags) {
    for (const link of Array.from(doc.querySelectorAll('link[rel][href]'))) {
      const rel = (link.getAttribute('rel') ?? '').trim().toLowerCase();
      if (!LINK_RELS.has(rel)) continue;
      if (rel === 'canonical' && options.basic) continue; // already listed under Basic
      const extras = ['hreflang', 'type', 'sizes', 'media', 'title']
        .map((name) => (link.getAttribute(name) ? `${name}=${link.getAttribute(name)}` : ''))
        .filter(Boolean)
        .join(' ');
      add('Link', extras ? `${rel} (${extras})` : rel, resolveUrl(link.getAttribute('href') ?? '', base));
    }
  }
  return {
    key: 'metadata',
    name: t('Page metadata'),
    columns: META_COLUMNS.map((c) => t(c)),
    rows,
    warnings: rows.length === 0 ? [t('No metadata found for the selected categories.')] : [],
    method: 'metadata',
  };
}
