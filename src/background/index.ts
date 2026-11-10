// Rowlio service worker.
//
// Deliberately small and stateless: it opens / focuses the workspace and handles keyboard
// shortcuts. It performs no extraction, makes no network requests, and does nothing in
// the background on its own – every code path starts from an explicit user action.
import {
  PROTOCOL,
  isInternalMessage,
  type BindWorkspaceMessage,
  type OpenWorkspaceMessage,
  type WorkspaceIntent,
} from '@/messaging/protocol';

const APP_PAGE = 'app.html';

interface WorkspaceTarget {
  tabId: number;
  url: string;
  title: string;
  intent: WorkspaceIntent;
}

async function findWorkspaceTab(): Promise<{ tabId: number; windowId: number } | null> {
  const prefix = chrome.runtime.getURL(APP_PAGE);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
  const context = contexts.find((c) => c.tabId >= 0 && typeof c.documentUrl === 'string' && c.documentUrl.startsWith(prefix));
  return context ? { tabId: context.tabId, windowId: context.windowId } : null;
}

async function openWorkspace(target: WorkspaceTarget): Promise<void> {
  // The visual selector needs the page in front, so the workspace stays in the background.
  const focusWorkspace = target.intent.kind !== 'picker';
  const existing = await findWorkspaceTab();
  if (existing) {
    const bind: BindWorkspaceMessage = { rowlio: PROTOCOL, internal: 'bind-workspace', ...target };
    try {
      await chrome.runtime.sendMessage(bind);
      if (focusWorkspace) {
        await chrome.tabs.update(existing.tabId, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    } catch {
      // The workspace tab is not listening (still loading or crashed): open a fresh one.
    }
  }
  const params = new URLSearchParams({
    tab: String(target.tabId),
    url: target.url,
    title: target.title,
    intent: JSON.stringify(target.intent),
  });
  let index: number | undefined;
  try {
    index = (await chrome.tabs.get(target.tabId)).index + 1;
  } catch {
    index = undefined;
  }
  await chrome.tabs.create({
    url: `${chrome.runtime.getURL(APP_PAGE)}?${params.toString()}`,
    active: focusWorkspace,
    openerTabId: target.tabId,
    index,
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    // First run: show the workspace, which starts the short onboarding.
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${APP_PAGE}#/`) });
  }
});

// Keyboard shortcuts. A command is a user gesture on the active tab, so it grants
// activeTab for that tab just like clicking the toolbar icon does.
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab || tab.id === undefined) return;
  const base = { tabId: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
  if (command === 'open-workspace') void openWorkspace({ ...base, intent: { kind: 'none' } });
  if (command === 'start-picker') void openWorkspace({ ...base, intent: { kind: 'picker' } });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only Rowlio's own extension pages may ask for the workspace (never a web page, and
  // not the content script either: it has no business opening tabs).
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  if (!isInternalMessage(message) || message.internal !== 'open-workspace') return false;
  const request = message as OpenWorkspaceMessage;
  if (typeof request.tabId !== 'number' || typeof request.url !== 'string' || typeof request.title !== 'string') return false;
  openWorkspace({ tabId: request.tabId, url: request.url, title: request.title, intent: request.intent }).then(
    () => sendResponse({ ok: true }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});
