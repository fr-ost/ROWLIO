import { beforeEach, describe, expect, it } from 'vitest';
import { detectFields, fieldForElement } from '@/extraction/fields';
import { classQuality, genericSelector, relativeSelector, selectorForGroup, similar, uniqueSelector } from '@/extraction/generate';
import { buildRuleForSelector, detectPatterns, findRecordGroup, groupFromExamples, narrowerGroup, widerGroup } from '@/extraction/patterns';
import { extractByRule } from '@/extraction/selectors';
import { classifyField, looksLikePhone, type FieldHints } from '@/extraction/valueTypes';
import { $, setPage } from './helpers';

function card(i: number): string {
  const rating = i % 2 ? `<span class="rating" aria-label="${3 + (i % 2)}.5 out of 5 stars">★★★★☆</span><span class="review-count">(${i * 12} reviews)</span>` : '';
  const tags = Array.from({ length: (i % 3) + 1 }, (_, k) => `<li class="tag">tag${k}</li>`).join('');
  return `
    <article class="product-card${i === 2 ? ' featured' : ''}" data-product-id="p${i}">
      <a class="thumb" href="/p/${i}"><img src="/img/${i}.jpg" alt="Product ${i}"></a>
      <h3 class="title"><a href="/p/${i}">Product ${i}</a></h3>
      <span class="price">$${10 + i}.99</span>
      ${rating}
      <p class="description">A fairly long description of product number ${i} that goes on for a while so it reads like body text.</p>
      <time class="added" datetime="2024-0${(i % 9) + 1}-15">added recently</time>
      <span class="availability">${i % 4 === 0 ? 'Out of stock' : 'In stock'}</span>
      <ul class="tags">${tags}</ul>
      <button type="button">Add to cart</button>
    </article>`;
}

const SHOP = `
  <nav><ul><li><a href="/">Home</a></li><li><a href="/a">About</a></li><li><a href="/c">Contact</a></li></ul></nav>
  <main><div class="grid">${Array.from({ length: 8 }, (_, i) => card(i)).join('')}</div></main>
  <footer><ul class="foot"><li><a href="/t">Terms</a></li><li><a href="/p">Privacy</a></li><li><a href="/h">Help</a></li></ul></footer>`;

describe('class quality and similarity', () => {
  it('ranks semantic classes above utility, hashed and state classes', () => {
    expect(classQuality('product-card')).toBe(3);
    expect(classQuality('mt-4')).toBe(1);
    expect(classQuality('md:flex')).toBe(1);
    expect(classQuality('css-1q2w3e4')).toBe(0);
    expect(classQuality('Card_title__3xK2a')).toBe(0);
    expect(classQuality('card__title')).toBe(3); // BEM element, not a hash
    expect(classQuality('active')).toBe(-1);
    expect(classQuality('is-selected')).toBe(-1);
  });

  it('treats elements with mostly the same classes as similar', () => {
    setPage('<ul><li class="item">a</li><li class="item active">b</li><li class="item featured">c</li><li class="ad">d</li><li>e</li></ul>');
    const [a, b, c, ad, bare] = Array.from(document.querySelectorAll('li'));
    expect(similar(a, b)).toBe(true); // state class ignored
    expect(similar(a, c)).toBe(true);
    expect(similar(a, ad)).toBe(false);
    expect(similar(a, bare)).toBe(false);
    expect(similar(a, document.body)).toBe(false);
  });
});

