// Local fixture site for end-to-end tests. Realistic pages: static tables, dynamically
// rendered content, a single-page app, multi-page listings, infinite scroll, lazy images,
// structured data. Run directly:  node tests/e2e/server.mjs  (http://127.0.0.1:4173)
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.ROWLIO_E2E_PORT || 4173);

const page = (title, body, head = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 24px; color: #222; }
  table { border-collapse: collapse; margin: 12px 0 28px; }
  th, td { border: 1px solid #ccc; padding: 4px 10px; text-align: left; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .product-card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .product-card img { width: 100%; height: 90px; object-fit: cover; background: #eee; }
  .pagination { display: flex; gap: 8px; margin: 24px 0; list-style: none; padding: 0; }
  .scroll-box { height: 160px; overflow: auto; border: 1px solid #999; }
  .hidden-row { display: none; }
  nav.site a { margin-right: 12px; }
</style>
${head}
</head>
<body>
<nav class="site"><a href="/">Home</a><a href="/tables">Tables</a><a href="/products">Products</a></nav>
${body}
</body>
</html>`;

const PRODUCTS = Array.from({ length: 27 }, (_, i) => {
  const n = i + 1;
  return {
    id: `sku-${1000 + n}`,
    name: n === 5 ? 'চা পাতা প্রিমিয়াম (Premium Tea)' : `Product ${n}`,
    price: `$${(9.5 + n * 3).toFixed(2)}`,
    rating: n % 4 === 0 ? null : (3 + (n % 3) * 0.5).toFixed(1),
    reviews: 10 + n * 7,
    stock: n % 5 === 0 ? 'Out of stock' : 'In stock',
    description: `A dependable everyday item, number ${n} in our catalogue, built to last and easy to use.`,
  };
});

function productCard(p) {
  return `<article class="product-card" data-product-id="${p.id}">
    <a class="thumb" href="/product/${p.id}"><img src="/img/${p.id}.png" alt="${p.name}" width="300" height="200"></a>
    <h3 class="title"><a href="/product/${p.id}">${p.name}</a></h3>
    <div class="price">${p.price}</div>
    ${p.rating ? `<div class="rating" aria-label="${p.rating} out of 5 stars">★★★★☆</div><span class="review-count">(${p.reviews} reviews)</span>` : ''}
    <p class="description">${p.description}</p>
    <span class="availability">${p.stock}</span>
    <button type="button">Add to cart</button>
  </article>`;
}

function productsPage(pageNo) {
  const perPage = 9;
  const pages = Math.ceil(PRODUCTS.length / perPage);
  const current = Math.min(Math.max(pageNo, 1), pages);
  const items = PRODUCTS.slice((current - 1) * perPage, current * perPage);
  const prev = current > 1 ? `<li><a class="prev" href="/products?page=${current - 1}">‹ Previous</a></li>` : '<li class="disabled"><span>‹ Previous</span></li>';
  const next = current < pages ? `<li><a class="next" rel="next" href="/products?page=${current + 1}">Next ›</a></li>` : '<li class="disabled"><span class="next">Next ›</span></li>';
  const numbers = Array.from({ length: pages }, (_, i) => (i + 1 === current ? `<li class="active"><span aria-current="page">${i + 1}</span></li>` : `<li><a href="/products?page=${i + 1}">${i + 1}</a></li>`)).join('');
  return page(
    `Products – page ${current}`,
    `<h1>Products</h1>
     <p id="page-info">Page ${current} of ${pages}</p>
     <div class="grid" id="product-grid">${items.map(productCard).join('\n')}</div>
     <ul class="pagination" aria-label="Pagination">${prev}${numbers}${next}</ul>`,
  );
}

function numberedPage(pageNo) {
  const pages = 3;
  const current = Math.min(Math.max(pageNo, 1), pages);
  const rows = Array.from({ length: 5 }, (_, i) => `<tr><td>Entry ${(current - 1) * 5 + i + 1}</td><td>${(current - 1) * 5 + i + 1}</td></tr>`).join('');
  const numbers = Array.from({ length: pages }, (_, i) => (i + 1 === current ? `<strong class="current">${i + 1}</strong>` : `<a href="/numbered?page=${i + 1}">${i + 1}</a>`)).join(' ');
  return page(`Numbered – ${current}`, `<h1>Directory</h1><table id="dir"><thead><tr><th>Name</th><th>No</th></tr></thead><tbody>${rows}</tbody></table><div class="pager">${numbers}</div>`);
}

const routes = {
  '/': () => page('Fixture home', '<h1>Rowlio fixture site</h1><p>Pick a page from the navigation.</p>'),

  '/tables': () =>
    page(
      'Tables fixture',
      `<h1>Tables</h1>

      <h2>Quarterly revenue</h2>
      <table id="revenue">
        <caption>Quarterly revenue by region</caption>
        <thead>
          <tr><th rowspan="2">Region</th><th colspan="2">2023</th><th colspan="2">2024</th></tr>
          <tr><th>H1</th><th>H2</th><th>H1</th><th>H2</th></tr>
        </thead>
        <tbody>
          <tr><td rowspan="2">Asia</td><td>1,200</td><td>1,350</td><td>1,500</td><td>1,720</td></tr>
          <tr><td>80</td><td>95</td><td>110</td><td></td></tr>
          <tr><td>Europe</td><td colspan="2">2,400 (combined)</td><td>1,300</td><td>1,410</td></tr>
          <tr class="hidden-row"><td>Internal</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>
        </tbody>
        <tfoot><tr><td>Total</td><td>3,680</td><td>—</td><td>2,910</td><td>3,130</td></tr></tfoot>
      </table>

      <h2>বাংলা তথ্য</h2>
      <table id="bengali">
        <tr><th>নাম</th><th>শহর</th><th>মন্তব্য</th></tr>
        <tr><td>রহিম উদ্দিন</td><td>ঢাকা</td><td>"সেরা", দ্রুত ডেলিভারি</td></tr>
        <tr><td>করিম</td><td>চট্টগ্রাম</td><td>=SUM(A1:A2)</td></tr>
        <tr><td>Zoë 😀</td><td>সিলেট</td><td>line one<br>line two</td></tr>
      </table>

      <h2>Team</h2>
      <table id="nested">
        <thead><tr><th>Team</th><th>Members</th></tr></thead>
        <tbody>
          <tr><td>Core</td><td><table class="inner"><tr><th>Name</th><th>Role</th></tr><tr><td>Ada</td><td>Lead</td></tr><tr><td>Lin</td><td>Dev</td></tr></table></td></tr>
          <tr><td>Design</td><td>Solo</td></tr>
        </tbody>
      </table>

      <h2>Scrollable</h2>
      <div class="scroll-box">
        <table id="scrolling"><thead><tr><th>#</th><th>Value</th></tr></thead><tbody>
          ${Array.from({ length: 40 }, (_, i) => `<tr><td>${i + 1}</td><td>Item ${i + 1}</td></tr>`).join('')}
        </tbody></table>
      </div>

      <table role="presentation" id="layout"><tr><td>layout only</td></tr></table>

      <h2>Loaded later</h2>
      <div id="late"></div>
      <script>
        setTimeout(() => {
          document.getElementById('late').innerHTML =
            '<table id="dynamic"><caption>Live prices</caption><thead><tr><th>Symbol</th><th>Price</th></tr></thead>' +
            '<tbody><tr><td>AAA</td><td>10.5</td></tr><tr><td>BBB</td><td>22.1</td></tr></tbody></table>';
        }, 1200);
      </script>`,
    ),

  '/products': (url) => productsPage(Number(url.searchParams.get('page') || 1)),

  '/numbered': (url) => numberedPage(Number(url.searchParams.get('page') || 1)),

  '/spa': () =>
    page(
      'SPA listing',
      `<h1>Single-page listing</h1>
       <ul id="results"></ul>
       <button id="more" class="btn-next" aria-label="Next page">Next</button>
       <script>
         const all = Array.from({ length: 12 }, (_, i) => ({ title: 'Result ' + (i + 1), url: '/item/' + (i + 1) }));
         let pageNo = 0;
         function render() {
           const list = document.getElementById('results');
           list.innerHTML = '';
           all.slice(pageNo * 4, pageNo * 4 + 4).forEach((item) => {
             const li = document.createElement('li');
             li.className = 'result';
             li.innerHTML = '<a class="result-link" href="' + item.url + '">' + item.title + '</a> <span class="snippet">Snippet for ' + item.title + '</span>';
             list.appendChild(li);
           });
           const button = document.getElementById('more');
           button.disabled = pageNo >= 2;
           history.replaceState(null, '', '/spa#page-' + (pageNo + 1));
         }
         document.getElementById('more').addEventListener('click', () => { setTimeout(() => { pageNo++; render(); }, 300); });
         render();
       </script>`,
    ),

  '/scroll': () =>
    page(
      'Infinite scroll',
      `<h1>Feed</h1>
       <div id="feed"></div>
       <div id="sentinel" style="height: 40px"></div>
       <script>
         let loaded = 0;
         const total = 60;
         function addBatch() {
           const feed = document.getElementById('feed');
           for (let i = 0; i < 15 && loaded < total; i++) {
             loaded++;
             const post = document.createElement('div');
             post.className = 'post';
             post.style.cssText = 'height: 120px; border-bottom: 1px solid #ddd; padding: 8px';
             post.innerHTML = '<h3 class="post-title">Post ' + loaded + '</h3><p class="post-body">Body of post number ' + loaded + '</p>';
             feed.appendChild(post);
           }
         }
         addBatch();
         let pending = false;
         new IntersectionObserver((entries) => {
           if (!entries.some((e) => e.isIntersecting) || pending || loaded >= total) return;
           pending = true;
           setTimeout(() => { addBatch(); pending = false; }, 250);
         }).observe(document.getElementById('sentinel'));
       </script>`,
    ),

  '/big-table': (url) => {
    const rows = Number(url.searchParams.get('rows') || 20000);
    return page(
      'Big table',
      `<h1>Big table</h1><table id="big"><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Amount</th><th>City</th></tr></thead><tbody id="body"></tbody></table>
       <script>
         const parts = [];
         for (let i = 1; i <= ${rows}; i++) parts.push('<tr><td>' + i + '</td><td>User ' + i + '</td><td>user' + i + '@example.com</td><td>' + (i * 1.5).toFixed(2) + '</td><td>' + (i % 7 === 0 ? 'ঢাকা' : 'City ' + (i % 50)) + '</td></tr>');
         document.getElementById('body').innerHTML = parts.join('');
       </script>`,
    );
  },

  '/content': () =>
    page(
      'Content fixture – Acme Kettle',
      `<nav aria-label="Breadcrumb"><ol class="breadcrumb"><li><a href="/">Home</a></li><li><a href="/kitchen">Kitchen</a></li><li aria-current="page">Acme Kettle</li></ol></nav>
       <h1 id="top">Acme Kettle</h1>
       <h2 id="specs">Specifications</h2>
       <dl><dt>Capacity</dt><dd>1.7 L</dd><dt>Power</dt><dd>2200 W</dd><dt>Colour</dt><dt>Color</dt><dd>Steel</dd></dl>
       <h2>Steps</h2>
       <ol><li>Fill with water</li><li>Switch on<ul><li>Wait for the click</li></ul></li><li>Pour</li></ol>
       <ul class="links"><li><a href="/a">Internal A</a></li><li><a href="https://example.org/b" title="B title" target="_blank" rel="noopener">External B</a></li><li><a href="mailto:hi@example.com">Mail us</a></li><li><a href="/a">Internal A again</a></li></ul>
       <div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Acme Kettle</span>
         <div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="priceCurrency" content="USD"><span itemprop="price">39.90</span></div></div>
       <div class="gallery">
         <img src="/img/a.png" alt="Front view" title="Front" width="640" height="480" loading="lazy">
         <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-src="/img/lazy-real.jpg" alt="Lazy one" class="lazyload">
         <img srcset="/img/small.jpg 480w, /img/large.jpg 1200w" src="/img/small.jpg" alt="Responsive">
         <picture><source srcset="/img/hero.webp" type="image/webp"><img src="/img/hero.jpg" alt="Hero"></picture>
         <img src="/img/a.png" alt="Duplicate of front">
       </div>`,
      `<meta name="description" content="A sturdy kettle for everyday use.">
       <link rel="canonical" href="http://127.0.0.1:${PORT}/content">
       <meta property="og:title" content="Acme Kettle">
       <meta property="og:type" content="product">
       <meta property="og:image" content="http://127.0.0.1:${PORT}/img/a.png">
       <meta name="twitter:card" content="summary_large_image">
       <meta name="twitter:title" content="Acme Kettle on Twitter">
       <script type="application/ld+json">${JSON.stringify({
         '@context': 'https://schema.org',
         '@graph': [
           { '@type': 'Product', name: 'Acme Kettle', sku: 'AK-1', brand: { '@type': 'Brand', name: 'Acme' }, offers: { '@type': 'Offer', price: '39.90', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }, aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.6, reviewCount: 128 } },
           { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `http://127.0.0.1:${PORT}/` }, { '@type': 'ListItem', position: 2, name: 'Kitchen', item: `http://127.0.0.1:${PORT}/kitchen` }] },
         ],
       })}</script>`,
    ),
};

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/img/')) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(PNG_1X1);
      return;
    }
    const handler = routes[url.pathname];
    if (!handler) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Not found', `<h1>Not found</h1><p>${url.pathname}</p>`));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(handler(url));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, '127.0.0.1', () => console.log(`[fixtures] http://127.0.0.1:${PORT}`));
}
