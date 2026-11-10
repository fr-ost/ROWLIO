// Saved projects: one ProjectMeta record plus one record per dataset. Every write that
// touches both stores happens in a single transaction, so a project is never half-saved.
import type { Dataset, DatasetSource, ExtractionMethod, Row } from '@/types/data';
import { isDataset, isObject } from '@/types/guards';
import type { ProjectFile, ProjectMeta, StoredDataset } from '@/types/recipes';
import { brand } from '@/config/brand';
import { t } from '@/i18n';
import { getDb, timestamp } from '@/storage/db';
import { uid } from '@/utils/id';

// Identifier written into exported files. It is part of the file format (see ProjectFile),
// so it must stay stable even if the product is renamed.
const PROJECT_FILE_FORMAT = 'rowlio-project';
const PROJECT_FILE_VERSION = 1;

export interface SaveProjectInput {
  /** Omit to create a new project; pass an existing id to overwrite it. */
  id?: string;
  name: string;
  folder?: string;
  notes?: string;
  datasets: Dataset[];
}

function countRows(datasets: Dataset[]): number {
  let rows = 0;
  for (const dataset of datasets) rows += dataset.rows.length;
  return rows;
}

function cleanName(name: string): string {
  return name.trim() || t('Untitled project');
}

/**
 * Write the meta record and replace the project's datasets in ONE transaction. The meta
 * is built inside the transaction from the currently stored record, so an overwrite can
 * keep fields such as createdAt without a read-then-write race.
 */
async function persist(
  id: string,
  datasets: Dataset[],
  build: (existing: ProjectMeta | undefined) => ProjectMeta,
): Promise<ProjectMeta> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'datasets'], 'readwrite');
  // Marks the rejection as handled; the awaited copy below still reports failures.
  tx.done.catch(() => undefined);
  try {
    const projects = tx.objectStore('projects');
    const store = tx.objectStore('datasets');
    const [existing, stale] = await Promise.all([projects.get(id), store.index('projectId').getAllKeys(id)]);
    const meta = build(existing);
    const work: Promise<unknown>[] = stale.map((key) => store.delete(key));
    work.push(projects.put(meta));
    datasets.forEach((dataset, order) => {
      const record: StoredDataset = { id: uid('sd'), projectId: id, order, dataset };
      work.push(store.put(record));
    });
    await Promise.all(work);
    await tx.done;
    return meta;
  } catch (error) {
    // put() can throw synchronously (uncloneable value): never commit the first half.
    try {
      tx.abort();
    } catch {
      // Already aborted or finished.
    }
    throw error;
  }
}

/**
 * Create a project, or overwrite the one with `input.id` (its creation date is kept, its
 * datasets are replaced; folder / notes are kept unless given).
 */
export async function saveProject(input: SaveProjectInput): Promise<ProjectMeta> {
  const id = input.id ?? uid('p');
  const first = input.datasets[0];
  return persist(id, input.datasets, (existing) => {
    const now = timestamp();
    return {
      id,
      name: cleanName(input.name),
      folder: (input.folder ?? existing?.folder ?? '').trim(),
      notes: input.notes ?? existing?.notes ?? '',
      sourceUrl: first?.source.url ?? '',
      sourceTitle: first?.source.title ?? '',
      datasetCount: input.datasets.length,
      rowCount: countRows(input.datasets),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });
}

/** Every project, most recently updated first. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await getDb();
  const projects = await db.getAllFromIndex('projects', 'updatedAt');
  return projects.reverse();
}

/** A project with its datasets in the order they were saved, or null. */
export async function getProject(id: string): Promise<{ meta: ProjectMeta; datasets: Dataset[] } | null> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'datasets'], 'readonly');
  const [meta, stored] = await Promise.all([
    tx.objectStore('projects').get(id),
    tx.objectStore('datasets').index('projectId').getAll(id),
    tx.done,
  ]);
  if (!meta) return null;
  stored.sort((a, b) => a.order - b.order);
  return { meta, datasets: stored.map((record) => record.dataset) };
}

export async function updateProjectMeta(
  id: string,
  patch: Partial<Pick<ProjectMeta, 'name' | 'folder' | 'notes'>>,
): Promise<ProjectMeta> {
  const db = await getDb();
  const tx = db.transaction('projects', 'readwrite');
  tx.done.catch(() => undefined);
  const current = await tx.store.get(id);
  if (!current) {
    tx.abort();
    throw new Error(t('That project no longer exists.'));
  }
  const next: ProjectMeta = { ...current, updatedAt: timestamp() };
  if (patch.name !== undefined) next.name = cleanName(patch.name);
  if (patch.folder !== undefined) next.folder = patch.folder.trim();
  if (patch.notes !== undefined) next.notes = patch.notes;
  await tx.store.put(next);
  await tx.done;
  return next;
}

