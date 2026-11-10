// The message contract between extension pages (popup, workspace, service worker) and
// the content script. One file so both sides stay in sync.
//
//  • Requests:  chrome.tabs.sendMessage(tabId, { rowlio: 1, type, payload }) → Reply
//  • Jobs:      chrome.tabs.connect(tabId, { name: JOB_PORT }) for anything that returns
//               a dataset (streams rows in chunks, reports progress, can be cancelled)
//  • Events:    chrome.runtime.sendMessage({ rowlio: 1, event, payload }) from the page
import type {
  ExtractKind,
  ExtractSpec,
  ExtractionMethod,
  ExtractionRule,
  NextControlInfo,
  PageScan,
  PaginationSettings,
  PatternCandidate,
  ScrollProgress,
  SelectorTestResult,
  SelectorType,
  StopReason,
  TableOptions,
  TableSummary,
} from '@/types';

export const PROTOCOL = 1;
export const JOB_PORT = 'rowlio-job';

export interface ContentRequests {
  ping: { req: undefined; res: { version: string; url: string; title: string } };
  scan: { req: undefined; res: PageScan };
  'tables:list': { req: { options: TableOptions; previewRows: number }; res: TableSummary[] };
  'tables:highlight': { req: { index: number }; res: { found: boolean } };
  'tables:watch': { req: { enabled: boolean }; res: undefined };
  'selector:test': {
    req: {
      selector: string;
      selectorType: SelectorType;
      extract?: ExtractKind;
      attribute?: string;
      limit: number;
      rowSelector?: string;
      rowSelectorType?: SelectorType;
    };
    res: SelectorTestResult;
  };
  'highlight:show': {
    req: { selector: string; selectorType: SelectorType; rowSelector?: string; rowSelectorType?: SelectorType; label?: string };
    res: { count: number };
  };
  'highlight:clear': { req: undefined; res: undefined };
  'rule:preview': {
    req: { rule: ExtractionRule; limit: number };
    res: { columns: string[]; rows: string[][]; warnings: string[]; totalRows: number };
  };
  'patterns:detect': { req: { limit: number }; res: PatternCandidate[] };
  'patterns:build': { req: { selector: string }; res: { rule: ExtractionRule; count: number } };
  'picker:start': { req: { mode: 'records' | 'element'; purpose?: string }; res: undefined };
  'picker:stop': { req: undefined; res: undefined };
  'pagination:detect': { req: { nextSelector: string }; res: NextControlInfo };
  /** Finds the next control, replies, then activates it a moment later. */
  'pagination:advance': { req: { nextSelector: string; spec: ExtractSpec }; res: NextControlInfo };
  /** After advance without a navigation: wait for the content to change in place. */
  'pagination:await-change': { req: { timeoutMs: number }; res: { changed: boolean } };
  'page:settle': { req: { quietMs: number; timeoutMs: number }; res: { settled: boolean } };
  'hud:show': { req: { text: string; detail?: string; canStop: boolean }; res: undefined };
  'hud:hide': { req: undefined; res: undefined };
}

export type RequestType = keyof ContentRequests;

export interface RequestMessage<T extends RequestType = RequestType> {
  rowlio: typeof PROTOCOL;
  type: T;
  payload: ContentRequests[T]['req'];
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: { message: string; code?: string } };

/** Messages sent by the content script on its own initiative. */
export interface ContentEvents {
  'picker:done': { mode: 'records'; rule: ExtractionRule; count: number; url: string };
  'picker:element': { mode: 'element'; purpose: string; selector: string; text: string; url: string };
  'picker:cancelled': { mode: 'records' | 'element' };
  'tables:changed': { fingerprint: string };
  /** The user pressed Stop on the in-page progress indicator. */
  'hud:stop': undefined;
  /** The user pressed "Back to Rowlio" on the in-page indicator. */
  'hud:back': undefined;
}

export type EventType = keyof ContentEvents;

export interface EventMessage<T extends EventType = EventType> {
  rowlio: typeof PROTOCOL;
  event: T;
  payload: ContentEvents[T];
}

export function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { rowlio?: unknown }).rowlio === PROTOCOL &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export function isEventMessage(value: unknown): value is EventMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { rowlio?: unknown }).rowlio === PROTOCOL &&
    typeof (value as { event?: unknown }).event === 'string'
  );
}

// ---- Jobs (port based) -------------------------------------------------------------

export type JobStart =
  | { type: 'start'; job: 'extract'; spec: ExtractSpec }
  | { type: 'start'; job: 'scroll'; spec: ExtractSpec; settings: PaginationSettings };

export type JobClientMessage = JobStart | { type: 'cancel' };

export interface JobDatasetHeader {
  key: string;
  name: string;
  columns: string[];
  warnings: string[];
  method: ExtractionMethod;
  detail?: string;
  rowCount: number;
}

export interface JobSummary {
  reason: StopReason;
  scrolls?: number;
  duplicates?: number;
  elapsedMs?: number;
}

export type JobServerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'scroll-progress'; progress: ScrollProgress }
  | { type: 'dataset'; header: JobDatasetHeader }
  | { type: 'rows'; key: string; rows: string[][] }
  | { type: 'done'; summary: JobSummary }
  | { type: 'error'; message: string; cancelled: boolean };

// ---- Extension-internal messages (popup / workspace / service worker) ---------------

export type WorkspaceIntent =
  | { kind: 'none' }
  | { kind: 'tables'; extractAll: boolean }
  | { kind: 'picker' }
  | { kind: 'links' }
  | { kind: 'images' }
  | { kind: 'page'; path: string };

export interface OpenWorkspaceMessage {
  rowlio: typeof PROTOCOL;
  internal: 'open-workspace';
  tabId: number;
  url: string;
  title: string;
  intent: WorkspaceIntent;
}

export interface BindWorkspaceMessage {
  rowlio: typeof PROTOCOL;
  internal: 'bind-workspace';
  tabId: number;
  url: string;
  title: string;
  intent: WorkspaceIntent;
}

export type InternalMessage = OpenWorkspaceMessage | BindWorkspaceMessage;

export function isInternalMessage(value: unknown): value is InternalMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { rowlio?: unknown }).rowlio === PROTOCOL &&
    typeof (value as { internal?: unknown }).internal === 'string'
  );
}
