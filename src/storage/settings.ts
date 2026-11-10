// User settings and a tiny key/value store, both in the `kv` object store.
import { isObject, isPaginationSettings, isTableOptions } from '@/types/guards';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { Settings } from '@/types/settings';
import { getDb } from '@/storage/db';

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

const SETTINGS_KEY = 'settings';
const THEMES: readonly string[] = ['system', 'light', 'dark'];

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return (await db.get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put('kv', value, key);
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('kv', key);
}

function sameKind(candidate: unknown, reference: unknown): boolean {
  if (candidate === null || candidate === undefined) return false;
  if (typeof candidate !== typeof reference) return false;
  return typeof candidate !== 'number' || Number.isFinite(candidate);
}

/**
 * A fresh copy of `base` with values from `patch` laid over it. Only keys that exist in
 * `base` are considered and only values of the same type are accepted, so unknown keys and
 * wrongly typed values from old versions, imports or bugs can never reach the settings.
 */
function overlay<T>(base: T, patch: unknown): T {
  if (!isObject(base)) return base;
  const source = isObject(patch) ? patch : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    const reference = base[key];
    const candidate = source[key];
    if (isObject(reference)) out[key] = overlay(reference, candidate);
    else out[key] = sameKind(candidate, reference) ? candidate : reference;
  }
  return out as T;
}

/** Keep the fields of `candidate` that pass the section's validator; the rest come from `fallback`. */
function repair<T extends object>(candidate: T, fallback: T, isValid: (value: unknown) => value is T): T {
  if (isValid(candidate)) return candidate;
  let repaired: T = { ...fallback };
  for (const key of Object.keys(fallback) as (keyof T)[]) {
    const attempt: T = { ...repaired, [key]: candidate[key] };
    if (isValid(attempt)) repaired = attempt;
  }
  return repaired;
}

/** Type-correct values can still be out of range (an unknown theme, maxPages = -1): fix those. */
function validated(candidate: Settings, fallback: Settings): Settings {
  return {
    ...candidate,
    theme: THEMES.includes(candidate.theme) ? candidate.theme : fallback.theme,
    export: {
      ...candidate.export,
      csvDelimiter:
        candidate.export.csvDelimiter === ',' || candidate.export.csvDelimiter === ';'
          ? candidate.export.csvDelimiter
          : fallback.export.csvDelimiter,
    },
    tables: repair(candidate.tables, fallback.tables, isTableOptions),
    pagination: repair(candidate.pagination, fallback.pagination, isPaginationSettings),
  };
}

function fromStored(stored: unknown): Settings {
  const defaults = overlay(DEFAULT_SETTINGS, undefined);
  return validated(overlay(defaults, stored), defaults);
}

/** Stored settings merged over the defaults, so keys added in newer versions get their default. */
export async function loadSettings(): Promise<Settings> {
  return fromStored(await kvGet<unknown>(SETTINGS_KEY));
}

/** Merge a partial change into the stored settings and return the result. */
export async function saveSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const db = await getDb();
  // Read-modify-write in one transaction: two tabs saving at once cannot lose an update.
  const tx = db.transaction('kv', 'readwrite');
  const current = fromStored(await tx.store.get(SETTINGS_KEY));
  const next = validated(overlay(current, patch), current);
  await Promise.all([tx.store.put(next, SETTINGS_KEY), tx.done]);
  return next;
}

export async function resetSettings(): Promise<Settings> {
  await kvDelete(SETTINGS_KEY);
  return fromStored(undefined);
}
