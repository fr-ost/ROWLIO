// Finding the "next page" control: user-defined selector, rel=next, next-ish text /
// aria-label / class names, and page-number navigation.
import type { NextControlInfo } from '@/types';
import { collapseWhitespace } from '@/utils/text';
import { resolveUrl } from '@/utils/url';
import { baseUrlOf, inlineText, isHiddenDeep, isOwnOverlay, tagOf } from '@/extraction/dom';
import { uniqueSelector } from '@/extraction/generate';

const NEXT_WORDS = [
  'next', 'next page', 'older', 'older posts', 'older entries', 'more', 'siguiente', 'suivant', 'suivante',
  'page suivante', 'weiter', 'nächste', 'nächste seite', 'próximo', 'próxima', 'seguinte', 'avanti',
  'successivo', 'successiva', 'volgende', 'следующая', 'далее', 'вперёд', '下一页', '下一頁', '下页', '次へ',
  '次のページ', '次', '다음', '다음 페이지', 'التالي', 'sonraki', 'পরবর্তী', 'পরের', 'পরবর্তী পাতা', 'अगला',
  'selanjutnya', 'berikutnya', 'tiếp', 'tiếp theo', 'ถัดไป', 'następna', 'dalej', 'další', 'nästa', 'neste',
  'næste', 'seuraava', 'επόμενη', 'הבא', 'următor', 'következő',
];
const NEXT_WORD_SET = new Set(NEXT_WORDS);
const ARROWS = new Set(['›', '»', '→', '>', '>>', '⟩', '❯', '▶', '►', '⏵', '⟶', '➔', '➜']);
const NOT_PAGINATION = /slide|carousel|image|photo|picture|month|year|week|day|video|story|stories|tab|step|track|song|episode|testimonial|banner|gallery|calendar/i;
const CAROUSEL_ANCESTOR =
  '[class*="carousel" i], [class*="slider" i], [class*="swiper" i], [class*="slick" i], [class*="gallery" i], [class*="lightbox" i], [aria-roledescription="carousel" i], [class*="datepicker" i], [class*="calendar" i]';
const PAGINATION_ANCESTOR =
  'nav, [role="navigation"], [class*="pagination" i], [class*="pager" i], [class*="paging" i], [class*="page-numbers" i], [aria-label*="pagination" i], [aria-label*="page" i], [id*="pagination" i]';
const NEXT_CLASS = /(^|[\s_-])(next|nextpage|next-page|pagination-next|page-next|pager-next|nav-next|nextpostslink)([\s_-]|$)/i;
const CLICKABLE = 'a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]';

