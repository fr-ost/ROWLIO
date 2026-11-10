// Rowlio content script.
//
// Injected ON DEMAND with chrome.scripting.executeScript, only into the tab the user
// invoked Rowlio on. It never runs by itself: every action below is a response to a
// request from Rowlio's own popup / workspace, and nothing leaves the browser.
import type { ExtractSpec } from '@/types';
import { isExtractSpec, isExtractionRule, isObject, isTableOptions } from '@/types/guards';
import { APP_VERSION, brand } from '@/config/brand';
import { t } from '@/i18n';
import { Pacer } from '@/utils/async';
import { isElement } from '@/extraction/dom';
import { contentSignature, scanPage } from '@/extraction/engine';
import { buildRuleForSelector, detectPatterns } from '@/extraction/patterns';
import { extractByRule, queryPage, queryWithin, testSelector, validateSelector } from '@/extraction/selectors';
import { collectTables, listTables, tablesFingerprint } from '@/extraction/tables';
import { activateNextControl, findNextControl } from '@/pagination/nextControl';
import { waitForChange, waitForDomQuiet } from '@/pagination/settle';
import {
  PROTOCOL,
  isRequestMessage,
  type ContentEvents,
  type ContentRequests,
  type EventType,
  type Reply,
  type RequestType,
} from '@/messaging/protocol';
import { registerJobHandler } from './jobs';
import { hud, overlay } from './overlay';
import { picker } from './picker';

function emit<T extends EventType>(event: T, payload: ContentEvents[T]): void {
  try {
    void chrome.runtime.sendMessage({ rowlio: PROTOCOL, event, payload }).catch(() => undefined);
  } catch {
    /* extension was reloaded or removed: nothing to notify */
  }
}

const isStr = (value: unknown, max = 4000): value is string => typeof value === 'string' && value.length <= max;
const isSelectorType = (value: unknown): value is 'css' | 'xpath' => value === 'css' || value === 'xpath';
const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

function invalid(): never {
  throw new Error(t('The request is not valid.'));
}

// ---- dynamic table watching -------------------------------------------------------------

let tableObserver: MutationObserver | null = null;
let tableTimer: ReturnType<typeof setTimeout> | undefined;
let lastFingerprint = '';

function watchTables(enabled: boolean): void {
  tableObserver?.disconnect();
  tableObserver = null;
  clearTimeout(tableTimer);
  if (!enabled) return;
  lastFingerprint = tablesFingerprint(document);
  tableObserver = new MutationObserver(() => {
    clearTimeout(tableTimer);
    tableTimer = setTimeout(() => {
      const fingerprint = tablesFingerprint(document);
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        emit('tables:changed', { fingerprint });
      }
    }, 600);
  });
  tableObserver.observe(document.documentElement, { childList: true, subtree: true });
}

// ---- pagination state ----------------------------------------------------------------------

let pendingAdvance: { spec: ExtractSpec; before: string } | null = null;

// ---- request handlers ------------------------------------------------------------------------

type Handler<T extends RequestType> = (payload: unknown) => Promise<ContentRequests[T]['res']> | ContentRequests[T]['res'];

