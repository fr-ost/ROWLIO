import { beforeEach, describe, expect, it } from 'vitest';
import { contentSignature, runSpec, scanPage } from '@/extraction/engine';
import { bestImageSource, extractImages, parseSrcset } from '@/extraction/images';
import { extractLinks } from '@/extraction/links';
import { extractBreadcrumbs, extractHeadings, extractLists } from '@/extraction/lists';
import { extractMetadata } from '@/extraction/metadata';
import { extractJsonLd, extractMicrodata, flattenJson, jsonLdBreadcrumbs } from '@/extraction/structured';
import { elementText } from '@/extraction/dom';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_LINK_OPTIONS, DEFAULT_LIST_OPTIONS, DEFAULT_META_OPTIONS, DEFAULT_TABLE_OPTIONS } from '@/types';
import type { RawDataset } from '@/types';
import { $, setPage } from './helpers';

/** Rows as objects keyed by column name. */
function records(dataset: RawDataset): Record<string, string>[] {
  return dataset.rows.map((row) => Object.fromEntries(dataset.columns.map((column, i) => [column, row[i]])));
}

describe('text extraction', () => {
  it('collapses whitespace, keeps line breaks at block boundaries and skips hidden content', () => {
    setPage('<div id="t">  Hello\n   <b>world</b>&nbsp;!<br>Second<p>Third</p><span hidden>secret</span><span style="display:none">x</span><script>1</script></div>');
    expect(elementText($('#t'))).toBe('Hello world !\nSecond\nThird');
    expect(elementText($('#t'), { includeHidden: true })).toBe('Hello world !\nSecond\nThird\nsecretx');
  });

  it('treats source line breaks as spaces, except inside <pre>', () => {
    setPage('<p id="p">first\n      second\n\tthird</p><pre id="code">line 1\nline 2</pre>');
    expect(elementText($('#p'))).toBe('first second third');
    expect(elementText($('#code'))).toBe('line 1\nline 2');
  });

  it('uses alt text for images and values for form controls', () => {
    setPage('<p id="t">Logo <img alt="Acme"> <input value="typed"> <input type="password" value="hunter2"> <textarea>note</textarea></p>');
    const text = elementText($('#t'));
    expect(text).toBe('Logo Acme typed note');
    expect(text).not.toContain('hunter2'); // password fields are never read
  });
});

