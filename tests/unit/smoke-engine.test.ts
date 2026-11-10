import { describe, expect, it } from 'vitest';
import { extractTables, listTables } from '@/extraction/tables';
import { detectPatterns, buildRuleForSelector, findRecordGroup } from '@/extraction/patterns';
import { extractByRule, testSelector } from '@/extraction/selectors';
import { DEFAULT_TABLE_OPTIONS } from '@/types';

function load(html: string) {
  document.documentElement.innerHTML = html;
}

describe('engine smoke', () => {
  it('tables with spans', async () => {
    load(
      '<body><table><caption>Sales</caption><thead><tr><th rowspan="2">Region</th><th colspan="2">2024</th></tr><tr><th>Q1</th><th>Q2</th></tr></thead>' +
        '<tbody><tr><td rowspan="2">North</td><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr><tr style="display:none"><td>Hidden</td><td>9</td><td>9</td></tr></tbody></table></body>',
    );
    const [ds] = await extractTables(document, 'all', DEFAULT_TABLE_OPTIONS);
    console.log(JSON.stringify(ds, null, 1));
    const list = await listTables(document, DEFAULT_TABLE_OPTIONS, 5);
    console.log(JSON.stringify(list[0]));
    expect(ds.columns).toEqual(['Region', '2024 - Q1', '2024 - Q2']);
    expect(ds.rows).toEqual([
      ['North', '1', '2'],
      ['North', '3', '4'],
    ]);
  });

  it('patterns + fields', async () => {
    const cards = Array.from({ length: 6 }, (_, i) => {
      const tags = Array.from({ length: (i % 3) + 1 }, (_x, k) => '<li class="tag">tag' + k + '</li>').join('');
      return (
        '<article class="product-card ' + (i === 2 ? 'featured' : '') + '" data-product-id="p' + i + '">' +
        '<a class="thumb" href="/p/' + i + '"><img src="/img/' + i + '.jpg" alt="x"></a>' +
        '<h3 class="title"><a href="/p/' + i + '">Product ' + i + ' নাম</a></h3>' +
        '<span class="price">$' + (10 + i) + '.99</span>' +
        (i % 2 ? '<span class="rating" aria-label="4.5 out of 5 stars">★★★★☆</span>' : '') +
        '<p class="desc">A fairly long description of product number ' + i + ' that goes on and on for testing purposes, yes indeed.</p>' +
        '<ul class="tags">' + tags + '</ul><button>Add to cart</button></article>'
      );
    }).join('');
    load(
      '<body><nav><ul><li><a href="/">Home</a></li><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></nav><main><div class="grid">' +
        cards +
        '</div></main></body>',
    );
    const patterns = detectPatterns(document, 5);
    console.log(JSON.stringify(patterns, null, 1));
    const rule = buildRuleForSelector(document, patterns[0].selector);
    console.log(JSON.stringify(rule, null, 1));
    const out = await extractByRule(document, rule);
    console.log(JSON.stringify(out.rows.slice(0, 3), null, 1), out.warnings);
    const group = findRecordGroup(document.querySelector('.price')!);
    console.log(group?.selector, group?.elements.length);
    console.log(JSON.stringify(testSelector(document, { selector: '//h3/a', selectorType: 'xpath', limit: 2 })));
    expect(patterns[0].count).toBe(6);
  });
});
