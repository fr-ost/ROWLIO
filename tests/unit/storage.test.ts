import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Dataset } from '@/types/data';
import { isDataset, isRecipe } from '@/types/guards';
import type { ProjectFile, Recipe, RecipeFile } from '@/types/recipes';
import { DEFAULT_PAGINATION, DEFAULT_SETTINGS, DEFAULT_TABLE_OPTIONS } from '@/types/settings';
import { brand } from '@/config/brand';
import { DB_NAME, DB_VERSION, closeDb, deleteAllData, getDb, storageEstimate, timestamp } from '@/storage/db';
import {
  deleteProject,
  duplicateProject,
  exportProjectFile,
  getProject,
  importProjectFile,
  listProjects,
  saveProject,
  updateProjectMeta,
} from '@/storage/projects';
import {
  deleteRecipe,
  exportRecipeFile,
  findMatchingRecipes,
  getRecipe,
  importRecipeFile,
  listRecipes,
  saveRecipe,
} from '@/storage/recipes';
import type { SaveRecipeInput } from '@/storage/recipes';
import { kvDelete, kvGet, kvSet, loadSettings, resetSettings, saveSettings } from '@/storage/settings';

function dataset(id: string, name: string, rows: string[][], url = 'https://example.test/shop'): Dataset {
  return {
    id,
    name,
    columns: [
      { id: `${id}-a`, name: 'নাম' },
      { id: `${id}-b`, name: 'Price' },
    ],
    rows: rows.map((cells, index) => ({ id: index + 1, cells })),
    source: { url, title: `Title of ${name}`, extractedAt: 1_700_000_000_000, method: 'table', detail: 'Table 1', pages: 2 },
    warnings: ['একটি সতর্কতা'],
  };
}

const tea = (): Dataset => dataset('ds-tea', 'Tea', [['আমার সোনার বাংলা', '১২০'], ['Green 👍', '95']]);
const mugs = (): Dataset => dataset('ds-mugs', 'Mugs', [['Mug', '250'], ['Cup', '80'], ['Glass', '60']], 'https://example.test/mugs');

function recipeInput(partial: Partial<SaveRecipeInput> = {}): SaveRecipeInput {
  return {
    name: 'Product list',
    description: 'পণ্যের তালিকা',
    urlPattern: 'https://shop.example/category/*',
    sourceUrl: 'https://shop.example/category/tea?page=1',
    spec: { kind: 'tables', indexes: 'all', options: { ...DEFAULT_TABLE_OPTIONS } },
    pagination: { ...DEFAULT_PAGINATION },
    ...partial,
  };
}

async function countAll(store: 'projects' | 'datasets' | 'recipes' | 'kv'): Promise<number> {
  return (await getDb()).count(store);
}

beforeEach(async () => {
  await closeDb();
  await deleteDB(DB_NAME);
});

afterEach(async () => {
  await closeDb();
});

describe('database', () => {
  it('is named after the brand and has the expected stores and indexes', async () => {
    expect(DB_NAME).toBe(brand.filePrefix);
    const db = await getDb();
    expect(db.name).toBe(brand.filePrefix);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['datasets', 'kv', 'projects', 'recipes']);
    const tx = db.transaction(['projects', 'datasets', 'recipes', 'kv'], 'readonly');
    expect(tx.objectStore('projects').keyPath).toBe('id');
    expect([...tx.objectStore('projects').indexNames]).toEqual(['updatedAt']);
    expect(tx.objectStore('datasets').keyPath).toBe('id');
    expect([...tx.objectStore('datasets').indexNames]).toEqual(['projectId']);
    expect(tx.objectStore('recipes').keyPath).toBe('id');
    expect([...tx.objectStore('recipes').indexNames]).toEqual(['updatedAt']);
    expect(tx.objectStore('kv').keyPath).toBeNull();
    await tx.done;
  });

  it('memoises the connection and reconnects after closeDb', async () => {
    const first = await getDb();
    expect(await getDb()).toBe(first);
    await closeDb();
    const second = await getDb();
    expect(second).not.toBe(first);
    await kvSet('k', 1);
    expect(await kvGet('k')).toBe(1);
  });

  it('steps aside when another connection needs to upgrade, then reconnects', async () => {
    await kvSet('kept', 'value');
    const stale = await getDb();
    // Simulate a newer version of the extension opening the database.
    const upgraded = await openDB(DB_NAME, DB_VERSION + 1);
    upgraded.close();
    await deleteDB(DB_NAME);
    // Our connection was released instead of blocking; a new one is opened on demand.
    const fresh = await getDb();
    expect(fresh).not.toBe(stale);
    expect(await kvGet('kept')).toBeUndefined();
  });

  it('timestamps never repeat', () => {
    const stamps = Array.from({ length: 1000 }, () => timestamp());
    expect(new Set(stamps).size).toBe(1000);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    expect(Math.abs(stamps[0]! - Date.now())).toBeLessThan(5000);
  });

  it('storageEstimate returns numbers or null, never throws', async () => {
    const estimate = await storageEstimate();
    if (estimate !== null) {
      expect(typeof estimate.usage).toBe('number');
      expect(typeof estimate.quota).toBe('number');
    }
    const original = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 12, quota: 3456 }) } });
    expect(await storageEstimate()).toEqual({ usage: 12, quota: 3456 });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => {
          throw new Error('denied');
        },
      },
    });
    expect(await storageEstimate()).toBeNull();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    expect(await storageEstimate()).toBeNull();
    if (original) Object.defineProperty(navigator, 'storage', original);
    else delete (navigator as unknown as Record<string, unknown>).storage;
  });
});