const handlers: { [T in RequestType]: Handler<T> } = {
  ping: () => ({ version: APP_VERSION, url: location.href, title: document.title }),

  scan: () => scanPage(document),

  'tables:list': async (payload) => {
    if (!isObject(payload) || !isTableOptions(payload.options)) invalid();
    return listTables(document, payload.options, clampInt(payload.previewRows, 1, 50, 5), new Pacer());
  },

  'tables:highlight': (payload) => {
    if (!isObject(payload)) invalid();
    const handle = collectTables(document)[clampInt(payload.index, 0, 1e6, 0)];
    if (!handle) return { found: false };
    try {
      handle.element.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    } catch {
      handle.element.scrollIntoView();
    }
    overlay.flash(handle.element);
    return { found: true };
  },

  'tables:watch': (payload) => {
    if (!isObject(payload)) invalid();
    watchTables(payload.enabled === true);
    return undefined;
  },

  'selector:test': (payload) => {
    if (!isObject(payload) || !isStr(payload.selector) || !isSelectorType(payload.selectorType)) invalid();
    return testSelector(document, {
      selector: payload.selector,
      selectorType: payload.selectorType,
      extract: payload.extract as never,
      attribute: isStr(payload.attribute, 200) ? payload.attribute : undefined,
      limit: clampInt(payload.limit, 1, 100, 10),
      rowSelector: isStr(payload.rowSelector) ? payload.rowSelector : undefined,
      rowSelectorType: isSelectorType(payload.rowSelectorType) ? payload.rowSelectorType : undefined,
    });
  },

  'highlight:show': (payload) => {
    if (!isObject(payload) || !isStr(payload.selector) || !isSelectorType(payload.selectorType)) invalid();
    const rowSelector = isStr(payload.rowSelector) ? payload.rowSelector.trim() : '';
    const rowType = isSelectorType(payload.rowSelectorType) ? payload.rowSelectorType : 'css';
    let elements: Element[] = [];
    if (rowSelector) {
      const rowError = validateSelector(rowSelector, rowType, document);
      if (rowError) throw new Error(rowError);
      const rows = queryPage(document, rowSelector, rowType).nodes.filter(isElement);
      if (payload.selector.trim()) {
        for (const row of rows) {
          for (const node of queryWithin(row, payload.selector, payload.selectorType, document).nodes) {
            const el = isElement(node) ? node : node.nodeType === 2 ? (node as Attr).ownerElement : node.parentElement;
            if (el) elements.push(el);
          }
        }
      } else {
        elements = rows;
      }
    } else {
      const error = validateSelector(payload.selector, payload.selectorType, document);
      if (error) throw new Error(error);
      for (const node of queryPage(document, payload.selector, payload.selectorType).nodes) {
        const el = isElement(node) ? node : node.nodeType === 2 ? (node as Attr).ownerElement : node.parentElement;
        if (el) elements.push(el);
      }
    }
    overlay.setBoxes('matches', elements, 'match');
    if (elements[0]) {
      try {
        elements[0].scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      } catch {
        elements[0].scrollIntoView();
      }
    }
    const label = isStr(payload.label, 200) && payload.label ? payload.label : t('{count} matches highlighted', { count: elements.length });
    hud.show({
      text: label,
      canStop: false,
      stopLabel: t('Stop'),
      backLabel: t('Back to {name}', { name: brand.name }),
      onBack: () => {
        overlay.clearBoxes('matches');
        hud.hide();
        emit('hud:back', undefined);
      },
    });
    return { count: elements.length };
  },

  'highlight:clear': () => {
    overlay.clearBoxes('matches');
    hud.hide();
    return undefined;
  },

  'rule:preview': async (payload) => {
    if (!isObject(payload) || !isExtractionRule(payload.rule)) invalid();
    const result = await extractByRule(document, payload.rule, { limit: clampInt(payload.limit, 1, 500, 20), pacer: new Pacer() });
    return { columns: result.columns, rows: result.rows, warnings: result.warnings, totalRows: result.totalRows };
  },

  'patterns:detect': (payload) => {
    if (!isObject(payload)) invalid();
    return detectPatterns(document, clampInt(payload.limit, 1, 50, 10));
  },

  'patterns:build': (payload) => {
    if (!isObject(payload) || !isStr(payload.selector)) invalid();
    const error = validateSelector(payload.selector, 'css', document);
    if (error) throw new Error(error);
    const rule = buildRuleForSelector(document, payload.selector);
    return { rule, count: queryPage(document, payload.selector, 'css').nodes.length };
  },

  'picker:start': (payload) => {
    if (!isObject(payload)) invalid();
    const mode = payload.mode === 'element' ? 'element' : 'records';
    const purpose = isStr(payload.purpose, 100) ? payload.purpose : '';
    overlay.clearBoxes('matches');
    hud.hide();
    picker.start(mode, purpose, {
      onRecords: (rule, count) => emit('picker:done', { mode: 'records', rule, count, url: location.href }),
      onElement: (selector, text, purposeLabel) => emit('picker:element', { mode: 'element', purpose: purposeLabel, selector, text, url: location.href }),
      onCancel: (cancelledMode) => emit('picker:cancelled', { mode: cancelledMode }),
    });
    return undefined;
  },

  'picker:stop': () => {
    picker.stop(false);
    return undefined;
  },

  'pagination:detect': (payload) => {
    if (!isObject(payload) || !isStr(payload.nextSelector)) invalid();
    return findNextControl(document, payload.nextSelector).info;
  },

  'pagination:advance': (payload) => {
    if (!isObject(payload) || !isStr(payload.nextSelector) || !isExtractSpec(payload.spec)) invalid();
    const control = findNextControl(document, payload.nextSelector);
    if (!control.info.found || control.info.disabled) return control.info;
    pendingAdvance = { spec: payload.spec, before: contentSignature(document, payload.spec) };
    // Reply first: activating the control may unload this page before a reply could be sent.
    setTimeout(() => activateNextControl(control, window), 40);
    return control.info;
  },

  'pagination:await-change': async (payload) => {
    if (!isObject(payload)) invalid();
    const pending = pendingAdvance;
    if (!pending) return { changed: false };
    const changed = await waitForChange(
      document,
      () => contentSignature(document, pending.spec),
      pending.before,
      clampInt(payload.timeoutMs, 500, 120_000, 15_000),
    );
    pendingAdvance = null;
    return { changed };
  },

  'page:settle': async (payload) => {
    if (!isObject(payload)) invalid();
    const { settled } = await waitForDomQuiet(document, clampInt(payload.quietMs, 50, 10_000, 500), clampInt(payload.timeoutMs, 100, 120_000, 8000));
    return { settled };
  },

  'hud:show': (payload) => {
    if (!isObject(payload) || !isStr(payload.text, 300)) invalid();
    const detail = isStr(payload.detail, 300) ? payload.detail : '';
    if (hud.visible) {
      hud.update(payload.text, detail);
    } else {
      hud.show({
        text: payload.text,
        detail,
        canStop: payload.canStop === true,
        stopLabel: t('Stop'),
        onStop: () => emit('hud:stop', undefined),
      });
    }
    return undefined;
  },

  'hud:hide': () => {
    hud.hide();
    return undefined;
  },
};

