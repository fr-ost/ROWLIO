// Tables: every table found on the connected page, with previews, options and warnings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Eye, MousePointerClick, RefreshCw, Table2 } from 'lucide-react';
import type { TableOptions, TableSummary } from '@/types';
import { formatNumber, t, tn } from '@/i18n';
import { request } from '@/messaging/tabClient';
import { focusTargetTab, useTarget } from '@/app/stores/target';
import { navigate, toast, useUi } from '@/app/stores/ui';
import { useRule } from '@/app/stores/rule';
import { describeError, extractAndOpen } from '@/app/services/extract';
import { onContentEvent } from '@/app/services/events';
import { ConnectionGate } from '@/app/components/Shell';
import { Badge, Button, Card, Checkbox, EmptyState, Notice, PageHeader, Segmented, Spinner } from '@/app/components/ui';

function PreviewTable({ table }: { table: TableSummary }) {
  if (table.columnCount === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-50 dark:bg-zinc-800/60">
            {table.headers.map((header, i) => (
              <th key={i} scope="col" className="max-w-56 truncate border-b border-zinc-200 px-2 py-1.5 text-left font-semibold whitespace-nowrap text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.preview.map((row, r) => (
            <tr key={r} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              {row.map((cell, c) => (
                <td key={c} className="max-w-56 truncate px-2 py-1 whitespace-nowrap text-zinc-700 dark:text-zinc-300" title={cell}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TablesPage() {
  const tabId = useTarget((state) => state.tabId);
  const status = useTarget((state) => state.status);
  const pageUrl = useTarget((state) => state.url);
  const settings = useUi((state) => state.settings);
  const updateSettings = useUi((state) => state.updateSettings);
  const options = settings.tables;
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const loadSeq = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      if (tabId === null || status !== 'ready') return;
      const seq = ++loadSeq.current;
      if (!quiet) setLoading(true);
      setError('');
      try {
        const list = await request(tabId, 'tables:list', { options, previewRows: 5 });
        if (seq !== loadSeq.current) return;
        setTables(list);
        setSelected((previous) => new Set(Array.from(previous).filter((index) => index < list.length)));
      } catch (caught) {
        if (seq !== loadSeq.current) return;
        useTarget.getState().markError(caught);
        setError(describeError(caught));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [tabId, status, options],
  );

  useEffect(() => {
    void load();
  }, [load, pageUrl]);

  // Tables rendered after the page loaded (AJAX, SPA navigation) show up automatically.
  useEffect(() => {
    if (tabId === null || status !== 'ready') return;
    void request(tabId, 'tables:watch', { enabled: true }).catch(() => undefined);
    const off = onContentEvent('tables:changed', () => {
      void load(true);
      toast.info(t('The tables on the page changed'), t('The list was updated.'));
    });
    return () => {
      off();
      void request(tabId, 'tables:watch', { enabled: false }, { noRetry: true }).catch(() => undefined);
    };
  }, [tabId, status, load]);

  const setOption = (patch: Partial<TableOptions>) => void updateSettings({ tables: { ...options, ...patch } });

  const visible = (tables ?? []).filter((table) => showAll || table.isDataTable);
  const hiddenCount = (tables ?? []).length - (tables ?? []).filter((table) => table.isDataTable).length;

  const extract = async (indexes: number[]) => {
    if (indexes.length === 0) return;
    setExtracting(true);
    try {
      await extractAndOpen({ kind: 'tables', indexes, options });
    } finally {
      setExtracting(false);
    }
  };

  const showOnPage = async (index: number) => {
    if (tabId === null) return;
    try {
      const { found } = await request(tabId, 'tables:highlight', { index });
      if (!found) {
        toast.warning(t('That table is no longer on the page'), t('Rescan to refresh the list.'));
        return;
      }
      await focusTargetTab();
    } catch (caught) {
      toast.error(t('Could not show the table'), describeError(caught));
    }
  };

  const paginate = (index: number, name: string) => {
    useRule.getState().setPaginationSpec({ kind: 'tables', indexes: [index], options }, name);
    navigate('/pagination');
  };

  return (
    <ConnectionGate>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <PageHeader
          title={t('Tables')}
          description={t('Every HTML table on the page, including ones rendered after load, inside scrollable areas, open shadow DOM and same-origin frames.')}
          actions={
            <>
              <Button icon={RefreshCw} onClick={() => void load()} loading={loading}>
                {t('Rescan')}
              </Button>
              <Button icon={Download} disabled={selected.size === 0 || extracting} onClick={() => void extract(Array.from(selected).sort((a, b) => a - b))} data-testid="extract-selected">
                {t('Extract selected ({count})', { count: selected.size })}
              </Button>
              <Button variant="primary" icon={Download} disabled={visible.length === 0} loading={extracting} onClick={() => void extract(visible.map((table) => table.index))} data-testid="extract-all-tables">
                {t('Extract all')}
              </Button>
            </>
          }
        />

        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Checkbox checked={options.includeHidden} onChange={(includeHidden) => setOption({ includeHidden })} label={t('Include hidden rows and columns')} />
          <Checkbox checked={options.fillMerged} onChange={(fillMerged) => setOption({ fillMerged })} label={t('Repeat merged cells')} />
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-zinc-700 dark:text-zinc-300">{t('Header row')}</span>
            <Segmented
              label={t('Header row')}
              value={options.headerMode}
              onChange={(headerMode) => setOption({ headerMode })}
              options={[
                { value: 'auto', label: t('Auto') },
                { value: 'first-row', label: t('First row') },
                { value: 'none', label: t('None') },
              ]}
            />
          </div>
          {hiddenCount > 0 ? (
            <Checkbox checked={showAll} onChange={setShowAll} label={t('Show layout / tiny tables ({count})', { count: hiddenCount })} />
          ) : null}
        </Card>

        {error ? (
          <Notice tone="red" icon={AlertTriangle} role="alert">
            {error}
          </Notice>
        ) : null}

        {tables === null && loading ? (
          <div className="py-10 text-center">
            <Spinner label={t('Looking for tables…')} />
          </div>
        ) : visible.length === 0 && tables !== null ? (
          <Card>
            <EmptyState
              icon={Table2}
              title={hiddenCount > 0 ? t('No data tables found') : t('No tables on this page')}
              description={
                hiddenCount > 0
                  ? t('{count} table(s) look like page layout rather than data. Tick “Show layout / tiny tables” to see them anyway.', { count: hiddenCount })
                  : t('Many sites lay data out as cards or lists instead of HTML tables. Use the Visual Selector to pick those. If the table appears after an action on the page, do that first and press Rescan.')
              }
              action={
                <>
                  <Button icon={MousePointerClick} variant="primary" onClick={() => navigate('/visual')}>
                    {t('Open Visual Selector')}
                  </Button>
                  <Button icon={RefreshCw} onClick={() => void load()}>
                    {t('Rescan')}
                  </Button>
                </>
              }
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="table-list">
            {visible.map((table) => {
              const name = table.caption || t('Table {n}', { n: table.index + 1 });
              const isSelected = selected.has(table.index);
              return (
                <li key={table.index}>
                  <Card className="p-4" data-testid="table-card">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="pt-0.5">
                        <Checkbox
                          checked={isSelected}
                          ariaLabel={t('Select {name}', { name })}
                          onChange={(checked) => {
                            const next = new Set(selected);
                            if (checked) next.add(table.index);
                            else next.delete(table.index);
                            setSelected(next);
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h2 className="truncate text-sm font-semibold" data-testid="table-name">
                            {name}
                          </h2>
                          <Badge tone="brand">
                            {table.rowCountExact ? '' : '≈ '}
                            {tn(table.rowCount, '{count} row', '{count} rows', { count: formatNumber(table.rowCount) })} × {tn(table.columnCount, '{count} column', '{count} columns')}
                          </Badge>
                          {table.kind === 'aria-grid' ? <Badge title={t('Built from div elements with ARIA table roles')}>{t('ARIA grid')}</Badge> : null}
                          {table.nestedIn >= 0 ? <Badge tone="violet">{t('Nested in table {n}', { n: table.nestedIn + 1 })}</Badge> : null}
                          {table.hasNested ? <Badge tone="violet">{t('Contains nested tables')}</Badge> : null}
                          {table.inScrollContainer ? <Badge tone="blue">{t('Scrollable container')}</Badge> : null}
                          {table.location !== 'document' ? <Badge tone="blue">{table.location === 'iframe' ? t('In a frame') : t('In shadow DOM')}</Badge> : null}
                          {!table.isDataTable ? <Badge tone="amber">{t('Layout / tiny')}</Badge> : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" icon={Eye} onClick={() => void showOnPage(table.index)}>
                          {t('Show on page')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => paginate(table.index, name)} title={t('Extract this table across several pages')}>
                          {t('Paginate…')}
                        </Button>
                        <Button size="sm" variant="secondary" icon={Download} disabled={extracting} onClick={() => void extract([table.index])} data-testid="extract-table">
                          {t('Extract')}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <PreviewTable table={table} />
                      {table.rowCount > table.preview.length ? (
                        <p className="mt-1.5 text-xs text-zinc-500">{t('Showing the first {shown} of {total} rows.', { shown: table.preview.length, total: formatNumber(table.rowCount) })}</p>
                      ) : null}
                    </div>
                    {table.warnings.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-1.5" data-testid="table-warnings">
                        {table.warnings.map((warning, i) => (
                          <li key={i}>
                            <Notice tone="amber" icon={AlertTriangle}>
                              {warning}
                            </Notice>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ConnectionGate>
  );
}