describe('projects', () => {
  it('creates a project and computes its metadata', async () => {
    const before = Date.now();
    const meta = await saveProject({ name: '  চা বাগান  ', folder: ' Research ', notes: 'নোট', datasets: [tea(), mugs()] });

    expect(meta.id).toMatch(/^p_/);
    expect(meta.name).toBe('চা বাগান');
    expect(meta.folder).toBe('Research');
    expect(meta.notes).toBe('নোট');
    expect(meta.datasetCount).toBe(2);
    expect(meta.rowCount).toBe(5);
    expect(meta.sourceUrl).toBe('https://example.test/shop');
    expect(meta.sourceTitle).toBe('Title of Tea');
    expect(meta.createdAt).toBeGreaterThanOrEqual(before);
    expect(meta.updatedAt).toBe(meta.createdAt);

    const stored = await getProject(meta.id);
    expect(stored).not.toBeNull();
    expect(stored!.meta).toEqual(meta);
    expect(stored!.datasets).toEqual([tea(), mugs()]);
    expect(stored!.datasets.every(isDataset)).toBe(true);
  });

  it('applies defaults for optional fields and an empty name', async () => {
    const meta = await saveProject({ name: '   ', datasets: [] });
    expect(meta.name).toBe('Untitled project');
    expect(meta.folder).toBe('');
    expect(meta.notes).toBe('');
    expect(meta.datasetCount).toBe(0);
    expect(meta.rowCount).toBe(0);
    expect(meta.sourceUrl).toBe('');
    expect(meta.sourceTitle).toBe('');
    expect((await getProject(meta.id))!.datasets).toEqual([]);
  });

  it('keeps datasets in the saved order', async () => {
    const many = Array.from({ length: 12 }, (_, i) => dataset(`ds-${i}`, `Set ${i}`, [[String(i), '']]));
    const meta = await saveProject({ name: 'Ordered', datasets: many });
    expect((await getProject(meta.id))!.datasets.map((d) => d.name)).toEqual(many.map((d) => d.name));
  });

  it('overwriting keeps the id and createdAt, bumps updatedAt and replaces the datasets', async () => {
    const created = await saveProject({ name: 'First', folder: 'F', notes: 'N', datasets: [tea(), mugs()] });
    const updated = await saveProject({ id: created.id, name: 'Renamed', datasets: [mugs()] });

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated.name).toBe('Renamed');
    // Not given on overwrite: kept.
    expect(updated.folder).toBe('F');
    expect(updated.notes).toBe('N');
    expect(updated.datasetCount).toBe(1);
    expect(updated.rowCount).toBe(3);
    expect(updated.sourceUrl).toBe('https://example.test/mugs');

    const stored = await getProject(created.id);
    expect(stored!.datasets).toEqual([mugs()]);
    // The old dataset records are gone, not orphaned.
    expect(await countAll('datasets')).toBe(1);
    expect(await countAll('projects')).toBe(1);

    const cleared = await saveProject({ id: created.id, name: 'Renamed', folder: '', notes: '', datasets: [] });
    expect(cleared.folder).toBe('');
    expect(cleared.notes).toBe('');
    expect(await countAll('datasets')).toBe(0);
  });

  it('saving with an unknown id creates that project', async () => {
    const meta = await saveProject({ id: 'p_custom', name: 'Custom', datasets: [tea()] });
    expect(meta.id).toBe('p_custom');
    expect(meta.createdAt).toBe(meta.updatedAt);
    expect((await getProject('p_custom'))!.datasets).toHaveLength(1);
  });

  it('two projects may contain datasets with the same id', async () => {
    const a = await saveProject({ name: 'A', datasets: [tea()] });
    const b = await saveProject({ name: 'B', datasets: [tea(), tea()] });
    expect((await getProject(a.id))!.datasets).toHaveLength(1);
    expect((await getProject(b.id))!.datasets).toHaveLength(2);
    expect(await countAll('datasets')).toBe(3);
  });

  it('does not store a half-written project when a dataset cannot be saved', async () => {
    const created = await saveProject({ name: 'Safe', datasets: [tea()] });
    const broken = { ...mugs(), name: (() => 'not cloneable') as unknown as string };
    await expect(saveProject({ id: created.id, name: 'Broken', datasets: [mugs(), broken] })).rejects.toThrow();
    // The original is untouched: same name, same single dataset.
    const stored = await getProject(created.id);
    expect(stored!.meta).toEqual(created);
    expect(stored!.datasets).toEqual([tea()]);
    expect(await countAll('datasets')).toBe(1);
    // And the connection is still usable.
    await expect(saveProject({ name: 'After', datasets: [] })).resolves.toBeDefined();
  });

  it('lists projects newest-updated first', async () => {
    const a = await saveProject({ name: 'A', datasets: [] });
    const b = await saveProject({ name: 'B', datasets: [] });
    const c = await saveProject({ name: 'C', datasets: [] });
    expect((await listProjects()).map((p) => p.name)).toEqual(['C', 'B', 'A']);

    await saveProject({ id: a.id, name: 'A', datasets: [] });
    expect((await listProjects()).map((p) => p.name)).toEqual(['A', 'C', 'B']);
    await updateProjectMeta(b.id, { notes: 'touched' });
    expect((await listProjects()).map((p) => p.name)).toEqual(['B', 'A', 'C']);
    expect(c.id).not.toBe(a.id);
    expect(await listProjects()).toHaveLength(3);
  });

  it('returns null / empty for missing data', async () => {
    expect(await getProject('nope')).toBeNull();
    expect(await listProjects()).toEqual([]);
  });

  it('updates name, folder and notes without touching the datasets', async () => {
    const created = await saveProject({ name: 'Old', datasets: [tea()] });
    const updated = await updateProjectMeta(created.id, { name: '  নতুন নাম ', folder: ' Work ' });
    expect(updated.name).toBe('নতুন নাম');
    expect(updated.folder).toBe('Work');
    expect(updated.notes).toBe('');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated.rowCount).toBe(2);

    const notes = await updateProjectMeta(created.id, { notes: 'line 1\nline 2' });
    expect(notes.name).toBe('নতুন নাম');
    expect(notes.notes).toBe('line 1\nline 2');
    const stored = await getProject(created.id);
    expect(stored!.meta).toEqual(notes);
    expect(stored!.datasets).toEqual([tea()]);
  });

  it('updateProjectMeta rejects a missing project', async () => {
    await expect(updateProjectMeta('nope', { name: 'x' })).rejects.toThrow(/no longer exists/);
    expect(await countAll('projects')).toBe(0);
  });

  it('deleting a project also deletes its datasets, and only its own', async () => {
    const keep = await saveProject({ name: 'Keep', datasets: [tea()] });
    const drop = await saveProject({ name: 'Drop', datasets: [tea(), mugs()] });
    expect(await countAll('datasets')).toBe(3);

    await deleteProject(drop.id);
    expect(await getProject(drop.id)).toBeNull();
    expect(await countAll('datasets')).toBe(1);
    expect((await listProjects()).map((p) => p.id)).toEqual([keep.id]);
    expect((await getProject(keep.id))!.datasets).toEqual([tea()]);

    // Deleting again is harmless.
    await expect(deleteProject(drop.id)).resolves.toBeUndefined();
  });

  it('duplicates a project with fresh ids', async () => {
    const original = await saveProject({ name: 'Original', folder: 'F', notes: 'N', datasets: [tea(), mugs()] });
    const copy = await duplicateProject(original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.folder).toBe('F');
    expect(copy.notes).toBe('N');
    expect(copy.rowCount).toBe(5);
    expect(copy.createdAt).toBeGreaterThan(original.createdAt);

    const stored = await getProject(copy.id);
    expect(stored!.datasets.map((d) => d.name)).toEqual(['Tea', 'Mugs']);
    expect(stored!.datasets.map((d) => d.rows)).toEqual([tea().rows, mugs().rows]);
    expect(stored!.datasets[0]!.id).not.toBe('ds-tea');
    expect(new Set(stored!.datasets.map((d) => d.id)).size).toBe(2);
    // The original is untouched and independent.
    await deleteProject(copy.id);
    expect((await getProject(original.id))!.datasets).toEqual([tea(), mugs()]);
    await expect(duplicateProject('nope')).rejects.toThrow(/no longer exists/);
  });
});

