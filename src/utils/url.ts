/** Resolve a possibly relative URL against a base. Returns '' when it cannot be parsed. */
export function resolveUrl(raw: string, base: string): string {
  const value = raw.trim();
  if (!value) return '';
  try {
    return new URL(value, base).href;
  } catch {
    return '';
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** Internal = same host, ignoring a leading "www.". */
export function isInternalUrl(url: string, pageUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(pageUrl);
    if (a.protocol !== 'http:' && a.protocol !== 'https:') return false;
    return bareHost(a.hostname) === bareHost(b.hostname);
  } catch {
    return false;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

/** Convert a `*` glob into an anchored RegExp. Everything else is matched literally. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function matchesUrlPattern(url: string, pattern: string): boolean {
  if (!pattern.trim()) return false;
  try {
    return globToRegExp(pattern).test(url);
  } catch {
    return false;
  }
}

/**
 * Suggest a reusable pattern for a page: keep the origin and directory, wildcard the rest.
 * https://shop.example/category/shoes?page=2 → https://shop.example/category/*
 */
export function suggestUrlPattern(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const segments = u.pathname.split('/').filter(Boolean);
    segments.pop();
    const dir = segments.length ? `/${segments.join('/')}` : '';
    return `${u.origin}${dir}/*`;
  } catch {
    return '';
  }
}

/** Pages Chrome never lets extensions script. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol === 'file:') return false;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  const host = parsed.hostname;
  if (host === 'chromewebstore.google.com') return true;
  if (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) return true;
  return false;
}