/** Delete a project and all of its datasets. Deleting a project that is already gone is fine. */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'datasets'], 'readwrite');
  const store = tx.objectStore('datasets');
  const keys = await store.index('projectId').getAllKeys(id);
  await Promise.all([tx.objectStore('projects').delete(id), ...keys.map((key) => store.delete(key)), tx.done]);
}

function withFreshId(dataset: Dataset): Dataset {
  return { ...dataset, id: uid('ds') };
}

export async function duplicateProject(id: string): Promise<ProjectMeta> {
  const project = await getProject(id);
  if (!project) throw new Error(t('That project no longer exists.'));
  const now = timestamp();
  const meta: ProjectMeta = {
    ...project.meta,
    id: uid('p'),
    name: t('{name} (copy)', { name: project.meta.name }),
    createdAt: now,
    updatedAt: now,
  };
  return persist(meta.id, project.datasets.map(withFreshId), () => meta);
}

export async function exportProjectFile(id: string): Promise<ProjectFile> {
  const project = await getProject(id);
  if (!project) throw new Error(t('That project no longer exists.'));
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    exportedAt: Date.now(),
    project: project.meta,
    datasets: project.datasets,
  };
}

const METHODS: ReadonlySet<string> = new Set<ExtractionMethod>([
  'table',
  'visual',
  'selectors',
  'links',
  'images',
  'lists',
  'headings',
  'breadcrumbs',
  'metadata',
  'jsonld',
  'microdata',
  'import',
]);

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasUniqueIntegerIds(rows: Row[]): boolean {
  const seen = new Set<number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || seen.has(row.id)) return false;
    seen.add(row.id);
  }
  return true;
}

/**
 * Rebuild an imported dataset from validated parts only: unknown properties are dropped,
 * ids are regenerated (so nothing stored can be overwritten or collide) and the fields
 * `isDataset` does not check are normalised.
 */
function adoptDataset(dataset: Dataset): Dataset {
  const raw: Record<string, unknown> = isObject(dataset.source) ? dataset.source : {};
  const source: DatasetSource = {
    url: dataset.source.url,
    title: typeof raw.title === 'string' ? raw.title : '',
    extractedAt: isTimestamp(raw.extractedAt) ? raw.extractedAt : Date.now(),
    method: typeof raw.method === 'string' && METHODS.has(raw.method) ? (raw.method as ExtractionMethod) : 'import',
  };
  if (typeof raw.detail === 'string') source.detail = raw.detail;
  if (isTimestamp(raw.pages)) source.pages = raw.pages;

  const keepRowIds = hasUniqueIntegerIds(dataset.rows);
  return {
    id: uid('ds'),
    name: dataset.name,
    columns: dataset.columns.map((column) => ({ id: uid('c'), name: column.name })),
    rows: dataset.rows.map((row, index) => ({ id: keepRowIds ? row.id : index + 1, cells: row.cells.slice() })),
    source,
    warnings: dataset.warnings.slice(),
  };
}

/**
 * Import a project file produced by exportProjectFile. The content is validated, the
 * project and its datasets get FRESH ids (an import never overwrites anything), and a
 * clear Error is thrown for anything that is not a valid project file.
 */
export async function importProjectFile(value: unknown): Promise<ProjectMeta> {
  const invalid = (): Error => new Error(t('This is not a valid {name} project file.', { name: brand.name }));
  if (!isObject(value) || value.format !== PROJECT_FILE_FORMAT) throw invalid();
  if (value.version !== PROJECT_FILE_VERSION) {
    throw new Error(
      t('This project file uses a format version this version of {name} cannot read.', { name: brand.name }),
    );
  }
  const { project, datasets } = value;
  if (!isObject(project) || typeof project.name !== 'string') throw invalid();
  if (!Array.isArray(datasets) || !datasets.every(isDataset)) throw invalid();

  const adopted = datasets.map(adoptDataset);
  const now = timestamp();
  const first = adopted[0];
  const meta: ProjectMeta = {
    id: uid('p'),
    name: cleanName(project.name),
    folder: typeof project.folder === 'string' ? project.folder.trim() : '',
    notes: typeof project.notes === 'string' ? project.notes : '',
    sourceUrl: first?.source.url ?? '',
    sourceTitle: first?.source.title ?? '',
    datasetCount: adopted.length,
    rowCount: countRows(adopted),
    createdAt: isTimestamp(project.createdAt) ? Math.min(project.createdAt, now) : now,
    updatedAt: now,
  };
  return persist(meta.id, adopted, () => meta);
}