describe('project files', () => {
  it('exports a portable file', async () => {
    const meta = await saveProject({ name: 'চা', datasets: [tea()] });
    const before = Date.now();
    const file = await exportProjectFile(meta.id);
    expect(file.format).toBe('rowlio-project');
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBeGreaterThanOrEqual(before);
    expect(file.project).toEqual(meta);
    expect(file.datasets).toEqual([tea()]);
    // The file is plain JSON.
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
    await expect(exportProjectFile('nope')).rejects.toThrow(/no longer exists/);
  });

  it('round-trips through JSON with fresh ids and intact Bengali content', async () => {
    const original = await saveProject({ name: 'আমার প্রকল্প', folder: 'ফোল্ডার', notes: 'নোট 👍', datasets: [tea(), mugs()] });
    const file = JSON.parse(JSON.stringify(await exportProjectFile(original.id))) as unknown;

    const imported = await importProjectFile(file);
    expect(imported.id).not.toBe(original.id);
    expect(imported.id).toMatch(/^p_/);
    expect(imported.name).toBe('আমার প্রকল্প');
    expect(imported.folder).toBe('ফোল্ডার');
    expect(imported.notes).toBe('নোট 👍');
    expect(imported.datasetCount).toBe(2);
    expect(imported.rowCount).toBe(5);
    expect(imported.sourceUrl).toBe(original.sourceUrl);
    expect(imported.createdAt).toBe(original.createdAt);
    expect(imported.updatedAt).toBeGreaterThan(original.updatedAt);

    const stored = await getProject(imported.id);
    expect(stored!.datasets).toHaveLength(2);
    const [first, second] = stored!.datasets;
    expect(isDataset(first)).toBe(true);
    expect(first!.id).not.toBe('ds-tea');
    expect(first!.id).toMatch(/^ds_/);
    expect(second!.id).not.toBe(first!.id);
    expect(first!.name).toBe('Tea');
    expect(first!.columns.map((c) => c.name)).toEqual(['নাম', 'Price']);
    expect(new Set(first!.columns.map((c) => c.id)).size).toBe(2);
    expect(first!.rows).toEqual(tea().rows);
    expect(first!.rows[0]!.cells).toEqual(['আমার সোনার বাংলা', '১২০']);
    expect(first!.source).toEqual(tea().source);
    expect(first!.warnings).toEqual(['একটি সতর্কতা']);
    expect(second!.rows).toEqual(mugs().rows);

    // Importing never overwrites: the original is still there, unchanged.
    expect((await getProject(original.id))!.meta).toEqual(original);
    expect(await listProjects()).toHaveLength(2);
    // Importing the same file again creates yet another project.
    const again = await importProjectFile(file);
    expect(again.id).not.toBe(imported.id);
    expect(await listProjects()).toHaveLength(3);
    expect(await countAll('datasets')).toBe(6);
  });

  it('normalises what the file does not guarantee', async () => {
    const file: ProjectFile = {
      format: 'rowlio-project',
      version: 1,
      exportedAt: 1,
      project: { id: 'x', name: '  ', folder: 7, notes: null, createdAt: 'yesterday' } as unknown as ProjectFile['project'],
      datasets: [
        {
          id: 'same',
          name: 'Loose',
          columns: [
            { id: 'dup', name: 'A' },
            { id: 'dup', name: 'B' },
          ],
          rows: [
            { id: 1, cells: ['1', '2'], extra: 'ignored' },
            { id: 1, cells: ['3', '4'] },
          ],
          source: { url: 'https://example.test/', method: 'teleport', pages: 'many' },
          warnings: [],
          injected: { anything: true },
        } as unknown as Dataset,
      ],
    };
    const meta = await importProjectFile(file);
    expect(meta.name).toBe('Untitled project');
    expect(meta.folder).toBe('');
    expect(meta.notes).toBe('');
    expect(meta.createdAt).toBe(meta.updatedAt);

    const [stored] = (await getProject(meta.id))!.datasets;
    expect(Object.keys(stored!).sort()).toEqual(['columns', 'id', 'name', 'rows', 'source', 'warnings']);
    expect(new Set(stored!.columns.map((c) => c.id)).size).toBe(2);
    // Duplicate row ids are renumbered; unknown row properties are dropped.
    expect(stored!.rows).toEqual([
      { id: 1, cells: ['1', '2'] },
      { id: 2, cells: ['3', '4'] },
    ]);
    expect(stored!.source.method).toBe('import');
    expect(stored!.source.title).toBe('');
    expect(typeof stored!.source.extractedAt).toBe('number');
    expect('pages' in stored!.source).toBe(false);
    expect(isDataset(stored)).toBe(true);
  });

  it('accepts a project without datasets', async () => {
    const meta = await importProjectFile({ format: 'rowlio-project', version: 1, exportedAt: 1, project: { name: 'Empty' }, datasets: [] });
    expect(meta.name).toBe('Empty');
    expect(meta.datasetCount).toBe(0);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'rowlio-project'],
    ['an array', []],
    ['an empty object', {}],
    ['a wrong format marker', { format: 'something-else', version: 1, project: { name: 'x' }, datasets: [] }],
    ['a recipe file', { format: 'rowlio-recipes', version: 1, exportedAt: 1, recipes: [] }],
    ['a newer version', { format: 'rowlio-project', version: 2, project: { name: 'x' }, datasets: [] }],
    ['a missing project', { format: 'rowlio-project', version: 1, datasets: [] }],
    ['a project without a name', { format: 'rowlio-project', version: 1, project: {}, datasets: [] }],
    ['datasets that are not an array', { format: 'rowlio-project', version: 1, project: { name: 'x' }, datasets: {} }],
    ['an invalid dataset', { format: 'rowlio-project', version: 1, project: { name: 'x' }, datasets: [{ id: 'd', name: 'n' }] }],
    [
      'a dataset whose rows do not match its columns',
      {
        format: 'rowlio-project',
        version: 1,
        project: { name: 'x' },
        datasets: [{ ...tea(), rows: [{ id: 1, cells: ['only one cell'] }] }],
      },
    ],
    [
      'a dataset with non-string cells',
      {
        format: 'rowlio-project',
        version: 1,
        project: { name: 'x' },
        datasets: [{ ...tea(), rows: [{ id: 1, cells: ['a', 5] }] }],
      },
    ],
  ])('rejects %s with a clear error and stores nothing', async (_label, value) => {
    await expect(importProjectFile(value)).rejects.toThrow(/project file/);
    expect(await countAll('projects')).toBe(0);
    expect(await countAll('datasets')).toBe(0);
  });
});

