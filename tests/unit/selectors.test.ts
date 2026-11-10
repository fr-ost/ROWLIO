import { beforeEach, describe, expect, it } from 'vitest';
import { assertRuleValid, extractByRule, queryPage, queryWithin, readValue, testSelector, validateSelector } from '@/extraction/selectors';
import type { ExtractionRule, FieldRule } from '@/types';
import { $, setPage } from './helpers';

const PRODUCTS = `
  <ul id="list">
    <li class="item" data-id="a1">
      <a class="name" href="/p/1" title="First">Blue <b>Shoes</b></a>
      <img src="/img/1.jpg" alt="Blue shoes">
      <span class="price">$10</span>
      <span class="tag">new</span><span class="tag">sale</span>
    </li>
    <li class="item" data-id="a2">
      <a class="name" href="https://other.test/p/2">লাল জুতা</a>
      <span class="price">$12</span>
    </li>
    <li class="item" data-id="a3">
      <a class="name" href="p/3">Green Shoes</a>
      <img data-src="/img/3-real.jpg" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">
      <span class="tag">last</span>
    </li>
  </ul>`;

function field(patch: Partial<FieldRule>): FieldRule {
  return { id: patch.name ?? 'f', name: 'Field', selector: '', selectorType: 'css', extract: 'text', ...patch };
}

function rule(fields: FieldRule[], rowSelector = 'li.item', rowSelectorType: 'css' | 'xpath' = 'css'): ExtractionRule {
  return { rowSelector, rowSelectorType, fields };
}

describe('selector validation', () => {
  beforeEach(() => setPage(PRODUCTS));

  it('accepts valid and rejects invalid CSS', () => {
    expect(validateSelector('li.item > a[href^="/"]', 'css', document)).toBeNull();
    expect(validateSelector('> a', 'css', document)).toBeNull();
    expect(validateSelector('li..item', 'css', document)).toMatch(/Invalid CSS/);
    expect(validateSelector('a[', 'css', document)).toMatch(/Invalid CSS/);
    expect(validateSelector('   ', 'css', document)).toMatch(/Enter a selector/);
  });

  it('accepts valid and rejects invalid XPath', () => {
    expect(validateSelector('//li[@class="item"]/a/@href', 'xpath', document)).toBeNull();
    expect(validateSelector('count(//li)', 'xpath', document)).toBeNull();
    expect(validateSelector('//li[', 'xpath', document)).toMatch(/Invalid XPath/);
    expect(validateSelector('', 'xpath', document)).toMatch(/Enter a selector/);
  });
});

describe('querying', () => {
  beforeEach(() => setPage(PRODUCTS));

  it('finds elements with CSS and XPath', () => {
    expect(queryPage(document, 'li.item', 'css').nodes).toHaveLength(3);
    expect(queryPage(document, '//li[@class="item"]', 'xpath').nodes).toHaveLength(3);
  });

  it('returns XPath scalars as values', () => {
    expect(queryPage(document, 'count(//li)', 'xpath').scalar).toBe('3');
    expect(queryPage(document, 'string(//li[1]/span[@class="price"])', 'xpath').scalar).toBe('$10');
    expect(queryPage(document, 'boolean(//table)', 'xpath').scalar).toBe('false');
  });

  it('evaluates field selectors relative to the row', () => {
    const row = $('li.item');
    expect(queryWithin(row, '.price', 'css', document).nodes).toHaveLength(1);
    expect(queryWithin(row, '> a', 'css', document).nodes).toHaveLength(1);
    expect(queryWithin(row, '> b', 'css', document).nodes).toHaveLength(0); // <b> is not a direct child
    expect(queryWithin(row, '', 'css', document).nodes).toEqual([row]);
    expect(queryWithin(row, './/span[@class="tag"]', 'xpath', document).nodes).toHaveLength(2);
    // "//x" inside a row means ".//x", not "every x on the page".
    expect(queryWithin(row, '//span[@class="price"]', 'xpath', document).nodes).toHaveLength(1);
    expect(queryWithin(row, 'count(.//span)', 'xpath', document).scalar).toBe('3');
  });
});

