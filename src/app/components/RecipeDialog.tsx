// Save (or edit) a reusable extraction recipe.
import { useEffect, useState } from 'react';
import type { ExtractSpec, PaginationSettings, Recipe } from '@/types';
import { t } from '@/i18n';
import { saveRecipe } from '@/storage/recipes';
import { suggestUrlPattern } from '@/utils/url';
import { toast } from '@/app/stores/ui';
import { Badge, Button, Dialog, Field, Input, Textarea } from './ui';

export function describeSpec(spec: ExtractSpec): string {
  switch (spec.kind) {
    case 'tables':
      return spec.indexes === 'all' ? t('All tables') : t('Tables: {list}', { list: spec.indexes.map((index) => index + 1).join(', ') });
    case 'rule':
      return spec.rule.rowSelector
        ? t('{count} fields per row “{selector}”', { count: spec.rule.fields.length, selector: spec.rule.rowSelector })
        : t('{count} fields (column mode)', { count: spec.rule.fields.length });
    case 'links':
      return t('Links');
    case 'images':
      return t('Images');
    case 'lists':
      return t('Lists');
    case 'headings':
      return t('Headings');
    case 'breadcrumbs':
      return t('Breadcrumbs');
    case 'metadata':
      return t('Page metadata');
    case 'jsonld':
      return t('JSON-LD');
    case 'microdata':
      return t('Microdata');
  }
}

export const METHOD_LABELS: Record<ExtractSpec['kind'], string> = {
  tables: 'Table extraction',
  rule: 'Selector rules',
  links: 'Link extraction',
  images: 'Image extraction',
  lists: 'List extraction',
  headings: 'Headings',
  breadcrumbs: 'Breadcrumbs',
  metadata: 'Metadata',
  jsonld: 'JSON-LD',
  microdata: 'Microdata',
};

export function RecipeDialog({
  open,
  onClose,
  spec,
  pagination,
  sourceUrl,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  spec: ExtractSpec | null;
  pagination: PaginationSettings | null;
  sourceUrl: string;
  /** When given, the recipe is updated instead of created. */
  existing?: Recipe | null;
  onSaved?: (recipe: Recipe) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (existing) {
      setName(existing.name);
      setDescription(existing.description);
      setUrlPattern(existing.urlPattern);
    } else {
      setName('');
      setDescription('');
      setUrlPattern(suggestUrlPattern(sourceUrl));
    }
  }, [open, existing, sourceUrl]);

  const effectiveSpec = existing?.spec ?? spec;
  const effectivePagination = existing ? existing.pagination : pagination;

  const save = async () => {
    if (!effectiveSpec) return;
    if (!name.trim()) {
      setError(t('Give the recipe a name.'));
      return;
    }
    setSaving(true);
    try {
      const recipe = await saveRecipe({
        id: existing?.id,
        name: name.trim(),
        description: description.trim(),
        urlPattern: urlPattern.trim(),
        sourceUrl: existing?.sourceUrl ?? sourceUrl,
        spec: effectiveSpec,
        pagination: effectivePagination,
      });
      toast.success(existing ? t('Recipe “{name}” updated', { name: recipe.name }) : t('Recipe “{name}” saved', { name: recipe.name }), t('Find it under Saved Recipes. It is offered automatically on matching pages.'));
      onSaved?.(recipe);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? t('Edit recipe') : t('Save as recipe')}
      description={t('A recipe stores the extraction settings (not the data), so you can repeat it on similar pages.')}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!effectiveSpec} data-testid="recipe-save-confirm">
            {existing ? t('Save changes') : t('Save recipe')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('Name')} error={error}>
          {(id) => <Input id={id} value={name} autoFocus onChange={(event) => setName(event.target.value)} placeholder={t('e.g. Shop product listing')} data-testid="recipe-name" />}
        </Field>
        <Field label={t('Description')}>{(id) => <Textarea id={id} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />}</Field>
        <Field label={t('Pages this recipe is for')} hint={t('URL pattern. Use * as a wildcard, e.g. https://shop.example/category/*')}>
          {(id) => <Input id={id} mono value={urlPattern} spellCheck={false} onChange={(event) => setUrlPattern(event.target.value)} data-testid="recipe-pattern" />}
        </Field>
        {effectiveSpec ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
            <Badge tone="brand">{t(METHOD_LABELS[effectiveSpec.kind])}</Badge>
            <span className="min-w-0 truncate">{describeSpec(effectiveSpec)}</span>
            {effectivePagination ? (
              <Badge tone="blue">
                {effectivePagination.mode === 'scroll'
                  ? t('Infinite scroll, max {n} scrolls', { n: effectivePagination.maxScrolls })
                  : t('Pagination, max {n} pages', { n: effectivePagination.maxPages })}
              </Badge>
            ) : (
              <Badge>{t('Single page')}</Badge>
            )}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
