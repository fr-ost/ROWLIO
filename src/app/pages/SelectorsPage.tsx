// Advanced Selectors: test CSS selectors / XPath against the page, inspect the matches,
// and build multi-field extraction rules.
import { useState } from 'react';
import { Eye, FlaskConical, Plus, Rows3, Trash2 } from 'lucide-react';
import type { ExtractKind, SelectorTestResult, SelectorType } from '@/types';
import { formatNumber, t } from '@/i18n';
import { request } from '@/messaging/tabClient';
import { useRule } from '@/app/stores/rule';
import { focusTargetTab, useTarget } from '@/app/stores/target';
import { toast } from '@/app/stores/ui';
import { describeError } from '@/app/services/extract';
import { ConnectionGate } from '@/app/components/Shell';
import { RuleEditor } from '@/app/components/RuleEditor';
import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select } from '@/app/components/ui';

function Tester() {
  const tabId = useTarget((state) => state.tabId);
  const [selector, setSelector] = useState('');
  const [selectorType, setSelectorType] = useState<SelectorType>('css');
  const [extract, setExtract] = useState<ExtractKind>('text');
  const [attribute, setAttribute] = useState('');
  const [result, setResult] = useState<SelectorTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    if (tabId === null) return;
    if (!selector.trim()) {
      setResult({ valid: false, error: t('Enter a selector.'), count: 0, samples: [] });
      return;
    }
    setTesting(true);
    try {
      setResult(await request(tabId, 'selector:test', { selector, selectorType, extract, attribute: attribute || undefined, limit: 10 }));
    } catch (error) {
      setResult({ valid: false, error: describeError(error), count: 0, samples: [] });
    } finally {
      setTesting(false);
    }
  };

  const show = async () => {
    if (tabId === null) return;
    try {
      const { count } = await request(tabId, 'highlight:show', { selector, selectorType });
      if (count > 0) await focusTargetTab();
      else toast.info(t('Nothing matches on the page, so there is nothing to highlight.'));
    } catch (error) {
      toast.error(t('Could not highlight the matches'), describeError(error));
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="selector-tester">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-brand-600" aria-hidden />
        <h2 className="text-sm font-semibold">{t('Try a selector')}</h2>
      </div>
      <form
        className="grid gap-2 md:grid-cols-[6rem_minmax(0,1fr)_9rem_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void test();
        }}
      >
        <Select value={selectorType} aria-label={t('Selector type')} onChange={(event) => setSelectorType(event.target.value as SelectorType)} data-testid="tester-type">
          <option value="css">CSS</option>
          <option value="xpath">XPath</option>
        </Select>
        <Input mono value={selector} spellCheck={false} aria-label={t('Selector or XPath expression')} placeholder={selectorType === 'css' ? 'table.results td:nth-child(2)' : '//h2[contains(@class, "title")]/a/@href'} onChange={(event) => setSelector(event.target.value)} invalid={result ? !result.valid : false} data-testid="tester-input" />
        <Select value={extract} aria-label={t('What to extract')} onChange={(event) => setExtract(event.target.value as ExtractKind)}>
          <option value="text">{t('Text')}</option>
          <option value="href">{t('Link URL')}</option>
          <option value="src">{t('Image URL')}</option>
          <option value="html">{t('HTML')}</option>
          <option value="attr">{t('Attribute…')}</option>
        </Select>
        <Button type="submit" variant="primary" loading={testing} data-testid="tester-run">
          {t('Test')}
        </Button>
        {extract === 'attr' ? (
          <Field label={t('Attribute name')} className="md:col-span-2">
            {(id) => <Input id={id} mono value={attribute} spellCheck={false} placeholder="data-id" onChange={(event) => setAttribute(event.target.value)} />}
          </Field>
        ) : null}
      </form>

      {result ? (
        result.valid ? (
          <div className="flex flex-col gap-2" data-testid="tester-result">
            <div className="flex flex-wrap items-center gap-2">
              {result.scalar !== undefined ? (
                <>
                  <Badge tone="blue">{t('Value')}</Badge>
                  <code className="font-mono text-xs" data-testid="tester-scalar">
                    {result.scalar}
                  </code>
                </>
              ) : (
                <Badge tone={result.count > 0 ? 'brand' : 'amber'} >
                  <span data-testid="tester-count">{t('{count} matches', { count: formatNumber(result.count) })}</span>
                </Badge>
              )}
              {result.count > 0 && result.scalar === undefined ? (
                <>
                  <Button size="sm" icon={Eye} onClick={() => void show()}>
                    {t('Highlight on page')}
                  </Button>
                  <Button size="sm" icon={Rows3} onClick={() => useRule.getState().patchRule({ rowSelector: selector, rowSelectorType: selectorType })} data-testid="use-as-row">
                    {t('Use as row selector')}
                  </Button>
                  <Button
                    size="sm"
                    icon={Plus}
                    onClick={() => useRule.getState().addField({ selector, selectorType, extract, attribute: extract === 'attr' ? attribute : undefined })}
                    data-testid="add-as-field"
                  >
                    {t('Add as field')}
                  </Button>
                </>
              ) : null}
            </div>
            {result.count === 0 && result.scalar === undefined ? (
              <Notice tone="amber">{t('The selector is valid but matches nothing on this page. Check spelling, or whether the content is loaded later or sits inside a frame.')}</Notice>
            ) : null}
            {result.samples.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {result.samples.map((sample) => (
                  <li key={sample.index} className="rounded-md border border-zinc-200 p-2.5 text-xs dark:border-zinc-800" data-testid="tester-sample">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{`#${sample.index + 1}`}</Badge>
                      <code className="font-mono text-zinc-500">&lt;{sample.tag}&gt;</code>
                      <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">{sample.value || t('(empty)')}</span>
                    </div>
                    {sample.html ? (
                      // Page markup is shown as text only – it is never rendered as HTML.
                      <pre className="mt-1.5 max-h-20 overflow-auto rounded bg-zinc-50 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">{sample.html}</pre>
                    ) : null}
                    {sample.attributes.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {sample.attributes.map(([name, value]) => (
                          <span key={name} className="max-w-full truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" title={`${name}="${value}"`}>
                            {name}="{value}"
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.count > result.samples.length && result.samples.length > 0 ? <p className="text-xs text-zinc-500">{t('Showing the first {shown} matches.', { shown: result.samples.length })}</p> : null}
          </div>
        ) : (
          <Notice tone="red" role="alert">
            <span data-testid="tester-error">{result.error}</span>
          </Notice>
        )
      ) : null}
    </Card>
  );
}

export function SelectorsPage() {
  const rule = useRule((state) => state.rule);
  const hasRule = rule.rowSelector.trim() !== '' || rule.fields.length > 0;
  return (
    <ConnectionGate>
      <div className="page-enter mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <PageHeader
          title={t('Advanced Selectors')}
          description={t('Extract with CSS selectors or XPath: text, HTML, attributes, links and image sources. Test a selector first, then build a rule with several fields.')}
          actions={
            hasRule ? (
              <Button icon={Trash2} onClick={() => useRule.getState().clear()}>
                {t('Clear rule')}
              </Button>
            ) : null
          }
        />
        <Tester />
        <RuleEditor method="selectors" />
      </div>
    </ConnectionGate>
  );
}