describe('recipes', () => {
  it('creates, reads, updates and deletes', async () => {
    const before = Date.now();
    const created = await saveRecipe(recipeInput({ name: '  Tea prices ' }));
    expect(created.id).toMatch(/^r_/);
    expect(created.name).toBe('Tea prices');
    expect(created.description).toBe('পণ্যের তালিকা');
    expect(created.createdAt).toBeGreaterThanOrEqual(before);
    expect(created.updatedAt).toBe(created.createdAt);
    expect(isRecipe(created)).toBe(true);
    expect(await getRecipe(created.id)).toEqual(created);

    const updated = await saveRecipe(recipeInput({ id: created.id, name: 'Tea prices v2', pagination: null }));
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated.pagination).toBeNull();
    expect(await getRecipe(created.id)).toEqual(updated);
    expect(await listRecipes()).toHaveLength(1);

    await deleteRecipe(created.id);
    expect(await getRecipe(created.id)).toBeNull();
    expect(await listRecipes()).toEqual([]);
    await expect(deleteRecipe(created.id)).resolves.toBeUndefined();
  });

  it('stores every kind of extraction spec', async () => {
    const rule = await saveRecipe(
      recipeInput({
        name: 'Cards',
        spec: {
          kind: 'rule',
          method: 'visual',
          name: 'Cards',
          rule: {
            rowSelector: 'article.card',
            rowSelectorType: 'css',
            fields: [{ id: 'f1', name: 'শিরোনাম', selector: 'h2', selectorType: 'css', extract: 'text' }],
          },
        },
      }),
    );
    expect((await getRecipe(rule.id))!.spec).toEqual(rule.spec);
    const headings = await saveRecipe(recipeInput({ name: 'Headings', spec: { kind: 'headings' }, pagination: null }));
    expect((await getRecipe(headings.id))!.spec).toEqual({ kind: 'headings' });
  });

  it('lists newest-updated first', async () => {
    const a = await saveRecipe(recipeInput({ name: 'A' }));
    await saveRecipe(recipeInput({ name: 'B' }));
    await saveRecipe(recipeInput({ name: 'C' }));
    expect((await listRecipes()).map((r) => r.name)).toEqual(['C', 'B', 'A']);
    await saveRecipe(recipeInput({ id: a.id, name: 'A' }));
    expect((await listRecipes()).map((r) => r.name)).toEqual(['A', 'C', 'B']);
  });

  it('refuses to store an invalid recipe', async () => {
    const bad = recipeInput({ spec: { kind: 'teleport' } as unknown as SaveRecipeInput['spec'] });
    await expect(saveRecipe(bad)).rejects.toThrow(/not valid/);
    const badPagination = recipeInput({ pagination: { ...DEFAULT_PAGINATION, maxPages: 0 } });
    await expect(saveRecipe(badPagination)).rejects.toThrow(/not valid/);
    expect(await listRecipes()).toEqual([]);
    // The connection survives the aborted transaction.
    await expect(saveRecipe(recipeInput())).resolves.toBeDefined();
  });

  it('exports a recipe file', async () => {
    const a = await saveRecipe(recipeInput({ name: 'A' }));
    const b = await saveRecipe(recipeInput({ name: 'B' }));
    const before = Date.now();
    const file = exportRecipeFile([a, b]);
    expect(file.format).toBe('rowlio-recipes');
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBeGreaterThanOrEqual(before);
    expect(file.recipes).toEqual([a, b]);
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });

  it('imports with fresh ids, skipping and counting invalid entries', async () => {
    const existing = await saveRecipe(recipeInput({ name: 'Existing' }));
    const other = await saveRecipe(recipeInput({ name: 'অন্য রেসিপি', urlPattern: 'https://news.example/*' }));
    const file = JSON.parse(JSON.stringify(exportRecipeFile([existing, other]))) as RecipeFile;
    const recipes: unknown[] = [
      ...file.recipes,
      null,
      'junk',
      { ...existing, spec: { kind: 'nope' } },
      { ...existing, name: 42 },
      { ...existing, pagination: { mode: 'next' } },
    ];

    const result = await importRecipeFile({ ...file, recipes });
    expect(result).toEqual({ imported: 2, skipped: 5 });

    const all = await listRecipes();
    expect(all).toHaveLength(4);
    expect(new Set(all.map((r) => r.id)).size).toBe(4);
    // The originals were not overwritten.
    expect(await getRecipe(existing.id)).toEqual(existing);
    expect(await getRecipe(other.id)).toEqual(other);
    const imported = all.filter((r) => r.id !== existing.id && r.id !== other.id);
    expect(imported.map((r) => r.name).sort()).toEqual(['Existing', 'অন্য রেসিপি'].sort());
    for (const recipe of imported) {
      expect(recipe.id).toMatch(/^r_/);
      expect(isRecipe(recipe)).toBe(true);
      expect(recipe.updatedAt).toBeGreaterThan(other.updatedAt);
    }
    const copy = imported.find((r) => r.name === 'অন্য রেসিপি')!;
    expect(copy.urlPattern).toBe('https://news.example/*');
    expect(copy.spec).toEqual(other.spec);
    expect(copy.createdAt).toBe(other.createdAt);
  });

  it('does not store unknown top-level properties from a file', async () => {
    const source = await saveRecipe(recipeInput());
    await deleteRecipe(source.id);
    const result = await importRecipeFile({ format: 'rowlio-recipes', version: 1, exportedAt: 1, recipes: [{ ...source, injected: 'x' }] });
    expect(result).toEqual({ imported: 1, skipped: 0 });
    const [stored] = await listRecipes();
    expect(Object.keys(stored!).sort()).toEqual(['createdAt', 'description', 'id', 'name', 'pagination', 'sourceUrl', 'spec', 'updatedAt', 'urlPattern']);
  });

  it('accepts an empty recipe file and one where everything is invalid', async () => {
    expect(await importRecipeFile({ format: 'rowlio-recipes', version: 1, exportedAt: 1, recipes: [] })).toEqual({ imported: 0, skipped: 0 });
    expect(await importRecipeFile({ format: 'rowlio-recipes', version: 1, exportedAt: 1, recipes: [1, 2, {}] })).toEqual({ imported: 0, skipped: 3 });
    expect(await listRecipes()).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', []],
    ['a project file', { format: 'rowlio-project', version: 1, project: { name: 'x' }, datasets: [] }],
    ['recipes that are not an array', { format: 'rowlio-recipes', version: 1, recipes: {} }],
    ['a newer version', { format: 'rowlio-recipes', version: 2, recipes: [] }],
  ])('rejects %s', async (_label, value) => {
    await expect(importRecipeFile(value)).rejects.toThrow(/recipe file/);
    expect(await listRecipes()).toEqual([]);
  });

  it('finds the recipes whose URL pattern matches a page', () => {
    const make = (name: string, urlPattern: string): Recipe => ({ ...recipeInput({ name, urlPattern }), id: name, createdAt: 1, updatedAt: 1 });
    const recipes = [
      make('category', 'https://shop.example/category/*'),
      make('exact', 'https://shop.example/about'),
      make('any-shop', 'https://*.example/*'),
      make('middle', 'https://shop.example/*/reviews'),
      make('empty', ''),
      make('blank', '   '),
      make('everything', '*'),
      make('dots', 'https://shop.example/a.b'),
    ];
    const matching = (url: string): string[] => findMatchingRecipes(recipes, url).map((r) => r.name);

    expect(matching('https://shop.example/category/tea?page=2')).toEqual(['category', 'any-shop', 'everything']);
    expect(matching('https://shop.example/about')).toEqual(['exact', 'any-shop', 'everything']);
    expect(matching('https://shop.example/about/team')).toEqual(['any-shop', 'everything']);
    expect(matching('https://shop.example/p/42/reviews')).toEqual(['any-shop', 'middle', 'everything']);
    expect(matching('HTTPS://SHOP.EXAMPLE/CATEGORY/TEA')).toEqual(['category', 'any-shop', 'everything']);
    expect(matching('https://other.test/category/tea')).toEqual(['everything']);
    // A dot in a pattern is a literal dot, not "any character".
    expect(matching('https://shop.example/a.b')).toEqual(['any-shop', 'everything', 'dots']);
    expect(matching('https://shop.example/aXb')).toEqual(['any-shop', 'everything']);
    expect(findMatchingRecipes([], 'https://shop.example/')).toEqual([]);
  });
});

