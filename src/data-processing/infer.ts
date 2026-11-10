// Value-level inference: what a cell "is" (for type badges and numeric sorting), loose
// number extraction and strict, never-guessing date parsing for the cleaning tools.
import type { ColumnStats, ColumnType, TableData } from '@/types/data';

export type ValueType = 'empty' | 'number' | 'date' | 'url' | 'email' | 'boolean' | 'text';

// \s already covers NBSP and U+FEFF; zero-width space / joiners and word joiner are added
// because a cell that only contains those is empty to a human.
const BLANK = /^[\s​-‍⁠]*$/;

/** Empty, whitespace-only or invisible-characters-only. */
export function isBlank(value: string): boolean {
  return value === '' || BLANK.test(value);
}

// ---------------------------------------------------------------------------------------
// Digits
// ---------------------------------------------------------------------------------------

const NON_ASCII = /[^\x00-\x7f]/;
const ANY_DIGIT = /\p{Nd}/gu;
const ONE_DIGIT = /^\p{Nd}$/u;
const digitCache = new Map<string, string>();

function asciiDigit(ch: string): string {
  if (ch >= '0' && ch <= '9') return ch;
  const cached = digitCache.get(ch);
  if (cached !== undefined) return cached;
  // Unicode guarantees every script's decimal digits are encoded as a contiguous run 0–9
  // (adjacent sets, e.g. the mathematical digits, still start on a multiple of ten), so the
  // value is the distance from the start of the run modulo 10. No per-script table needed.
  const code = ch.codePointAt(0) ?? 0;
  let start = code;
  while (start > 0 && ONE_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
  const digit = String((code - start) % 10);
  digitCache.set(ch, digit);
  return digit;
}

/** Convert every Unicode decimal digit (Bengali ০-৯, Arabic-Indic, Devanagari, fullwidth…) to ASCII. */
export function toAsciiDigits(value: string): string {
  return NON_ASCII.test(value) ? value.replace(ANY_DIGIT, asciiDigit) : value;
}

const EXOTIC_NUMBER_CHARS = /[٫٬，．−－﹣＋]/g;
const EXOTIC_NUMBER_MAP: Record<string, string> = {
  '٫': '.', // Arabic decimal separator
  '٬': ',', // Arabic thousands separator
  '，': ',', // fullwidth comma
  '．': '.', // fullwidth full stop
  '−': '-', // minus sign
  '－': '-', // fullwidth hyphen-minus
  '﹣': '-', // small hyphen-minus
  '＋': '+', // fullwidth plus
};

function normalizeNumberText(value: string): string {
  if (!NON_ASCII.test(value)) return value;
  return value.replace(ANY_DIGIT, asciiDigit).replace(EXOTIC_NUMBER_CHARS, (ch) => EXOTIC_NUMBER_MAP[ch] ?? ch);
}

// ---------------------------------------------------------------------------------------
// Strict numbers (type inference / numeric sort)
// ---------------------------------------------------------------------------------------

// sign? currency? sign? (grouped | Indian-grouped | plain) fraction? (% | currency)?
const STRICT_NUMBER =
  /^([-+])?(?:(\p{Sc})\s?)?([-+])?(?:(\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d+)(\.\d+)?|(\.\d+))(?:\s?(%|\p{Sc}))?$/u;

/**
 * The numeric value of a cell that is entirely a number ("1,234.50", "-12%", "৳ ১,২০০",
 * "12 €"), or null. This is the definition behind `inferValueType(value) === 'number'`.
 * Deliberately conservative: "1.234,56", "12 apples" or "1e5" are not numbers here.
 */
export function parseNumberStrict(value: string): number | null {
  const text = normalizeNumberText(value.trim());
  if (text === '' || text.length > 40) return null;
  const match = STRICT_NUMBER.exec(text);
  if (!match) return null;
  // At most one sign and at most one unit symbol.
  if ((match[1] && match[3]) || (match[2] && match[7])) return null;
  const digits = (match[4] ?? '0').replace(/,/g, '') + (match[5] ?? match[6] ?? '');
  const number = Number(digits);
  if (!Number.isFinite(number)) return null;
  return match[1] === '-' || match[3] === '-' ? 0 - number : number;
}

// ---------------------------------------------------------------------------------------
// Loose numbers (extraction from free text)
// ---------------------------------------------------------------------------------------

// 1: digit groups separated by a space-like character or apostrophe ("1 234,5", "1'234'567")
// 3: a run of digits with . or , separators – interpreted by interpretRun()
// 4: a leading-dot decimal (".5"), only when the dot does not follow a word ("No.5" is 5)
const NUMBER_RUN =
  /([1-9]\d{0,2}([    '])\d{3}(?:\2\d{3})*(?!\d)(?:[.,]\d+)?(?![.,]?\d))|(\d+(?:[.,]\d+)*)|((?<![\p{L}\p{N}.,])\.\d+)/gu;
const HAS_DIGIT = /\d/;
const CURRENCY = /\p{Sc}/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function isGrouped(parts: string[], separator: string): boolean {
  const first = parts[0] ?? '';
  if (parts.length < 2 || first.length > 3 || first.startsWith('0')) return false;
  let western = true;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i]!.length !== 3) {
      western = false;
      break;
    }
  }
  if (western) return true;
  // Indian grouping (lakh / crore): 12,34,567
  if (separator !== ',' || parts.length < 3 || first.length > 2) return false;
  for (let i = 1; i < parts.length - 1; i++) if (parts[i]!.length !== 2) return false;
  return parts[parts.length - 1]!.length === 3;
}

/**
 * Turn a run such as "1,234.56", "1.234,56", "12,345" or "1,2,3" into plain numbers.
 * A run that cannot be one number (a list, an IP address, a dotted date) yields its parts.
 */
function interpretRun(run: string): string[] {
  const parts = run.split(/[.,]/);
  if (parts.length === 1) return [run];
  const separators = run.replace(/\d/g, '');

  if (parts.length === 2) {
    // A single comma followed by exactly three digits is a thousands group ("12,345");
    // anything else – including every single dot – is a decimal separator.
    const [whole = '', rest = ''] = parts;
    if (separators === ',' && rest.length === 3 && whole.length <= 3 && !whole.startsWith('0')) return [whole + rest];
    return [`${whole}.${rest}`];
  }

  const last = separators.charAt(separators.length - 1);
  const uniform = separators === last.repeat(separators.length);
  if (uniform) return isGrouped(parts, last) ? [parts.join('')] : parts;

  // Both separators present: the last one is the decimal separator, provided everything
  // before it is a well-formed thousands grouping with the other separator.
  const other = last === ',' ? '.' : ',';
  const head = separators.slice(0, -1);
  const whole = parts.slice(0, -1);
  if (head === other.repeat(head.length) && isGrouped(whole, other)) {
    return [`${whole.join('')}.${parts[parts.length - 1]}`];
  }
  // Otherwise the commas separate list items ("1.5,2.5").
  return run.split(',').flatMap(interpretRun);
}

/** True when the number starting at `index` is directly preceded by a minus sign. */
function hasMinus(text: string, index: number): boolean {
  let at = index - 1;
  // A currency symbol may sit between the sign and the digits: "-$5", "-৳ 500".
  if (at >= 1 && /\s/.test(text.charAt(at)) && CURRENCY.test(text.charAt(at - 1))) at -= 2;
  else if (at >= 0 && CURRENCY.test(text.charAt(at))) at -= 1;
  if (at < 0 || text.charAt(at) !== '-') return false;
  // A hyphen glued to a preceding word or number is a separator ("10-20", "SKU-123").
  return at === 0 || !WORD_CHAR.test(text.charAt(at - 1));
}

function scanNumbers(value: string, max: number): string[] {
  const text = normalizeNumberText(value);
  const found: string[] = [];
  if (!HAS_DIGIT.test(text)) return found;
  NUMBER_RUN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while (found.length < max && (match = NUMBER_RUN.exec(text)) !== null) {
    let numbers: string[];
    if (match[1] !== undefined) {
      const [whole = '', fraction] = match[1].split(/[.,]/);
      const digits = whole.split(match[2] ?? ' ').join('');
      numbers = [fraction ? `${digits}.${fraction}` : digits];
    } else if (match[3] !== undefined) {
      numbers = interpretRun(match[3]);
    } else {
      numbers = [`0${match[4] ?? ''}`];
    }
    const negative = hasMinus(text, match.index);
    for (let i = 0; i < numbers.length && found.length < max; i++) {
      found.push(i === 0 && negative ? `-${numbers[i]}` : numbers[i]!);
    }
  }
  return found;
}

/**
 * Every number in the text, normalised to plain ASCII ("-1234.56"): Unicode digits are
 * converted, thousands separators removed, the decimal separator becomes ".". Digits are
 * otherwise kept as written ("12.50" stays "12.50", "007" stays "007") – nothing is rounded.
 * Parentheses are not treated as a negative sign.
 */
export function extractAllNumbers(value: string): string[] {
  return scanNumbers(value, Number.MAX_SAFE_INTEGER);
}

/** The first number found in the text, or null when it contains no digits. */
export function parseNumberLoose(value: string): number | null {
  const first = scanNumbers(value, 1)[0];
  if (first === undefined) return null;
  const number = Number(first);
  if (!Number.isFinite(number)) return null;
  return number === 0 ? 0 : number;
}

// ---------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------

const MONTH_NAME =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const WEEKDAY = '(?:(?:mon|tue(?:s)?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s+)?';
// The zone is recognised only so it can be dropped: values are wall-clock, never shifted.
const ZONE =
  '(?:\\s*(?:z|utc?|gmt|[ecmp][sd]t|bst|ist|cest?|eest?|west?|aest|aedt|jst|kst|sgt|hkt|pkt|npt))?' +
  '(?:\\s*[+-]\\d{2}(?::?\\d{2})?)?(?:\\s*\\([a-z]{2,5}\\))?';
// Four groups: hour, minute, second, a/p.
const TIME =
  '(?:(?:t|\\s*,?\\s+(?:at\\s+)?)(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,]\\d{1,9})?)?(?:\\s*([ap])\\.?m\\.?)?' +
  ZONE +
  ')?';

const YEAR_FIRST = new RegExp(`^(\\d{4})([-/.])(\\d{1,2})\\2(\\d{1,2})${TIME}$`, 'i');
const DAY_MONTH_YEAR = new RegExp(
  `^${WEEKDAY}(\\d{1,2})(?:st|nd|rd|th)?[\\s.\\-/]*(?:of\\s+)?${MONTH_NAME}[\\s.,\\-/]*(\\d{4})${TIME}$`,
  'i',
);
const MONTH_DAY_YEAR = new RegExp(
  `^${WEEKDAY}${MONTH_NAME}[\\s.\\-/]*(\\d{1,2})(?:st|nd|rd|th)?[\\s,\\-/]+(\\d{4})${TIME}$`,
  'i',
);
const NUMERIC_DAY_MONTH = new RegExp(`^(\\d{1,2})([-/.])(\\d{1,2})\\2(\\d{4})${TIME}$`, 'i');

const MONTH_INDEX = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MAX_DATE_LENGTH = 80;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

/** Validate the calendar date and optional time; null when any part is out of range. */
function toIso(year: number, month: number, day: number, match: RegExpExecArray, timeGroup: number): string | null {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const date = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  const hourText = match[timeGroup];
  if (hourText === undefined) return date;

  let hour = Number(hourText);
  const minute = Number(match[timeGroup + 1]);
  const second = Number(match[timeGroup + 2] ?? '0');
  const meridiem = match[timeGroup + 3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${date}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}`;
}

function monthFromName(name: string): number {
  return MONTH_INDEX.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/** iso === null means "this is a date, but the day / month order cannot be known". */
function parseDate(value: string): { iso: string | null } | null {
  const text = toAsciiDigits(value).trim();
  if (text.length < 6 || text.length > MAX_DATE_LENGTH) return null;

  let match = YEAR_FIRST.exec(text);
  if (match) {
    const iso = toIso(Number(match[1]), Number(match[3]), Number(match[4]), match, 5);
    return iso ? { iso } : null;
  }

  match = DAY_MONTH_YEAR.exec(text);
  if (match) {
    const iso = toIso(Number(match[3]), monthFromName(match[2] ?? ''), Number(match[1]), match, 4);
    return iso ? { iso } : null;
  }

  match = MONTH_DAY_YEAR.exec(text);
  if (match) {
    const iso = toIso(Number(match[3]), monthFromName(match[1] ?? ''), Number(match[2]), match, 4);
    return iso ? { iso } : null;
  }

  match = NUMERIC_DAY_MONTH.exec(text);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[3]);
    const year = Number(match[4]);
    // The order is only certain when one part cannot be a month (or both are equal).
    if (first > 12 || first === second) {
      const iso = toIso(year, second, first, match, 5);
      return iso ? { iso } : null;
    }
    if (second > 12) {
      const iso = toIso(year, first, second, match, 5);
      return iso ? { iso } : null;
    }
    // Both ≤ 12: valid either way, so it is a date we refuse to interpret.
    return toIso(year, first, second, match, 5) && toIso(year, second, first, match, 5) ? { iso: null } : null;
  }
  return null;
}

/**
 * ISO `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm:ss` when a time is present) – but ONLY when the
 * value is unambiguous: ISO / year-first forms, English month names, RFC 2822, or numeric
 * day/month forms where one part is > 12. `03/04/2024`, two-digit years and impossible
 * dates return null. Time zones are dropped, never applied: the result is the wall-clock
 * value exactly as written on the page.
 */
export function parseDateUnambiguous(value: string): string | null {
  return parseDate(value)?.iso ?? null;
}

// ---------------------------------------------------------------------------------------
// Types and column statistics
// ---------------------------------------------------------------------------------------

const BOOLEAN = /^(?:true|false|yes|no)$/i;
const HTTP_URL = /^https?:\/\/\S+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;
const MAX_SCALAR_LENGTH = 100;

export function inferValueType(value: string): ValueType {
  if (isBlank(value)) return 'empty';
  const text = value.trim();
  if (HTTP_URL.test(text)) return 'url';
  // Nothing below can be longer than a short phrase; skip the regex work for prose.
  if (text.length > MAX_SCALAR_LENGTH) return 'text';
  if (parseNumberStrict(text) !== null) return 'number';
  if (BOOLEAN.test(text)) return 'boolean';
  if (EMAIL.test(text)) return 'email';
  // An order-ambiguous date ("03/04/2024") is still a date as far as the type goes.
  if (parseDate(text) !== null) return 'date';
  return 'text';
}

const TYPE_SAMPLE_SIZE = 5000;

/**
 * Type, empty / non-empty counts and number of distinct non-empty values of one column.
 * The type is the dominant type when at least 90% of the non-empty values share it,
 * otherwise 'mixed'. Counts are exact; the type is inferred from an even sample of at
 * most 5,000 non-empty values so huge datasets stay fast.
 */
export function columnStats(data: TableData, columnIndex: number): ColumnStats {
  const rows = data.rows;
  const distinct = new Set<string>();
  let empty = 0;
  for (let i = 0; i < rows.length; i++) {
    const value = rows[i]!.cells[columnIndex] ?? '';
    if (isBlank(value)) empty += 1;
    else distinct.add(value);
  }
  const nonEmpty = rows.length - empty;
  if (nonEmpty === 0) return { type: 'empty', empty, nonEmpty, distinct: 0 };

  const step = Math.ceil(nonEmpty / TYPE_SAMPLE_SIZE);
  const counts = new Map<ValueType, number>();
  let seen = 0;
  let sampled = 0;
  for (let i = 0; i < rows.length; i++) {
    const value = rows[i]!.cells[columnIndex] ?? '';
    if (isBlank(value)) continue;
    if (seen % step === 0) {
      const type = inferValueType(value);
      counts.set(type, (counts.get(type) ?? 0) + 1);
      sampled += 1;
    }
    seen += 1;
  }

  let type: ColumnType = 'mixed';
  for (const [candidate, count] of counts) {
    if (count * 10 >= sampled * 9) type = candidate;
  }
  return { type, empty, nonEmpty, distinct: distinct.size };
}

export function allColumnStats(data: TableData): ColumnStats[] {
  return data.columns.map((_, index) => columnStats(data, index));
}
