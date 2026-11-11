// Runtime validation for values that cross a trust boundary: extension messages,
// imported recipe / project files, and anything read back from storage.
// Hand-written (no schema library) so the content script stays small.
import type {
  ExtractSpec,
  ExtractionRule,
  FieldRule,
  ImageOptions,
  LinkOptions,
  ListOptions,
  MetaOptions,
  PaginationSettings,
  TableOptions,
} from './extraction';
import type { Dataset } from './data';
import type { Recipe } from './recipes';

const MAX_SELECTOR_LENGTH = 4000;
const MAX_FIELDS = 500;

type Obj = Record<string, unknown>;

export function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isStr = (v: unknown, max = MAX_SELECTOR_LENGTH): v is string => typeof v === 'string' && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isSelectorType = (v: unknown): v is 'css' | 'xpath' => v === 'css' || v === 'xpath';

export function isFieldRule(value: unknown): value is FieldRule {
  if (!isObject(value)) return false;
  return (
    isStr(value.id, 200) &&
    isStr(value.name, 500) &&
    isStr(value.selector) &&
    isSelectorType(value.selectorType) &&
    (value.extract === 'text' ||
      value.extract === 'html' ||
      value.extract === 'href' ||
      value.extract === 'src' ||
      value.extract === 'attr') &&
    (value.attribute === undefined || isStr(value.attribute, 200)) &&
    (value.multiple === undefined || isBool(value.multiple)) &&
    (value.joinWith === undefined || isStr(value.joinWith, 50)) &&
    (value.detectedType === undefined || isStr(value.detectedType, 40))
  );
}

export function isExtractionRule(value: unknown): value is ExtractionRule {
  if (!isObject(value)) return false;
  return (
    isStr(value.rowSelector) &&
    isSelectorType(value.rowSelectorType) &&
    Array.isArray(value.fields) &&
    value.fields.length <= MAX_FIELDS &&
    value.fields.every(isFieldRule)
  );
}

export function isTableOptions(value: unknown): value is TableOptions {
  if (!isObject(value)) return false;
  return (
    isBool(value.includeHidden) &&
    isBool(value.fillMerged) &&
    (value.headerMode === 'auto' || value.headerMode === 'first-row' || value.headerMode === 'none')
  );
}

export function isLinkOptions(value: unknown): value is LinkOptions {
  if (!isObject(value)) return false;
  return (
    (value.scope === 'all' || value.scope === 'internal' || value.scope === 'external') &&
    isStr(value.containerSelector) &&
    isStr(value.textContains, 1000) &&
    isStr(value.matchSelector) &&
    isBool(value.dedupe)
  );
}

export function isImageOptions(value: unknown): value is ImageOptions {
  if (!isObject(value)) return false;
  return (
    isStr(value.containerSelector) &&
    isStr(value.urlContains, 1000) &&
    isNum(value.minWidth, 0, 100000) &&
    isNum(value.minHeight, 0, 100000) &&
    isBool(value.includeBackgrounds) &&
    isBool(value.dedupe)
  );
}

export function isListOptions(value: unknown): value is ListOptions {
  if (!isObject(value)) return false;
  return (
    isBool(value.ordered) &&
    isBool(value.unordered) &&
    isBool(value.definition) &&
    isStr(value.containerSelector) &&
    isNum(value.minItems, 0, 1000000)
  );
}

export function isMetaOptions(value: unknown): value is MetaOptions {
  if (!isObject(value)) return false;
  return (
    isBool(value.basic) &&
    isBool(value.openGraph) &&
    isBool(value.twitter) &&
    isBool(value.otherMeta) &&
    isBool(value.linkTags)
  );
}

export function isExtractSpec(value: unknown): value is ExtractSpec {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case 'tables':
      return (
        isTableOptions(value.options) &&
        (value.indexes === 'all' ||
          (Array.isArray(value.indexes) &&
            value.indexes.length <= 10000 &&
            value.indexes.every((i) => Number.isInteger(i) && (i as number) >= 0)))
      );
    case 'rule':
      return (
        isExtractionRule(value.rule) &&
        (value.name === undefined || isStr(value.name, 500)) &&
        (value.method === undefined || value.method === 'visual' || value.method === 'selectors')
      );
    case 'links':
      return isLinkOptions(value.options);
    case 'images':
      return isImageOptions(value.options);
    case 'lists':
      return isListOptions(value.options);
    case 'metadata':
      return isMetaOptions(value.options);
    case 'headings':
    case 'breadcrumbs':
    case 'jsonld':
    case 'microdata':
    case 'contacts':
      return true;
    default:
      return false;
  }
}

export function isPaginationSettings(value: unknown): value is PaginationSettings {
  if (!isObject(value)) return false;
  return (
    (value.mode === 'next' || value.mode === 'scroll') &&
    isStr(value.nextSelector) &&
    isNum(value.maxPages, 1, 1_000_000) &&
    isNum(value.maxRecords, 0) &&
    isNum(value.delayMs, 0, 600_000) &&
    isBool(value.skipDuplicates) &&
    isNum(value.retries, 0, 20) &&
    isNum(value.maxScrolls, 1, 1_000_000) &&
    isNum(value.maxDurationSec, 1, 86_400) &&
    isStr(value.scrollContainer) &&
    isStr(value.loadMoreSelector)
  );
}

export function isRecipe(value: unknown): value is Recipe {
  if (!isObject(value)) return false;
  return (
    isStr(value.id, 200) &&
    isStr(value.name, 500) &&
    isStr(value.description, 5000) &&
    isStr(value.urlPattern, 4000) &&
    isStr(value.sourceUrl, 8000) &&
    isExtractSpec(value.spec) &&
    (value.pagination === null || isPaginationSettings(value.pagination)) &&
    isNum(value.createdAt) &&
    isNum(value.updatedAt)
  );
}

export function isDataset(value: unknown): value is Dataset {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (!Array.isArray(value.columns) || !Array.isArray(value.rows) || !Array.isArray(value.warnings)) return false;
  if (!isObject(value.source) || typeof value.source.url !== 'string') return false;
  const width = value.columns.length;
  for (const column of value.columns) {
    if (!isObject(column) || typeof column.id !== 'string' || typeof column.name !== 'string') return false;
  }
  for (const row of value.rows) {
    if (!isObject(row) || typeof row.id !== 'number' || !Array.isArray(row.cells)) return false;
    if (row.cells.length !== width) return false;
    for (const cell of row.cells) if (typeof cell !== 'string') return false;
  }
  return value.warnings.every((w) => typeof w === 'string');
}
