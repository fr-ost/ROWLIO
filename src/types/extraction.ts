// Extraction rule model: what a user (or the detector) defines, and what the content
// script executes. These types are serialisable – they travel over extension messaging
// and are stored inside recipes.

export type SelectorType = 'css' | 'xpath';

/** What to read from a matched element. */
export type ExtractKind = 'text' | 'html' | 'href' | 'src' | 'attr';

export type FieldType =
  | 'title'
  | 'heading'
  | 'text'
  | 'description'
  | 'price'
  | 'date'
  | 'author'
  | 'category'
  | 'tag'
  | 'rating'
  | 'reviewCount'
  | 'image'
  | 'link'
  | 'email'
  | 'phone'
  | 'address'
  | 'productId'
  | 'availability'
  | 'number'
  | 'unknown';

export interface FieldRule {
  id: string;
  name: string;
  /** Selector relative to the row element. Empty string = the row element itself. */
  selector: string;
  selectorType: SelectorType;
  extract: ExtractKind;
  /** Attribute name when extract === 'attr'. */
  attribute?: string;
  /** Join every match inside the row instead of taking the first one. */
  multiple?: boolean;
  joinWith?: string;
  detectedType?: FieldType;
}

export interface ExtractionRule {
  /**
   * Selector matching one element per record. Empty string = "column mode": every field
   * selector is evaluated against the whole document and matches are zipped by position.
   */
  rowSelector: string;
  rowSelectorType: SelectorType;
  fields: FieldRule[];
}

export interface TableOptions {
  /** Include rows / columns / inline content hidden with CSS or the hidden attribute. */
  includeHidden: boolean;
  /** Repeat the value of a merged (rowspan/colspan) cell into every cell it covers. */
  fillMerged: boolean;
  /** auto: thead or leading all-<th> rows. first-row: force. none: generate Column N. */
  headerMode: 'auto' | 'first-row' | 'none';
}

export interface LinkOptions {
  scope: 'all' | 'internal' | 'external';
  /** Only links inside this container (CSS). */
  containerSelector: string;
  /** Only links whose text contains this (case-insensitive). */
  textContains: string;
  /** Only anchors matching this CSS selector. */
  matchSelector: string;
  dedupe: boolean;
}

export interface ImageOptions {
  containerSelector: string;
  urlContains: string;
  minWidth: number;
  minHeight: number;
  /** Also report CSS background images (slower: inspects computed styles). */
  includeBackgrounds: boolean;
  dedupe: boolean;
}

export interface ListOptions {
  ordered: boolean;
  unordered: boolean;
  definition: boolean;
  containerSelector: string;
  /** Ignore lists with fewer items than this. */
  minItems: number;
}

export interface MetaOptions {
  basic: boolean;
  openGraph: boolean;
  twitter: boolean;
  otherMeta: boolean;
  linkTags: boolean;
}

/** One unit of extraction work. `kind` is the recipe's "extraction method". */
export type ExtractSpec =
  | { kind: 'tables'; indexes: number[] | 'all'; options: TableOptions }
  | { kind: 'rule'; rule: ExtractionRule; name?: string; method?: 'visual' | 'selectors' }
  | { kind: 'links'; options: LinkOptions }
  | { kind: 'images'; options: ImageOptions }
  | { kind: 'lists'; options: ListOptions }
  | { kind: 'headings' }
  | { kind: 'breadcrumbs' }
  | { kind: 'metadata'; options: MetaOptions }
  | { kind: 'jsonld' }
  | { kind: 'microdata' }
  | { kind: 'contacts' };

export type ExtractKindName = ExtractSpec['kind'];

export interface TableSummary {
  index: number;
  caption: string;
  kind: 'table' | 'aria-grid';
  rowCount: number;
  /** False when the table is so large that the count was estimated from a sample. */
  rowCountExact: boolean;
  columnCount: number;
  headers: string[];
  preview: string[][];
  warnings: string[];
  hiddenRows: number;
  hiddenColumns: number;
  /** Index of the table this one is nested in, or -1. */
  nestedIn: number;
  hasNested: boolean;
  /** False for presentational / trivially small tables. Still listed, just de-emphasised. */
  isDataTable: boolean;
  inScrollContainer: boolean;
  location: 'document' | 'shadow-dom' | 'iframe';
}

export interface SelectorSample {
  index: number;
  tag: string;
  text: string;
  html: string;
  value: string;
  attributes: [string, string][];
}

export interface SelectorTestResult {
  valid: boolean;
  error?: string;
  /** Matches on the page, or (with a row selector) the number of rows that have a match. */
  count: number;
  /** Total rows matched by the row selector, when one was given. */
  rowCount?: number;
  /** Non-node XPath results (string(), count(), …) come back as a single value. */
  scalar?: string;
  samples: SelectorSample[];
}

export interface PatternCandidate {
  selector: string;
  count: number;
  /** Text of the first few records, for the user to recognise the list. */
  samples: string[];
  score: number;
  /** Rough description such as "24 × article.card". */
  label: string;
}

export interface PageScan {
  url: string;
  title: string;
  dataTables: number;
  allTables: number;
  links: number;
  images: number;
  lists: number;
  headings: number;
  jsonLd: number;
  microdata: number;
  patterns: number;
  hasNextPage: boolean;
}

export interface NextControlInfo {
  found: boolean;
  /** How the control was found. */
  strategy: 'custom-selector' | 'rel-next' | 'text' | 'aria' | 'class' | 'page-number' | 'none';
  /** navigate = has a real URL; click = button / script-driven control. */
  kind: 'navigate' | 'click' | 'none';
  href: string;
  text: string;
  selector: string;
  disabled: boolean;
  currentPage: number | null;
}

export interface PaginationSettings {
  /** next: follow next-page buttons / links / page numbers. scroll: infinite scroll. */
  mode: 'next' | 'scroll';
  /** CSS selector of the next-page control. Empty = detect automatically. */
  nextSelector: string;
  maxPages: number;
  /** 0 = no record cap (the page / scroll cap still bounds the run). */
  maxRecords: number;
  delayMs: number;
  skipDuplicates: boolean;
  /** How many times to retry a failed page before stopping. */
  retries: number;
  maxScrolls: number;
  maxDurationSec: number;
  /** CSS selector of the scrolling element. Empty = the page itself. */
  scrollContainer: string;
  /** Optional "Load more" button to click between scrolls. Empty = none. */
  loadMoreSelector: string;
}

export interface ScrollProgress {
  scrolls: number;
  records: number;
  elapsedMs: number;
  duplicates: number;
}

export type StopReason =
  | 'completed'
  | 'max-pages'
  | 'max-records'
  | 'max-scrolls'
  | 'max-duration'
  | 'no-next'
  | 'next-disabled'
  | 'no-change'
  | 'no-new-records'
  | 'end-of-content'
  | 'cancelled'
  | 'error';