describe('selector generation', () => {
  beforeEach(() => setPage(SHOP));

  it('builds selectors that match exactly one element', () => {
    for (const selector of ['.grid', 'article.featured h3', 'footer ul', 'nav li:nth-child(2) a', 'article:nth-of-type(5) .tag']) {
      const el = $(selector);
      const generated = uniqueSelector(el);
      const found = document.querySelectorAll(generated);
      expect(found, `${selector} → ${generated}`).toHaveLength(1);
      expect(found[0]).toBe(el);
    }
  });

  it('prefers stable ids and ignores generated ones', () => {
    setPage('<div id="results"><p>a</p></div><div id=":r3:"><p>b</p></div><div id="item-839201773"><p>c</p></div>');
    expect(uniqueSelector($('#results'))).toBe('#results');
    expect(uniqueSelector(document.querySelectorAll('div')[1])).not.toContain(':r3:');
    expect(uniqueSelector(document.querySelectorAll('div')[2])).not.toContain('839201773');
  });

  it('builds short relative selectors inside a record', () => {
    const record = $('article.product-card');
    expect(relativeSelector(record, record)).toBe('');
    expect(relativeSelector(record, record.querySelector('.price')!)).toBe('span.price');
    expect(relativeSelector(record, record.querySelector('h3 a')!)).toBe('h3.title > a');
    const img = record.querySelector('img')!;
    expect(record.querySelectorAll(relativeSelector(record, img))[0]).toBe(img);
    // Position-free selector for repeated children.
    const third = document.querySelectorAll('article.product-card')[2];
    expect(genericSelector(third, third.querySelectorAll('.tag')[1])).toBe('li.tag');
    const positional = relativeSelector(third, third.querySelectorAll('.tag')[1]);
    expect(third.querySelectorAll(positional)).toHaveLength(1);
  });

  it('selects a group of records with a short class selector', () => {
    const cards = Array.from(document.querySelectorAll('article.product-card'));
    expect(selectorForGroup(cards)).toBe('article.product-card');
    const navItems = Array.from(document.querySelectorAll('nav li'));
    const navSelector = selectorForGroup(navItems);
    expect(Array.from(document.querySelectorAll(navSelector))).toEqual(navItems); // footer items excluded
  });
});

describe('repeated pattern detection', () => {
  beforeEach(() => setPage(SHOP));

  it('ranks the main listing above navigation and inner lists', () => {
    const patterns = detectPatterns(document, 5);
    expect(patterns[0]).toMatchObject({ selector: 'article.product-card', count: 8 });
    expect(patterns[0].samples[0]).toContain('Product 0');
    expect(patterns.map((pattern) => pattern.selector)).not.toContain('button');
    const nav = patterns.find((pattern) => pattern.selector.startsWith('nav'));
    if (nav) expect(nav.score).toBeLessThan(patterns[0].score);
  });

  it('returns nothing for a page without repetition', () => {
    setPage('<h1>Title</h1><p>One paragraph.</p><p>Another.</p>');
    expect(detectPatterns(document, 5)).toEqual([]);
  });

  it('finds the record a clicked element belongs to', () => {
    const price = document.querySelectorAll('.price')[3];
    const group = findRecordGroup(price)!;
    expect(group.selector).toBe('article.product-card');
    expect(group.elements).toHaveLength(8);
    expect(group.anchor).toBe(price.closest('article'));
    // A tag inside a card: tags vary in number, so the tag list itself is offered…
    const tag = document.querySelectorAll('article')[2].querySelector('.tag')!;
    const tags = findRecordGroup(tag)!;
    expect(tags.elements.every((el) => el.classList.contains('tag'))).toBe(true);
    // …and "Wider" moves up to the cards.
    expect(widerGroup(tags.anchor)!.selector).toBe('article.product-card');
  });

  it('chooses rows, not cells, in grid-like markup', () => {
    setPage(`<div class="tbl">${Array.from({ length: 5 }, (_, r) => `<div class="row"><div class="cell">n${r}</div><div class="cell">v${r}</div><div class="cell">x${r}</div></div>`).join('')}</div>`);
    const group = findRecordGroup(document.querySelectorAll('.cell')[4])!;
    expect(group.elements).toHaveLength(5);
    expect(group.elements.every((el) => el.classList.contains('row'))).toBe(true);
    expect(Array.from(document.querySelectorAll(group.selector))).toEqual(group.elements);
    // Narrower goes back down towards the clicked cell.
    const narrower = narrowerGroup(group.anchor, document.querySelectorAll('.cell')[4])!;
    expect(narrower.elements.every((el) => el.classList.contains('cell'))).toBe(true);
  });

  it('keeps list items as records for plain link lists', () => {
    setPage('<ul id="links"><li><a href="/1">One</a></li><li><a href="/2">Two</a></li><li><a href="/3">Three</a></li></ul>');
    const group = findRecordGroup($('#links a'))!;
    expect(group.elements.map((el) => el.tagName)).toEqual(['LI', 'LI', 'LI']);
  });

  it('returns null when nothing repeats, and generalises from two examples', () => {
    setPage('<section><h1 id="only">Solo</h1></section><div id="box"><p class="a">one</p><div class="x">noise</div><p class="b">two</p><p class="c">three</p></div>');
    expect(findRecordGroup($('#only'))).toBeNull();
    const [first, , third] = Array.from(document.querySelectorAll('#box p'));
    const group = groupFromExamples(first, third)!;
    // Both examples are <p> children of #box: every <p> there is a record, the <div> is not.
    expect(group.elements.map((el) => el.textContent)).toEqual(['one', 'two', 'three']);
    expect(Array.from(document.querySelectorAll(group.selector))).toEqual(group.elements);
    expect(groupFromExamples(first, first)).toBeNull();
    expect(groupFromExamples($('#box'), first)).toBeNull();
  });
});