describe('link extraction', () => {
  const PAGE = `
    <nav id="menu"><a href="/">Home</a><a href="/about" title="About us" target="_blank" rel="noopener nofollow">About</a></nav>
    <main>
      <a href="page-2">Relative</a>
      <a href="https://www.example.test/x">Same site with www</a>
      <a href="https://other.test/y?z=1#frag">External</a>
      <a href="mailto:hi@example.test">Mail</a>
      <a href="tel:+8801711000000">Call</a>
      <a href="/about">About again</a>
      <a href="/img"><img src="/i.png" alt="Image link"></a>
      <a aria-label="Icon only" href="/icon"></a>
      <a>no href</a>
      <a href="">empty</a>
    </main>`;
  beforeEach(() => setPage(PAGE));

  it('returns text, absolute and relative URLs, title, target and rel', async () => {
    const rows = records(await extractLinks(document, DEFAULT_LINK_OPTIONS));
    expect(rows.find((row) => row['Link text'] === 'About')).toEqual({
      'Link text': 'About',
      URL: 'https://example.test/about',
      'Relative URL': '/about',
      Title: 'About us',
      Target: '_blank',
      Rel: 'noopener nofollow',
      Type: 'internal',
    });
    expect(rows.find((row) => row['Link text'] === 'Relative')?.URL).toBe('https://example.test/shop/page-2');
    expect(rows.find((row) => row['Link text'] === 'External')?.URL).toBe('https://other.test/y?z=1#frag');
    expect(rows.find((row) => row['Link text'] === 'Image link')?.URL).toBe('https://example.test/img');
    expect(rows.find((row) => row['Link text'] === 'Icon only')?.URL).toBe('https://example.test/icon');
    expect(rows.find((row) => row.URL === 'mailto:hi@example.test')?.Type).toBe('mailto');
    expect(rows.find((row) => row.URL.startsWith('tel:'))?.Type).toBe('tel');
    expect(rows.some((row) => row['Link text'] === 'no href')).toBe(false);
  });

  it('filters internal and external links', async () => {
    const internal = records(await extractLinks(document, { ...DEFAULT_LINK_OPTIONS, scope: 'internal' }));
    expect(internal.every((row) => row.Type === 'internal')).toBe(true);
    expect(internal.map((row) => row['Link text'])).toContain('Same site with www');
    const external = records(await extractLinks(document, { ...DEFAULT_LINK_OPTIONS, scope: 'external' }));
    expect(external.map((row) => row.URL)).toEqual(['https://other.test/y?z=1#frag']);
  });

  it('filters by container, text and selector', async () => {
    const inNav = await extractLinks(document, { ...DEFAULT_LINK_OPTIONS, containerSelector: '#menu' });
    expect(inNav.rows).toHaveLength(2);
    const byText = await extractLinks(document, { ...DEFAULT_LINK_OPTIONS, textContains: 'ABOUT' });
    expect(byText.rows.map((row) => row[0])).toEqual(['About', 'About again']);
    const bySelector = await extractLinks(document, { ...DEFAULT_LINK_OPTIONS, matchSelector: 'a[target="_blank"]' });
    expect(bySelector.rows).toHaveLength(1);
  });

  it('skips duplicate URLs on request and says how many', async () => {
    const result = await extractLinks(document, { ...DEFAULT_LINK_OPTIONS, dedupe: true });
    expect(result.rows.filter((row) => row[1] === 'https://example.test/about')).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/1 duplicate link\(s\) were skipped/);
  });

  it('reports problems with the filters instead of returning nothing silently', async () => {
    const missing = await extractLinks(document, { ...DEFAULT_LINK_OPTIONS, containerSelector: '#nope' });
    expect(missing.rows).toEqual([]);
    expect(missing.warnings[0]).toMatch(/container selector matched nothing/);
    await expect(extractLinks(document, { ...DEFAULT_LINK_OPTIONS, containerSelector: 'a[' })).rejects.toThrow(/Invalid container selector/);
    await expect(extractLinks(document, { ...DEFAULT_LINK_OPTIONS, matchSelector: 'a[' })).rejects.toThrow(/Invalid link selector/);
  });

  it('honours <base href>', async () => {
    setPage('<a href="x">Based</a>', '<base href="https://cdn.test/root/">');
    expect((await extractLinks(document, DEFAULT_LINK_OPTIONS)).rows[0][1]).toBe('https://cdn.test/root/x');
    document.head.innerHTML = '';
  });
});

