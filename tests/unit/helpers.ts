// Shared helpers for DOM-based unit tests (jsdom; page URL is https://example.test/shop/list?page=1).

/** Replace the whole document body (and optionally the head). */
export function setPage(body: string, head = ''): void {
  document.head.innerHTML = head;
  document.body.innerHTML = body;
}

export function $(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`No element matches ${selector}`);
  return el;
}
