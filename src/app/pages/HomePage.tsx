// Home / Extract: what the connected page offers and one-click ways to extract it.
import { useEffect, useState } from 'react';
import {
  BookMarked,
  Braces,
  Code2,
  Crosshair,
  FileText,
  Image as ImageIcon,
  Layers,
  Link2,
  List,
  MousePointerClick,
  Play,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { ExtractSpec, ImageOptions, LinkOptions, MetaOptions, Recipe } from '@/types';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_LINK_OPTIONS, DEFAULT_LIST_OPTIONS, DEFAULT_META_OPTIONS } from '@/types';
import { brand } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { findMatchingRecipes, listRecipes } from '@/storage/recipes';
import { useTarget } from '@/app/stores/target';
import { navigate, toast } from '@/app/stores/ui';
import { quickExtractTables, runRecipe } from '@/app/services/actions';
import { describeError, openDatasets, runExtraction } from '@/app/services/extract';
import { pickElement, startRecordPicker } from '@/app/services/picker';
import { ConnectionGate } from '@/app/components/Shell';
import { Badge, Button, Card, Checkbox, Field, IconButton, Input, Select, cx } from '@/app/components/ui';
import { Aurora, CountUp, Spotlight } from '@/app/components/fx';

function ActionCard({
  icon: Icon,
  title,
  description,
  count,
  children,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  count?: number | null;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Spotlight className="card-lift flex flex-col gap-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:border-zinc-800 dark:bg-zinc-900" data-testid={testId}>
      <div className="flex items-start gap-3">
        <div className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_6px_14px_-6px_rgb(16_169_116/0.7)]">
          <Icon className="size-4.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {count !== undefined && count !== null ? <Badge tone={count > 0 ? 'brand' : 'neutral'}>{t('{count} found', { count: formatNumber(count) })}</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{description}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">{children}</div>
    </Spotlight>
  );
}

