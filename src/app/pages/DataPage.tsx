// Data Preview: review, edit, clean, filter and export extracted records.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
  CaseSensitive,
  ClipboardCopy,
  Columns3,
  CopyMinus,
  Download,
  Eraser,
  Filter,
  History,
  Link2,
  Pencil,
  Redo2,
  Replace,
  Save,
  Search,
  Sheet,
  Split,
  Trash2,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import type { CaseMode, Column, ColumnFilter, TransformOp } from '@/types';
import { formatNumber, t } from '@/i18n';
import { allColumnStats } from '@/data-processing/infer';
import { computeView, countEmptyCells, findDuplicateRowIds } from '@/data-processing/view';
import { useActiveDataset, useData } from '@/app/stores/data';
import { navigate, toast, useUi } from '@/app/stores/ui';
import { copyToClipboard } from '@/app/services/exportData';
import { DataGrid } from '@/app/components/DataGrid';
import {
  CombineDialog,
  CONDITION_LABELS,
  ExportDialog,
  FilterDialog,
  FindReplaceDialog,
  RenameDialog,
  SaveProjectDialog,
  SplitDialog,
} from '@/app/components/DataDialogs';
import { Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Input, MenuButton, Notice, cx, type MenuItem } from '@/app/components/ui';

type DialogState =
  | { kind: 'none' }
  | { kind: 'export' }
  | { kind: 'save' }
  | { kind: 'find'; column: string | null }
  | { kind: 'split'; column: string | null }
  | { kind: 'combine'; columns: string[] }
  | { kind: 'filter'; column: string | null }
  | { kind: 'rename-column'; column: Column }
  | { kind: 'rename-dataset' }
  | { kind: 'close-dataset'; id: string; name: string }
  | { kind: 'restore' };

