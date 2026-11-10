/** Collapse every run of whitespace (including NBSP) into a single space and trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/[\s ]+/g, ' ').trim();
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  // Avoid cutting a surrogate pair in half.
  let end = max - 1;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}

/**
 * Make header names unique and non-empty: "", "Name", "Name" → "Column 1", "Name", "Name (2)".
 * Never drops a column.
 */
export function uniqueNames(names: string[], emptyLabel = 'Column'): string[] {
  const seen = new Map<string, number>();
  const taken = new Set<string>();
  return names.map((raw, index) => {
    const base = collapseWhitespace(raw ?? '') || `${emptyLabel} ${index + 1}`;
    let name = base;
    let n = seen.get(base) ?? 1;
    while (taken.has(name)) {
      n += 1;
      name = `${base} (${n})`;
    }
    seen.set(base, n);
    taken.add(name);
    return name;
  });
}

/** "product-vendor_name" → "Product vendor name" */
export function humanize(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/**
 * File-name friendly slug. Latin accents are folded (é → e); letters of every other
 * script are kept together with their combining marks, so "বাংলা তথ্য" stays readable
 * instead of losing its vowel signs.
 */
export function slugify(value: string, max = 60): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  // Cut on a code point boundary and never leave a dangling combining mark or dash.
  return Array.from(slug).slice(0, max).join('').replace(/-+$/g, '');
}
