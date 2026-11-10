// Image extraction: <img>, srcset, <picture>/<source>, lazy-loading attributes, video
// posters and (optionally) CSS backgrounds. Only URLs already present in the page are
// reported – Rowlio never fetches the images itself.
import type { ImageOptions, RawDataset } from '@/types';
import { t } from '@/i18n';
import { resolveUrl } from '@/utils/url';
import type { Pacer } from '@/utils/async';
import { baseUrlOf, collectRoots, describeElement, isOwnOverlay, tagOf } from './dom';

const LAZY_ATTRIBUTES = [
  'data-src',
  'data-lazy-src',
  'data-original',
  'data-lazy',
  'data-url',
  'data-image',
  'data-img-src',
  'data-hi-res-src',
  'data-full-src',
  'data-echo',
  'data-flickity-lazyload',
];
const LAZY_SRCSET_ATTRIBUTES = ['data-srcset', 'data-lazy-srcset'];
const PLACEHOLDER_PATTERN = /(placeholder|blank|spacer|loading|lazy|transparent|1x1|pixel)\.(gif|png|svg|jpe?g|webp)/i;

export interface SrcsetCandidate {
  url: string;
  /** Width descriptor (w) or density (x) scaled to a comparable number; 0 when absent. */
  weight: number;
}

/** Parse a srcset attribute. URLs may contain commas, so split on the descriptor boundary. */
export function parseSrcset(srcset: string, base: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  const pattern = /\s*([^\s,][^\s]*)(?:\s+([\d.]+)([wx]))?\s*(?:,|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(srcset)) !== null) {
    if (!match[1]) {
      if (pattern.lastIndex >= srcset.length) break;
      continue;
    }
    const raw = match[1].replace(/,+$/, '');
    const url = resolveUrl(raw, base);
    if (url) {
      const n = match[2] ? parseFloat(match[2]) : 0;
      out.push({ url, weight: match[3] === 'x' ? n * 1000 : n });
    }
    if (pattern.lastIndex >= srcset.length) break;
  }
  return out;
}

function largest(candidates: SrcsetCandidate[]): string {
  let best: SrcsetCandidate | null = null;
  for (const candidate of candidates) if (!best || candidate.weight > best.weight) best = candidate;
  return best?.url ?? '';
}

function isPlaceholder(url: string): boolean {
  return !url || url.startsWith('data:') || url.startsWith('about:') || PLACEHOLDER_PATTERN.test(url);
}

export interface ImageSource {
  url: string;
  /** Which element / attribute the URL was read from. */
  origin: string;
  others: string[];
}

/** The real source of an image, looking through lazy-loading placeholders. */
export function bestImageSource(img: HTMLImageElement): ImageSource {
  const base = baseUrlOf(img);
  const srcAttr = img.getAttribute('src') ?? '';
  const src = resolveUrl(srcAttr, base);
  const current = typeof img.currentSrc === 'string' ? img.currentSrc : '';
  const srcset = parseSrcset(img.getAttribute('srcset') ?? '', base);
  const picture = img.parentElement && tagOf(img.parentElement) === 'PICTURE' ? img.parentElement : null;
  const pictureSources: SrcsetCandidate[] = [];
  if (picture) {
    const sources = picture.querySelectorAll('source');
    for (let i = 0; i < sources.length; i++) {
      const set = sources[i].getAttribute('srcset') ?? sources[i].getAttribute('data-srcset') ?? '';
      pictureSources.push(...parseSrcset(set, base));
    }
  }
  let lazy = '';
  let lazyAttr = '';
  for (const name of LAZY_ATTRIBUTES) {
    const value = img.getAttribute(name);
    if (value && value.trim()) {
      lazy = resolveUrl(value, base);
      lazyAttr = name;
      if (lazy) break;
    }
  }
  const lazySet: SrcsetCandidate[] = [];
  for (const name of LAZY_SRCSET_ATTRIBUTES) {
    const value = img.getAttribute(name);
    if (value) lazySet.push(...parseSrcset(value, base));
  }

  let url = '';
  let origin = '';
  if (current && !isPlaceholder(current)) {
    url = current;
    origin = picture && pictureSources.some((c) => c.url === current) ? 'picture > source[srcset]' : srcset.some((c) => c.url === current) && current !== src ? 'img[srcset]' : 'img[src]';
  } else if (src && !isPlaceholder(src)) {
    url = src;
    origin = 'img[src]';
  } else if (lazy) {
    url = lazy;
    origin = `img[${lazyAttr}]`;
  } else if (lazySet.length) {
    url = largest(lazySet);
    origin = 'img[data-srcset]';
  } else if (srcset.length) {
    url = largest(srcset);
    origin = 'img[srcset]';
  } else if (pictureSources.length) {
    url = largest(pictureSources);
    origin = 'picture > source[srcset]';
  } else if (src) {
    // Only a placeholder / data URI exists: report it rather than nothing.
    url = src;
    origin = 'img[src]';
  }

  const others = new Set<string>();
  for (const candidate of [...srcset, ...pictureSources, ...lazySet]) others.add(candidate.url);
  if (lazy) others.add(lazy);
  if (src && !isPlaceholder(src)) others.add(src);
  others.delete(url);
  return { url, origin, others: Array.from(others) };
}