export function DataPage() {
  const items = useData((state) => state.items);
  const project = useData((state) => state.project);
  const dirty = useData((state) => state.dirty);
  const busy = useData((state) => state.busy);
  const active = useActiveDataset();
  const store = useData;
  const formulaGuard = useUi((state) => state.settings.export.formulaGuard);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [searchDraft, setSearchDraft] = useState('');
  const [showWarnings, setShowWarnings] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const id = active?.dataset.id ?? '';
  const data = useMemo(() => (active ? { columns: active.dataset.columns, rows: active.dataset.rows } : { columns: [], rows: [] }), [active?.dataset.columns, active?.dataset.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewIndexes = useMemo(() => (active ? computeView(data, active.view) : []), [data, active?.view]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => allColumnStats(data), [data]);
  const duplicates = useMemo(() => findDuplicateRowIds(data).size, [data]);
  const emptyCells = useMemo(() => countEmptyCells(data), [data]);

  // Keep the search box in sync when switching datasets; debounce typing on large data.
  useEffect(() => {
    setSearchDraft(active?.view.search ?? '');
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || searchDraft === active.view.search) return;
    const timer = window.setTimeout(() => store.getState().setView(id, { search: searchDraft }), data.rows.length > 20_000 ? 250 : 80);
    return () => window.clearTimeout(timer);
  }, [searchDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Apply a transformation and report what really happened. */
  const run = useCallback(
    async (op: TransformOp): Promise<boolean> => {
      if (!id) return false;
      try {
        const result = await store.getState().apply(id, op);
        // Direct manipulations show their own result in the grid; a toast for every
        // edited cell or moved column would only be noise.
        const visibleInPlace = op.type === 'editCell' || op.type === 'moveColumn' || op.type === 'renameColumn';
        if (result.changed === 0) toast.info(result.summary);
        else if (!visibleInPlace) toast.success(result.summary);
        return true;
      } catch (error) {
        toast.error(t('That did not work'), error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [id, store],
  );

  const undo = useCallback(() => {
    const label = store.getState().undo(id);
    if (label) toast.info(t('Undid: {label}', { label }));
  }, [id, store]);
  const redo = useCallback(() => {
    const label = store.getState().redo(id);
    if (label) toast.info(t('Redid: {label}', { label }));
  }, [id, store]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active || dialog.kind !== 'none') return;
      const mod = event.ctrlKey || event.metaKey;
      const typing = (event.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        setDialog({ kind: 'save' });
      } else if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setDialog({ kind: 'export' });
      } else if (mod && !typing && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && !typing && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dialog.kind, undo, redo]);

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <EmptyState
            icon={Sheet}
            title={t('No data yet')}
            description={t('Extract something from a page and it appears here, ready to review, clean and export. You can also reopen a saved project.')}
            action={
              <>
                <Button variant="primary" onClick={() => navigate('/')}>
                  {t('Go to Extract')}
                </Button>
                <Button onClick={() => navigate('/projects')}>{t('Open a project')}</Button>
              </>
            }
          />
        </Card>
      </div>
    );
  }

  const { dataset, view, selectedRows, selectedColumns } = active;
  const columns = dataset.columns;
  const columnName = (columnId: string) => columns.find((column) => column.id === columnId)?.name ?? '';
  const setView = store.getState().setView;
  const filtering = view.search !== '' || view.filters.length > 0 || !!view.duplicatesOnly;

  const toggleSort = (columnId: string) => {
    const current = view.sort;
    if (!current || current.column !== columnId) setView(id, { sort: { column: columnId, direction: 'asc' } });
    else if (current.direction === 'asc') setView(id, { sort: { column: columnId, direction: 'desc' } });
    else setView(id, { sort: null });
  };

  const addFilter = (filter: ColumnFilter) => setView(id, { filters: [...view.filters, filter] });

  const caseItems = (target: string[] | undefined): MenuItem[] =>
    (
      [
        ['upper', 'UPPERCASE'],
        ['lower', 'lowercase'],
        ['title', 'Title Case'],
        ['sentence', 'Sentence case'],
      ] as [CaseMode, string][]
    ).map(([mode, label]) => ({ label: t(label), icon: CaseSensitive, onSelect: () => void run({ type: 'convertCase', columns: target, mode }) }));

  const columnMenu = (column: Column, index: number): MenuItem[] => [
    { label: t('Rename…'), icon: Pencil, onSelect: () => setDialog({ kind: 'rename-column', column }) },
    { label: t('Sort A → Z'), icon: ArrowDownAZ, onSelect: () => setView(id, { sort: { column: column.id, direction: 'asc' } }) },
    { label: t('Sort Z → A'), icon: ArrowUpAZ, onSelect: () => setView(id, { sort: { column: column.id, direction: 'desc' } }) },
    { label: t('Filter…'), icon: Filter, onSelect: () => setDialog({ kind: 'filter', column: column.id }) },
    { label: t('Show only empty cells'), onSelect: () => addFilter({ column: column.id, condition: 'empty', value: '' }) },
    { label: t('Show only filled cells'), onSelect: () => addFilter({ column: column.id, condition: 'nonEmpty', value: '' }) },
    { type: 'separator' },
    { type: 'label', label: t('Clean this column') },
    { label: t('Trim whitespace'), icon: Eraser, onSelect: () => void run({ type: 'trim', columns: [column.id] }) },
    { label: t('Normalize whitespace'), onSelect: () => void run({ type: 'normalizeWhitespace', columns: [column.id] }) },
    ...caseItems([column.id]),
    { label: t('Extract first number'), onSelect: () => void run({ type: 'extractNumbers', column: column.id, mode: 'first', target: 'replace' }) },
    { label: t('Extract numbers into a new column'), onSelect: () => void run({ type: 'extractNumbers', column: column.id, mode: 'first', target: 'new' }) },
    { label: t('Parse dates (unambiguous only)'), onSelect: () => void run({ type: 'parseDates', column: column.id, target: 'replace' }) },
    { label: t('Normalize URLs'), icon: Link2, onSelect: () => void run({ type: 'normalizeUrls', column: column.id, baseUrl: dataset.source.url || undefined, stripTracking: true, stripHash: false }) },
    { label: t('Find and replace…'), icon: Replace, onSelect: () => setDialog({ kind: 'find', column: column.id }) },
    { label: t('Split into columns…'), icon: Split, onSelect: () => setDialog({ kind: 'split', column: column.id }) },
    { label: t('Remove rows where this is empty'), onSelect: () => void run({ type: 'keepRows', column: column.id, condition: 'nonEmpty' }) },
    { type: 'separator' },
    { label: t('Move left'), disabled: index === 0, onSelect: () => void run({ type: 'moveColumn', column: column.id, toIndex: index - 1 }) },
    { label: t('Move right'), disabled: index === columns.length - 1, onSelect: () => void run({ type: 'moveColumn', column: column.id, toIndex: index + 1 }) },
    { label: t('Remove column'), icon: Trash2, danger: true, onSelect: () => void run({ type: 'removeColumns', columns: [column.id] }) },
  ];

  const cleanMenu: MenuItem[] = [
    { type: 'label', label: t('All columns') },
    { label: t('Trim whitespace'), icon: Eraser, onSelect: () => void run({ type: 'trim' }) },
    { label: t('Normalize whitespace'), onSelect: () => void run({ type: 'normalizeWhitespace' }) },
    { label: t('Remove empty rows'), onSelect: () => void run({ type: 'removeEmptyRows' }) },
    { label: t('Remove empty columns'), onSelect: () => void run({ type: 'removeEmptyColumns' }) },
    { label: t('Remove duplicate rows'), icon: CopyMinus, onSelect: () => void run({ type: 'removeDuplicates' }) },
    { type: 'separator' },
    { label: t('Find and replace…'), icon: Replace, onSelect: () => setDialog({ kind: 'find', column: null }) },
    { label: t('Split a column…'), icon: Split, onSelect: () => setDialog({ kind: 'split', column: null }) },
    { label: t('Combine columns…'), icon: Columns3, onSelect: () => setDialog({ kind: 'combine', columns: Array.from(selectedColumns) }) },
    { type: 'separator' },
    { type: 'label', label: t('Change case (all columns)') },
    ...caseItems(undefined),
    { type: 'separator' },
    { label: t('Use first row as header'), onSelect: () => void run({ type: 'promoteHeader' }) },
    { label: t('Move header into first row'), onSelect: () => void run({ type: 'demoteHeader' }) },
  ];

  const copy = async (format: 'tsv' | 'csv' | 'json') => {
    const rows = selectedRows.size > 0 ? dataset.rows.filter((row) => selectedRows.has(row.id)) : viewIndexes.map((index) => dataset.rows[index]);
    try {
      const count = await copyToClipboard({ columns, rows }, format, { formulaGuard, includeHeader: true });
      toast.success(t('Copied {count} rows to the clipboard', { count: formatNumber(count) }), format === 'tsv' ? t('Paste straight into Excel or Google Sheets.') : undefined);
    } catch (error) {
      toast.error(t('Could not copy'), error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-testid="data-page">
      {/* Dataset tabs */}
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label={t('Open datasets')} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {items.map((item) => {
            const selected = item.dataset.id === id;
            return (
              <div key={item.dataset.id} className={cx('flex shrink-0 items-center rounded-md border', selected ? 'border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid="dataset-tab"
                  onClick={() => store.getState().setActive(item.dataset.id)}
                  onDoubleClick={() => setDialog({ kind: 'rename-dataset' })}
                  className="flex h-8 max-w-64 items-center gap-2 pr-1 pl-2.5 text-[13px] font-medium"
                  title={t('{name} — double-click to rename', { name: item.dataset.name })}
                >
                  <span className="truncate">{item.dataset.name}</span>
                  <span className="text-[11px] font-normal text-zinc-500">{formatNumber(item.dataset.rows.length)}</span>
                </button>
                <IconButton icon={X} size="sm" label={t('Close {name}', { name: item.dataset.name })} className="mr-1" onClick={() => setDialog({ kind: 'close-dataset', id: item.dataset.id, name: item.dataset.name })} />
              </div>
            );
          })}
        </div>
        <span className="shrink-0 text-xs text-zinc-500" data-testid="save-state">
          {project.id ? (dirty ? t('“{name}” · unsaved changes', { name: project.name }) : t('“{name}” · saved', { name: project.name })) : t('Not saved yet')}
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64 max-w-full">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-zinc-400" aria-hidden />
          <Input ref={searchRef} type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t('Search all columns…')} aria-label={t('Search all columns')} className="pl-8" data-testid="grid-search" />
        </div>
        <Button icon={Filter} onClick={() => setDialog({ kind: 'filter', column: null })} data-testid="add-filter">
          {t('Filter')}
        </Button>
        <MenuButton label={t('Clean')} icon={Wand2} items={cleanMenu} testId="clean-menu" disabled={busy} />
        <div className="flex items-center">
          <IconButton icon={Undo2} label={t('Undo (Ctrl+Z)')} disabled={active.past.length === 0 || busy} onClick={undo} data-testid="undo" />
          <IconButton icon={Redo2} label={t('Redo (Ctrl+Shift+Z)')} disabled={active.future.length === 0 || busy} onClick={redo} data-testid="redo" />
          <IconButton icon={History} label={t('Restore the original extracted data')} disabled={active.past.length === 0 || busy} onClick={() => setDialog({ kind: 'restore' })} data-testid="restore-original" />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <MenuButton
            label={t('Copy')}
            icon={ClipboardCopy}
            align="end"
            testId="copy-menu"
            items={[
              { label: t('Copy for spreadsheets (TSV)'), onSelect: () => void copy('tsv') },
              { label: t('Copy as CSV'), onSelect: () => void copy('csv') },
              { label: t('Copy as JSON'), onSelect: () => void copy('json') },
            ]}
          />
          <Button icon={Save} onClick={() => setDialog({ kind: 'save' })} data-testid="save-project">
            {t('Save')}
          </Button>
          <Button variant="primary" icon={Download} onClick={() => setDialog({ kind: 'export' })} data-testid="open-export">
            {t('Export')}
          </Button>
        </div>
      </div>

      {/* Active filters + selection */}
      {filtering || selectedRows.size > 0 || selectedColumns.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="grid-context">
          {view.filters.map((filter, index) => (
            <span key={index} className="inline-flex h-6 items-center gap-1 rounded-full bg-blue-50 pr-1 pl-2.5 text-blue-800 dark:bg-blue-950 dark:text-blue-200" data-testid="filter-chip">
              <strong className="font-semibold">{columnName(filter.column)}</strong> {t(CONDITION_LABELS[filter.condition])} {filter.value ? `“${filter.value}”` : ''}
              <IconButton icon={X} size="sm" label={t('Remove filter')} className="size-5" onClick={() => setView(id, { filters: view.filters.filter((_, i) => i !== index) })} />
            </span>
          ))}
          {view.duplicatesOnly ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-blue-50 pr-1 pl-2.5 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              {t('Duplicates only')}
              <IconButton icon={X} size="sm" label={t('Show all rows')} className="size-5" onClick={() => setView(id, { duplicatesOnly: false })} />
            </span>
          ) : null}
          {filtering ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearchDraft('');
                setView(id, { search: '', filters: [], duplicatesOnly: false });
              }}
            >
              {t('Clear search and filters')}
            </Button>
          ) : null}
          {selectedRows.size > 0 ? (
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="text-zinc-600 dark:text-zinc-400">{t('{count} rows selected', { count: formatNumber(selectedRows.size) })}</span>
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => void run({ type: 'removeRows', rowIds: Array.from(selectedRows) })} data-testid="remove-rows">
                {t('Remove rows')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => store.getState().setSelectedRows(id, new Set())}>
                {t('Clear')}
              </Button>
            </span>
          ) : null}
          {selectedColumns.size > 0 ? (
            <span className={cx('inline-flex items-center gap-2', selectedRows.size === 0 && 'ml-auto')}>
              <span className="text-zinc-600 dark:text-zinc-400">{t('{count} columns selected', { count: selectedColumns.size })}</span>
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => void run({ type: 'removeColumns', columns: Array.from(selectedColumns) })} data-testid="remove-columns">
                {t('Remove columns')}
              </Button>
              {selectedColumns.size >= 2 ? (
                <Button size="sm" onClick={() => setDialog({ kind: 'combine', columns: Array.from(selectedColumns) })}>
                  {t('Combine…')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => store.getState().setSelectedColumns(id, new Set())}>
                {t('Clear')}
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}

      {dataset.warnings.length > 0 ? (
        <Notice tone="amber" icon={AlertTriangle} role="status">
          <div className="flex items-start justify-between gap-3">
            <div data-testid="dataset-warnings">
              {showWarnings || dataset.warnings.length === 1 ? (
                <ul className={cx(dataset.warnings.length > 1 && 'list-disc pl-4')}>
                  {dataset.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              ) : (
                t('{count} extraction warnings', { count: dataset.warnings.length })
              )}
            </div>
            {dataset.warnings.length > 1 ? (
              <button type="button" className="shrink-0 text-xs font-medium underline" onClick={() => setShowWarnings(!showWarnings)}>
                {showWarnings ? t('Hide') : t('Show')}
              </button>
            ) : null}
          </div>
        </Notice>
      ) : null}

      {/* Grid */}
      <div className="min-h-0 flex-1">
        {columns.length === 0 ? (
          <Card className="h-full">
            <EmptyState icon={Sheet} title={t('This dataset has no columns')} description={t('Undo the last change or restore the original data.')} />
          </Card>
        ) : (
          <DataGrid
            columns={columns}
            rows={dataset.rows}
            view={viewIndexes}
            stats={stats}
            widths={active.widths}
            sort={view.sort}
            selectedRows={selectedRows}
            selectedColumns={selectedColumns}
            onSelectRows={(next) => store.getState().setSelectedRows(id, next)}
            onSelectColumns={(next) => store.getState().setSelectedColumns(id, next)}
            onResize={(columnId, width) => store.getState().setWidth(id, columnId, width)}
            onSort={toggleSort}
            onEditCell={(rowId, columnId, value) => void run({ type: 'editCell', rowId, column: columnId, value })}
            onMoveColumn={(columnId, toIndex) => void run({ type: 'moveColumn', column: columnId, toIndex })}
            onRenameColumn={(columnId) => {
              const column = columns.find((item) => item.id === columnId);
              if (column) setDialog({ kind: 'rename-column', column });
            }}
            columnMenu={columnMenu}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400" data-testid="status-bar" aria-live="polite">
        <span data-testid="row-count">
          {filtering ? t('{shown} of {total} rows', { shown: formatNumber(viewIndexes.length), total: formatNumber(dataset.rows.length) }) : t('{total} rows', { total: formatNumber(dataset.rows.length) })}
        </span>
        <span data-testid="column-count">{t('{count} columns', { count: columns.length })}</span>
        {duplicates > 0 ? (
          <span className="inline-flex items-center gap-1.5" data-testid="duplicate-count">
            <Badge tone="amber">{t('{count} duplicate rows', { count: formatNumber(duplicates) })}</Badge>
            <button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setView(id, { duplicatesOnly: !view.duplicatesOnly })}>
              {view.duplicatesOnly ? t('Show all') : t('Show')}
            </button>
            <button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => void run({ type: 'removeDuplicates' })}>
              {t('Remove')}
            </button>
          </span>
        ) : (
          <span>{t('No duplicate rows')}</span>
        )}
        <span data-testid="empty-count">{t('{count} empty cells', { count: formatNumber(emptyCells) })}</span>
        {dataset.source.url ? (
          <span className="ml-auto max-w-sm truncate" title={dataset.source.url}>
            {dataset.source.pages ? t('{pages} pages · ', { pages: dataset.source.pages }) : ''}
            {dataset.source.title || dataset.source.url}
          </span>
        ) : null}
      </div>

      {/* Dialogs */}
      <ExportDialog open={dialog.kind === 'export'} onClose={() => setDialog({ kind: 'none' })} active={active} items={items} viewIndexes={viewIndexes} projectName={project.name} />
      <SaveProjectDialog open={dialog.kind === 'save'} onClose={() => setDialog({ kind: 'none' })} items={items} project={project} onSaved={(ref) => store.getState().markSaved(ref)} />
      <FindReplaceDialog open={dialog.kind === 'find'} onClose={() => setDialog({ kind: 'none' })} columns={columns} initialColumn={dialog.kind === 'find' ? dialog.column : null} onApply={run} />
      <SplitDialog open={dialog.kind === 'split'} onClose={() => setDialog({ kind: 'none' })} columns={columns} initialColumn={dialog.kind === 'split' ? dialog.column : null} onApply={run} />
      <CombineDialog open={dialog.kind === 'combine'} onClose={() => setDialog({ kind: 'none' })} columns={columns} initialColumns={dialog.kind === 'combine' ? dialog.columns : []} onApply={run} />
      <FilterDialog open={dialog.kind === 'filter'} onClose={() => setDialog({ kind: 'none' })} columns={columns} initialColumn={dialog.kind === 'filter' ? dialog.column : null} onAdd={addFilter} />
      <RenameDialog
        open={dialog.kind === 'rename-column'}
        onClose={() => setDialog({ kind: 'none' })}
        title={t('Rename column')}
        label={t('Column name')}
        initial={dialog.kind === 'rename-column' ? dialog.column.name : ''}
        onRename={(name) => {
          if (dialog.kind === 'rename-column') void run({ type: 'renameColumn', column: dialog.column.id, name });
        }}
      />
      <RenameDialog open={dialog.kind === 'rename-dataset'} onClose={() => setDialog({ kind: 'none' })} title={t('Rename dataset')} label={t('Dataset name')} initial={dataset.name} onRename={(name) => store.getState().renameDataset(id, name)} />
      <ConfirmDialog
        open={dialog.kind === 'close-dataset'}
        onClose={() => setDialog({ kind: 'none' })}
        title={t('Close this dataset?')}
        message={
          dialog.kind === 'close-dataset'
            ? project.id && !dirty
              ? t('“{name}” will be closed. It stays in the saved project.', { name: dialog.name })
              : t('“{name}” will be removed from the workspace. Anything not saved in a project or exported will be lost.', { name: dialog.name })
            : ''
        }
        confirmLabel={t('Close dataset')}
        danger
        onConfirm={() => {
          if (dialog.kind === 'close-dataset') store.getState().close(dialog.id);
        }}
      />
      <ConfirmDialog
        open={dialog.kind === 'restore'}
        onClose={() => setDialog({ kind: 'none' })}
        title={t('Restore the original data?')}
        message={t('All edits and cleaning steps on this dataset will be reverted to the data as it was extracted. You can undo this.')}
        confirmLabel={t('Restore original')}
        onConfirm={() => {
          if (store.getState().restoreOriginal(id)) toast.success(t('Original data restored'));
        }}
      />
    </div>
  );
}