describe('field detection', () => {
  beforeEach(() => setPage(SHOP));

  it('detects the fields that are actually present, with sensible names and types', async () => {
    const rule = buildRuleForSelector(document, 'article.product-card');
    const byName = new Map(rule.fields.map((field) => [field.name, field]));
    expect(Array.from(byName.keys())).toEqual(expect.arrayContaining(['Product ID', 'URL', 'Image URL', 'Title', 'Price', 'Rating', 'Reviews', 'Description', 'Date', 'Availability', 'Tags']));
    expect(byName.get('Title')).toMatchObject({ extract: 'text', detectedType: 'title' });
    expect(byName.get('Price')).toMatchObject({ selector: 'span.price', detectedType: 'price' });
    expect(byName.get('Image URL')).toMatchObject({ extract: 'src', detectedType: 'image' });
    expect(byName.get('URL')).toMatchObject({ extract: 'href', detectedType: 'link' });
    expect(byName.get('Rating')).toMatchObject({ extract: 'attr', attribute: 'aria-label', detectedType: 'rating' });
    expect(byName.get('Date')).toMatchObject({ extract: 'attr', attribute: 'datetime', detectedType: 'date' });
    expect(byName.get('Product ID')).toMatchObject({ selector: '', extract: 'attr', attribute: 'data-product-id' });
    expect(byName.get('Tags')).toMatchObject({ multiple: true });
    // Buttons are interface chrome, not data.
    expect(rule.fields.some((field) => field.selector.includes('button'))).toBe(false);

    const data = await extractByRule(document, rule);
    const column = (name: string) => data.columns.indexOf(name);
    expect(data.rows).toHaveLength(8);
    expect(data.rows[1][column('Title')]).toBe('Product 1');
    expect(data.rows[1][column('Price')]).toBe('$11.99');
    expect(data.rows[1][column('Rating')]).toBe('4.5 out of 5 stars');
    expect(data.rows[1][column('Reviews')]).toBe('(12 reviews)');
    expect(data.rows[1][column('Date')]).toBe('2024-02-15');
    expect(data.rows[1][column('URL')]).toBe('https://example.test/p/1');
    expect(data.rows[2][column('Tags')]).toBe('tag0, tag1, tag2');
    // Records without a rating simply have an empty value: nothing is invented.
    expect(data.rows[0][column('Rating')]).toBe('');
    expect(data.rows[0][column('Reviews')]).toBe('');
  });

  it('does not create duplicate link fields for the same URL', () => {
    const rule = buildRuleForSelector(document, 'article.product-card');
    expect(rule.fields.filter((field) => field.extract === 'href')).toHaveLength(1);
  });

  it('turns fixed-width classless cells into one field per position', async () => {
    setPage(`<div id="g">${Array.from({ length: 6 }, (_, r) => `<div class="row"><span>Name ${r}</span><span>${r * 3}</span><span>user${r}@example.com</span></div>`).join('')}</div>`);
    const rows = Array.from(document.querySelectorAll('.row'));
    const fields = detectFields(rows, document);
    expect(fields).toHaveLength(3);
    const data = await extractByRule(document, { rowSelector: 'div.row', rowSelectorType: 'css', fields });
    expect(data.rows[2]).toEqual(['Name 2', '6', 'user2@example.com']);
    expect(fields[2].detectedType).toBe('email');
  });

  it('builds a field for a clicked element', () => {
    const records = Array.from(document.querySelectorAll('article.product-card'));
    const price = fieldForElement(records[0], records[0].querySelector('.price')!, records, document);
    expect(price).toMatchObject({ name: 'Price', selector: 'span.price', extract: 'text' });
    const image = fieldForElement(records[0], records[0].querySelector('img')!, records, document);
    expect(image).toMatchObject({ extract: 'src', detectedType: 'image' });
  });

  it('throws a clear error when the selector matches nothing', () => {
    expect(() => buildRuleForSelector(document, 'div.none')).toThrow(/matched nothing/);
  });
});

