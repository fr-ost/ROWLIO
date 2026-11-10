import type { ExtractSpec, PaginationSettings } from './extraction';
import type { Dataset } from './data';

export interface Recipe {
  id: string;
  name: string;
  description: string;
  /** Glob-style pattern (`*` wildcard) of pages this recipe is meant for. */
  urlPattern: string;
  /** The page the recipe was created on (for reference only). */
  sourceUrl: string;
  /** Extraction method + selectors / rules / field definitions / options. */
  spec: ExtractSpec;
  /** Pagination settings, or null when the recipe extracts a single page. */
  pagination: PaginationSettings | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  /** Free-form folder name used to organise projects. Empty = no folder. */
  folder: string;
  notes: string;
  sourceUrl: string;
  sourceTitle: string;
  datasetCount: number;
  rowCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredDataset {
  id: string;
  projectId: string;
  order: number;
  dataset: Dataset;
}

/** Portable project file (export / import). */
export interface ProjectFile {
  format: 'rowlio-project';
  version: 1;
  exportedAt: number;
  project: ProjectMeta;
  datasets: Dataset[];
}

export interface RecipeFile {
  format: 'rowlio-recipes';
  version: 1;
  exportedAt: number;
  recipes: Recipe[];
}
