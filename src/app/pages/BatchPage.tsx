// Batch URLs: run one extraction on a list of pages (for example the detail pages linked
// from a listing you already extracted). User-started, bounded by the list, cancellable.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, ListPlus, Play, Sheet, Square } from 'lucide-react';
import type { ExtractSpec, Recipe } from '@/types';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_LINK_OPTIONS, DEFAULT_META_OPTIONS } from '@/types';
import { brand } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { inferValueType } from '@/data-processing/infer';
import { normalizeUrlList } from '@/pagination/batch';
import { describeStop } from '@/pagination/runner';
import { listRecipes } from '@/storage/recipes';
import { originOf } from '@/utils/url';
import { useData } from '@/app/stores/data';
import { useRule } from '@/app/stores/rule';
import { useTarget } from '@/app/stores/target';
import { navigate, toast, useUi } from '@/app/stores/ui';
import { useBatch } from '@/app/services/batch';
import { ConnectionGate } from '@/app/components/Shell';
import { describeSpec } from '@/app/components/RecipeDialog';
import { Button, Card, Field, Input, Notice, PageHeader, ProgressBar, Select, Textarea, cx } from '@/app/components/ui';

type SourceKey = 'rule' | 'recipe' | 'tables' | 'metadata' | 'jsonld' | 'contacts' | 'links' | 'images';

