// Saved Recipes: reusable extraction settings (selectors, fields, pagination) – no data.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, Download, MoreHorizontal, Pencil, Play, Search, SquarePen, Trash2, Upload } from 'lucide-react';
import type { Recipe } from '@/types';
import { brand } from '@/config/brand';
import { t } from '@/i18n';
import { deleteRecipe, exportRecipeFile, importRecipeFile, listRecipes } from '@/storage/recipes';
import { matchesUrlPattern } from '@/utils/url';
import { useRule } from '@/app/stores/rule';
import { useTarget } from '@/app/stores/target';
import { navigate, toast } from '@/app/stores/ui';
import { runRecipe } from '@/app/services/actions';
import { describeSpec, METHOD_LABELS, RecipeDialog } from '@/app/components/RecipeDialog';
import { Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Input, Menu, PageHeader, Spinner, type MenuItem } from '@/app/components/ui';

function saveJsonFile(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function RecipesPage() {
  const pageUrl = useTarget((state) => state.url);
  const status = useTarget((state) => state.status);
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [deleting, setDeleting] = useState<Recipe | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setRecipes(await listRecipes());
    } catch (error) {
      setRecipes([]);
      toast.error(t('Could not read saved recipes'), error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = (recipes ?? []).filter((recipe) => !needle || [recipe.name, recipe.description, recipe.urlPattern].some((value) => value.toLowerCase().includes(needle)));
    // Recipes meant for the connected page come first.
    return list.sort((a, b) => Number(matchesUrlPattern(pageUrl, b.urlPattern)) - Number(matchesUrlPattern(pageUrl, a.urlPattern)));
  }, [recipes, query, pageUrl]);

  const run = async (recipe: Recipe) => {
    if (status !== 'ready') {
      toast.info(t('Connect a page first'), t('Open the page you want to extract from and click the {name} icon there.', { name: brand.name }));
      return;
    }
    setRunning(recipe.id);
    try {
      await runRecipe(recipe);
    } finally {
      setRunning(null);
    }
  };

  const loadIntoEditor = (recipe: Recipe) => {
    if (recipe.spec.kind !== 'rule') return;
    const origin = recipe.spec.method ?? 'selectors';
    useRule.getState().setRule(recipe.spec.rule, origin, { matched: null, sourceUrl: recipe.sourceUrl });
    navigate(origin === 'visual' ? '/visual' : '/selectors');
  };

  const importFile = async (file: File) => {
    try {
      const { imported, skipped } = await importRecipeFile(JSON.parse(await file.text()));
      if (imported === 0) toast.warning(t('No recipes were imported'), skipped > 0 ? t('{count} entries in the file are not valid recipes.', { count: skipped }) : t('The file contains no recipes.'));
      else toast.success(t('Imported {count} recipe(s)', { count: imported }), skipped > 0 ? t('{count} invalid entries were skipped.', { count: skipped }) : undefined);
      await reload();
    } catch (error) {
      toast.error(t('That file could not be imported'), error instanceof SyntaxError ? t('It is not a valid {name} recipe file.', { name: brand.name }) : error instanceof Error ? error.message : String(error));
    }
  };

  const menuFor = (recipe: Recipe): MenuItem[] => [
    { label: t('Edit name, description, URL pattern…'), icon: Pencil, onSelect: () => setEditing(recipe) },
    { label: t('Open selectors in the editor'), icon: SquarePen, disabled: recipe.spec.kind !== 'rule', onSelect: () => loadIntoEditor(recipe) },
    { label: t('Export this recipe'), icon: Download, onSelect: () => saveJsonFile(exportRecipeFile([recipe]), `${brand.filePrefix}-recipe${brand.recipeFileExtension}`) },
    { type: 'separator' },
    { label: t('Delete…'), icon: Trash2, danger: true, onSelect: () => setDeleting(recipe) },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <PageHeader
        title={t('Saved Recipes')}
        description={t('A recipe remembers how to extract (method, selectors, fields, pagination limits) so you can repeat it on similar pages. Recipes contain no page content.')}
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="recipe-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importFile(file);
              }}
            />
            <Button icon={Upload} onClick={() => fileInput.current?.click()}>
              {t('Import')}
            </Button>
            <Button icon={Download} disabled={!recipes || recipes.length === 0} onClick={() => recipes && saveJsonFile(exportRecipeFile(recipes), `${brand.filePrefix}-recipes${brand.recipeFileExtension}`)}>
              {t('Export all')}
            </Button>
          </>
        }
      />

      {recipes === null ? (
        <div className="py-10 text-center">
          <Spinner label={t('Loading recipes…')} />
        </div>
      ) : recipes.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookMarked}
            title={t('No recipes yet')}
            description={t('Build an extraction in the Visual Selector, Advanced Selectors or Pagination screen and choose “Save as recipe”.')}
            action={
              <>
                <Button variant="primary" onClick={() => navigate('/visual')}>
                  {t('Open Visual Selector')}
                </Button>
                <Button onClick={() => navigate('/selectors')}>{t('Open Advanced Selectors')}</Button>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="relative w-72 max-w-full">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-zinc-400" aria-hidden />
            <Input type="search" className="pl-8" value={query} placeholder={t('Search recipes…')} aria-label={t('Search recipes')} onChange={(event) => setQuery(event.target.value)} />
          </div>
          {visible.length === 0 ? (
            <Card>
              <EmptyState icon={Search} title={t('No recipes match')} description={t('Try a different search.')} />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800" data-testid="recipe-list">
                {visible.map((recipe) => {
                  const matches = matchesUrlPattern(pageUrl, recipe.urlPattern);
                  return (
                    <li key={recipe.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="recipe-row">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[13px] font-semibold" data-testid="recipe-title">
                            {recipe.name}
                          </span>
                          <Badge tone="brand">{t(METHOD_LABELS[recipe.spec.kind])}</Badge>
                          {recipe.pagination ? <Badge tone="blue">{recipe.pagination.mode === 'scroll' ? t('Infinite scroll') : t('Up to {n} pages', { n: recipe.pagination.maxPages })}</Badge> : null}
                          {matches ? <Badge tone="violet">{t('Matches the connected page')}</Badge> : null}
                        </div>
                        {recipe.description ? <div className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-400">{recipe.description}</div> : null}
                        <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                          {recipe.urlPattern || t('(no URL pattern)')} · {describeSpec(recipe.spec)}
                        </div>
                      </div>
                      <Button size="sm" variant="primary" icon={Play} loading={running === recipe.id} onClick={() => void run(recipe)} data-testid="run-recipe">
                        {t('Run on connected page')}
                      </Button>
                      <Menu
                        label={t('Actions for {name}', { name: recipe.name })}
                        align="end"
                        items={menuFor(recipe)}
                        trigger={({ ref, ...props }) => <IconButton ref={ref as (el: HTMLButtonElement | null) => void} icon={MoreHorizontal} label={t('Actions for {name}', { name: recipe.name })} data-testid="recipe-menu" {...props} />}
                      />
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}

      <RecipeDialog open={editing !== null} onClose={() => setEditing(null)} spec={editing?.spec ?? null} pagination={editing?.pagination ?? null} sourceUrl={editing?.sourceUrl ?? ''} existing={editing} onSaved={() => void reload()} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('Delete this recipe?')}
        message={t('“{name}” will be permanently removed. Data you already extracted with it is not affected.', { name: deleting?.name ?? '' })}
        confirmLabel={t('Delete recipe')}
        danger
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteRecipe(deleting.id);
            toast.success(t('Deleted “{name}”', { name: deleting.name }));
            await reload();
          } catch (error) {
            toast.error(t('Could not delete the recipe'), error instanceof Error ? error.message : String(error));
          }
        }}
      />
    </div>
  );
}