describe('reading values', () => {
  beforeEach(() => setPage(PRODUCTS));

  it('reads text, HTML, attributes, absolute links and image sources', () => {
    const link = $('li.item a.name');
    expect(readValue(link, 'text', undefined)).toBe('Blue Shoes');
    expect(readValue(link, 'html', undefined)).toBe('Blue <b>Shoes</b>');
    expect(readValue(link, 'href', undefined)).toBe('https://example.test/p/1');
    expect(readValue(link, 'attr', 'title')).toBe('First');
    expect(readValue(link, 'attr', 'missing')).toBe('');
    expect(readValue($('li.item img'), 'src', undefined)).toBe('https://example.test/img/1.jpg');
    expect(readValue($('li.item img'), 'text', undefined)).toBe('Blue shoes');
  });

  it('resolves relative links against the page directory', () => {
    const third = document.querySelectorAll('li.item')[2];
    expect(readValue(third.querySelector('a')!, 'href', undefined)).toBe('https://example.test/shop/p/3');
  });

  it('finds the link or image belonging to a non-link element', () => {
    const row = $('li.item');
    // An element inside a link, and a container holding a link.
    expect(readValue(row.querySelector('b')!, 'href', undefined)).toBe('https://example.test/p/1');
    expect(readValue(row, 'href', undefined)).toBe('https://example.test/p/1');
    expect(readValue(row, 'src', undefined)).toBe('https://example.test/img/1.jpg');
    expect(readValue(row.querySelector('.price')!, 'href', undefined)).toBe('');
  });

  it('looks through lazy-loading placeholders', () => {
    const lazy = document.querySelectorAll('li.item')[2].querySelector('img')!;
    expect(readValue(lazy, 'src', undefined)).toBe('https://example.test/img/3-real.jpg');
  });

  it('reads XPath attribute and text nodes', () => {
    const attr = queryPage(document, '//li[1]/a/@href', 'xpath').nodes[0];
    expect(readValue(attr, 'text', undefined)).toBe('/p/1');
    expect(readValue(attr, 'href', undefined)).toBe('https://example.test/p/1');
    const text = queryPage(document, '//li[2]/span/text()', 'xpath').nodes[0];
    expect(readValue(text, 'text', undefined)).toBe('$12');
  });
});

