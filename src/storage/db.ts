// IndexedDB access. Everything the extension stores stays in this one local database.
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { ProjectMeta, Recipe, StoredDataset } from '@/types/recipes';
import { brand } from '@/config/brand';

export interface AppDbSchema extends DBSchema {
  projects: { key: string; value: ProjectMeta; indexes: { updatedAt: number } };
  datasets: { key: string; value: StoredDataset; indexes: { projectId: string } };
  recipes: { key: string; value: Recipe; indexes: { updatedAt: number } };
  /** Small out-of-line key/value records (settings, UI state). */
  kv: { key: string; value: unknown };
}

export type AppDb = IDBPDatabase<AppDbSchema>;

export const DB_NAME = brand.filePrefix;
export const DB_VERSION = 1;
const STORES = ['projects', 'datasets', 'recipes', 'kv'] as const;

let connection: Promise<AppDb> | null = null;

function forget(candidate: Promise<AppDb>): void {
  if (connection === candidate) connection = null;
}

/** The shared connection. Re-opened transparently after it was closed or failed to open. */
export function getDb(): Promise<AppDb> {
  if (connection) return connection;
  const opening: Promise<AppDb> = openDB<AppDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('datasets')) {
        db.createObjectStore('datasets', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('recipes')) {
        db.createObjectStore('recipes', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    },
    blocking() {
      // Another context (a newer version of the extension, or a delete) needs the database:
      // step aside instead of blocking it forever; the next call reconnects.
      forget(opening);
      void opening.then((db) => db.close()).catch(() => undefined);
    },
    terminated() {
      forget(opening);
    },
  }).then((db) => {
    db.addEventListener('close', () => forget(opening));
    return db;
  });
  // A failed open must not poison every later call.
  opening.catch(() => forget(opening));
  connection = opening;
  return opening;
}

/** Close the connection (tests, or before deleting the database). */
export async function closeDb(): Promise<void> {
  const current = connection;
  connection = null;
  if (!current) return;
  try {
    (await current).close();
  } catch {
    // The open itself failed: there is nothing to close.
  }
}

/** Erase every project, dataset, recipe and setting. */
export async function deleteAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORES, 'readwrite');
  await Promise.all([...STORES.map((store) => tx.objectStore(store).clear()), tx.done]);
}

/** Bytes used / available for this origin, or null when the browser does not say. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage || typeof storage.estimate !== 'function') return null;
    const { usage, quota } = await storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  } catch {
    return null;
  }
}

let lastTimestamp = 0;

/**
 * Date.now() that never repeats within a session, so "newest first" lists have a
 * well-defined order even when several records are saved in the same millisecond.
 */
export function timestamp(): number {
  const now = Date.now();
  lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 1;
  return lastTimestamp;
}
