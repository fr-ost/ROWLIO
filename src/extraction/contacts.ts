// Contact details on a page: email addresses, phone numbers and social profile links.
// Only what the page already shows or links to is collected.
import type { RawDataset } from '@/types';
import { t } from '@/i18n';
import { truncate } from '@/utils/text';
import { resolveUrl } from '@/utils/url';
import type { Pacer } from '@/utils/async';
import { baseUrlOf, collectRoots, elementText, inlineText, isOwnOverlay } from './dom';
import { looksLikePhone } from './valueTypes';

export const CONTACT_COLUMNS = ['Type', 'Value', 'Label', 'Found in', 'URL'];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
const NOT_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$/i;
const PHONE = /(?:\+|00)[\d০-৯][\d০-৯\s().\-–]{6,20}[\d০-৯]|\(?\d{2,4}\)?[\s.\-–]\d{3,4}[\s.\-–]\d{3,5}/g;

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'Facebook'],
  [/(^|\.)(twitter|x)\.com$/, 'X / Twitter'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)github\.com$/, 'GitHub'],
  [/(^|\.)t\.me$|(^|\.)telegram\.me$/, 'Telegram'],
  [/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/, 'WhatsApp'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'Pinterest'],
  [/(^|\.)threads\.net$/, 'Threads'],
  [/(^|\.)discord\.(gg|com)$/, 'Discord'],
];

function socialNetwork(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    if (pathname === '/' || pathname === '') return ''; // a bare homepage is not a profile
    if (/\/(share|sharer|intent)\b/.test(pathname)) return ''; // "share this" buttons
    for (const [pattern, name] of SOCIAL) if (pattern.test(hostname.toLowerCase())) return name;
  } catch {
    /* not a URL */
  }
  return '';
}

function surrounding(text: string, start: number, length: number): string {
  const from = Math.max(0, start - 40);
  return truncate(text.slice(from, start + length + 40).replace(/\s+/g, ' ').trim(), 120);
}

export async function extractContacts(doc: Document, pacer?: Pacer): Promise<RawDataset> {
  const rows: string[][] = [];
  const seen = new Set<string>();
  const add = (type: string, value: string, label: string, source: string, url: string) => {
    const key = `${type}\u001f${value.toLowerCase()}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push([type, value, label, source, url]);
  };

  for (const { root } of collectRoots(doc)) {
    const links = root.querySelectorAll('a[href]');
    for (let i = 0; i < links.length; i++) {
      if (pacer) await pacer.tick();
      const link = links[i];
      if (isOwnOverlay(link)) continue;
      const raw = (link.getAttribute('href') ?? '').trim();
      const label = inlineText(link) || (link.getAttribute('aria-label') ?? '').trim();
      if (/^mailto:/i.test(raw)) {
        const address = decodeURIComponent(raw.slice(7).split('?')[0] ?? '').trim();
        for (const part of address.split(',')) add('Email', part.trim(), label, 'mailto link', raw);
      } else if (/^tel:/i.test(raw)) {
        add('Phone', decodeURIComponent(raw.slice(4)).trim(), label, 'tel link', raw);
      } else {
        const url = resolveUrl(raw, baseUrlOf(link));
        const network = socialNetwork(url);
        if (network) add(network, url, label, 'link', url);
      }
    }
  }

  const text = doc.body ? elementText(doc.body) : '';
  for (const match of text.matchAll(EMAIL)) {
    if (pacer) await pacer.tick();
    const value = match[0].replace(/[.,;:]+$/, '');
    if (NOT_EMAIL.test(value)) continue;
    add('Email', value, surrounding(text, match.index ?? 0, value.length), 'page text', `mailto:${value}`);
  }
  for (const match of text.matchAll(PHONE)) {
    const value = match[0].trim();
    if (!looksLikePhone(value)) continue;
    add('Phone', value, surrounding(text, match.index ?? 0, value.length), 'page text', `tel:${value.replace(/[^\d+]/g, '')}`);
  }

  return {
    key: 'contacts',
    name: t('Contacts'),
    columns: CONTACT_COLUMNS.map((column) => t(column)),
    rows,
    warnings: rows.length === 0 ? [t('No email addresses, phone numbers or social profiles found on this page.')] : [],
    method: 'contacts',
  };
}
