// Local, rule-based recognition of what a field's values mean (price, date, rating, …).
// No remote services: only regular expressions and markup hints.
import type { FieldType } from '@/types';

const CURRENCY_SYMBOL = '[$€£¥₹₽₩₺₫₴₦৳฿₱₪₡₲₵]';
const CURRENCY_CODE =
  '(?:USD|EUR|GBP|JPY|INR|BDT|CAD|AUD|NZD|CHF|CNY|RMB|HKD|SGD|SEK|NOK|DKK|PLN|CZK|HUF|RON|BRL|MXN|ARS|AED|SAR|QAR|KWD|EGP|ZAR|NGN|KES|PKR|LKR|NPR|THB|VND|IDR|MYR|PHP|KRW|TRY|RUB|UAH|ILS|US\\$|A\\$|C\\$|R\\$|Rs\\.?|Tk\\.?|টাকা|kr|zł|Kč|лв|руб)';
const NUM = '[\\d০-৯٠-٩][\\d০-৯٠-٩.,\\u00a0\\u202f \']*';

export const PRICE_RE = new RegExp(`(?:${CURRENCY_SYMBOL}|${CURRENCY_CODE})\\s?${NUM}|${NUM}\\s?(?:${CURRENCY_SYMBOL}|${CURRENCY_CODE})(?![a-z])`, 'i');
export const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;
export const RATING_RE = /(\d(?:[.,]\d+)?)\s*(?:out of|\/|of|sur|von|de)\s*(?:5|10)\b|^[★☆⭐✩✪✭✮]{1,10}$|\b(\d(?:[.,]\d+)?)\s*(?:stars?|étoiles?|sterne)\b|^rated\s+\d/i;
export const REVIEW_COUNT_RE = /^\(\s*[\d০-৯][\d০-৯.,]*\s*[km]?\+?\s*\)$|[\d০-৯][\d০-৯.,]*\s*[km]?\+?\s*(?:reviews?|ratings?|votes?|comments?|opinions?|avis|bewertungen|reseñas|রিভিউ)/i;
export const AVAILABILITY_RE = /\b(in stock|out of stock|sold out|unavailable|available|pre-?order|back-?order|low stock|only \d+ left|coming soon|discontinued|en stock|agotado|auf lager|ausverkauft)\b|স্টকে আছে|স্টক নেই|স্টক আউট/i;
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|জানুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)';
export const DATE_RE = new RegExp(
  `\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{2,4}\\b|${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b|\\b\\d+\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago\\b|\\b(?:yesterday|today)\\b`,
  'i',
);
export const NUMBER_RE = /^[-+−]?[\d০-৯][\d০-৯.,\s]*%?$/;
const SKU_RE = /\b(?:sku|mpn|asin|isbn|upc|ean|gtin|model|item|part)\s*(?:no\.?|number|#|id)?\s*[:#]\s*[\w-]{3,}/i;

export function looksLikePhone(value: string): boolean {
  const v = value.trim();
  if (!/^(?:\+|00|\()?[\d০-৯][\d০-৯\s().\-–]{5,22}$/.test(v) && !/^(?:tel|phone|mobile|call)[:\s]+\+?[\d\s().\-–]{7,22}$/i.test(v)) return false;
  const digits = v.replace(/[^\d০-৯]/g, '').length;
  if (digits < 7 || digits > 15) return false;
  // Plain integers and decimals are numbers, not phone numbers.
  if (/^\d+([.,]\d+)?$/.test(v)) return false;
  if (DATE_RE.test(v)) return false;
  return true;
}

export interface FieldHints {
  tag: string;
  /** Lower-cased class + id + itemprop + data-* names of the element and its parent. */
  tokens: string;
  itemprop: string;
  extract: 'text' | 'href' | 'src' | 'attr' | 'html';
  attribute: string;
  inAddress: boolean;
}

const ITEMPROP_TYPES: Record<string, FieldType> = {
  name: 'title',
  headline: 'title',
  price: 'price',
  lowprice: 'price',
  highprice: 'price',
  description: 'description',
  ratingvalue: 'rating',
  reviewcount: 'reviewCount',
  ratingcount: 'reviewCount',
  author: 'author',
  datepublished: 'date',
  datemodified: 'date',
  datecreated: 'date',
  startdate: 'date',
  sku: 'productId',
  mpn: 'productId',
  productid: 'productId',
  gtin: 'productId',
  gtin13: 'productId',
  isbn: 'productId',
  availability: 'availability',
  category: 'category',
  keywords: 'tag',
  image: 'image',
  url: 'link',
  address: 'address',
  streetaddress: 'address',
  telephone: 'phone',
  email: 'email',
  brand: 'category',
};

const TOKEN_RULES: [RegExp, FieldType][] = [
  [/(^|[^a-z])(price|cost|amount|precio|prix|preis)([^a-z]|$)/, 'price'],
  [/(review|rating)s?[-_ ]?(count|total|number|qty)|(count|num|total)[-_ ]?(review|rating)|reviews\b/, 'reviewCount'],
  [/(^|[^a-z])(rating|stars?|score)([^a-z]|$)/, 'rating'],
  [/(^|[^a-z])(sku|mpn|asin|isbn|upc|ean|gtin|model[-_ ]?(no|number)|product[-_ ]?(id|code)|item[-_ ]?(id|no|number))([^a-z]|$)/, 'productId'],
  [/(^|[^a-z])(stock|availability|avail|inventory)([^a-z]|$)/, 'availability'],
  [/(^|[^a-z])(author|byline|creator|writer|posted[-_ ]?by|user[-_ ]?name)([^a-z]|$)/, 'author'],
  [/(^|[^a-z])(date|time|published|posted|updated|timestamp|datetime)([^a-z]|$)/, 'date'],
  [/(^|[^a-z])(desc|description|summary|excerpt|snippet|teaser|abstract|blurb)([^a-z]|$)/, 'description'],
  [/(^|[^a-z])(category|categories|cat|section|department|brand|vendor)([^a-z]|$)/, 'category'],
  [/(^|[^a-z])(tags?|label|badge|chip|keyword|topic)([^a-z]|$)/, 'tag'],
  [/(^|[^a-z])(address|addr|location|street|city|locality)([^a-z]|$)/, 'address'],
  [/(^|[^a-z])(phone|tel|telephone|mobile)([^a-z]|$)/, 'phone'],
  [/(^|[^a-z])(email|e-mail|mail)([^a-z]|$)/, 'email'],
  [/(^|[^a-z])(title|name|headline|heading|subject)([^a-z]|$)/, 'title'],
];

function ratio(samples: string[], test: (value: string) => boolean): number {
  if (samples.length === 0) return 0;
  let hits = 0;
  for (const sample of samples) if (test(sample)) hits++;
  return hits / samples.length;
}

/** Decide the semantic type of a field from its sample values and markup hints. */
export function classifyField(samples: string[], hints: FieldHints): FieldType {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (hints.extract === 'src') return 'image';
  if (hints.extract === 'href') {
    if (ratio(values, (v) => v.startsWith('mailto:')) >= 0.6) return 'email';
    if (ratio(values, (v) => v.startsWith('tel:')) >= 0.6) return 'phone';
    return 'link';
  }
  const itemprop = hints.itemprop.toLowerCase();
  if (itemprop && ITEMPROP_TYPES[itemprop]) return ITEMPROP_TYPES[itemprop];
  if (hints.attribute === 'datetime') return 'date';
  if (/^data-(product-id|sku|asin|item-id|id|pid)$/.test(hints.attribute)) return 'productId';

  // Strong value patterns first.
  if (ratio(values, (v) => EMAIL_RE.test(v)) >= 0.6) return 'email';
  if (ratio(values, (v) => RATING_RE.test(v)) >= 0.6) return 'rating';
  if (ratio(values, (v) => REVIEW_COUNT_RE.test(v)) >= 0.6) return 'reviewCount';
  if (ratio(values, (v) => PRICE_RE.test(v) && v.length <= 40) >= 0.6) return 'price';
  if (ratio(values, (v) => AVAILABILITY_RE.test(v) && v.length <= 40) >= 0.6) return 'availability';
  if (ratio(values, (v) => SKU_RE.test(v) && v.length <= 60) >= 0.6) return 'productId';

  const tokens = hints.tokens;
  let hinted: FieldType | null = null;
  for (const [pattern, type] of TOKEN_RULES) {
    if (pattern.test(tokens)) {
      hinted = type;
      break;
    }
  }
  const numeric = ratio(values, (v) => NUMBER_RE.test(v));
  if (hinted === 'price' && ratio(values, (v) => /\d/.test(v)) >= 0.6) return 'price';
  if (hinted === 'rating' && ratio(values, (v) => /\d|[★☆⭐]/.test(v)) >= 0.6) return 'rating';
  if (hinted === 'reviewCount' && ratio(values, (v) => /\d/.test(v)) >= 0.6) return 'reviewCount';
  if (hinted === 'phone' || ratio(values, looksLikePhone) >= 0.8) {
    if (ratio(values, (v) => /\d{3}/.test(v)) >= 0.6) return 'phone';
  }
  if (hints.tag === 'TIME' || ratio(values, (v) => DATE_RE.test(v) && v.length <= 60) >= 0.6) return 'date';
  if (hints.inAddress || hints.tag === 'ADDRESS') return 'address';
  if (hinted && hinted !== 'phone' && hinted !== 'price' && hinted !== 'rating' && hinted !== 'reviewCount') return hinted;
  if (/^H[1-6]$/.test(hints.tag)) return 'title';
  if (numeric >= 0.8) return 'number';

  const average = values.reduce((sum, v) => sum + v.length, 0) / Math.max(values.length, 1);
  if (average >= 90) return 'description';
  return 'text';
}

export const FIELD_LABELS: Record<FieldType, string> = {
  title: 'Title',
  heading: 'Heading',
  text: 'Text',
  description: 'Description',
  price: 'Price',
  date: 'Date',
  author: 'Author',
  category: 'Category',
  tag: 'Tags',
  rating: 'Rating',
  reviewCount: 'Reviews',
  image: 'Image URL',
  link: 'URL',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  productId: 'Product ID',
  availability: 'Availability',
  number: 'Number',
  unknown: 'Field',
};