function StatTile({ icon: Icon, label, value, loading }: { icon: LucideIcon; label: string; value: number | undefined; loading: boolean }) {
  return (
    <div className="rounded-xl border border-white/50 bg-white/65 px-3 py-2.5 backdrop-blur-sm transition-transform duration-300 hover:-translate-y-0.5 dark:border-white/10 dark:bg-zinc-900/55">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
        <Icon className="size-3.5 text-brand-600 dark:text-brand-300" aria-hidden />
        {label}
      </div>
      <div className={cx('mt-0.5 text-xl leading-tight font-semibold tracking-tight', value ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-500')}>
        {value === undefined ? <span className={cx('inline-block h-5 w-10 rounded', loading && 'shimmer')} /> : <CountUp value={value} />}
      </div>
    </div>
  );
}

function SelectorInput({
  id,
  value,
  onChange,
  purpose,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  purpose: string;
  placeholder: string;
}) {
  return (
    <div className="flex gap-1.5">
      <Input id={id} mono value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} spellCheck={false} />
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
  );
}

type PageCategory = 'ol' | 'ul' | 'dl' | 'headings' | 'breadcrumbs' | 'meta' | 'jsonld' | 'microdata' | 'contacts';

const CATEGORY_LABELS: [PageCategory, string][] = [
  ['ol', 'Ordered lists'],
  ['ul', 'Unordered lists'],
  ['dl', 'Definition lists'],
  ['headings', 'Headings'],
  ['breadcrumbs', 'Breadcrumbs'],
  ['meta', 'Metadata (title, description, canonical, Open Graph, Twitter Cards)'],
  ['jsonld', 'JSON-LD structured data'],
  ['microdata', 'Schema.org microdata'],
  ['contacts', 'Emails, phone numbers and social profiles'],
];

export function HomePage() {
  const { status, scan, url, title } = useTarget();
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkOptions>(DEFAULT_LINK_OPTIONS);
  const [images, setImages] = useState<ImageOptions>(DEFAULT_IMAGE_OPTIONS);
  const [meta, setMeta] = useState<MetaOptions>(DEFAULT_META_OPTIONS);
  const [categories, setCategories] = useState<Set<PageCategory>>(new Set(['headings', 'meta', 'jsonld']));
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  useEffect(() => {
    let cancelled = false;
    listRecipes()
      .then((all) => {
        if (!cancelled) setRecipes(url ? findMatchingRecipes(all, url) : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);

  const run = async (key: string, specs: ExtractSpec[]) => {
    setBusy(key);
    try {
      const all = [];
      for (const spec of specs) all.push(...(await runExtraction(spec)));
      openDatasets(all, { dropEmpty: specs.length > 1 });
    } catch (error) {
      toast.error(t('Extraction failed'), describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const extractPageContent = () => {
    const specs: ExtractSpec[] = [];
    const lists = { ...DEFAULT_LIST_OPTIONS, ordered: categories.has('ol'), unordered: categories.has('ul'), definition: categories.has('dl') };
    if (lists.ordered || lists.unordered || lists.definition) specs.push({ kind: 'lists', options: lists });
    if (categories.has('headings')) specs.push({ kind: 'headings' });
    if (categories.has('breadcrumbs')) specs.push({ kind: 'breadcrumbs' });
    if (categories.has('meta')) specs.push({ kind: 'metadata', options: meta });
    if (categories.has('jsonld')) specs.push({ kind: 'jsonld' });
    if (categories.has('microdata')) specs.push({ kind: 'microdata' });
    if (categories.has('contacts')) specs.push({ kind: 'contacts' });
    if (specs.length === 0) {
      toast.info(t('Choose at least one category.'));
      return;
    }
    void run('content', specs);
  };

  const toggleCategory = (category: PageCategory, on: boolean) => {
    const next = new Set(categories);
    if (on) next.add(category);
    else next.delete(category);
    setCategories(next);
  };

  return (
    <ConnectionGate>
      <div className="page-enter mx-auto flex max-w-6xl flex-col gap-5 p-6">
        <section className="relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_20px_50px_-30px_rgb(16_169_116/0.45)] dark:border-zinc-800 dark:bg-zinc-900" data-testid="home-hero">
          <Aurora />
          <div className="relative">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-700 uppercase dark:text-brand-300">{status === 'ready' ? t('Connected page') : brand.category}</p>
            <h1 className="mt-1 max-w-3xl text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              {status === 'ready' ? (
                <>
                  {t('What do you want from')} <span className="gradient-text">{title || url}</span>?
                </>
              ) : (
                brand.tagline
              )}
            </h1>
            <p className="mt-1 max-w-2xl truncate text-[13px] text-zinc-600 dark:text-zinc-400">{status === 'ready' ? url : t('Reading the page…')}</p>
            <div className="stagger mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile icon={Table2} label={t('Tables')} value={scan?.dataTables} loading={!scan} />
              <StatTile icon={MousePointerClick} label={t('Repeating lists')} value={scan?.patterns} loading={!scan} />
              <StatTile icon={Link2} label={t('Links')} value={scan?.links} loading={!scan} />
              <StatTile icon={ImageIcon} label={t('Images')} value={scan?.images} loading={!scan} />
              <StatTile icon={List} label={t('Headings')} value={scan?.headings} loading={!scan} />
              <StatTile icon={Braces} label={t('Structured data')} value={scan ? scan.jsonLd + scan.microdata : undefined} loading={!scan} />
            </div>
          </div>
        </section>

        {recipes.length > 0 ? (
          <Card className="p-4" data-testid="matching-recipes">
            <div className="mb-2 flex items-center gap-2">
              <BookMarked className="size-4 text-brand-600" aria-hidden />
              <h2 className="text-sm font-semibold">{t('Saved recipes for this page')}</h2>
            </div>
            <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
              {recipes.map((recipe) => (
                <li key={recipe.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{recipe.name}</div>
                    {recipe.description ? <div className="truncate text-xs text-zinc-500">{recipe.description}</div> : null}
                  </div>
                  {recipe.pagination ? <Badge tone="blue">{recipe.pagination.mode === 'scroll' ? t('Infinite scroll') : t('Pagination')}</Badge> : null}
                  <Button size="sm" variant="primary" icon={Play} onClick={() => void runRecipe(recipe)}>
                    {t('Run')}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ActionCard icon={Table2} title={t('Tables')} description={t('HTML tables with headers, merged cells and nested tables handled.')} count={scan?.dataTables} testId="card-tables">
            <Button variant="primary" loading={busy === 'tables'} disabled={!scan || scan.dataTables === 0} data-testid="home-extract-tables" onClick={async () => {
              setBusy('tables');
              try {
                await quickExtractTables();
              } finally {
                setBusy(null);
              }
            }}>
              {t('Extract all')}
            </Button>
            <Button onClick={() => navigate('/tables')}>{t('Review tables')}</Button>
          </ActionCard>

          <ActionCard icon={MousePointerClick} title={t('Lists & cards')} description={t('Products, search results, articles, directories: click one item and the similar ones are found.')} count={scan?.patterns} testId="card-visual">
            <Button variant="primary" icon={MousePointerClick} onClick={() => void startRecordPicker().then((ok) => ok && navigate('/visual'))} data-testid="home-start-picker">
              {t('Select on page')}
            </Button>
            <Button onClick={() => navigate('/visual')}>{t('Auto-detect')}</Button>
          </ActionCard>

          <ActionCard icon={Code2} title={t('Custom selectors')} description={t('Write CSS selectors or XPath, preview the matches and build reusable rules.')}>
            <Button onClick={() => navigate('/selectors')}>{t('Open Advanced Selectors')}</Button>
          </ActionCard>

          <ActionCard icon={Layers} title={t('Multiple pages')} description={t('Follow next-page links, infinite scroll, or a list of addresses, within limits you set.')}>
            <Button onClick={() => navigate('/pagination')}>{t('Pagination')}</Button>
            <Button onClick={() => navigate('/batch')}>{t('Batch URLs')}</Button>
            {scan?.hasNextPage ? <Badge tone="brand">{t('Next page detected')}</Badge> : null}
          </ActionCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-4" data-testid="card-links">
            <div className="flex items-center gap-2">
              <Link2 className="size-4 text-brand-600" aria-hidden />
              <h2 className="text-sm font-semibold">{t('Links')}</h2>
              {scan ? <Badge>{t('{count} on page', { count: formatNumber(scan.links) })}</Badge> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Which links')}>
                {(id) => (
                  <Select id={id} value={links.scope} onChange={(event) => setLinks({ ...links, scope: event.target.value as LinkOptions['scope'] })}>
                    <option value="all">{t('All links')}</option>
                    <option value="internal">{t('Internal (same site)')}</option>
                    <option value="external">{t('External (other sites)')}</option>
                  </Select>
                )}
              </Field>
              <Field label={t('Link text contains')}>
                {(id) => <Input id={id} value={links.textContains} placeholder={t('Optional')} onChange={(event) => setLinks({ ...links, textContains: event.target.value })} />}
              </Field>
              <Field label={t('Only inside this container')} hint={t('CSS selector, or pick it on the page.')}>
                {(id) => <SelectorInput id={id} value={links.containerSelector} placeholder="nav.sidebar" purpose={t('container holding the links')} onChange={(containerSelector) => setLinks({ ...links, containerSelector })} />}
              </Field>
              <Field label={t('Only links matching')} hint={t('CSS selector for the links themselves.')}>
                {(id) => <Input id={id} mono value={links.matchSelector} placeholder="a.product-link" spellCheck={false} onChange={(event) => setLinks({ ...links, matchSelector: event.target.value })} />}
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox checked={links.dedupe} onChange={(dedupe) => setLinks({ ...links, dedupe })} label={t('Skip duplicate URLs')} />
              <Button variant="primary" icon={Link2} loading={busy === 'links'} onClick={() => void run('links', [{ kind: 'links', options: links }])} data-testid="extract-links">
                {t('Extract links')}
              </Button>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-4" data-testid="card-images">
            <div className="flex items-center gap-2">
              <ImageIcon className="size-4 text-brand-600" aria-hidden />
              <h2 className="text-sm font-semibold">{t('Images')}</h2>
              {scan ? <Badge>{t('{count} on page', { count: formatNumber(scan.images) })}</Badge> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Only inside this container')} hint={t('CSS selector, or pick it on the page.')}>
                {(id) => <SelectorInput id={id} value={images.containerSelector} placeholder=".gallery" purpose={t('container holding the images')} onChange={(containerSelector) => setImages({ ...images, containerSelector })} />}
              </Field>
              <Field label={t('URL contains')}>
                {(id) => <Input id={id} value={images.urlContains} placeholder={t('Optional')} onChange={(event) => setImages({ ...images, urlContains: event.target.value })} />}
              </Field>
              <Field label={t('Minimum width (px)')}>
                {(id) => <Input id={id} type="number" min={0} value={images.minWidth || ''} placeholder="0" onChange={(event) => setImages({ ...images, minWidth: Math.max(0, Number(event.target.value) || 0) })} />}
              </Field>
              <Field label={t('Minimum height (px)')}>
                {(id) => <Input id={id} type="number" min={0} value={images.minHeight || ''} placeholder="0" onChange={(event) => setImages({ ...images, minHeight: Math.max(0, Number(event.target.value) || 0) })} />}
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <Checkbox checked={images.dedupe} onChange={(dedupe) => setImages({ ...images, dedupe })} label={t('Skip duplicate URLs')} />
                <Checkbox checked={images.includeBackgrounds} onChange={(includeBackgrounds) => setImages({ ...images, includeBackgrounds })} label={t('Include CSS backgrounds')} />
              </div>
              <Button variant="primary" icon={ImageIcon} loading={busy === 'images'} onClick={() => void run('images', [{ kind: 'images', options: images }])} data-testid="extract-images">
                {t('Extract images')}
              </Button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('Image addresses are read from the page. {name} does not download the images.', { name: brand.name })}</p>
          </Card>
        </div>

        <Card className="flex flex-col gap-3 p-4" data-testid="card-content">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-brand-600" aria-hidden />
            <h2 className="text-sm font-semibold">{t('Lists, headings, metadata and structured data')}</h2>
            {scan ? (
              <span className="flex flex-wrap gap-1.5">
                <Badge>
                  <List className="mr-1 size-3" aria-hidden />
                  {t('{count} lists', { count: formatNumber(scan.lists) })}
                </Badge>
                <Badge>{t('{count} headings', { count: formatNumber(scan.headings) })}</Badge>
                <Badge>
                  <Braces className="mr-1 size-3" aria-hidden />
                  {t('{count} JSON-LD', { count: scan.jsonLd })}
                </Badge>
                <Badge>{t('{count} microdata items', { count: scan.microdata })}</Badge>
              </span>
            ) : null}
          </div>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {CATEGORY_LABELS.map(([category, label]) => (
              <Checkbox key={category} checked={categories.has(category)} onChange={(on) => toggleCategory(category, on)} label={t(label)} />
            ))}
          </div>
          {categories.has('meta') ? (
            <fieldset className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <legend className="px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('Metadata groups')}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <Checkbox checked={meta.basic} onChange={(basic) => setMeta({ ...meta, basic })} label={t('Title, description, canonical')} />
                <Checkbox checked={meta.openGraph} onChange={(openGraph) => setMeta({ ...meta, openGraph })} label={t('Open Graph')} />
                <Checkbox checked={meta.twitter} onChange={(twitter) => setMeta({ ...meta, twitter })} label={t('Twitter Cards')} />
                <Checkbox checked={meta.otherMeta} onChange={(otherMeta) => setMeta({ ...meta, otherMeta })} label={t('Other meta tags')} />
                <Checkbox checked={meta.linkTags} onChange={(linkTags) => setMeta({ ...meta, linkTags })} label={t('Link tags (alternate, icons…)')} />
              </div>
            </fieldset>
          ) : null}
          <div className="flex justify-end">
            <Button variant="primary" loading={busy === 'content'} onClick={extractPageContent} data-testid="extract-content">
              {t('Extract selected')}
            </Button>
          </div>
        </Card>
      </div>
    </ConnectionGate>
  );
}
