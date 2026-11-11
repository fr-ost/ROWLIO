import type { ImageOptions, LinkOptions, ListOptions, MetaOptions, PaginationSettings, TableOptions } from './extraction';

export interface ExportSettings {
  csvDelimiter: ',' | ';';
  /** Prepend a UTF-8 byte order mark so Excel detects UTF-8 (needed for Bengali etc.). */
  csvBom: boolean;
  /** Neutralise cells that spreadsheet apps would execute as formulas. */
  formulaGuard: boolean;
  jsonPretty: boolean;
  /** Write plain numbers / ISO dates as typed XLSX cells. */
  xlsxTypes: boolean;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  onboardingDone: boolean;
  /** Interface sound effects (synthesised locally, no audio files). */
  sound: boolean;
  /** Decorative motion. Off = calm interface; the OS "reduce motion" setting always wins. */
  animations: boolean;
  export: ExportSettings;
  tables: TableOptions;
  pagination: PaginationSettings;
}

export const DEFAULT_TABLE_OPTIONS: TableOptions = {
  includeHidden: false,
  fillMerged: true,
  headerMode: 'auto',
};

export const DEFAULT_LINK_OPTIONS: LinkOptions = {
  scope: 'all',
  containerSelector: '',
  textContains: '',
  matchSelector: '',
  dedupe: false,
};

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  containerSelector: '',
  urlContains: '',
  minWidth: 0,
  minHeight: 0,
  includeBackgrounds: false,
  dedupe: true,
};

export const DEFAULT_LIST_OPTIONS: ListOptions = {
  ordered: true,
  unordered: true,
  definition: true,
  containerSelector: '',
  minItems: 1,
};

export const DEFAULT_META_OPTIONS: MetaOptions = {
  basic: true,
  openGraph: true,
  twitter: true,
  otherMeta: true,
  linkTags: true,
};

export const DEFAULT_PAGINATION: PaginationSettings = {
  mode: 'next',
  nextSelector: '',
  maxPages: 10,
  maxRecords: 0,
  delayMs: 1000,
  skipDuplicates: true,
  retries: 2,
  maxScrolls: 30,
  maxDurationSec: 120,
  scrollContainer: '',
  loadMoreSelector: '',
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  onboardingDone: false,
  sound: true,
  animations: true,
  export: {
    csvDelimiter: ',',
    csvBom: true,
    formulaGuard: true,
    jsonPretty: true,
    xlsxTypes: true,
  },
  tables: DEFAULT_TABLE_OPTIONS,
  pagination: DEFAULT_PAGINATION,
};
