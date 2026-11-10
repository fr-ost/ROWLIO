// Editor for an extraction rule: a row selector plus fields (CSS or XPath), with live
// validation, match counts, sample values and a preview of the resulting records.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, BookMarked, Crosshair, Download, Eye, Layers, Plus, Trash2 } from 'lucide-react';
import type { ExtractKind, ExtractSpec, ExtractionRule, FieldRule, SelectorTestResult, SelectorType } from '@/types';
import { formatNumber, t } from '@/i18n';
import { request } from '@/messaging/tabClient';
import { focusTargetTab, useTarget } from '@/app/stores/target';
import { useRule } from '@/app/stores/rule';
import { navigate, toast } from '@/app/stores/ui';
import { describeError, extractAndOpen } from '@/app/services/extract';
import { pickElement } from '@/app/services/picker';
import { RecipeDialog } from './RecipeDialog';
import { Badge, Button, Card, Checkbox, IconButton, Input, Notice, Select, Spinner, cx } from './ui';

const EXTRACT_LABELS: [ExtractKind, string][] = [
  ['text', 'Text'],
  ['href', 'Link URL'],
  ['src', 'Image URL'],
  ['html', 'HTML'],
  ['attr', 'Attribute…'],
];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Tests a selector on the connected page (debounced). */
function useSelectorTest(
  selector: string,
  selectorType: SelectorType,
  context: { rowSelector?: string; rowSelectorType?: SelectorType; extract?: ExtractKind; attribute?: string; allowEmpty?: boolean },
): { result: SelectorTestResult | null; testing: boolean } {
  const tabId = useTarget((state) => state.tabId);
  const status = useTarget((state) => state.status);
  const url = useTarget((state) => state.url);
  const [result, setResult] = useState<SelectorTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const key = useDebounced(JSON.stringify([selector, selectorType, context.rowSelector ?? '', context.rowSelectorType ?? '', context.extract ?? '', context.attribute ?? '']), 350);
  const seq = useRef(0);

  useEffect(() => {
    const isEmpty = !selector.trim();
    if (tabId === null || status !== 'ready' || (isEmpty && !(context.allowEmpty && context.rowSelector?.trim()))) {
      setResult(null);
      return;
    }
    const current = ++seq.current;
    setTesting(true);
    request(tabId, 'selector:test', {
      selector,
      selectorType,
      limit: 3,
      extract: context.extract,
      attribute: context.attribute,
      rowSelector: context.rowSelector,
      rowSelectorType: context.rowSelectorType,
    })
      .then((value) => {
        if (current === seq.current) setResult(value);
      })
      .catch((error) => {
        if (current === seq.current) setResult({ valid: false, error: describeError(error), count: 0, samples: [] });
      })
      .finally(() => {
        if (current === seq.current) setTesting(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tabId, status, url]);

  return { result, testing };
}

function MatchBadge({ result, testing, unit }: { result: SelectorTestResult | null; testing: boolean; unit: 'matches' | 'rows' }) {
  if (testing && !result) return <Badge>{t('Testing…')}</Badge>;
  if (!result) return null;
  if (!result.valid) return <Badge tone="red">{t('Invalid')}</Badge>;
  if (result.scalar !== undefined && unit === 'matches') return <Badge tone="blue">{t('Value')}</Badge>;
  if (result.count === 0) return <Badge tone="amber">{t('No matches')}</Badge>;
  if (unit === 'rows' || result.rowCount === undefined) {
    return <Badge tone="brand">{t('{count} matches', { count: formatNumber(result.count) })}</Badge>;
  }
  return (
    <Badge tone={result.count < result.rowCount ? 'amber' : 'brand'} title={t('Rows in which this field was found')}>
      {t('{count} of {rows} rows', { count: formatNumber(result.count), rows: formatNumber(result.rowCount) })}
    </Badge>
  );
}

async function highlight(payload: { selector: string; selectorType: SelectorType; rowSelector?: string; rowSelectorType?: SelectorType }): Promise<void> {
  const tabId = useTarget.getState().tabId;
  if (tabId === null) return;
  try {
    const { count } = await request(tabId, 'highlight:show', payload);
    if (count === 0) {
      toast.info(t('Nothing matches on the page, so there is nothing to highlight.'));
      await request(tabId, 'highlight:clear', undefined).catch(() => undefined);
      return;
    }
    await focusTargetTab();
  } catch (error) {
    toast.error(t('Could not highlight the matches'), describeError(error));
  }
}

function FieldRow({ field, index, total, rule }: { field: FieldRule; index: number; total: number; rule: ExtractionRule }) {
  const { updateField, removeField, moveField } = useRule.getState();
  const { result, testing } = useSelectorTest(field.selector, field.selectorType, {
    rowSelector: rule.rowSelector,
    rowSelectorType: rule.rowSelectorType,
    extract: field.extract,
    attribute: field.attribute,
    allowEmpty: true,
  });
  const sample = result?.scalar ?? result?.samples[0]?.value ?? '';
  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="field-row">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1.1fr)_6.5rem_minmax(0,2fr)_9.5rem_auto]">
        <Input value={field.name} aria-label={t('Field name')} placeholder={t('Field name')} onChange={(event) => updateField(field.id, { name: event.target.value })} data-testid="field-name" />
        <Select value={field.selectorType} aria-label={t('Selector type')} onChange={(event) => updateField(field.id, { selectorType: event.target.value as SelectorType })}>
          <option value="css">CSS</option>
          <option value="xpath">XPath</option>
        </Select>
        <Input
          mono
          value={field.selector}
          spellCheck={false}
          aria-label={t('Selector for {name}', { name: field.name })}
          invalid={result ? !result.valid : false}
          placeholder={rule.rowSelector ? (field.selectorType === 'css' ? t('h3.title  (empty = the row itself)') : './/h3') : field.selectorType === 'css' ? 'h3.title' : '//h3'}
          onChange={(event) => updateField(field.id, { selector: event.target.value })}
          data-testid="field-selector"
        />
        <Select
          value={field.extract}
          aria-label={t('What to extract')}
          onChange={(event) => {
            const extract = event.target.value as ExtractKind;
            updateField(field.id, { extract, attribute: extract === 'attr' ? (field.attribute ?? '') : undefined });
          }}
          data-testid="field-extract"
        >
          {EXTRACT_LABELS.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-0.5">
          <IconButton icon={Eye} label={t('Highlight matches on the page')} onClick={() => void highlight({ selector: field.selector, selectorType: field.selectorType, rowSelector: rule.rowSelector, rowSelectorType: rule.rowSelectorType })} />
          <IconButton icon={ArrowUp} label={t('Move field up')} disabled={index === 0} onClick={() => moveField(field.id, -1)} />
          <IconButton icon={ArrowDown} label={t('Move field down')} disabled={index === total - 1} onClick={() => moveField(field.id, 1)} />
          <IconButton icon={Trash2} label={t('Remove field')} onClick={() => removeField(field.id)} data-testid="field-remove" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {field.extract === 'attr' ? (
          <Input className="w-44" mono value={field.attribute ?? ''} aria-label={t('Attribute name')} placeholder={t('attribute, e.g. data-id')} spellCheck={false} onChange={(event) => updateField(field.id, { attribute: event.target.value })} data-testid="field-attribute" />
        ) : null}
        <Checkbox checked={!!field.multiple} onChange={(multiple) => updateField(field.id, { multiple, joinWith: multiple ? (field.joinWith ?? ', ') : undefined })} label={t('Join all matches in a row')} />
        <MatchBadge result={result} testing={testing} unit="matches" />
        {result && !result.valid && result.error ? (
          <span className="text-xs text-red-600 dark:text-red-400" role="alert" data-testid="field-error">
            {result.error}
          </span>
        ) : sample ? (
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={sample} data-testid="field-sample">
            {t('Sample:')} {sample}
          </span>
        ) : null}
      </div>
    </li>
  );
}

interface Preview {
  columns: string[];
  rows: string[][];
  warnings: string[];
  totalRows: number;
}

export function RuleEditor({ method }: { method: 'visual' | 'selectors' }) {
  const rule = useRule((state) => state.rule);
  const { patchRule, addField } = useRule.getState();
  const tabId = useTarget((state) => state.tabId);
  const status = useTarget((state) => state.status);
  const pageUrl = useTarget((state) => state.url);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const rowTest = useSelectorTest(rule.rowSelector, rule.rowSelectorType, {});
  const ruleKey = useDebounced(JSON.stringify(rule), 500);
  const seq = useRef(0);

  const usable = rule.fields.length > 0 && rule.fields.every((field) => field.selector.trim() || rule.rowSelector.trim());
  const spec: ExtractSpec = { kind: 'rule', rule, method };

  useEffect(() => {
    if (tabId === null || status !== 'ready' || !usable) {
      setPreview(null);
      setPreviewError('');
      return;
    }
    const current = ++seq.current;
    setPreviewing(true);
    request(tabId, 'rule:preview', { rule, limit: 20 })
      .then((value) => {
        if (current !== seq.current) return;
        setPreview(value);
        setPreviewError('');
      })
      .catch((error) => {
        if (current !== seq.current) return;
        setPreview(null);
        setPreviewError(describeError(error));
      })
      .finally(() => {
        if (current === seq.current) setPreviewing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleKey, tabId, status, pageUrl]);

  const extract = async () => {
    setExtracting(true);
    try {
      await extractAndOpen(spec);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">{t('Rows')}</h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {t('A selector that matches one element per record (one product card, one search result). Leave it empty to match every field across the whole page and line the values up by position.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-24" value={rule.rowSelectorType} aria-label={t('Row selector type')} onChange={(event) => patchRule({ rowSelectorType: event.target.value as SelectorType })}>
            <option value="css">CSS</option>
            <option value="xpath">XPath</option>
          </Select>
          <Input
            className="min-w-56 flex-1"
            mono
            value={rule.rowSelector}
            spellCheck={false}
            aria-label={t('Row selector')}
            invalid={rowTest.result ? !rowTest.result.valid : false}
            placeholder={rule.rowSelectorType === 'css' ? 'article.product-card' : '//article[@class="product-card"]'}
            onChange={(event) => patchRule({ rowSelector: event.target.value })}
            data-testid="row-selector"
          />
          <IconButton
            icon={Crosshair}
            label={t('Pick an element on the page')}
            className="border border-zinc-300 dark:border-zinc-700"
            onClick={async () => {
              const picked = await pickElement(t('element that represents one record'));
              if (picked) patchRule({ rowSelector: picked.selector, rowSelectorType: 'css' });
            }}
          />
          <IconButton icon={Eye} label={t('Highlight the rows on the page')} className="border border-zinc-300 dark:border-zinc-700" disabled={!rule.rowSelector.trim()} onClick={() => void highlight({ selector: rule.rowSelector, selectorType: rule.rowSelectorType })} />
          <span data-testid="row-match">
            <MatchBadge result={rowTest.result} testing={rowTest.testing} unit="rows" />
          </span>
        </div>
        {rowTest.result && !rowTest.result.valid && rowTest.result.error ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert" data-testid="row-error">
            {rowTest.result.error}
          </p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('Fields ({count})', { count: rule.fields.length })}</h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {rule.rowSelector.trim()
                ? t('Each selector is evaluated inside every row. XPath expressions starting with // are treated as .// (relative to the row).')
                : t('Each selector is evaluated against the whole page.')}
            </p>
          </div>
          <Button icon={Plus} onClick={() => addField({ selectorType: rule.rowSelectorType })} data-testid="add-field">
            {t('Add field')}
          </Button>
        </div>
        {rule.fields.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-[13px] text-zinc-500 dark:border-zinc-700">{t('No fields yet. Add a field and enter a CSS selector or XPath expression.')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rule.fields.map((field, index) => (
              <FieldRow key={field.id} field={field} index={index} total={rule.fields.length} rule={rule} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4" data-testid="rule-preview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{t('Preview')}</h2>
            {preview ? <Badge tone={preview.totalRows > 0 ? 'brand' : 'amber'}>{t('{count} records on this page', { count: formatNumber(preview.totalRows) })}</Badge> : null}
            {previewing ? <Spinner label={t('Updating…')} /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={BookMarked} disabled={!usable} onClick={() => setRecipeOpen(true)} data-testid="save-recipe">
              {t('Save as recipe')}
            </Button>
            <Button
              icon={Layers}
              disabled={!usable}
              onClick={() => {
                useRule.getState().setPaginationSpec(spec, t('Current rule ({count} fields)', { count: rule.fields.length }));
                navigate('/pagination');
              }}
            >
              {t('Extract multiple pages…')}
            </Button>
            <Button variant="primary" icon={Download} disabled={!usable || !preview || preview.totalRows === 0} loading={extracting} onClick={() => void extract()} data-testid="extract-rule">
              {preview && preview.totalRows > 0 ? t('Extract {count} records', { count: formatNumber(preview.totalRows) }) : t('Extract')}
            </Button>
          </div>
        </div>
        {previewError ? (
          <Notice tone="red" icon={AlertTriangle} role="alert">
            {previewError}
          </Notice>
        ) : null}
        {preview?.warnings.map((warning, index) => (
          <Notice key={index} tone="amber" icon={AlertTriangle}>
            {warning}
          </Notice>
        ))}
        {preview && preview.rows.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full border-collapse text-xs" data-testid="preview-table">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                  {preview.columns.map((column, index) => (
                    <th key={index} scope="col" className="border-b border-zinc-200 px-2 py-1.5 text-left font-semibold whitespace-nowrap dark:border-zinc-800">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, r) => (
                  <tr key={r} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    {row.map((cell, c) => (
                      <td key={c} className={cx('max-w-64 truncate px-2 py-1 whitespace-nowrap', cell ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400')} title={cell}>
                        {cell || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !previewError && usable && preview ? (
          <p className="text-[13px] text-zinc-500">{t('Nothing matched on this page yet. Adjust the selectors above.')}</p>
        ) : !usable ? (
          <p className="text-[13px] text-zinc-500">{t('Add at least one field with a selector to see a preview.')}</p>
        ) : null}
        {preview && preview.totalRows > preview.rows.length ? <p className="text-xs text-zinc-500">{t('Showing the first {shown} records.', { shown: preview.rows.length })}</p> : null}
      </Card>

      <RecipeDialog open={recipeOpen} onClose={() => setRecipeOpen(false)} spec={spec} pagination={null} sourceUrl={pageUrl} />
    </div>
  );
}