describe('image extraction', () => {
  it('parses srcset including URLs that contain commas', () => {
    const candidates = parseSrcset('/a.jpg 480w, /b,c.jpg 1200w, /d.jpg 2x, /e.jpg', 'https://example.test/');
    expect(candidates.map((candidate) => candidate.url)).toEqual(['https://example.test/a.jpg', 'https://example.test/b,c.jpg', 'https://example.test/d.jpg', 'https://example.test/e.jpg']);
    expect(candidates.map((candidate) => candidate.weight)).toEqual([480, 1200, 2000, 0]);
    expect(parseSrcset('', 'https://example.test/')).toEqual([]);
  });

  it('finds the real source behind lazy-loading placeholders', () => {
    setPage(`
      <img id="plain" src="/a.png">
      <img id="lazy" src="data:image/gif;base64,AAAA" data-src="/real.jpg">
      <img id="lazy2" src="/assets/placeholder.gif" data-original="/real2.jpg">
      <img id="set" srcset="/s.jpg 400w, /l.jpg 1600w">
      <picture><source srcset="/hero.webp 1x, /hero@2x.webp 2x"><img id="pic" src="/hero.jpg"></picture>
      <img id="only-data" src="data:image/png;base64,BBBB">`);
    expect(bestImageSource($('#plain') as HTMLImageElement)).toMatchObject({ url: 'https://example.test/a.png', origin: 'img[src]' });
    expect(bestImageSource($('#lazy') as HTMLImageElement)).toMatchObject({ url: 'https://example.test/real.jpg', origin: 'img[data-src]' });
    expect(bestImageSource($('#lazy2') as HTMLImageElement)).toMatchObject({ url: 'https://example.test/real2.jpg', origin: 'img[data-original]' });
    expect(bestImageSource($('#set') as HTMLImageElement)).toMatchObject({ url: 'https://example.test/l.jpg', origin: 'img[srcset]' });
    const picture = bestImageSource($('#pic') as HTMLImageElement);
    expect(picture.url).toBe('https://example.test/hero.jpg');
    expect(picture.others).toEqual(['https://example.test/hero.webp', 'https://example.test/hero@2x.webp']);
    // Nothing better exists: the data URI itself is reported rather than dropped.
    expect(bestImageSource($('#only-data') as HTMLImageElement).url).toMatch(/^data:image\/png/);
  });

  it('returns the documented columns and applies filters', async () => {
    setPage(`
      <div id="gallery">
        <img src="/a.png" alt="A" title="Title A" width="800" height="600" loading="lazy">
        <img src="/b.png" alt="B" width="50" height="50">
        <img src="/a.png" alt="A again" width="800" height="600">
        <img src="/c.png" alt="No size">
      </div>
      <video poster="/poster.jpg"></video>
      <img src="/outside.png" width="900" height="900">`);
    const all = await extractImages(document, { ...DEFAULT_IMAGE_OPTIONS, dedupe: false });
    expect(all.columns).toEqual(['Image URL', 'Alt text', 'Title', 'Width', 'Height', 'Source element', 'Loading', 'Other sources']);
    expect(all.rows[0]).toEqual(['https://example.test/a.png', 'A', 'Title A', '800', '600', 'img[src]', 'lazy', '']);
    expect(all.rows).toHaveLength(6);
    expect(all.rows.some((row) => row[5] === 'video[poster]' && row[0] === 'https://example.test/poster.jpg')).toBe(true);

    const deduped = await extractImages(document, DEFAULT_IMAGE_OPTIONS);
    expect(deduped.rows).toHaveLength(5);
    expect(deduped.warnings.join(' ')).toMatch(/1 duplicate image URL/);

    const scoped = await extractImages(document, { ...DEFAULT_IMAGE_OPTIONS, containerSelector: '#gallery', dedupe: false });
    expect(scoped.rows).toHaveLength(4);

    const large = await extractImages(document, { ...DEFAULT_IMAGE_OPTIONS, minWidth: 100, minHeight: 100, dedupe: false });
    expect(large.rows.map((row) => row[1])).toEqual(['A', 'A again', '']);
    // Images of unknown size cannot be checked against the filter: excluded, and reported.
    expect(large.warnings.join(' ')).toMatch(/2 image\(s\) with unknown dimensions/);

    const byUrl = await extractImages(document, { ...DEFAULT_IMAGE_OPTIONS, urlContains: 'OUTSIDE' });
    expect(byUrl.rows).toHaveLength(1);
  });

  it('can include CSS background images', async () => {
    setPage('<div id="bg" style="background-image: url(\'/bg/hero.jpg\')">x</div><div>plain</div>');
    const without = await extractImages(document, DEFAULT_IMAGE_OPTIONS);
    expect(without.rows).toHaveLength(0);
    const withBackgrounds = await extractImages(document, { ...DEFAULT_IMAGE_OPTIONS, includeBackgrounds: true });
    expect(withBackgrounds.rows).toHaveLength(1);
    expect(withBackgrounds.rows[0][0]).toBe('https://example.test/bg/hero.jpg');
    expect(withBackgrounds.rows[0][5]).toMatch(/^css background/);
  });
});

