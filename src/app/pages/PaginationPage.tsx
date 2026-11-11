// Pagination: extract across several pages (next links / buttons / page numbers) or an
// infinite-scroll page. Always user-started and bounded by explicit limits.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookMarked, CheckCircle2, Crosshair, Info, Play, Radar, Sheet, Square } from 'lucide-react';
import type { ExtractSpec, NextControlInfo, PaginationSettings, Recipe, TableSummary } from '@/types';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_LINK_OPTIONS } from '@/types';
import { brand } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { request } from '@/messaging/tabClient';
import { describeStop } from '@/pagination/runner';
import { listRecipes } from '@/storage/recipes';
import { useRule } from '@/app/stores/rule';
import { useTarget } from '@/app/stores/target';
import { navigate, toast, useUi } from '@/app/stores/ui';
import { describeError } from '@/app/services/extract';
import { useRun } from '@/app/services/paginate';
import { pickElement } from '@/app/services/picker';
import { ConnectionGate } from '@/app/components/Shell';
import { describeSpec, RecipeDialog } from '@/app/components/RecipeDialog';
import { Badge, Button, Card, Checkbox, Field, IconButton, Input, Notice, PageHeader, ProgressBar, Segmented, Select, cx } from '@/app/components/ui';

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  testId,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  testId?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ''}
          data-testid={testId}
          onChange={(event) => {
            const parsed = Math.floor(Number(event.target.value));
            if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
          }}
        />
      )}
    </Field>
  );
}

function PickableSelector({
  label,
  hint,
  value,
  placeholder,
  purpose,
  onChange,
  testId,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  purpose: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="flex gap-1.5">
          <Input id={id} mono value={value} placeholder={placeholder} spellCheck={false} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
          <IconButton
            icon={Crosshair}
            label={t('Pick on the page')}
            className="border border-zinc-300 dark:border-zinc-700"
            onClick={async () => {
              const picked = await pickElement(purpose);
              if (picked) onChange(picked.selector);
            }}
          />
        </div>
      )}
    </Field>
  );
}

type SourceKey = 'rule' | 'table' | 'links' | 'images' | 'recipe' | 'preset';