/** Wire up the listeners. Returns a function that removes them again. */
function install(): () => void {
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (reply: Reply<unknown>) => void): boolean => {
    // Accept requests only from Rowlio's own extension contexts.
    if (sender.id !== chrome.runtime.id) return false;
    if (!isRequestMessage(message)) return false;
    const handler = handlers[message.type] as Handler<RequestType> | undefined;
    if (!handler) {
      sendResponse({ ok: false, error: { message: t('Unknown request.'), code: 'unknown-request' } });
      return false;
    }
    Promise.resolve()
      .then(() => handler(message.payload))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (error: unknown) => sendResponse({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } }),
      );
    return true; // async reply
  };
  chrome.runtime.onMessage.addListener(onMessage);
  const unregisterJobs = registerJobHandler();
  return () => {
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
      unregisterJobs();
    } catch {
      /* the previous extension context is gone */
    }
    picker.stop(false);
    hud.hide();
    overlay.clearBoxes();
    watchTables(false);
  };
}

// Re-injection (after an extension update, or a manual retry) replaces the previous
// instance instead of stacking a second set of listeners on top of it.
const scope = window as Window & { __rowlioDispose?: () => void };
try {
  scope.__rowlioDispose?.();
} catch {
  /* ignore */
}
scope.__rowlioDispose = install();