function labelOf(el: Element): { text: string; aria: string } {
  const tag = tagOf(el);
  const text = tag === 'INPUT' ? ((el as HTMLInputElement).value ?? '') : inlineText(el, { includeHidden: true });
  const aria = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
  return { text: collapseWhitespace(text), aria: collapseWhitespace(aria) };
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[›»→>⟩❯▶►⏵⟶➔➜«‹←<]+/g, ' ')
    .replace(/[.:…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDisabledControl(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled === true) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  if (/(^|[\s_-])(disabled|inactive)([\s_-]|$)/i.test(el.getAttribute('class') ?? '')) return true;
  const wrapper = el.closest('li, span, div');
  if (wrapper && wrapper !== el && /(^|[\s_-])disabled([\s_-]|$)/i.test(wrapper.getAttribute('class') ?? '') && wrapper.querySelectorAll(CLICKABLE).length <= 1) {
    return true;
  }
  return false;
}

function realHref(el: Element): string {
  const anchor = tagOf(el) === 'A' ? el : el.closest('a[href]');
  const raw = (anchor?.getAttribute('href') ?? '').trim();
  if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return '';
  return resolveUrl(raw, baseUrlOf(el));
}

interface Scored {
  el: Element;
  score: number;
  strategy: NextControlInfo['strategy'];
}

function scoreCandidate(el: Element): Scored | null {
  const { text, aria } = labelOf(el);
  const normText = normalizeLabel(text);
  const normAria = normalizeLabel(aria);
  const classId = `${el.getAttribute('class') ?? ''} ${el.id ?? ''}`;
  const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
  let score = 0;
  let strategy: NextControlInfo['strategy'] = 'none';

  if (rel.includes('next')) {
    score = 100;
    strategy = 'rel-next';
  } else if (normAria && (NEXT_WORD_SET.has(normAria) || /^(go to )?next( page| results)?$/.test(normAria) || /next page|page suivante|nächste seite|página siguiente/.test(normAria))) {
    score = 80;
    strategy = 'aria';
  } else if (normText && NEXT_WORD_SET.has(normText)) {
    score = normText === 'more' ? 40 : 70;
    strategy = 'text';
  } else if (NEXT_CLASS.test(classId)) {
    score = 60;
    strategy = 'class';
  } else if (text && ARROWS.has(text.trim()) && text.trim().length <= 2) {
    score = 30;
    strategy = 'text';
  } else {
    return null;
  }

  const combined = `${text} ${aria} ${classId}`;
  if (NOT_PAGINATION.test(combined) && strategy !== 'rel-next') score -= 60;
  if (el.closest(CAROUSEL_ANCESTOR)) score -= 60;
  if (el.closest(PAGINATION_ANCESTOR)) score += 30;
  if (isHiddenDeep(el)) score -= 100;
  return { el, score, strategy };
}

function pageNumberOf(el: Element): number | null {
  const text = collapseWhitespace(inlineText(el, { includeHidden: true }));
  if (!/^\d{1,6}$/.test(text)) return null;
  return parseInt(text, 10);
}

/** Page-number navigation: find the current page and the control for current + 1. */
function findByPageNumber(doc: Document): { el: Element; current: number } | null {
  const currentMarkers = doc.querySelectorAll(
    '[aria-current="page"], [aria-current="true"], .active, .current, .selected, .is-active, .is-current, [class*="current" i], [class*="active" i]',
  );
  for (let i = 0; i < currentMarkers.length; i++) {
    const marker = currentMarkers[i];
    if (isOwnOverlay(marker)) continue;
    const current = pageNumberOf(marker);
    if (current === null) continue;
    const container = marker.closest(PAGINATION_ANCESTOR) ?? marker.parentElement?.parentElement ?? marker.parentElement;
    if (!container) continue;
    const controls = container.querySelectorAll(CLICKABLE);
    let numeric = 0;
    let next: Element | null = null;
    for (let c = 0; c < controls.length; c++) {
      const n = pageNumberOf(controls[c]);
      if (n === null) continue;
      numeric++;
      if (n === current + 1 && !controls[c].contains(marker) && !marker.contains(controls[c])) next = controls[c];
    }
    if (numeric >= 1 && next && !isHiddenDeep(next)) return { el: next, current };
  }
  return null;
}

function infoFor(el: Element, strategy: NextControlInfo['strategy'], currentPage: number | null): NextControlInfo {
  const href = realHref(el);
  const { text, aria } = labelOf(el);
  let selector = '';
  try {
    selector = uniqueSelector(el);
  } catch {
    selector = '';
  }
  return {
    found: true,
    strategy,
    kind: href ? 'navigate' : 'click',
    href,
    text: text || aria,
    selector,
    disabled: isDisabledControl(el),
    currentPage,
  };
}

const NOT_FOUND: NextControlInfo = {
  found: false,
  strategy: 'none',
  kind: 'none',
  href: '',
  text: '',
  selector: '',
  disabled: false,
  currentPage: null,
};

export interface NextControl {
  info: NextControlInfo;
  element: Element | null;
  /** Set for <link rel="next">, which can only be followed by navigating. */
  navigateTo?: string;
}

/**
 * Locate the next-page control. `customSelector` (CSS) wins when given; an invalid custom
 * selector throws so the UI can show the problem instead of silently auto-detecting.
 */
export function findNextControl(doc: Document, customSelector: string): NextControl {
  const custom = customSelector.trim();
  if (custom) {
    let matches: Element[];
    try {
      matches = Array.from(doc.querySelectorAll(custom));
    } catch {
      throw new Error('Invalid next-page selector.');
    }
    const visible = matches.filter((el) => !isOwnOverlay(el) && !isHiddenDeep(el));
    const el = visible[0] ?? null;
    if (!el) return { info: NOT_FOUND, element: null };
    return { info: infoFor(el, 'custom-selector', null), element: el };
  }

  const candidates = doc.querySelectorAll(CLICKABLE);
  let best: Scored | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (isOwnOverlay(el)) continue;
    const scored = scoreCandidate(el);
    if (!scored || scored.score < 50) continue;
    // Later in the document wins ties: pagination usually sits below the content.
    if (!best || scored.score >= best.score) best = scored;
  }
  if (best) return { info: infoFor(best.el, best.strategy, null), element: best.el };

  const numbered = findByPageNumber(doc);
  if (numbered) return { info: infoFor(numbered.el, 'page-number', numbered.current), element: numbered.el };

  const relLink = doc.querySelector('link[rel~="next" i][href]');
  if (relLink) {
    const href = resolveUrl(relLink.getAttribute('href') ?? '', doc.baseURI || doc.URL);
    if (href) {
      return {
        info: { found: true, strategy: 'rel-next', kind: 'navigate', href, text: 'link[rel=next]', selector: 'link[rel~="next"]', disabled: false, currentPage: null },
        element: null,
        navigateTo: href,
      };
    }
  }
  return { info: NOT_FOUND, element: null };
}

/** Activate the control the way a user would. */
export function activateNextControl(control: NextControl, view: Window): void {
  if (control.navigateTo) {
    view.location.assign(control.navigateTo);
    return;
  }
  const el = control.element as HTMLElement | null;
  if (!el) return;
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    /* older engines */
  }
  // Some sites listen for pointer / mouse down-up rather than click.
  const init: MouseEventInit = { bubbles: true, cancelable: true, composed: true, view, button: 0 };
  const ctors = view as unknown as { PointerEvent?: typeof PointerEvent; MouseEvent: typeof MouseEvent };
  const Pointer = ctors.PointerEvent;
  if (Pointer) el.dispatchEvent(new Pointer('pointerdown', { ...init, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new ctors.MouseEvent('mousedown', init));
  if (Pointer) el.dispatchEvent(new Pointer('pointerup', { ...init, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new ctors.MouseEvent('mouseup', init));
  el.click();
}
