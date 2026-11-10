// CSV / formula-injection defence (OWASP "CSV Injection").
//
// Spreadsheet applications treat a cell that starts with = + - @ (or with a TAB / CR / LF,
// which some importers skip before looking at the next character) as a formula. A scraped
// page is untrusted input, so such a cell could run DDE commands or exfiltrate data when
// the exported file is opened. Dangerous cells get a leading apostrophe, which spreadsheet
// apps interpret as "this is text".

// = + - @, their fullwidth forms (some locales normalise them), and TAB / CR / LF.
const DANGEROUS_FIRST = new Set(['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠']);

// "-12.50", "+3", "-1,200", "-5%": nothing but a sign, digits and digit separators. Such a
// value cannot reference a cell or call a function, and prefixing it would turn ordinary
// negative numbers into text – so it is deliberately left alone.
const PLAIN_SIGNED_NUMBER = /^[+-]\d[\d,. ]*%?$/;

/** True when a spreadsheet application could interpret the value as a formula. */
export function isFormulaLike(value: string): boolean {
  if (value === '' || !DANGEROUS_FIRST.has(value.charAt(0))) return false;
  return !PLAIN_SIGNED_NUMBER.test(value);
}

/** Neutralise a formula-like value by prefixing an apostrophe; other values are returned as is. */
export function guardFormula(value: string): string {
  return isFormulaLike(value) ? `'${value}` : value;
}
