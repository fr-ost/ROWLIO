// DOM helpers shared by every extractor. Pure DOM code: no chrome.* APIs, so the whole
// extraction engine runs unchanged in the content script and in jsdom unit tests.

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK']);

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TFOOT', 'THEAD',
  'TR', 'UL',
]);

const CELL_SEPARATOR = '\u0001';
const LINE_BREAK = '\n';

/** Tag name in upper case for both HTML and (rare) XML/SVG elements. */
export function tagOf(el: Element): string {
  return el.tagName.toUpperCase();
}

export function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === 1;
}

/**
 * True when the element itself is hidden: `hidden` attribute, display:none or
 * visibility:hidden/collapse. Deliberately looks at the element's OWN computed style, not
 * its ancestors, so callers walking top-down get "hidden relative to the root they started
 * from" (a table inside a collapsed tab panel still yields its visible rows).
 */
export function isSelfHidden(el: Element): boolean {
  if ((el as HTMLElement).hidden === true) return true;
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  if (style.display === 'none') return true;
  const visibility = style.visibility;
  return visibility === 'hidden' || visibility === 'collapse';
}

/** True when the element or any ancestor is hidden (i.e. it is not rendered at all). */
export function isHiddenDeep(el: Element): boolean {
  const anyEl = el as Element & { checkVisibility?: (opts?: object) => boolean };
  if (typeof anyEl.checkVisibility === 'function') {
    try {
      return !anyEl.checkVisibility({ visibilityProperty: true });
    } catch {
      /* fall through */
    }
  }
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (isSelfHidden(node)) return true;
  }
  return false;
}

function formControlText(el: Element, tag: string): string | null {
  if (tag === 'INPUT') {
    const input = el as HTMLInputElement;
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (type === 'hidden' || type === 'password' || type === 'file') return '';
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return '';
    if (type === 'checkbox' || type === 'radio') return input.checked ? 'true' : 'false';
    return input.value ?? '';
  }
  if (tag === 'TEXTAREA') return (el as HTMLTextAreaElement).value ?? '';
  if (tag === 'SELECT') {
    const select = el as HTMLSelectElement;
    const selected = Array.from(select.selectedOptions ?? []).map((o) => o.textContent ?? '');
    return selected.join(', ');
  }
  return null;
}

export interface TextOptions {
  /** Include content hidden with CSS / the hidden attribute. Default false. */
  includeHidden?: boolean;
  /** Use the alt text of images as text. Default true. */
  imageAlt?: boolean;
}

function walkText(node: Node, out: string[], opts: TextOptions): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      out.push((child as Text).data);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = tagOf(el);
    if (SKIP_TAGS.has(tag)) continue;
    if (!opts.includeHidden && isSelfHidden(el)) continue;
    if (tag === 'BR') {
      out.push(LINE_BREAK);
      continue;
    }
    if (tag === 'IMG') {
      if (opts.imageAlt !== false) {
        const alt = el.getAttribute('alt');
        if (alt) out.push(` ${alt} `);
      }
      continue;
    }
    const control = formControlText(el, tag);
    if (control !== null) {
      out.push(` ${control} `);
      continue;
    }
    if (tag === 'TD' || tag === 'TH') {
      // Only reached for cells of a table nested inside the element being read.
      walkText(el, out, opts);
      out.push(CELL_SEPARATOR);
      continue;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) out.push(LINE_BREAK);
    walkText(el, out, opts);
    // Slotted / shadow content is part of what the user sees.
    const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (shadow) walkText(shadow, out, opts);
    if (block) out.push(LINE_BREAK);
  }
}

/**
 * Visible text of an element, close to what `innerText` gives but layout-free (fast, and
 * available in jsdom): whitespace is collapsed, <br> and block boundaries become newlines,
 * script/style are skipped, nested table cells are separated by " | ".
 */
