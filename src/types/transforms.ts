import type { TableData } from './data';

/**
 * Every data-cleaning operation is a serialisable description, so it can run on the main
 * thread or inside the data worker, and so future "transformation workflows" can replay it.
 * `columns` are column ids; undefined / omitted means "all columns".
 */
export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence';

export type TransformOp =
  | { type: 'trim'; columns?: string[] }
  | { type: 'normalizeWhitespace'; columns?: string[] }
  | { type: 'removeEmptyRows' }
  | { type: 'removeEmptyColumns' }
  | { type: 'removeDuplicates'; columns?: string[] }
  | { type: 'convertCase'; columns?: string[]; mode: CaseMode }
  | { type: 'extractNumbers'; column: string; mode: 'first' | 'all'; target: 'replace' | 'new' }
  | { type: 'parseDates'; column: string; target: 'replace' | 'new' }
  | { type: 'normalizeUrls'; column: string; baseUrl?: string; stripTracking: boolean; stripHash: boolean }
  | {
      type: 'findReplace';
      columns?: string[];
      find: string;
      replace: string;
      regex: boolean;
      caseSensitive: boolean;
      wholeCell: boolean;
    }
  | { type: 'splitColumn'; column: string; delimiter: string; keepOriginal: boolean }
  | { type: 'combineColumns'; columns: string[]; separator: string; name: string; removeSources: boolean }
  | { type: 'keepRows'; column: string; condition: 'empty' | 'nonEmpty' }
  | { type: 'removeRows'; rowIds: number[] }
  | { type: 'removeColumns'; columns: string[] }
  | { type: 'renameColumn'; column: string; name: string }
  | { type: 'moveColumn'; column: string; toIndex: number }
  | { type: 'editCell'; rowId: number; column: string; value: string }
  | { type: 'promoteHeader' }
  | { type: 'demoteHeader' }
  /** First regex match (or its first capture group) of each cell. */
  | { type: 'extractRegex'; column: string; pattern: string; caseSensitive: boolean; target: 'replace' | 'new' }
  /** Copy the value above into empty cells. */
  | { type: 'fillDown'; columns?: string[] }
  | { type: 'addColumn'; name: string; fill: 'empty' | 'rowNumber' | 'value'; value?: string }
  | { type: 'addRow' };

export interface TransformResult {
  data: TableData;
  /** Number of cells / rows / columns actually changed. 0 means the data is untouched. */
  changed: number;
  /** Honest, human readable outcome, e.g. "Removed 12 duplicate rows". */
  summary: string;
}

export type FilterCondition =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'empty'
  | 'nonEmpty'
  | 'regex';

export interface ColumnFilter {
  column: string;
  condition: FilterCondition;
  value: string;
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

export interface ViewSpec {
  search: string;
  filters: ColumnFilter[];
  sort: SortSpec | null;
  /** Show only rows that are exact duplicates of an earlier row. */
  duplicatesOnly?: boolean;
}

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'jsonl' | 'xlsx' | 'markdown' | 'html';

export interface ExportOptions {
  format: ExportFormat;
  /** CSV only. */
  delimiter: ',' | ';';
  bom: boolean;
  formulaGuard: boolean;
  jsonPretty: boolean;
  xlsxTypes: boolean;
  includeHeader: boolean;
}
