// Cross-page actions: popup intents, quick table extraction, running recipes.
import type { Recipe } from '@/types';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_LINK_OPTIONS } from '@/types';
import { t } from '@/i18n';
import { request } from '@/messaging/tabClient';
import type { WorkspaceIntent } from '@/messaging/protocol';
import { requireTarget, useTarget } from '@/app/stores/target';
import { useRule } from '@/app/stores/rule';
import { navigate, toast, useUi, type Route } from '@/app/stores/ui';
import { describeError, extractAndOpen } from './extract';
import { startRecordPicker } from './picker';

/** Extract every table that looks like real data. Returns false when there is none. */
export async function quickExtractTables(): Promise<boolean> {
  try {
    const tabId = requireTarget();
    const options = useUi.getState().settings.tables;
    const tables = await request(tabId, 'tables:list', { options, previewRows: 1 });
    const indexes = tables.filter((table) => table.isDataTable && table.rowCount > 0).map((table) => table.index);
    if (indexes.length === 0) {
      toast.info(
        t('No data tables found on this page.'),
        t('If the data is laid out as cards or a list, use the Visual Selector instead.'),
      );
      return false;
    }
    return await extractAndOpen({ kind: 'tables', indexes, options }, { dropEmpty: true });
  } catch (error) {
    useTarget.getState().markError(error);
    toast.error(t('Could not read the tables'), describeError(error));
    return false;
  }
}

/** Carry out what the user asked for in the popup / via a keyboard shortcut. */
export async function runIntent(intent: WorkspaceIntent): Promise<void> {
  if (useTarget.getState().status !== 'ready' && intent.kind !== 'page' && intent.kind !== 'none') return;
  switch (intent.kind) {
    case 'tables':
      navigate('/tables');
      if (intent.extractAll) await quickExtractTables();
      break;
    case 'picker':
      navigate('/visual');
      await startRecordPicker();
      break;
    case 'links':
      await extractAndOpen({ kind: 'links', options: DEFAULT_LINK_OPTIONS });
      break;
    case 'images':
      await extractAndOpen({ kind: 'images', options: DEFAULT_IMAGE_OPTIONS });
      break;
    case 'page':
      if (typeof intent.path === 'string') navigate(intent.path as Route);
      break;
    case 'none':
      break;
  }
}

/**
 * Reuse a recipe on the connected page. Recipes with pagination open the Pagination
 * screen pre-filled – the user still presses Start, so nothing crawls on its own.
 */
export async function runRecipe(recipe: Recipe): Promise<void> {
  if (recipe.spec.kind === 'rule') {
    useRule.getState().setRule(recipe.spec.rule, recipe.spec.method ?? 'selectors', { matched: null, sourceUrl: recipe.sourceUrl });
  }
  if (recipe.pagination) {
    useRule.getState().setPaginationSpec(recipe.spec, recipe.name, recipe.pagination);
    navigate('/pagination');
    toast.info(t('Recipe "{name}" loaded', { name: recipe.name }), t('Review the limits, then press Start.'));
    return;
  }
  await extractAndOpen(recipe.spec.kind === 'rule' ? { ...recipe.spec, name: recipe.name } : recipe.spec);
}
