// Incoming messages for the workspace: events from the connected page's content script,
// and "bind to this tab" requests from the service worker.
import {
  isEventMessage,
  isInternalMessage,
  type BindWorkspaceMessage,
  type ContentEvents,
  type EventType,
} from '@/messaging/protocol';
import { useTarget } from '@/app/stores/target';

type Listener<T extends EventType> = (payload: ContentEvents[T]) => void;

const listeners = new Map<EventType, Set<Listener<EventType>>>();
let bindHandler: ((message: BindWorkspaceMessage) => void) | null = null;

export function onContentEvent<T extends EventType>(type: T, listener: Listener<T>): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(listener as Listener<EventType>);
  return () => {
    set!.delete(listener as Listener<EventType>);
  };
}

export function onBindRequest(handler: (message: BindWorkspaceMessage) => void): void {
  bindHandler = handler;
}

export function initMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Messages must come from this extension.
    if (sender.id !== chrome.runtime.id) return false;

    if (isEventMessage(message)) {
      // Page events are only accepted from the tab the workspace is connected to.
      if (!sender.tab || sender.tab.id !== useTarget.getState().tabId) return false;
      const set = listeners.get(message.event);
      if (set) for (const listener of Array.from(set)) listener(message.payload);
      return false;
    }

    if (isInternalMessage(message) && message.internal === 'bind-workspace') {
      // Bind requests come from the service worker, never from a web page's content script.
      if (sender.tab) return false;
      if (typeof message.tabId !== 'number') return false;
      bindHandler?.(message);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
}