export function BatchPage() {
  const pageUrl = useTarget((state) => state.url);
  const tableOptions = useUi((state) => state.settings.tables);
  const defaultDelay = useUi((state) => state.settings.pagination.delayMs);
  const rule = useRule((state) => state.rule);
  const ruleOrigin = useRule((state) => state.origin);
  const datasets = useData((state) => state.items);
  const batch = useBatch();

  const ruleUsable = rule.fields.length > 0 && rule.fields.every((field) => field.selector.trim() || rule.rowSelector.trim());
  const [source, setSource] = useState<SourceKey>(ruleUsable ? 'rule' : 'metadata');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeId, setRecipeId] = useState('');
  const [text, setText] = useState('');
  const [maxUrls, setMaxUrls] = useState(50);
  const [delayMs, setDelayMs] = useState(defaultDelay);
  const [columnKey, setColumnKey] = useState('');

  useEffect(() => {
    listRecipes().then(setRecipes).catch(() => setRecipes([]));
  }, []);

  const spec: ExtractSpec | null = useMemo(() => {
    switch (source) {
      case 'rule':
        return ruleUsable ? { kind: 'rule', rule, method: ruleOrigin } : null;
      case 'recipe':
        return recipes.find((recipe) => recipe.id === recipeId)?.spec ?? null;
      case 'tables':
        return { kind: 'tables', indexes: 'all', options: tableOptions };
      case 'metadata':
        return { kind: 'metadata', options: DEFAULT_META_OPTIONS };
      case 'jsonld':
        return { kind: 'jsonld' };
      case 'contacts':
        return { kind: 'contacts' };
      case 'links':
        return { kind: 'links', options: DEFAULT_LINK_OPTIONS };
      case 'images':
        return { kind: 'images', options: DEFAULT_IMAGE_OPTIONS };
    }
  }, [source, ruleUsable, rule, ruleOrigin, recipes, recipeId, tableOptions]);

  // Columns of the open datasets that hold web addresses.
  const urlColumns = useMemo(() => {
    const out: { key: string; label: string; values: string[] }[] = [];
    for (const item of datasets) {
      item.dataset.columns.forEach((column, index) => {
        const sample = item.dataset.rows.slice(0, 50).map((row) => row.cells[index] ?? '').filter(Boolean);
        if (sample.length === 0 || sample.filter((value) => inferValueType(value) === 'url').length / sample.length < 0.6) return;
        out.push({
          key: `${item.dataset.id}:${column.id}`,
          label: `${item.dataset.name} → ${column.name}`,
          values: item.dataset.rows.map((row) => row.cells[index] ?? ''),
        });
      });
    }
    return out;
  }, [datasets]);

  const parsed = useMemo(() => normalizeUrlList(text), [text]);
  const origin = originOf(pageUrl);
  const otherSites = parsed.urls.filter((url) => originOf(url) !== origin).length;
  const planned = Math.min(parsed.urls.length, Math.max(1, maxUrls));

  const start = () => {
    if (!spec) {
      toast.info(t('Choose what to extract first.'));
      return;
    }
    if (parsed.urls.length === 0) {
      toast.info(t('Add at least one web address.'));
      return;
    }
    void batch.start(parsed.urls, spec, { maxUrls: Math.max(1, maxUrls), delayMs: Math.max(0, delayMs), sourceColumn: t('Source URL') });
  };

  const summary = batch.summary;
  const progress = batch.progress;

  return (
    <ConnectionGate>
      <div className="page-enter mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <PageHeader
          title={t('Batch URLs')}
          description={t('Run the same extraction on a list of pages, one after another in the connected tab. Useful for the detail pages behind a listing. You start it, and it stops at the end of your list.')}
        />

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">{t('1 · What to extract on each page')}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('Source')}>
              {(id) => (
                <Select id={id} value={source} onChange={(event) => setSource(event.target.value as SourceKey)} disabled={batch.running} data-testid="batch-source">
                  <option value="rule" disabled={!ruleUsable}>
                    {ruleUsable ? t('Current selector rule ({count} fields)', { count: rule.fields.length }) : t('Current selector rule (none yet)')}
                  </option>
                  <option value="recipe" disabled={recipes.length === 0}>
                    {recipes.length > 0 ? t('A saved recipe') : t('A saved recipe (none yet)')}
                  </option>
                  <option value="tables">{t('All tables')}</option>
                  <option value="metadata">{t('Page metadata')}</option>
                  <option value="jsonld">{t('JSON-LD structured data')}</option>
                  <option value="contacts">{t('Emails, phone numbers and social profiles')}</option>
                  <option value="links">{t('All links')}</option>
                  <option value="images">{t('All images')}</option>
                </Select>
              )}
            </Field>
            {source === 'recipe' ? (
              <Field label={t('Recipe')}>
                {(id) => (
                  <Select id={id} value={recipeId} onChange={(event) => setRecipeId(event.target.value)} disabled={batch.running}>
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
          {spec ? <p className="text-xs text-zinc-600 dark:text-zinc-400">{describeSpec(spec)}</p> : <Notice tone="amber" icon={Info}>{t('Nothing selected yet. Build a rule in the Visual Selector or Advanced Selectors, or pick another source.')}</Notice>}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">{t('2 · Pages to visit')}</h2>
          {urlColumns.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('Take addresses from a column of the open data')} className="min-w-64 flex-1">
                {(id) => (
                  <Select id={id} value={columnKey} onChange={(event) => setColumnKey(event.target.value)} disabled={batch.running} data-testid="batch-column">
                    <option value="">{t('Choose a column…')}</option>
                    {urlColumns.map((column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button
                icon={ListPlus}
                disabled={!columnKey || batch.running}
                data-testid="batch-use-column"
                onClick={() => {
                  const column = urlColumns.find((item) => item.key === columnKey);
                  if (column) setText(column.values.filter(Boolean).join('\n'));
                }}
              >
                {t('Use these addresses')}
              </Button>
            </div>
          ) : null}
          <Field label={t('Web addresses, one per line')} hint={t('Only http and https addresses are used. Duplicates are visited once.')}>
            {(id) => <Textarea id={id} rows={7} value={text} spellCheck={false} disabled={batch.running} className="font-mono text-xs" placeholder={'https://example.com/item/1\nhttps://example.com/item/2'} onChange={(event) => setText(event.target.value)} data-testid="batch-urls" />}
          </Field>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400" data-testid="batch-count">
            <span>{t('{count} addresses', { count: formatNumber(parsed.urls.length) })}</span>
            {parsed.duplicates > 0 ? <span>{t('{count} duplicates ignored', { count: parsed.duplicates })}</span> : null}
            {parsed.invalid.length > 0 ? <span className="text-amber-700 dark:text-amber-400">{t('{count} lines are not web addresses and will be skipped', { count: parsed.invalid.length })}</span> : null}
          </div>
          {otherSites > 0 ? (
            <Notice tone="amber" icon={AlertTriangle}>
              {t('{count} addresses are on a different site than the connected page. {name} only has access to the site you invoked it on, so those pages are skipped unless you granted access to that site (Settings → Site access).', { count: otherSites, name: brand.name })}
            </Notice>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('Maximum pages')} hint={t('The run never goes past this.')}>
              {(id) => <Input id={id} type="number" min={1} max={100000} value={maxUrls} disabled={batch.running} onChange={(event) => setMaxUrls(Math.max(1, Math.floor(Number(event.target.value)) || 1))} data-testid="batch-max" />}
            </Field>
            <Field label={t('Delay between pages (ms)')} hint={t('Be gentle with the site.')}>
              {(id) => <Input id={id} type="number" min={0} max={600000} value={delayMs} disabled={batch.running} onChange={(event) => setDelayMs(Math.max(0, Math.floor(Number(event.target.value)) || 0))} data-testid="batch-delay" />}
            </Field>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-4" data-testid="batch-run">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t('3 · Run')}</h2>
            {batch.running ? (
              <Button variant="danger" icon={Square} onClick={() => batch.stop()} data-testid="batch-stop">
                {t('Stop')}
              </Button>
            ) : (
              <Button variant="primary" icon={Play} disabled={!spec || parsed.urls.length === 0} onClick={start} data-testid="batch-start">
                {parsed.urls.length > 0 ? t('Visit {count} pages', { count: formatNumber(planned) }) : t('Start')}
              </Button>
            )}
          </div>

          {batch.running && progress ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <ProgressBar value={progress.total ? (progress.index - 1) / progress.total : undefined} label={t('Batch progress')} />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                <span>{t('Page {n} of {total}', { n: progress.index, total: progress.total })}</span>
                <span>{t('{count} records', { count: formatNumber(progress.records) })}</span>
                {progress.failed > 0 ? <span className="text-red-600 dark:text-red-400">{t('{count} failed', { count: progress.failed })}</span> : null}
              </div>
              <p className="truncate font-mono text-xs text-zinc-500">{progress.url}</p>
            </div>
          ) : null}

          {summary && !batch.running ? (
            <div className="flex flex-col gap-2" data-testid="batch-summary" data-reason={summary.reason}>
              <Notice tone={summary.records > 0 ? 'brand' : 'amber'} icon={summary.failed > 0 ? AlertTriangle : CheckCircle2} role="status">
                <div className="font-medium">{t('{records} records from {visited} of {total} pages', { records: formatNumber(summary.records), visited: summary.visited, total: summary.total })}</div>
                <div>
                  {summary.reason === 'completed' ? t('Reached the end of your list.') : describeStop(summary.reason)}
                  {summary.failed > 0 ? ` ${t('{count} pages failed – see the log below.', { count: summary.failed })}` : ''}
                </div>
              </Notice>
              {summary.records > 0 ? (
                <div>
                  <Button variant="primary" icon={Sheet} onClick={() => navigate('/data')} data-testid="batch-view-data">
                    {t('View the data')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {batch.log.length > 0 ? (
            <details className="text-xs" open={batch.running || (summary?.failed ?? 0) > 0}>
              <summary className="font-medium text-zinc-600 dark:text-zinc-400">{t('Activity log ({count})', { count: batch.log.length })}</summary>
              <ol className="mt-2 flex max-h-56 flex-col gap-1 overflow-auto rounded-md border border-zinc-200 p-2 font-mono dark:border-zinc-800" data-testid="batch-log">
                {batch.log.map((entry, index) => (
                  <li key={index} className={cx('truncate', entry.kind === 'error' && 'text-red-600 dark:text-red-400', entry.kind === 'warning' && 'text-amber-700 dark:text-amber-400')} title={`${entry.url} — ${entry.message}`}>
                    {entry.message} · {entry.url}
                  </li>
                ))}
              </ol>
            </details>
          ) : !batch.running && !summary ? (
            <p className="text-[13px] text-zinc-500">{t('Each row gets a “Source URL” column so you know which page it came from. The connected tab ends on the last page of the list.')}</p>
          ) : null}
        </Card>
      </div>
    </ConnectionGate>
  );
}