describe('value classification', () => {
  const hints = (patch: Partial<FieldHints> = {}): FieldHints => ({ tag: 'SPAN', tokens: '', itemprop: '', extract: 'text', attribute: '', inAddress: false, ...patch });

  it('recognises common value types from their content', () => {
    expect(classifyField(['$12.50', '€ 8,90', '৳ ১,২০০', '1.299,00 EUR'], hints())).toBe('price');
    expect(classifyField(['a@b.co', 'someone@example.com'], hints())).toBe('email');
    expect(classifyField(['4.5 out of 5', '3/5', '★★★★☆'], hints())).toBe('rating');
    expect(classifyField(['(128)', '12 reviews', '1.2k ratings'], hints())).toBe('reviewCount');
    expect(classifyField(['2024-03-01', 'March 5, 2024', '3 days ago'], hints())).toBe('date');
    expect(classifyField(['In stock', 'Out of stock', 'Sold out'], hints())).toBe('availability');
    expect(classifyField(['+1 (415) 555-0100', '+880 1711-000000'], hints())).toBe('phone');
    expect(classifyField(['12', '7', '1,024'], hints())).toBe('number');
    expect(classifyField(['x'.repeat(200)], hints())).toBe('description');
    expect(classifyField(['Blue shoes'], hints())).toBe('text');
  });

  it('uses markup hints when values alone are ambiguous', () => {
    expect(classifyField(['Blue shoes'], hints({ tag: 'H2' }))).toBe('title');
    expect(classifyField(['Jane Doe'], hints({ tokens: 'post-author byline' }))).toBe('author');
    expect(classifyField(['Shoes'], hints({ tokens: 'product-category' }))).toBe('category');
    expect(classifyField(['12.50'], hints({ tokens: 'price-current' }))).toBe('price');
    expect(classifyField(['x'], hints({ itemprop: 'sku' }))).toBe('productId');
    expect(classifyField(['12 Main St'], hints({ inAddress: true }))).toBe('address');
    expect(classifyField(['https://x.test/a'], hints({ extract: 'href' }))).toBe('link');
    expect(classifyField(['mailto:a@b.co'], hints({ extract: 'href' }))).toBe('email');
    expect(classifyField(['https://x.test/a.png'], hints({ extract: 'src' }))).toBe('image');
  });

  it('does not mistake numbers and dates for phone numbers', () => {
    expect(looksLikePhone('+44 20 7946 0958')).toBe(true);
    expect(looksLikePhone('12345678')).toBe(false);
    expect(looksLikePhone('2024-03-01')).toBe(false);
    expect(looksLikePhone('12.50')).toBe(false);
  });
});