export function PaginationPage() {
  const tabId = useTarget((state) => state.tabId);
  const status = useTarget((state) => state.status);
  const pageUrl = useTarget((state) => state.url);
  const defaults = useUi((state) => state.settings.pagination);
  const tableOptions = useUi((state) => state.settings.tables);
  const updateSettings = useUi((state) => state.updateSettings);
  const rule = useRule((state) => state.rule);
  const ruleOrigin = useRule((state) => state.origin);
  const presetSpec = useRule((state) => state.paginationSpec);
  const presetLabel = useRule((state) => state.paginationLabel);
  const recipePagination = useRule((state) => state.recipePagination);
  const run = useRun();

  const [settings, setSettings] = useState<PaginationSettings>(defaults);
  const [source, setSource] = useState<SourceKey>('rule');
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [tableIndex, setTableIndex] = useState(0);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeId, setRecipeId] = useState('');
  const [detected, setDetected] = useState<NextControlInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);

  const ruleUsable = rule.fields.length > 0 && rule.fields.every((field) => field.selector.trim() || rule.rowSelector.trim());

  // Settings start from the saved defaults; a recipe's pagination settings override them.
  useEffect(() => {
    setSettings(recipePagination ?? defaults);
  }, [recipePagination]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (presetSpec) setSource('preset');
    else if (!ruleUsable) setSource('table');
  }, [presetSpec]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tabId === null || status !== 'ready') return;
    request(tabId, 'tables:list', { options: tableOptions, previewRows: 1 })
      .then((list) => {
        const data = list.filter((table) => table.isDataTable);
        setTables(data);
        if (data.length > 0) setTableIndex(data[0].index);
      })
      .catch(() => setTables([]));
    listRecipes().then(setRecipes).catch(() => setRecipes([]));
    setDetected(null);
  }, [tabId, status, pageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const spec: ExtractSpec | null = useMemo(() => {
    switch (source) {
      case 'preset':
        return presetSpec;
      case 'rule':
        return ruleUsable ? { kind: 'rule', rule, method: ruleOrigin } : null;
      case 'table':
        return tables.length > 0 ? { kind: 'tables', indexes: [tableIndex], options: tableOptions } : null;
      case 'links':
        return { kind: 'links', options: DEFAULT_LINK_OPTIONS };
      case 'images':
        return { kind: 'images', options: DEFAULT_IMAGE_OPTIONS };
      case 'recipe':
        return recipes.find((recipe) => recipe.id === recipeId)?.spec ?? null;
    }
  }, [source, presetSpec, ruleUsable, rule, ruleOrigin, tables, tableIndex, tableOptions, recipes, recipeId]);

  const patch = (change: Partial<PaginationSettings>) => setSettings((current) => ({ ...current, ...change }));

  const detect = async () => {
    if (tabId === null) return;
    setDetecting(true);
    try {
      setDetected(await request(tabId, 'pagination:detect', { nextSelector: settings.nextSelector }));
    } catch (error) {
      toast.error(t('Could not check the page'), describeError(error));
    } finally {
      setDetecting(false);
    }
  };

  const start = () => {
    if (!spec) {
      toast.info(t('Choose what to extract first.'));
      return;
    }
    void updateSettings({ pagination: settings });
    void run.start(spec, settings);
  };

  const summary = run.summary;
  const progress = run.progress;
  const pageFraction = progress ? Math.min(1, progress.page / Math.max(1, progress.maxPages)) : undefined;
  const scrollFraction = run.scroll && run.maxScrolls ? Math.min(1, run.scroll.scrolls / run.maxScrolls) : undefined;

  return (
    <ConnectionGate>
      <div className="page-enter mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <PageHeader
          title={t('Pagination')}
          description={t('Collect records across several pages or from an infinite-scroll page. You start every run, and it always stops at the limits you set.')}
        />

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">{t('1 · What to extract on each page')}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('Source')}>
              {(id) => (
                <Select id={id} value={source} onChange={(event) => setSource(event.target.value as SourceKey)} data-testid="pagination-source" disabled={run.running}>
                  {presetSpec ? <option value="preset">{presetLabel || t('Selected extraction')}</option> : null}
                  <option value="rule" disabled={!ruleUsable}>
                    {ruleUsable ? t('Current selector rule ({count} fields)', { count: rule.fields.length }) : t('Current selector rule (none yet)')}
                  </option>
                  <option value="table" disabled={tables.length === 0}>
                    {tables.length > 0 ? t('A table on the page') : t('A table on the page (none found)')}
                  </option>
                  <option value="links">{t('All links')}</option>
                  <option value="images">{t('All images')}</option>
                  <option value="recipe" disabled={recipes.length === 0}>
                    {recipes.length > 0 ? t('A saved recipe') : t('A saved recipe (none yet)')}
                  </option>
                </Select>
              )}
            </Field>
            {source === 'table' && tables.length > 0 ? (
              <Field label={t('Table')}>
                {(id) => (
                  <Select id={id} value={tableIndex} onChange={(event) => setTableIndex(Number(event.target.value))} disabled={run.running}>
                    {tables.map((table) => (
                      <option key={table.index} value={table.index}>
                        {table.caption || t('Table {n}', { n: table.index + 1 })} ({formatNumber(table.rowCount)} × {table.columnCount})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {source === 'recipe' ? (
              <Field label={t('Recipe')}>
                {(id) => (
                  <Select id={id} value={recipeId} onChange={(event) => setRecipeId(event.target.value)} disabled={run.running}>
                    <option value="">{t('Choose a recipe…')}</option>
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipe.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </div>
          {spec ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-400" data-testid="pagination-spec">
              {describeSpec(spec)}
            </p>
          ) : (
            <Notice tone="amber" icon={Info}>
              {t('Nothing selected yet. Build a rule in the Visual Selector or Advanced Selectors, or choose a table, links or images above.')}{' '}
              <button type="button" className="font-medium underline" onClick={() => navigate('/visual')}>
                {t('Open Visual Selector')}
              </button>
            </Notice>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t('2 · How to reach more records')}</h2>
            <Segmented
              label={t('Pagination mode')}
              value={settings.mode}
              onChange={(mode) => patch({ mode })}
              options={[
                { value: 'next', label: t('Next page') },
                { value: 'scroll', label: t('Infinite scroll') },
              ]}
            />
          </div>

          {settings.mode === 'next' ? (
            <>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <PickableSelector
                  label={t('Next-page control')}
                  hint={t('Leave empty to detect it automatically (rel="next", “Next” buttons and links, page numbers). Or enter a CSS selector / pick it on the page.')}
                  value={settings.nextSelector}
                  placeholder={t('Automatic')}
                  purpose={t('next-page button or link')}
                  onChange={(nextSelector) => patch({ nextSelector })}
                  testId="next-selector"
                />
                <div className="pt-5">
                  <Button icon={Radar} loading={detecting} onClick={() => void detect()} data-testid="detect-next">
                    {t('Check this page')}
                  </Button>
                </div>
              </div>
              {detected ? (
                <Notice tone={detected.found && !detected.disabled ? 'brand' : 'amber'} icon={detected.found && !detected.disabled ? CheckCircle2 : AlertTriangle}>
                  <span data-testid="detect-result">
                    {!detected.found
                      ? t('No next-page control was found on this page. It may be the last page, or the site uses infinite scroll.')
                      : detected.disabled
                        ? t('Found “{label}”, but it is disabled: this looks like the last page.', { label: detected.text })
                        : t('Found “{label}” ({how}){target}.', {
                            label: detected.text || detected.selector,
                            how: detected.strategy === 'page-number' ? t('page {n} → {m}', { n: detected.currentPage ?? 0, m: (detected.currentPage ?? 0) + 1 }) : t(detected.strategy),
                            target: detected.href ? ` → ${detected.href}` : '',
                          })}
                  </span>
                </Notice>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumberField label={t('Maximum pages')} hint={t('The run never goes past this.')} value={settings.maxPages} min={1} max={100000} onChange={(maxPages) => patch({ maxPages })} testId="max-pages" />
                <NumberField label={t('Maximum records')} hint={t('0 = no record limit.')} value={settings.maxRecords} min={0} max={100000000} onChange={(maxRecords) => patch({ maxRecords })} testId="max-records" />
                <NumberField label={t('Delay between pages (ms)')} hint={t('Be gentle with the site.')} value={settings.delayMs} min={0} max={600000} onChange={(delayMs) => patch({ delayMs })} testId="delay-ms" />
                <NumberField label={t('Retries per page')} hint={t('If a page fails to load.')} value={settings.retries} min={0} max={10} onChange={(retries) => patch({ retries })} />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumberField label={t('Maximum scrolls')} hint={t('The run never goes past this.')} value={settings.maxScrolls} min={1} max={100000} onChange={(maxScrolls) => patch({ maxScrolls })} testId="max-scrolls" />
                <NumberField label={t('Maximum records')} hint={t('0 = no record limit.')} value={settings.maxRecords} min={0} max={100000000} onChange={(maxRecords) => patch({ maxRecords })} testId="max-records" />
                <NumberField label={t('Time limit (seconds)')} value={settings.maxDurationSec} min={5} max={86400} onChange={(maxDurationSec) => patch({ maxDurationSec })} testId="max-duration" />
                <NumberField label={t('Pause per scroll (ms)')} hint={t('Time for new content to load.')} value={settings.delayMs} min={0} max={60000} onChange={(delayMs) => patch({ delayMs })} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <PickableSelector
                  label={t('Scrolling area')}
                  hint={t('Leave empty for the page itself (a scrolling box around the records is detected automatically).')}
                  value={settings.scrollContainer}
                  placeholder={t('Automatic')}
                  purpose={t('scrolling area that holds the records')}
                  onChange={(scrollContainer) => patch({ scrollContainer })}
                />
                <PickableSelector
                  label={t('“Load more” button')}
                  hint={t('Optional. Clicked before each scroll when present.')}
                  value={settings.loadMoreSelector}
                  placeholder={t('None')}
                  purpose={t('“load more” button')}
                  onChange={(loadMoreSelector) => patch({ loadMoreSelector })}
                />
              </div>
              <Notice icon={Info}>
                {t('{name} scrolls step by step, collects what appears and puts the scroll position back afterwards. Pages that only keep a few items in the page at a time are supported, but identical records that are never visible together are counted once.', { name: brand.name })}
              </Notice>
            </>
          )}
          <Checkbox checked={settings.skipDuplicates} onChange={(skipDuplicates) => patch({ skipDuplicates })} label={t('Skip duplicate records')} description={t('A record identical to one already collected is not added again.')} />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('Access granted by clicking the {name} icon covers this site only. If “next” leads to a different site, the run stops there and tells you.', { name: brand.name })}
          </p>
        </Card>

        <Card className="flex flex-col gap-3 p-4" data-testid="run-panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t('3 · Run')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {run.last && !run.running ? (
                <Button icon={BookMarked} onClick={() => setRecipeOpen(true)} data-testid="save-pagination-recipe">
                  {t('Save as recipe')}
                </Button>
              ) : null}
              {run.running ? (
                <Button variant="danger" icon={Square} onClick={() => run.stop()} data-testid="stop-run">
                  {t('Stop')}
                </Button>
              ) : (
                <Button variant="primary" icon={Play} disabled={!spec} onClick={start} data-testid="start-run">
                  {t('Start')}
                </Button>
              )}
            </div>
          </div>

          {run.running ? (
            <div className="flex flex-col gap-2" aria-live="polite" data-testid="run-progress">
              <ProgressBar value={run.mode === 'scroll' ? scrollFraction : pageFraction} label={t('Run progress')} />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                {run.mode === 'scroll' ? (
                  <>
                    <span>{t('Scroll {n} of up to {max}', { n: run.scroll?.scrolls ?? 0, max: run.maxScrolls })}</span>
                    <span>{t('{count} records', { count: formatNumber(run.scroll?.records ?? 0) })}</span>
                    <span className="text-zinc-500">{t('{seconds}s elapsed', { seconds: Math.round((run.scroll?.elapsedMs ?? 0) / 1000) })}</span>
                  </>
                ) : (
                  <>
                    <span>{t('Page {n} of up to {max}', { n: progress?.page ?? 1, max: progress?.maxPages ?? settings.maxPages })}</span>
                    <span>{t('{count} records', { count: formatNumber(progress?.records ?? 0) })}</span>
                    {progress && progress.duplicates > 0 ? <span className="text-zinc-500">{t('{count} duplicates skipped', { count: formatNumber(progress.duplicates) })}</span> : null}
                    <span className="text-zinc-500">{progress ? t({ loading: 'Loading the page…', extracting: 'Reading records…', waiting: 'Waiting…', advancing: 'Going to the next page…', done: 'Finishing…' }[progress.phase]) : t('Starting…')}</span>
                  </>
                )}
              </div>
              <p className="text-xs text-zinc-500">{t('The page is shown while {name} works. Use Stop here or on the page; everything collected so far is kept.', { name: brand.name })}</p>
            </div>
          ) : null}

          {summary && !run.running ? (
            <div className="flex flex-col gap-2" data-testid="run-summary" data-reason={summary.reason}>
              <Notice tone={summary.reason === 'error' ? 'red' : summary.records > 0 ? 'brand' : 'amber'} icon={summary.reason === 'error' ? AlertTriangle : CheckCircle2} role="status">
                <div className="font-medium">
                  {summary.mode === 'scroll'
                    ? t('{records} records collected in {steps} scrolls', { records: formatNumber(summary.records), steps: summary.steps })
                    : t('{records} records collected from {steps} pages', { records: formatNumber(summary.records), steps: summary.steps })}
                </div>
                <div>
                  {describeStop(summary.reason)}
                  {summary.error ? ` ${summary.error}` : ''}
                  {summary.duplicates > 0 ? ` ${t('{count} duplicates were skipped.', { count: formatNumber(summary.duplicates) })}` : ''}
                </div>
                {summary.records === 0 && summary.reason !== 'error' ? <div>{t('Nothing matched. Check that the selected extraction finds records on this page first.')}</div> : null}
              </Notice>
              {summary.records > 0 ? (
                <div>
                  <Button variant="primary" icon={Sheet} onClick={() => navigate('/data')} data-testid="view-run-data">
                    {t('View the data')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {run.log.length > 0 ? (
            <details className="text-xs" open={run.running}>
              <summary className="font-medium text-zinc-600 dark:text-zinc-400">{t('Activity log ({count})', { count: run.log.length })}</summary>
              <ol className="mt-2 flex max-h-56 flex-col gap-1 overflow-auto rounded-md border border-zinc-200 p-2 font-mono dark:border-zinc-800" data-testid="run-log">
                {run.log.map((entry, index) => (
                  <li key={index} className={cx(entry.kind === 'error' && 'text-red-600 dark:text-red-400', entry.kind === 'warning' && 'text-amber-700 dark:text-amber-400')}>
                    {entry.message}
                  </li>
                ))}
              </ol>
            </details>
          ) : !run.running && !summary ? (
            <p className="text-[13px] text-zinc-500">
              {settings.mode === 'next'
                ? t('Press Start to extract this page, follow “next” up to {pages} pages, and stop.', { pages: settings.maxPages })
                : t('Press Start to scroll up to {scrolls} times (at most {seconds}s), collecting records as they appear.', { scrolls: settings.maxScrolls, seconds: settings.maxDurationSec })}
            </p>
          ) : null}
          {summary?.datasetCount ? <Badge tone="neutral">{t('Opened in the Data Preview')}</Badge> : null}
        </Card>

        <RecipeDialog open={recipeOpen} onClose={() => setRecipeOpen(false)} spec={run.last?.spec ?? spec} pagination={run.last?.settings ?? settings} sourceUrl={pageUrl} />
      </div>
    </ConnectionGate>
  );
}
