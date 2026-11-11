// Working datasets (the Data Preview): current data, the untouched original, an undo /
// redo history and view state. Nothing here is persisted until the user saves a project.
import { create } from 'zustand';
import type { Dataset, TableData, TransformOp, TransformResult, ViewSpec } from '@/types';
import { describeOp } from '@/data-processing/transforms';
import { t } from '@/i18n';
import { runTransform } from '@/workers/client';

const HISTORY_LIMIT = 50;

export interface HistoryEntry {
  data: TableData;
  label: string;
}

export interface OpenDataset {
  dataset: Dataset;
  /** The data exactly as extracted (or as loaded from a project). Never mutated. */
  original: TableData;
  past: HistoryEntry[];
  future: HistoryEntry[];
  view: ViewSpec;
  selectedRows: Set<number>;
  selectedColumns: Set<string>;
  widths: Record<string, number>;
}

export interface ProjectRef {
  id: string | null;
  name: string;
  folder: string;
}

interface DataState {
  items: OpenDataset[];
  activeId: string | null;
  project: ProjectRef;
  /** True when there are changes that are not saved in a project. */
  dirty: boolean;
  busy: boolean;
  open(datasets: Dataset[], options?: { replace?: boolean; project?: ProjectRef }): void;
  close(id: string): void;
  closeAll(): void;
  setActive(id: string): void;
  renameDataset(id: string, name: string): void;
  apply(id: string, op: TransformOp): Promise<TransformResult>;
  undo(id: string): string | null;
  redo(id: string): string | null;
  restoreOriginal(id: string): boolean;
  setView(id: string, patch: Partial<ViewSpec>): void;
  setSelectedRows(id: string, rows: Set<number>): void;
  setSelectedColumns(id: string, columns: Set<string>): void;
  setWidth(id: string, column: string, width: number): void;
  markSaved(project: ProjectRef): void;
}

const EMPTY_VIEW: ViewSpec = { search: '', filters: [], sort: null, duplicatesOnly: false };

function wrap(dataset: Dataset): OpenDataset {
  return {
    dataset,
    original: { columns: dataset.columns, rows: dataset.rows },
    past: [],
    future: [],
    view: EMPTY_VIEW,
    selectedRows: new Set(),
    selectedColumns: new Set(),
    widths: {},
  };
}

function withData(item: OpenDataset, data: TableData): OpenDataset {
  // Drop selections / filters that point at rows or columns which no longer exist.
  const columnIds = new Set(data.columns.map((column) => column.id));
  let selectedRows = item.selectedRows;
  if (selectedRows.size) {
    const rowIds = new Set<number>();
    for (const row of data.rows) rowIds.add(row.id);
    selectedRows = new Set(Array.from(selectedRows).filter((id) => rowIds.has(id)));
  }
  const selectedColumns = new Set(Array.from(item.selectedColumns).filter((id) => columnIds.has(id)));
  const view: ViewSpec = {
    ...item.view,
    filters: item.view.filters.filter((filter) => columnIds.has(filter.column)),
    sort: item.view.sort && columnIds.has(item.view.sort.column) ? item.view.sort : null,
  };
  return { ...item, dataset: { ...item.dataset, columns: data.columns, rows: data.rows }, selectedRows, selectedColumns, view };
}

function current(item: OpenDataset): TableData {
  return { columns: item.dataset.columns, rows: item.dataset.rows };
}

export const useData = create<DataState>((set, get) => {
  const update = (id: string, fn: (item: OpenDataset) => OpenDataset, dirty = false) =>
    set((state) => ({
      items: state.items.map((item) => (item.dataset.id === id ? fn(item) : item)),
      dirty: state.dirty || dirty,
    }));
  const find = (id: string) => get().items.find((item) => item.dataset.id === id);

  return {
    items: [],
    activeId: null,
    project: { id: null, name: '', folder: '' },
    dirty: false,
    busy: false,

    open: (datasets, options = {}) => {
      if (datasets.length === 0) return;
      const wrapped = datasets.map(wrap);
      set((state) => ({
        items: options.replace ? wrapped : [...state.items, ...wrapped],
        activeId: wrapped[0].dataset.id,
        project: options.project ?? (options.replace ? { id: null, name: '', folder: '' } : state.project),
        // Loading a saved project is clean; adding fresh extractions is unsaved work.
        dirty: options.project ? false : true,
      }));
    },

    close: (id) =>
      set((state) => {
        const items = state.items.filter((item) => item.dataset.id !== id);
        const activeId = state.activeId === id ? (items[0]?.dataset.id ?? null) : state.activeId;
        return {
          items,
          activeId,
          dirty: items.length === 0 ? false : true,
          project: items.length === 0 ? { id: null, name: '', folder: '' } : state.project,
        };
      }),

    closeAll: () => set({ items: [], activeId: null, dirty: false, project: { id: null, name: '', folder: '' } }),

    setActive: (id) => set({ activeId: id }),

    renameDataset: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      update(id, (item) => ({ ...item, dataset: { ...item.dataset, name: trimmed } }), true);
    },

    apply: async (id, op) => {
      const item = find(id);
      if (!item) throw new Error('This dataset is no longer open.');
      set({ busy: true });
      try {
        const before = current(item);
        const result = await runTransform(before, op);
        if (result.changed > 0 && result.data !== before) {
          update(
            id,
            (latest) => ({
              ...withData(latest, result.data),
              past: [...latest.past, { data: before, label: describeOp(op) }].slice(-HISTORY_LIMIT),
              future: [],
            }),
            true,
          );
        }
        return result;
      } finally {
        set({ busy: false });
      }
    },

    undo: (id) => {
      const item = find(id);
      if (!item || item.past.length === 0) return null;
      const entry = item.past[item.past.length - 1];
      update(
        id,
        (latest) => ({
          ...withData(latest, entry.data),
          past: latest.past.slice(0, -1),
          future: [...latest.future, { data: current(latest), label: entry.label }],
        }),
        true,
      );
      return entry.label;
    },

    redo: (id) => {
      const item = find(id);
      if (!item || item.future.length === 0) return null;
      const entry = item.future[item.future.length - 1];
      update(
        id,
        (latest) => ({
          ...withData(latest, entry.data),
          past: [...latest.past, { data: current(latest), label: entry.label }],
          future: latest.future.slice(0, -1),
        }),
        true,
      );
      return entry.label;
    },

    restoreOriginal: (id) => {
      const item = find(id);
      if (!item) return false;
      if (item.dataset.columns === item.original.columns && item.dataset.rows === item.original.rows) return false;
      // Restoring is itself undoable: the current state goes onto the history.
      update(
        id,
        (latest) => ({
          ...withData(latest, latest.original),
          past: [...latest.past, { data: current(latest), label: t('Restore original') }].slice(-HISTORY_LIMIT),
          future: [],
        }),
        true,
      );
      return true;
    },

    setView: (id, patch) => update(id, (item) => ({ ...item, view: { ...item.view, ...patch } })),
    setSelectedRows: (id, rows) => update(id, (item) => ({ ...item, selectedRows: rows })),
    setSelectedColumns: (id, columns) => update(id, (item) => ({ ...item, selectedColumns: columns })),
    setWidth: (id, column, width) => update(id, (item) => ({ ...item, widths: { ...item.widths, [column]: width } })),

    markSaved: (project) => set({ project, dirty: false }),
  };
});

export function useActiveDataset(): OpenDataset | null {
  return useData((state) => state.items.find((item) => item.dataset.id === state.activeId) ?? null);
}