describe('settings', () => {
  it('returns the defaults when nothing is stored, as an independent copy', async () => {
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toBe(DEFAULT_SETTINGS);
    expect(settings.export).not.toBe(DEFAULT_SETTINGS.export);
    expect(settings.tables).not.toBe(DEFAULT_SETTINGS.tables);
    expect(settings.pagination).not.toBe(DEFAULT_SETTINGS.pagination);
    settings.export.csvBom = !settings.export.csvBom;
    settings.pagination.maxPages = 999;
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.pagination.maxPages).toBe(10);
  });

  it('merges a deep partial patch and persists it', async () => {
    const saved = await saveSettings({ theme: 'dark', export: { csvDelimiter: ';' }, pagination: { maxPages: 50 } });
    expect(saved.theme).toBe('dark');
    expect(saved.export).toEqual({ ...DEFAULT_SETTINGS.export, csvDelimiter: ';' });
    expect(saved.pagination).toEqual({ ...DEFAULT_PAGINATION, maxPages: 50 });
    expect(saved.tables).toEqual(DEFAULT_TABLE_OPTIONS);
    expect(await loadSettings()).toEqual(saved);

    // A later patch builds on the stored value instead of resetting other keys.
    const next = await saveSettings({ onboardingDone: true, export: { jsonPretty: false } });
    expect(next.theme).toBe('dark');
    expect(next.onboardingDone).toBe(true);
    expect(next.export.csvDelimiter).toBe(';');
    expect(next.export.jsonPretty).toBe(false);
    expect(next.pagination.maxPages).toBe(50);
    await closeDb();
    expect(await loadSettings()).toEqual(next);
  });

  it('fills keys missing from an older stored value with defaults', async () => {
    await kvSet('settings', { theme: 'light', export: { csvBom: false }, pagination: { delayMs: 250 } });
    const settings = await loadSettings();
    expect(settings.theme).toBe('light');
    expect(settings.onboardingDone).toBe(false);
    expect(settings.export).toEqual({ ...DEFAULT_SETTINGS.export, csvBom: false });
    expect(settings.pagination).toEqual({ ...DEFAULT_PAGINATION, delayMs: 250 });
    expect(settings.tables).toEqual(DEFAULT_TABLE_OPTIONS);
  });

  it('ignores unknown keys and values of the wrong type or out of range', async () => {
    await kvSet('settings', {
      theme: 'neon',
      onboardingDone: 'yes',
      legacyOption: true,
      export: { csvDelimiter: '|', csvBom: 'no', formulaGuard: false, jsonPretty: null, extra: 1 },
      tables: { includeHidden: true, fillMerged: 0, headerMode: 'sideways' },
      pagination: { mode: 'scroll', maxPages: -3, delayMs: Number.NaN, retries: 2.5, nextSelector: 9, maxRecords: 100 },
    });
    const settings = await loadSettings();
    expect(settings.theme).toBe('system');
    expect(settings.onboardingDone).toBe(false);
    expect('legacyOption' in settings).toBe(false);
    expect(settings.export).toEqual({ ...DEFAULT_SETTINGS.export, formulaGuard: false });
    expect(settings.tables).toEqual({ ...DEFAULT_TABLE_OPTIONS, includeHidden: true });
    // Valid fields survive next to invalid ones.
    expect(settings.pagination).toEqual({ ...DEFAULT_PAGINATION, mode: 'scroll', retries: 2.5, maxRecords: 100 });
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it.each<[string, unknown]>([
    ['a string', 'dark'],
    ['a number', 42],
    ['null', null],
    ['an array', ['dark']],
    ['sections of the wrong shape', { export: 'csv', tables: [], pagination: 5 }],
  ])('falls back to defaults when the stored value is %s', async (_label, stored) => {
    await kvSet('settings', stored);
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings ignores invalid values in a patch and keeps the current ones', async () => {
    await saveSettings({ theme: 'dark', pagination: { maxPages: 20 } });
    const patch = { theme: 'neon', bogus: 1, pagination: { maxPages: 0, delayMs: 500 }, export: { csvDelimiter: '\t' } } as unknown as Parameters<typeof saveSettings>[0];
    const saved = await saveSettings(patch);
    expect(saved.theme).toBe('dark');
    expect(saved.pagination.maxPages).toBe(20);
    expect(saved.pagination.delayMs).toBe(500);
    expect(saved.export.csvDelimiter).toBe(',');
    expect('bogus' in saved).toBe(false);
    expect(await loadSettings()).toEqual(saved);
  });

  it('an empty patch stores the current settings unchanged', async () => {
    expect(await saveSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(await kvGet('settings')).toEqual(DEFAULT_SETTINGS);
  });

  it('resetSettings restores the defaults', async () => {
    await saveSettings({ theme: 'dark', export: { csvBom: false } });
    expect(await resetSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await kvGet('settings')).toBeUndefined();
  });

  it('concurrent saves do not lose updates', async () => {
    await Promise.all([saveSettings({ theme: 'dark' }), saveSettings({ onboardingDone: true }), saveSettings({ export: { csvDelimiter: ';' } })]);
    const settings = await loadSettings();
    expect(settings.theme).toBe('dark');
    expect(settings.onboardingDone).toBe(true);
    expect(settings.export.csvDelimiter).toBe(';');
  });
});

describe('key/value store', () => {
  it('stores, overwrites and deletes arbitrary structured values', async () => {
    expect(await kvGet('missing')).toBeUndefined();
    await kvSet('text', 'আমার সোনার বাংলা 👍');
    await kvSet('object', { widths: { c1: 120 }, list: [1, 2, 3], when: new Date(0) });
    await kvSet('zero', 0);
    await kvSet('nothing', null);
    expect(await kvGet<string>('text')).toBe('আমার সোনার বাংলা 👍');
    expect(await kvGet('object')).toEqual({ widths: { c1: 120 }, list: [1, 2, 3], when: new Date(0) });
    expect(await kvGet<number>('zero')).toBe(0);
    expect(await kvGet('nothing')).toBeNull();

    await kvSet('text', 'replaced');
    expect(await kvGet('text')).toBe('replaced');
    await kvDelete('text');
    expect(await kvGet('text')).toBeUndefined();
    await expect(kvDelete('text')).resolves.toBeUndefined();
    expect(await countAll('kv')).toBe(3);
  });
});

describe('deleteAllData', () => {
  it('clears every store and leaves the database usable', async () => {
    await saveProject({ name: 'P', datasets: [tea(), mugs()] });
    await saveRecipe(recipeInput());
    await saveSettings({ theme: 'dark' });
    await kvSet('ui', { panel: 'open' });
    expect(await countAll('projects')).toBe(1);
    expect(await countAll('datasets')).toBe(2);
    expect(await countAll('recipes')).toBe(1);
    expect(await countAll('kv')).toBe(2);

    await deleteAllData();

    for (const store of ['projects', 'datasets', 'recipes', 'kv'] as const) expect(await countAll(store)).toBe(0);
    expect(await listProjects()).toEqual([]);
    expect(await listRecipes()).toEqual([]);
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await kvGet('ui')).toBeUndefined();

    const again = await saveProject({ name: 'After', datasets: [tea()] });
    expect((await getProject(again.id))!.datasets).toEqual([tea()]);
  });
});