describe('rule extraction', () => {
  beforeEach(() => setPage(PRODUCTS));

  it('extracts one record per row and leaves missing fields empty', async () => {
    const result = await extractByRule(
      document,
      rule([
        field({ name: 'Name', selector: 'a.name' }),
        field({ name: 'URL', selector: 'a.name', extract: 'href' }),
        field({ name: 'Price', selector: '.price' }),
        field({ name: 'Image', selector: 'img', extract: 'src' }),
        field({ name: 'ID', selector: '', extract: 'attr', attribute: 'data-id' }),
        field({ name: 'Tags', selector: '.tag', multiple: true, joinWith: ' | ' }),
        field({ name: 'XPath price', selector: './/span[@class="price"]', selectorType: 'xpath' }),
      ]),
    );
    expect(result.columns).toEqual(['Name', 'URL', 'Price', 'Image', 'ID', 'Tags', 'XPath price']);
    expect(result.totalRows).toBe(3);
    expect(result.rows).toEqual([
      ['Blue Shoes', 'https://example.test/p/1', '$10', 'https://example.test/img/1.jpg', 'a1', 'new | sale', '$10'],
      ['লাল জুতা', 'https://other.test/p/2', '$12', '', 'a2', '', '$12'],
      ['Green Shoes', 'https://example.test/shop/p/3', '', 'https://example.test/img/3-real.jpg', 'a3', 'last', ''],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('takes only the first match unless "multiple" is set', async () => {
    const result = await extractByRule(document, rule([field({ name: 'Tag', selector: '.tag' })]));
    expect(result.rows.map((row) => row[0])).toEqual(['new', '', 'last']);
  });

  it('supports an XPath row selector', async () => {
    const result = await extractByRule(document, rule([field({ name: 'Name', selector: 'a' })], '//ul[@id="list"]/li[position() <= 2]', 'xpath'));
    expect(result.rows).toEqual([['Blue Shoes'], ['লাল জুতা']]);
  });

  it('warns when the row selector or a field matches nothing', async () => {
    const none = await extractByRule(document, rule([field({ name: 'Name', selector: 'a' })], 'div.nope'));
    expect(none.rows).toEqual([]);
    expect(none.warnings[0]).toMatch(/row selector matched nothing/);

    const partial = await extractByRule(document, rule([field({ name: 'Name', selector: 'a' }), field({ name: 'Ghost', selector: '.ghost' })]));
    expect(partial.rows).toHaveLength(3);
    expect(partial.warnings).toEqual(['Field "Ghost" matched nothing in any row.']);
  });

  it('column mode zips fields by position and warns about mismatched counts', async () => {
    const result = await extractByRule(document, rule([field({ name: 'Name', selector: 'li.item a.name' }), field({ name: 'Price', selector: 'li.item .price' })], ''));
    expect(result.rows).toEqual([
      ['Blue Shoes', '$10'],
      ['লাল জুতা', '$12'],
      ['Green Shoes', ''],
    ]);
    expect(result.warnings[0]).toMatch(/different numbers of elements \(Name: 3, Price: 2\)/);
  });

  it('respects the preview limit but reports the real total', async () => {
    const result = await extractByRule(document, rule([field({ name: 'Name', selector: 'a' })]), { limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.totalRows).toBe(3);
  });

  it('makes duplicate field names unique', async () => {
    const result = await extractByRule(document, rule([field({ name: 'X', selector: 'a' }), field({ name: 'X', selector: '.price' }), field({ name: '', selector: '.tag' })]));
    expect(result.columns).toEqual(['X', 'X (2)', 'Field 3']);
  });

  it('rejects invalid rules with a message naming the field', () => {
    expect(() => assertRuleValid(document, rule([]))).toThrow(/at least one field/);
    expect(() => assertRuleValid(document, rule([field({ name: 'Bad', selector: 'a[' })]))).toThrow(/Field "Bad": Invalid CSS/);
    expect(() => assertRuleValid(document, rule([field({ name: 'Name', selector: 'a' })], 'li[['))).toThrow(/Row selector: Invalid CSS/);
    expect(() => assertRuleValid(document, rule([field({ name: 'Attr', selector: 'a', extract: 'attr' })]))).toThrow(/attribute name/);
    expect(() => assertRuleValid(document, rule([field({ name: 'Self', selector: '' })], ''))).toThrow(/needs a row selector/);
  });

  it('reuses cached rows only while their content is unchanged', async () => {
    const cache = new WeakMap();
    const fields = rule([field({ name: 'Name', selector: 'a' }), field({ name: 'Image', selector: 'img', extract: 'src' })]);
    const before = await extractByRule(document, fields, { cache });
    const again = await extractByRule(document, fields, { cache });
    expect(again.rows[0]).toBe(before.rows[0]); // same array: served from the cache
    // A lazy image swapping its src must invalidate the cached row.
    document.querySelectorAll('li.item img')[1].setAttribute('src', '/img/3-loaded.jpg');
    $('li.item a').textContent = 'Renamed';
    const after = await extractByRule(document, fields, { cache });
    expect(after.rows[0][0]).toBe('Renamed');
    expect(after.rows[2][1]).toBe('https://example.test/img/3-loaded.jpg');
  });
});

describe('testSelector', () => {
  beforeEach(() => setPage(PRODUCTS));

  it('reports counts and samples', () => {
    const result = testSelector(document, { selector: 'li.item a.name', selectorType: 'css', limit: 2 });
    expect(result).toMatchObject({ valid: true, count: 3 });
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0]).toMatchObject({ index: 0, tag: 'a', text: 'Blue Shoes', value: 'Blue Shoes' });
    expect(result.samples[0].attributes).toContainEqual(['href', '/p/1']);
    expect(result.samples[0].html).toContain('<a class="name"');
  });

  it('reports how many rows contain a field', () => {
    const result = testSelector(document, { selector: '.price', selectorType: 'css', limit: 5, rowSelector: 'li.item' });
    expect(result).toMatchObject({ valid: true, count: 2, rowCount: 3 });
    const self = testSelector(document, { selector: '', selectorType: 'css', limit: 5, rowSelector: 'li.item', extract: 'attr', attribute: 'data-id' });
    expect(self.samples.map((sample) => sample.value)).toEqual(['a1', 'a2', 'a3']);
  });

  it('returns errors instead of throwing', () => {
    expect(testSelector(document, { selector: 'a[', selectorType: 'css', limit: 5 })).toMatchObject({ valid: false, count: 0 });
    expect(testSelector(document, { selector: '//a[', selectorType: 'xpath', limit: 5 }).error).toMatch(/Invalid XPath/);
    expect(testSelector(document, { selector: 'a', selectorType: 'css', limit: 5, rowSelector: 'li[[' }).error).toMatch(/Row selector/);
  });

  it('handles scalar XPath results', () => {
    expect(testSelector(document, { selector: 'count(//li)', selectorType: 'xpath', limit: 5 })).toMatchObject({ valid: true, scalar: '3' });
  });
});
