// Everything Rowlio draws on top of a page lives in ONE host element with a closed
// shadow root: page CSS cannot restyle it and page scripts cannot reach inside.
// All text is set with textContent – page content is never interpreted as HTML here.
import { IS_E2E, brand } from '@/config/brand';
import { OVERLAY_ATTR } from '@/extraction/dom';
import { OVERLAY_CSS } from './styles';

export type BoxKind = 'hover' | 'record' | 'field' | 'match' | 'flash';

type Child = string | Node | null | undefined | false;

/** Tiny DOM builder (the content script does not ship a UI framework). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | number | boolean | ((event: Event) => void) | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') {
      el.addEventListener(key.replace(/^on/, '').toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'value') {
      (el as unknown as HTMLInputElement).value = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const MAX_BOXES = 400;

class Overlay {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private boxLayer: HTMLElement | null = null;
  private uiLayer: HTMLElement | null = null;
  private groups = new Map<string, { elements: Element[]; kind: BoxKind }>();
  private frame = 0;
  private listening = false;
  private readonly onViewportChange = () => this.schedule();

  /** The host element (used to tell our own UI apart from page elements). */
  get hostElement(): HTMLElement | null {
    return this.host;
  }

  private ensure(): void {
    if (this.host && this.host.isConnected) return;
    this.host = document.createElement('div');
    this.host.setAttribute(OVERLAY_ATTR, '');
    this.host.setAttribute('aria-live', 'off');
    this.host.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important;';
    // Closed in production. Open only in the E2E test build so tests can drive the picker.
    this.root = this.host.attachShadow({ mode: IS_E2E ? 'open' : 'closed' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    this.boxLayer = h('div', { class: 'boxes', 'aria-hidden': 'true' });
    this.uiLayer = h('div', { class: 'ui' });
    this.root.append(style, this.boxLayer, this.uiLayer);
    (document.documentElement || document.body).append(this.host);
  }

  /** Mount a piece of UI (panel, HUD). Returns a function that removes it. */
  mount(node: HTMLElement): () => void {
    this.ensure();
    this.uiLayer!.append(node);
    return () => {
      node.remove();
      this.cleanupIfIdle();
    };
  }

  /** Is this event coming from Rowlio's own UI? */
  ownsEvent(event: Event): boolean {
    if (!this.host) return false;
    return event.composedPath().includes(this.host);
  }

  setBoxes(group: string, elements: Element[], kind: BoxKind): void {
    if (elements.length === 0) {
      this.clearBoxes(group);
      return;
    }
    this.ensure();
    this.groups.set(group, { elements, kind });
    this.listen(true);
    this.schedule();
  }

  clearBoxes(group?: string): void {
    if (group) this.groups.delete(group);
    else this.groups.clear();
    if (this.groups.size === 0) this.listen(false);
    this.schedule();
    this.cleanupIfIdle();
  }

  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('scroll', this.onViewportChange, { capture: true, passive: true } as AddEventListenerOptions);
    window[method]('resize', this.onViewportChange, { passive: true } as AddEventListenerOptions);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const layer = this.boxLayer;
    if (!layer) return;
    const fragment = document.createDocumentFragment();
    const width = window.innerWidth;
    const height = window.innerHeight;
    let drawn = 0;
    for (const { elements, kind } of this.groups.values()) {
      for (const el of elements) {
        if (drawn >= MAX_BOXES) break;
        if (!el.isConnected) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width) continue;
        const box = document.createElement('div');
        box.className = `box box-${kind}`;
        box.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
        box.style.width = `${Math.round(rect.width)}px`;
        box.style.height = `${Math.round(rect.height)}px`;
        fragment.append(box);
        drawn++;
      }
    }
    layer.replaceChildren(fragment);
  }

  /** Briefly outline an element (used by "show on page"). */
  flash(el: Element, ms = 2200): void {
    const key = `flash-${Date.now()}`;
    this.setBoxes(key, [el], 'flash');
    setTimeout(() => this.clearBoxes(key), ms);
  }

  private cleanupIfIdle(): void {
    if (!this.host) return;
    if (this.groups.size > 0) return;
    if (this.uiLayer && this.uiLayer.childElementCount > 0) return;
    this.host.remove();
    this.host = null;
    this.root = null;
    this.boxLayer = null;
    this.uiLayer = null;
  }
}

export const overlay = new Overlay();

// ---- HUD: small status pill shown during long runs ------------------------------------

interface HudOptions {
  text: string;
  detail?: string;
  canStop: boolean;
  onStop?: () => void;
  onBack?: () => void;
  stopLabel: string;
  backLabel?: string;
}

class Hud {
  private node: HTMLElement | null = null;
  private unmount: (() => void) | null = null;
  private textEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;

  show(options: HudOptions): void {
    this.hide();
    this.textEl = h('span', { class: 'hud-text' }, options.text);
    this.detailEl = h('span', { class: 'hud-detail' }, options.detail ?? '');
    const buttons: Child[] = [];
    if (options.onBack && options.backLabel) {
      buttons.push(h('button', { class: 'btn btn-ghost', type: 'button', onClick: guard(options.onBack) }, options.backLabel));
    }
    if (options.canStop && options.onStop) {
      buttons.push(h('button', { class: 'btn btn-danger', type: 'button', 'data-rowlio': 'hud-stop', onClick: guard(options.onStop) }, options.stopLabel));
    }
    this.node = h(
      'div',
      { class: 'hud', role: 'status', 'aria-live': 'polite', 'data-rowlio': 'hud' },
      h('span', { class: 'hud-brand' }, brand.name),
      this.textEl,
      this.detailEl,
      ...buttons,
    );
    this.unmount = overlay.mount(this.node);
  }

  update(text: string, detail?: string): void {
    if (this.textEl) this.textEl.textContent = text;
    if (this.detailEl) this.detailEl.textContent = detail ?? '';
  }

  hide(): void {
    this.unmount?.();
    this.unmount = null;
    this.node = null;
    this.textEl = null;
    this.detailEl = null;
  }

  get visible(): boolean {
    return this.node !== null;
  }
}

/** Only react to genuine user input, never to events synthesised by page scripts. */
export function guard(handler: (event: Event) => void): (event: Event) => void {
  return (event: Event) => {
    if (!event.isTrusted && !IS_E2E) return;
    handler(event);
  };
}

export const hud = new Hud();
