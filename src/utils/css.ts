/** CSS.escape with a spec-compliant fallback (jsdom and very old engines lack it). */
export function cssEscape(value: string): string {
  const native = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  if (native && typeof native.escape === 'function') return native.escape(value);
  const str = String(value);
  let result = '';
  const first = str.charCodeAt(0);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0) {
      result += '�';
    } else if (
      (code >= 0x1 && code <= 0x1f) ||
      code === 0x7f ||
      (i === 0 && code >= 0x30 && code <= 0x39) ||
      (i === 1 && code >= 0x30 && code <= 0x39 && first === 0x2d)
    ) {
      result += `\\${code.toString(16)} `;
    } else if (i === 0 && str.length === 1 && code === 0x2d) {
      result += `\\${str.charAt(i)}`;
    } else if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      result += str.charAt(i);
    } else {
      result += `\\${str.charAt(i)}`;
    }
  }
  return result;
}