function dimension(natural: number, attr: string | null, rendered: number): number {
  if (natural > 0) return natural;
  const parsed = attr ? parseInt(attr, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return rendered > 0 ? rendered : 0;
}

export const IMAGE_COLUMNS = ['Image URL', 'Alt text', 'Title', 'Width', 'Height', 'Source element', 'Loading', 'Other sources'];

export async function extractImages(doc: Document, options: ImageOptions, pacer?: Pacer): Promise<RawDataset> {
  const warnings: string[] = [];
  const rows: string[][] = [];
  const seen = new Set<string>();
  const needle = options.urlContains.trim().toLowerCase();
  let unknownSizeExcluded = 0;
  let duplicates = 0;

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

  const push = (url: string, alt: string, title: string, width: number, height: number, origin: string, loading: string, others: string[]) => {
    if (!url) return;
    if (needle && !url.toLowerCase().includes(needle)) return;
    if (options.minWidth > 0 || options.minHeight > 0) {
      if (width === 0 && height === 0) {
        unknownSizeExcluded++;
        return;
      }
      if (width < options.minWidth || height < options.minHeight) return;
    }
    if (options.dedupe) {
      if (seen.has(url)) {
        duplicates++;
        return;
      }
      seen.add(url);
    }
    rows.push([url, alt, title, width ? String(width) : '', height ? String(height) : '', origin, loading, others.join(' ')]);
  };

  for (const scope of scopes) {
    const images = scope.querySelectorAll('img');
    for (let i = 0; i < images.length; i++) {
      if (pacer) await pacer.tick();
      const img = images[i] as HTMLImageElement;
      if (isOwnOverlay(img)) continue;
      const source = bestImageSource(img);
      push(
        source.url,
        (img.getAttribute('alt') ?? '').trim(),
        (img.getAttribute('title') ?? '').trim(),
        dimension(img.naturalWidth, img.getAttribute('width'), img.width),
        dimension(img.naturalHeight, img.getAttribute('height'), img.height),
        source.origin,
        (img.getAttribute('loading') ?? '').trim(),
        source.others,
      );
    }
    // <picture> without an <img> fallback, video posters and image inputs.
    const extras = scope.querySelectorAll('picture, video[poster], input[type="image"][src]');
    for (let i = 0; i < extras.length; i++) {
      const el = extras[i];
      if (isOwnOverlay(el)) continue;
      const base = baseUrlOf(el);
      const tag = tagOf(el);
      if (tag === 'PICTURE') {
        if (el.querySelector('img')) continue;
        const candidates: SrcsetCandidate[] = [];
        el.querySelectorAll('source').forEach((source) => candidates.push(...parseSrcset(source.getAttribute('srcset') ?? '', base)));
        const url = largest(candidates);
        push(url, '', '', 0, 0, 'picture > source[srcset]', '', candidates.map((c) => c.url).filter((u) => u !== url));
      } else if (tag === 'VIDEO') {
        push(resolveUrl(el.getAttribute('poster') ?? '', base), '', (el.getAttribute('title') ?? '').trim(), 0, 0, 'video[poster]', '', []);
      } else {
        push(resolveUrl(el.getAttribute('src') ?? '', base), (el.getAttribute('alt') ?? '').trim(), (el.getAttribute('title') ?? '').trim(), 0, 0, 'input[type=image]', '', []);
      }
    }
    if (options.includeBackgrounds) {
      const view = doc.defaultView;
      const all = scope.querySelectorAll('*');
      for (let i = 0; i < all.length && view; i++) {
        if (pacer) await pacer.tick();
        const el = all[i];
        if (isOwnOverlay(el)) continue;
        const background = view.getComputedStyle(el).backgroundImage;
        if (!background || background === 'none' || background.indexOf('url(') === -1) continue;
        const pattern = /url\((['"]?)(.*?)\1\)/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(background)) !== null) {
          const url = resolveUrl(match[2], baseUrlOf(el));
          if (!url || url.startsWith('data:')) continue;
          const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
          push(url, '', (el.getAttribute('title') ?? '').trim(), Math.round(rect?.width ?? 0), Math.round(rect?.height ?? 0), `css background (${describeElement(el)})`, '', []);
        }
      }
    }
  }

  if (unknownSizeExcluded > 0) {
    warnings.push(t('{count} image(s) with unknown dimensions were excluded by the size filter.', { count: unknownSizeExcluded }));
  }
  if (duplicates > 0) {
    warnings.push(t('{count} duplicate image URL(s) were skipped.', { count: duplicates }));
  }
  return { key: 'images', name: t('Images'), columns: IMAGE_COLUMNS.map((c) => t(c)), rows, warnings, method: 'images' };
}