export function elementText(el: Element, opts: TextOptions = {}): string {
  const tag = tagOf(el);
  if (tag === 'IMG') return (el.getAttribute('alt') ?? '').trim();
  const control = formControlText(el, tag);
  if (control !== null) return control.trim();
  if (tag === 'META') return (el.getAttribute('content') ?? '').trim();

  const parts: string[] = [];
  walkText(el, parts, opts);
  if (parts.length === 0) return '';
  if (parts.length === 1 && parts[0].indexOf(LINE_BREAK) === -1) {
    return parts[0].replace(/[\s ]+/g, ' ').trim();
  }
  const lines = parts.join('').split(LINE_BREAK);
  const result: string[] = [];
  for (const line of lines) {
    const cleaned = line
      .replace(/[^\S\n]*\u0001[^\S\n]*/g, CELL_SEPARATOR)
      .replace(/^\u0001+|\u0001+$/g, '')
      .replace(/\u0001+/g, ' | ')
      .replace(/[\s ]+/g, ' ')
      .trim();
    if (cleaned) result.push(cleaned);
  }
  return result.join('\n');
}

/** Single-line variant: newlines are folded into spaces. */
export function inlineText(el: Element, opts: TextOptions = {}): string {
  return elementText(el, opts).replace(/\n+/g, ' ');
}

/** Text of the element's direct text nodes only. */
export function ownText(el: Element): string {
  let text = '';
  for (let child = el.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) text += (child as Text).data;
  }
  return text.replace(/[\s ]+/g, ' ').trim();
}

export type RootLocation = 'document' | 'shadow-dom' | 'iframe';

export interface SearchRoot {
  root: Document | ShadowRoot;
  location: RootLocation;
}

const MAX_ROOT_DEPTH = 6;

function collectRootsInto(root: Document | ShadowRoot, location: RootLocation, depth: number, out: SearchRoot[]): void {
  out.push({ root, location });
  if (depth >= MAX_ROOT_DEPTH) return;
  const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!doc) return;
  const walker = doc.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as Element & { shadowRoot?: ShadowRoot | null };
    if (el.shadowRoot) collectRootsInto(el.shadowRoot, 'shadow-dom', depth + 1, out);
    const tag = el.tagName;
    if (tag === 'IFRAME' || tag === 'FRAME') {
      try {
        // Same-origin frames only; cross-origin access throws or returns null, by design.
        const frameDoc = (el as HTMLIFrameElement).contentDocument;
        if (frameDoc && frameDoc.documentElement) collectRootsInto(frameDoc, 'iframe', depth + 1, out);
      } catch {
        /* cross-origin frame: not accessible, skip */
      }
    }
  }
}

/**
 * The document plus every open shadow root and same-origin iframe document reachable
 * from it. Closed shadow roots and cross-origin frames are not accessible to extensions.
 */
export function collectRoots(doc: Document): SearchRoot[] {
  const out: SearchRoot[] = [];
  collectRootsInto(doc, 'document', 0, out);
  return out;
}

/** querySelectorAll across the document, open shadow roots and same-origin iframes. */
export function queryAllDeep(doc: Document, selector: string, roots?: SearchRoot[]): Element[] {
  const result: Element[] = [];
  for (const { root } of roots ?? collectRoots(doc)) {
    const found = root.querySelectorAll(selector);
    for (let i = 0; i < found.length; i++) result.push(found[i]);
  }
  return result;
}

/** Base URL used to resolve relative URLs for an element (honours <base href>). */
export function baseUrlOf(node: Node): string {
  const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
  return doc?.baseURI || doc?.URL || '';
}

/** Closest scrollable ancestor (overflow auto/scroll with overflowing content), if any. */
export function scrollableAncestor(el: Element, maxDepth = 8): Element | null {
  const view = el.ownerDocument?.defaultView;
  if (!view) return null;
  let node = el.parentElement;
  for (let depth = 0; node && depth < maxDepth; depth++, node = node.parentElement) {
    if (node === el.ownerDocument.body || node === el.ownerDocument.documentElement) return null;
    const style = view.getComputedStyle(node);
    const overflow = `${style.overflowY} ${style.overflowX} ${style.overflow}`;
    if (/(auto|scroll)/.test(overflow) && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
      return node;
    }
  }
  return null;
}

/** Elements Rowlio injects into the page carry this attribute and are never extracted. */
export const OVERLAY_ATTR = 'data-rowlio-overlay';

export function isOwnOverlay(el: Element): boolean {
  return !!el.closest?.(`[${OVERLAY_ATTR}]`);
}

/** A short "tag.class" description used in labels and warnings. */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim()
    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
    : '';
  return `${tag}${id}${cls}`;
}
