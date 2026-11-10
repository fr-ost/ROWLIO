// Minimal localisation layer (gettext style).
//
// The English source string is the lookup key, so call sites stay readable:
//   t('Extract tables')
//   t('{count} rows removed', { count: 3 })
//
// To add a language, register a catalog mapping English strings to translations with
// registerCatalog('bn', { 'Extract tables': '…' }) and call setLocale('bn').
// Missing entries fall back to English, so partial translations are safe.

export type Catalog = Record<string, string>;
export type Params = Record<string, string | number>;

const catalogs = new Map<string, Catalog>();
let active = 'en';

export function registerCatalog(locale: string, catalog: Catalog): void {
  catalogs.set(locale, { ...(catalogs.get(locale) ?? {}), ...catalog });
}

export function setLocale(locale: string): void {
  active = locale;
}

export function getLocale(): string {
  return active;
}

export function t(source: string, params?: Params): string {
  const template = catalogs.get(active)?.[source] ?? source;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/** Pick between singular and plural English source strings, then translate. */
export function tn(count: number, one: string, other: string, params?: Params): string {
  return t(count === 1 ? one : other, { count, ...params });
}

const numberFormat = new Intl.NumberFormat('en-US');
export function formatNumber(n: number): string {
  return numberFormat.format(n);
}
