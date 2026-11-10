// Core tabular data model shared by every layer (content script, workspace, storage, export).

export type ExtractionMethod =
  | 'table'
  | 'visual'
  | 'selectors'
  | 'links'
  | 'images'
  | 'lists'
  | 'headings'
  | 'breadcrumbs'
  | 'metadata'
  | 'jsonld'
  | 'microdata'
  | 'import';

/** A column has a stable id (used for widths, selection, transforms) and a display name. */
export interface Column {
  id: string;
  name: string;
}

/** A row has a stable numeric id; cells are aligned with the columns array by index. */
export interface Row {
  id: number;
  cells: string[];
}

/** The pure data part of a dataset – what transformations operate on. */
export interface TableData {
  columns: Column[];
  rows: Row[];
}

export interface DatasetSource {
  url: string;
  title: string;
  extractedAt: number;
  method: ExtractionMethod;
  /** Human readable detail, e.g. "Table 2" or the row selector. */
  detail?: string;
  /** Number of pages / scroll steps that contributed, when paginated. */
  pages?: number;
}

export interface Dataset extends TableData {
  id: string;
  name: string;
  source: DatasetSource;
  /** Extraction warnings (incomplete data, mismatched counts, …). Never dropped silently. */
  warnings: string[];
}

/** What the content script returns: plain strings, no ids. */
export interface RawDataset {
  /** Stable key within one extraction job (used to merge the same dataset across pages). */
  key: string;
  name: string;
  columns: string[];
  rows: string[][];
  warnings: string[];
  method: ExtractionMethod;
  detail?: string;
}

export type ColumnType = 'text' | 'number' | 'date' | 'url' | 'email' | 'boolean' | 'empty' | 'mixed';

export interface ColumnStats {
  type: ColumnType;
  empty: number;
  nonEmpty: number;
  distinct: number;
}
