// Visual Selector: point-and-click selection of repeated records, plus automatic
// detection of repeating structures as a starting point.
import { useCallback, useEffect, useState } from 'react';
import { MousePointerClick, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { PatternCandidate } from '@/types';
import { brand } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { request } from '@/messaging/tabClient';
import { useRule } from '@/app/stores/rule';
import { useTarget } from '@/app/stores/target';
import { toast } from '@/app/stores/ui';
import { describeError } from '@/app/services/extract';
import { startRecordPicker } from '@/app/services/picker';
import { ConnectionGate } from '@/app/components/Shell';
import { RuleEditor } from '@/app/components/RuleEditor';
import { Badge, Button, Card, EmptyState, Notice, PageHeader, Spinner } from '@/app/components/ui';

export function VisualPage() {
  const tabId = useTarget((state) => state.tabId);
  const status = useTarget((state) => state.status);
  const pageUrl = useTarget((state) => state.url);
  const rule = useRule((state) => state.rule);
  const matched = useRule((state) => state.matched);
  const [patterns, setPatterns] = useState<PatternCandidate[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const hasRule = rule.rowSelector.trim() !== '' || rule.fields.length > 0;

  const detect = useCallback(async () => {
    if (tabId === null || status !== 'ready') return;
    setDetecting(true);
    try {
      setPatterns(await request(tabId, 'patterns:detect', { limit: 8 }));
    } catch (error) {
      useTarget.getState().markError(error);
      toast.error(t('Could not analyse the page'), describeError(error));
      setPatterns([]);
    } finally {
      setDetecting(false);
    }
  }, [tabId, status]);

  useEffect(() => {
    if (!hasRule) void detect();
  }, [detect, hasRule, pageUrl]);

  const usePattern = async (pattern: PatternCandidate) => {
    if (tabId === null) return;
    setBuilding(pattern.selector);
    try {
      const { rule: built, count } = await request(tabId, 'patterns:build', { selector: pattern.selector });
      useRule.getState().setRule(built, 'visual', { matched: count, sourceUrl: pageUrl });
      if (built.fields.length === 0) toast.warning(t('No fields were detected in these records'), t('Add fields yourself below, or pick them on the page.'));
    } catch (error) {
      toast.error(t('Could not use that pattern'), describeError(error));
    } finally {
      setBuilding(null);
    }
  };

  return (
    <ConnectionGate>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <PageHeader
          title={t('Visual Selector')}
          description={t('Click one item on the page (a product card, a search result, a directory entry) and {name} finds the others like it and the fields inside them.', { name: brand.name })}
          actions={
            <>
              {hasRule ? (
                <Button icon={Trash2} onClick={() => useRule.getState().clear()} data-testid="clear-rule">
                  {t('Start over')}
                </Button>
              ) : null}
              <Button variant="primary" icon={MousePointerClick} onClick={() => void startRecordPicker()} data-testid="start-picker">
                {hasRule ? t('Pick again on page') : t('Select on page')}
              </Button>
            </>
          }
        />

        {hasRule ? (
          <>
            {matched !== null ? (
              <Notice tone="brand" icon={Sparkles}>
                {t('{count} records and {fields} fields were detected. Rename, reorder or remove fields below; nothing is extracted until you press Extract.', { count: formatNumber(matched), fields: rule.fields.length })}
              </Notice>
            ) : null}
            <RuleEditor method="visual" />
          </>
        ) : (
          <>
            <Card className="p-5">
              <ol className="grid gap-4 text-[13px] md:grid-cols-3">
                {[
                  [t('Press “Select on page”'), t('You are taken to the page. Hover to see what would be selected.')],
                  [t('Click one item'), t('Similar items are highlighted. Use Wider / Narrower if the wrong block is chosen.')],
                  [t('Check the fields'), t('Rename, remove or add fields by clicking, then send the records back here.')],
                ].map(([title, body], index) => (
                  <li key={index} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{index + 1}</span>
                    <span>
                      <span className="block font-medium">{title}</span>
                      <span className="text-zinc-600 dark:text-zinc-400">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>

            <Card className="p-4" data-testid="pattern-list">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{t('Detected automatically')}</h2>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('Repeating structures found on this page. Pick one to start from, or select on the page yourself.')}</p>
                </div>
                <Button size="sm" icon={RefreshCw} loading={detecting} onClick={() => void detect()}>
                  {t('Detect again')}
                </Button>
              </div>
              {patterns === null ? (
                <div className="py-6 text-center">
                  <Spinner label={t('Analysing the page…')} />
                </div>
              ) : patterns.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title={t('No repeating structure found')}
                  description={t('The page may hold a single item, or build its content in an unusual way. Use “Select on page”: if no pattern is found around your click you can point at two examples and {name} generalises from them.', { name: brand.name })}
                />
              ) : (
                <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
                  {patterns.map((pattern) => (
                    <li key={pattern.selector} className="flex items-start gap-3 py-3" data-testid="pattern">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="brand">{t('{count} items', { count: formatNumber(pattern.count) })}</Badge>
                          <code className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{pattern.selector}</code>
                        </div>
                        <ul className="mt-1.5 flex flex-col gap-0.5">
                          {pattern.samples.map((sample, index) => (
                            <li key={index} className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                              {sample || t('(no text)')}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Button size="sm" loading={building === pattern.selector} onClick={() => void usePattern(pattern)} data-testid="use-pattern">
                        {t('Use')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </ConnectionGate>
  );
}