describe('lists, headings and breadcrumbs', () => {
  it('extracts ordered, unordered and nested lists with levels and links', async () => {
    setPage(`
      <h2>Steps</h2>
      <ol><li>Fill</li><li>Boil <a href="/how">how</a><ul><li>Wait</li><li>Listen</li></ul></li><li>Pour</li></ol>
      <ul aria-label="Colours"><li>লাল</li><li>নীল</li></ul>`);
    const rows = records(await extractLists(document, DEFAULT_LIST_OPTIONS));
    expect(rows.map((row) => [row.List, row.Type, row.Level, row.Position, row.Text])).toEqual([
      ['1', 'ordered', '1', '1', 'Fill'],
      ['1', 'ordered', '1', '2', 'Boil how'],
      ['1', 'unordered', '2', '1', 'Wait'],
      ['1', 'unordered', '2', '2', 'Listen'],
      ['1', 'ordered', '1', '3', 'Pour'],
      ['2', 'unordered', '1', '1', 'লাল'],
      ['2', 'unordered', '1', '2', 'নীল'],
    ]);
    expect(rows[0]['List name']).toBe('Steps');
    expect(rows[1].Link).toBe('https://example.test/how');
    expect(rows[5]['List name']).toBe('Colours');
  });

  it('extracts definition lists, including grouped terms and terms without a definition', async () => {
    setPage('<dl><dt>Capacity</dt><dd>1.7 L</dd><dt>Colour</dt><dt>Color</dt><dd>Steel</dd><div><dt>Power</dt><dd>2200 W</dd><dd>or 1800 W</dd></div><dt>Orphan</dt></dl>');
    const rows = records(await extractLists(document, DEFAULT_LIST_OPTIONS));
    expect(rows.map((row) => [row.Type, row.Term, row.Text])).toEqual([
      ['definition', 'Capacity', '1.7 L'],
      ['definition', 'Colour / Color', 'Steel'],
      ['definition', 'Power', '2200 W'],
      ['definition', 'Power', 'or 1800 W'],
      ['definition', 'Orphan', ''],
    ]);
  });

  it('honours type selection and the minimum size', async () => {
    setPage('<ul><li>a</li></ul><ol><li>1</li><li>2</li><li>3</li></ol><dl><dt>t</dt><dd>d</dd></dl>');
    const onlyOrdered = await extractLists(document, { ...DEFAULT_LIST_OPTIONS, unordered: false, definition: false });
    expect(onlyOrdered.rows.map((row) => row[6])).toEqual(['1', '2', '3']);
    const big = await extractLists(document, { ...DEFAULT_LIST_OPTIONS, minItems: 2 });
    expect(big.rows).toHaveLength(3);
    expect(big.warnings.join(' ')).toMatch(/2 list\(s\) with fewer than 2 items were skipped/);
    const none = await extractLists(document, { ...DEFAULT_LIST_OPTIONS, ordered: false, unordered: false, definition: false });
    expect(none.warnings).toEqual(['No list type selected.']);
  });

  it('extracts headings with levels and anchors', () => {
    setPage('<h1 id="top">Title</h1><h2>Section <em>one</em></h2><div role="heading" aria-level="4">ARIA heading</div><h3></h3>');
    expect(extractHeadings(document).rows).toEqual([
      ['1', 'Title', 'top', 'https://example.test/shop/list?page=1#top'],
      ['2', 'Section one', '', ''],
      ['4', 'ARIA heading', '', ''],
    ]);
  });

  it('extracts breadcrumbs from markup and JSON-LD without duplicating a trail', () => {
    setPage(
      '<nav aria-label="Breadcrumb"><ol class="breadcrumb"><li><a href="/">Home</a></li><li><a href="/kitchen">Kitchen</a> ›</li><li aria-current="page">Kettle</li></ol></nav>',
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 2, name: 'Kitchen', item: '/kitchen' }, { '@type': 'ListItem', position: 1, name: 'Home', item: { '@id': 'https://example.test/' } }] })}</script>`,
    );
    const trails = jsonLdBreadcrumbs(document);
    expect(trails).toEqual([[{ name: 'Home', url: 'https://example.test/' }, { name: 'Kitchen', url: 'https://example.test/kitchen' }]]);
    const rows = extractBreadcrumbs(document, trails).rows;
    expect(rows).toEqual([
      ['1', '1', 'Home', 'https://example.test/', 'JSON-LD'],
      ['1', '2', 'Kitchen', 'https://example.test/kitchen', 'JSON-LD'],
      ['2', '1', 'Home', 'https://example.test/', 'HTML'],
      ['2', '2', 'Kitchen', 'https://example.test/kitchen', 'HTML'],
      ['2', '3', 'Kettle', '', 'HTML'],
    ]);
    document.head.innerHTML = '';
    setPage('<p>nothing</p>');
    expect(extractBreadcrumbs(document).warnings).toEqual(['No breadcrumbs found on this page.']);
  });
});

describe('metadata and structured data', () => {
  const HEAD = `
    <title>Acme Kettle – Shop</title>
    <meta name="description" content="A sturdy kettle.">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="/kettle">
    <link rel="alternate" hreflang="bn" href="/bn/kettle">
    <link rel="stylesheet" href="/x.css">
    <meta property="og:title" content="Acme Kettle">
    <meta property="og:image" content="https://cdn.test/k.png">
    <meta property="article:author" content="Rina">
    <meta name="twitter:card" content="summary">
    <meta name="custom-thing" content="42">
    <meta name="empty" content="">`;

  it('groups page metadata', () => {
    setPage('<p>body</p>', HEAD);
    const rows = extractMetadata(document, DEFAULT_META_OPTIONS).rows;
    expect(rows).toContainEqual(['Basic', 'title', 'Acme Kettle – Shop']);
    expect(rows).toContainEqual(['Basic', 'description', 'A sturdy kettle.']);
    expect(rows).toContainEqual(['Basic', 'canonical', 'https://example.test/kettle']);
    expect(rows).toContainEqual(['Open Graph', 'og:title', 'Acme Kettle']);
    expect(rows).toContainEqual(['Open Graph', 'article:author', 'Rina']);
    expect(rows).toContainEqual(['Twitter Card', 'twitter:card', 'summary']);
    expect(rows).toContainEqual(['Other meta', 'custom-thing', '42']);
    expect(rows).toContainEqual(['Link', 'alternate (hreflang=bn)', 'https://example.test/bn/kettle']);
    expect(rows.some((row) => row[1] === 'empty')).toBe(false);
    expect(rows.some((row) => row[2].includes('x.css'))).toBe(false);

    const onlyOg = extractMetadata(document, { basic: false, openGraph: true, twitter: false, otherMeta: false, linkTags: false }).rows;
    expect(onlyOg.every((row) => row[0] === 'Open Graph')).toBe(true);
    document.head.innerHTML = '';
  });

  it('flattens nested JSON without losing data', () => {
    const flat = flattenJson({
      name: 'Kettle',
      offers: { price: 39.9, currency: 'USD' },
      tags: ['a', 'b'],
      image: [{ url: '/1.png' }],
      reviews: [{ author: 'A' }, { author: 'B' }],
      many: Array.from({ length: 12 }, (_, i) => ({ n: i })),
      empty: [],
      nothing: null,
      ok: true,
    });
    expect(Object.fromEntries(flat)).toEqual({
      name: 'Kettle',
      'offers.price': '39.9',
      'offers.currency': 'USD',
      tags: 'a | b',
      'image.url': '/1.png',
      'reviews[0].author': 'A',
      'reviews[1].author': 'B',
      many: JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ n: i }))),
      ok: 'true',
    });
  });

  it('extracts JSON-LD from several blocks, @graph and arrays, and reports invalid JSON', () => {
    setPage(
      '<p>x</p>',
      `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"চা","offers":{"@type":"Offer","price":"12"}},{"@type":"Organization","name":"Acme"}]}</script>
       <script type="application/ld+json">[{"@type":"Article","headline":"News"}]</script>
       <script type="application/ld+json">{ this is not json }</script>
       <script type="application/ld+json"></script>`,
    );
    const dataset = extractJsonLd(document);
    const rows = records(dataset);
    expect(dataset.columns.slice(0, 2)).toEqual(['@type', 'name']);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ '@type': 'Product', name: 'চা', 'offers.price': '12' });
    expect(rows[2]).toMatchObject({ '@type': 'Article', headline: 'News', name: '' });
    expect(dataset.warnings).toEqual(['1 JSON-LD block(s) contain invalid JSON and were skipped.']);
    document.head.innerHTML = '';
    expect(extractJsonLd(document).warnings).toEqual(['This page has no JSON-LD structured data.']);
  });

  it('extracts Schema.org microdata with nested items', () => {
    setPage(`
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Kettle</span>
        <img itemprop="image" src="/k.png">
        <a itemprop="url" href="/kettle">link</a>
        <time itemprop="releaseDate" datetime="2024-01-02">Jan 2</time>
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="priceCurrency" content="USD"><span itemprop="price">39.90</span>
        </div>
        <span itemprop="category">Kitchen</span><span itemprop="category">Home</span>
      </div>`);
    const rows = records(extractMicrodata(document));
    expect(rows).toHaveLength(1); // the nested Offer is part of the Product, not a second row
    expect(rows[0]).toMatchObject({
      '@type': 'Product',
      name: 'Kettle',
      image: 'https://example.test/k.png',
      url: 'https://example.test/kettle',
      releaseDate: '2024-01-02',
      'offers.@type': 'Offer',
      'offers.priceCurrency': 'USD',
      'offers.price': '39.90',
      category: 'Kitchen | Home',
    });
  });
});

describe('engine', () => {
  it('scans a page and runs any spec', async () => {
    setPage(`
      <h1>Shop</h1>
      <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
      <ul><li><a href="/1">one</a></li><li><a href="/2">two</a></li><li><a href="/3">three</a></li></ul>
      <img src="/x.png">
      <a rel="next" href="?page=2">Next</a>`);
    const scan = scanPage(document);
    expect(scan).toMatchObject({ url: 'https://example.test/shop/list?page=1', dataTables: 1, allTables: 1, links: 4, images: 1, lists: 1, headings: 1, jsonLd: 0, microdata: 0, hasNextPage: true });
    expect(scan.patterns).toBeGreaterThanOrEqual(1);

    expect((await runSpec(document, { kind: 'tables', indexes: 'all', options: DEFAULT_TABLE_OPTIONS }))[0].rows).toEqual([['1']]);
    expect((await runSpec(document, { kind: 'links', options: DEFAULT_LINK_OPTIONS }))[0].rows).toHaveLength(4);
    expect((await runSpec(document, { kind: 'headings' }))[0].rows).toHaveLength(1);
    const ruled = await runSpec(document, { kind: 'rule', rule: { rowSelector: 'li', rowSelectorType: 'css', fields: [{ id: 'f', name: 'T', selector: 'a', selectorType: 'css', extract: 'text' }] }, name: 'Items', method: 'visual' });
    expect(ruled[0]).toMatchObject({ name: 'Items', method: 'visual', columns: ['T'] });
    expect(ruled[0]).not.toHaveProperty('totalRows');
    for (const kind of ['images', 'lists', 'metadata'] as const) {
      const options = kind === 'images' ? DEFAULT_IMAGE_OPTIONS : kind === 'lists' ? DEFAULT_LIST_OPTIONS : DEFAULT_META_OPTIONS;
      expect(await runSpec(document, { kind, options } as never)).toHaveLength(1);
    }
    for (const kind of ['breadcrumbs', 'jsonld', 'microdata'] as const) expect(await runSpec(document, { kind })).toHaveLength(1);
  });

  it('content signature changes when the targeted records change', () => {
    setPage('<ul><li class="r">one</li><li class="r">two</li></ul><p id="other">x</p>');
    const spec = { kind: 'rule' as const, rule: { rowSelector: 'li.r', rowSelectorType: 'css' as const, fields: [] } };
    const before = contentSignature(document, spec);
    $('#other').textContent = 'unrelated change';
    expect(contentSignature(document, spec)).toBe(before);
    $('li.r').textContent = 'three';
    expect(contentSignature(document, spec)).not.toBe(before);
  });
});
