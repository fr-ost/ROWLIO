// Saved extraction recipes.
import { isObject, isRecipe } from '@/types/guards';
import type { Recipe, RecipeFile } from '@/types/recipes';
import { brand } from '@/config/brand';
import { t } from '@/i18n';
import { getDb, timestamp } from '@/storage/db';
import { uid } from '@/utils/id';
import { matchesUrlPattern } from '@/utils/url';

// Identifier written into exported files; part of the file format (see RecipeFile), so it
// stays stable even if the product is renamed.
const RECIPE_FILE_FORMAT = 'rowlio-recipes';
const RECIPE_FILE_VERSION = 1;

export type SaveRecipeInput = Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

/** Create a recipe, or overwrite the one with `input.id` (its creation date is kept). */
export async function saveRecipe(input: SaveRecipeInput): Promise<Recipe> {
  const db = await getDb();
  const tx = db.transaction('recipes', 'readwrite');
  tx.done.catch(() => undefined);
  try {
    const id = input.id ?? uid('r');
    const existing = input.id === undefined ? undefined : await tx.store.get(id);
    const now = timestamp();
    const recipe: Recipe = {
      id,
      name: input.name.trim() || t('Untitled recipe'),
      description: input.description,
      urlPattern: input.urlPattern.trim(),
      sourceUrl: input.sourceUrl,
      spec: input.spec,
      pagination: input.pagination,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    // Recipes are later replayed against live pages: never store one that fails validation.
    if (!isRecipe(recipe)) throw new Error(t('This recipe is not valid and was not saved.'));
    await tx.store.put(recipe);
    await tx.done;
    return recipe;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already aborted or finished.
    }
    throw error;
  }
}

/** Every recipe, most recently updated first. */
export async function listRecipes(): Promise<Recipe[]> {
  const db = await getDb();
  const recipes = await db.getAllFromIndex('recipes', 'updatedAt');
  return recipes.reverse();
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const db = await getDb();
  return (await db.get('recipes', id)) ?? null;
}

export async function deleteRecipe(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('recipes', id);
}

export function exportRecipeFile(recipes: Recipe[]): RecipeFile {
  return { format: RECIPE_FILE_FORMAT, version: RECIPE_FILE_VERSION, exportedAt: Date.now(), recipes };
}

/**
 * Import a recipe file. Each recipe is validated on its own: valid ones are stored under
 * FRESH ids (an import never overwrites an existing recipe), invalid ones are skipped and
 * counted. Throws when the value is not a recipe file at all.
 */
export async function importRecipeFile(value: unknown): Promise<{ imported: number; skipped: number }> {
  if (!isObject(value) || value.format !== RECIPE_FILE_FORMAT || !Array.isArray(value.recipes)) {
    throw new Error(t('This is not a valid {name} recipe file.', { name: brand.name }));
  }
  if (value.version !== RECIPE_FILE_VERSION) {
    throw new Error(t('This recipe file uses a format version this version of {name} cannot read.', { name: brand.name }));
  }

  const accepted: Recipe[] = [];
  let skipped = 0;
  for (const candidate of value.recipes as unknown[]) {
    if (!isRecipe(candidate)) {
      skipped += 1;
      continue;
    }
    // Copy the known fields only; whatever else the file carried is not stored.
    accepted.push({
      id: uid('r'),
      name: candidate.name,
      description: candidate.description,
      urlPattern: candidate.urlPattern,
      sourceUrl: candidate.sourceUrl,
      spec: candidate.spec,
      pagination: candidate.pagination,
      createdAt: candidate.createdAt,
      updatedAt: timestamp(),
    });
  }

  if (accepted.length > 0) {
    const db = await getDb();
    const tx = db.transaction('recipes', 'readwrite');
    await Promise.all([...accepted.map((recipe) => tx.store.put(recipe)), tx.done]);
  }
  return { imported: accepted.length, skipped };
}

/** Recipes whose URL pattern matches the page, in the order given. */
export function findMatchingRecipes(recipes: Recipe[], url: string): Recipe[] {
  return recipes.filter((recipe) => matchesUrlPattern(url, recipe.urlPattern));
}
