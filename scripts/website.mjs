// Builds the marketing website into ./website-dist (the folder Vercel serves).
//
// Uses only Node built-ins, so it runs on Vercel without `npm install`:
//   • copies ./website, replacing {{tokens}} in .html files with values from
//     brand.config.json and package.json (branding stays in one place);
//   • renders the blog: ./website/_posts/*.html (a JSON header comment + the article body)
//     through ./website/_templates into /blog and /blog/<slug>;
//   • writes structured data (JSON-LD), sitemap.xml, robots.txt and an RSS feed;
//   • adds the product screenshots and icons;
//   • includes the extension archive from ./website/downloads (refreshed from ./release
//     whenever `npm run package` has been run locally).
//
//   node scripts/website.mjs            build
//   node scripts/website.mjs --serve    build, then preview on http://127.0.0.1:4321
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'website');
// `--out <dir>` (relative to the current directory) changes the output folder. Used when
// Vercel's Root Directory is set to `website`, where the output must live inside it.
const outArg = process.argv.indexOf('--out');
const out = outArg > -1 && process.argv[outArg + 1] ? path.resolve(process.argv[outArg + 1]) : path.join(root, 'website-dist');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const brand = JSON.parse(await fs.readFile(path.join(root, 'brand.config.json'), 'utf8'));

const exists = (file) => fs.access(file).then(() => true, () => false);

// Keep the committed download in step with the latest local package, when there is one.
const zipName = `${brand.filePrefix}-${pkg.version}.zip`;
const released = path.join(root, 'release', zipName);
const downloads = path.join(src, 'downloads');
if (await exists(released)) {
  await fs.mkdir(downloads, { recursive: true });
  for (const file of await fs.readdir(downloads)) if (file.endsWith('.zip')) await fs.rm(path.join(downloads, file));
  await fs.copyFile(released, path.join(downloads, zipName));
}
const available = (await exists(downloads)) ? (await fs.readdir(downloads)).filter((file) => file.endsWith('.zip')).sort() : [];
const zip = available.includes(zipName) ? zipName : (available[available.length - 1] ?? '');
if (!zip) console.warn('[website] no extension archive in website/downloads – run `npm run package` first');
const zipSize = zip ? `${Math.round((await fs.stat(path.join(downloads, zip))).size / 1024)} KB` : '';

// Public address of the site (no trailing slash): canonical links, sitemap and robots.txt.
const siteUrl = String(brand.urls.website || '').replace(/\/+$/, '');
if (!siteUrl) throw new Error('brand.config.json: urls.website is required to build the website');

const version = zip ? zip.replace(`${brand.filePrefix}-`, '').replace('.zip', '') : pkg.version;
const tokens = {
  name: brand.name,
  storeTitle: brand.storeTitle,
  tagline: brand.tagline,
  description: brand.shortDescription,
  positioning: brand.positioning,
  motto: brand.motto,
  company: brand.company,
  companyUrl: brand.urls.homepage,
  siteUrl,
  copyright: brand.copyright,
  developer: brand.developer.name,
  developerUrl: brand.developer.url,
  version,
  zip: zip ? `downloads/${zip}` : '#install',
  zipSize,
  year: String(new Date().getFullYear()),
  // Automated tests behind a release, rounded down (see docs/TESTING.md).
  tests: '900',
};
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** {{key}} is escaped; {{&key}} inserts markup that this script produced itself. */
const render = (text, extra = {}) =>
  text.replace(/\{\{(&?)(\w+)\}\}/g, (match, raw, key) => {
    const value = key in extra ? extra[key] : tokens[key];
    if (value === undefined) throw new Error(`Unknown token ${match} in website template`);
    return raw ? String(value) : escapeHtml(value);
  });
/** A JSON-LD block. `<` is escaped so text can never close the script element. */
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
const stripTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const publisher = { '@type': 'Organization', name: brand.company, url: brand.urls.homepage, logo: { '@type': 'ImageObject', url: `${siteUrl}/assets/icons/icon-128.png` } };

// ---- Blog ------------------------------------------------------------------------------
const postsDir = path.join(src, '_posts');
const templatesDir = path.join(src, '_templates');
const template = async (name) => fs.readFile(path.join(templatesDir, name), 'utf8');

async function loadPosts() {
  if (!(await exists(postsDir))) return [];
  const posts = [];
  for (const file of (await fs.readdir(postsDir)).filter((name) => name.endsWith('.html')).sort()) {
    const text = await fs.readFile(path.join(postsDir, file), 'utf8');
    const header = /^<!--\s*(\{[\s\S]*?\})\s*-->/.exec(text);
    if (!header) throw new Error(`${file}: a post starts with a JSON header inside an HTML comment`);
    const meta = JSON.parse(header[1]);
    for (const key of ['title', 'description', 'date', 'tag']) if (!meta[key]) throw new Error(`${file}: missing "${key}"`);
    if (meta.description.length > 160) throw new Error(`${file}: description is ${meta.description.length} characters (max 160)`);
    // Headings get ids so the table of contents and other pages can link to them.
    const sections = [];
    const used = new Set();
    const body = text.slice(header[0].length).trim().replace(/<h2>([\s\S]*?)<\/h2>/g, (match, inner) => {
      let id = stripTags(inner).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
      while (used.has(id)) id += '-2';
      used.add(id);
      sections.push({ id, title: stripTags(inner) });
      return `<h2 id="${id}">${inner}</h2>`;
    });
    const words = stripTags(body).split(' ').length;
    posts.push({ ...meta, slug: file.replace(/\.html$/, ''), body, sections, words, minutes: Math.max(1, Math.round(words / 220)) });
  }
  // Newest first; the order field breaks ties between posts of the same day.
  return posts.sort((a, b) => b.date.localeCompare(a.date) || (a.order ?? 0) - (b.order ?? 0));
}

const postCard = (post) => `
      <a class="post-card" href="/blog/${post.slug}">
        <span class="tag">${escapeHtml(post.tag)}</span>
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.description)}</p>
        <span class="post-meta"><time datetime="${post.date}">${longDate(post.date)}</time> · ${post.minutes} min read</span>
      </a>`;

async function buildBlog(posts) {
  const blogOut = path.join(out, 'blog');
  await fs.mkdir(blogOut, { recursive: true });
  const [postTemplate, indexTemplate] = await Promise.all([template('post.html'), template('blog.html')]);
  const image = `${siteUrl}/assets/og-image.png`;

  for (const [index, post] of posts.entries()) {
    const url = `${siteUrl}/blog/${post.slug}`;
    const related = [1, 2, 3].map((step) => posts[(index + step) % posts.length]).filter((other) => other !== post);
    const data = [
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        dateModified: post.updated ?? post.date,
        inLanguage: 'en',
        wordCount: post.words,
        articleSection: post.tag,
        image,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        author: { '@type': 'Organization', name: brand.company, url: brand.urls.homepage },
        publisher,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: brand.name, item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${siteUrl}/blog` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
    ];
    const html = render(postTemplate, {
      title: post.title,
      description: post.description,
      url,
      image,
      tag: post.tag,
      date: post.date,
      dateLong: longDate(post.date),
      minutes: String(post.minutes),
      content: post.body,
      toc: post.sections.map((section) => `<li><a href="#${section.id}">${escapeHtml(section.title)}</a></li>`).join(''),
      related: related.map(postCard).join(''),
      jsonLd: data.map(jsonLd).join('\n  '),
    });
    await fs.writeFile(path.join(blogOut, `${post.slug}.html`), html);
  }

  const blogData = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `${brand.name} Blog`,
    url: `${siteUrl}/blog`,
    description: 'Practical guides to web scraping, data extraction and data cleaning in the browser.',
    inLanguage: 'en',
    publisher,
    blogPost: posts.map((post) => ({ '@type': 'BlogPosting', headline: post.title, url: `${siteUrl}/blog/${post.slug}`, datePublished: post.date })),
  };
  await fs.writeFile(
    path.join(blogOut, 'index.html'),
    render(indexTemplate, { url: `${siteUrl}/blog`, image, posts: posts.map(postCard).join(''), count: String(posts.length), jsonLd: jsonLd(blogData) }),
  );

  const rssDate = (iso) => new Date(`${iso}T08:00:00Z`).toUTCString();
  const items = posts.map((post) => `  <item>\n    <title>${escapeHtml(post.title)}</title>\n    <link>${siteUrl}/blog/${post.slug}</link>\n    <guid isPermaLink="true">${siteUrl}/blog/${post.slug}</guid>\n    <pubDate>${rssDate(post.date)}</pubDate>\n    <description>${escapeHtml(post.description)}</description>\n  </item>`);
  await fs.writeFile(
    path.join(out, 'feed.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n  <title>${escapeHtml(brand.name)} Blog</title>\n  <link>${siteUrl}/blog</link>\n  <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>\n  <description>Practical guides to web scraping, data extraction and data cleaning in the browser.</description>\n  <language>en</language>\n${items.join('\n')}\n</channel>\n</rss>\n`,
  );
}

// ---- Pages -----------------------------------------------------------------------------
const posts = await loadPosts();

/** Question / answer pairs written as <details><summary>…</summary><p>…</p></details>. */
const faqEntries = (html) =>
  Array.from(html.matchAll(/<details[^>]*><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g), (match) => ({
    '@type': 'Question',
    name: stripTags(match[1]),
    acceptedAnswer: { '@type': 'Answer', text: stripTags(match[2]) },
  }));

/** Plain pages (About, Contact, Support, FAQ): ./website/_pages/<slug>.html → /<slug>. */
async function buildPages() {
  const dir = path.join(src, '_pages');
  if (!(await exists(dir))) return [];
  const pageTemplate = await template('page.html');
  const slugs = [];
  for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith('.html')).sort()) {
    const text = await fs.readFile(path.join(dir, file), 'utf8');
    const header = /^<!--\s*(\{[\s\S]*?\})\s*-->/.exec(text);
    if (!header) throw new Error(`${file}: a page starts with a JSON header inside an HTML comment`);
    const meta = JSON.parse(header[1]);
    const slug = file.replace(/\.html$/, '');
    const url = `${siteUrl}/${slug}`;
    const content = render(text.slice(header[0].length).trim());
    const data = [
      { '@context': 'https://schema.org', '@type': meta.type ?? 'WebPage', name: meta.title, description: meta.description, url, inLanguage: 'en', publisher },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: brand.name, item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: meta.title, item: url },
        ],
      },
    ];
    const faq = faqEntries(content);
    if (faq.length > 0) data.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq });
    await fs.writeFile(
      path.join(out, `${slug}.html`),
      render(pageTemplate, { title: meta.title, heading: meta.heading ?? meta.title, description: meta.description, url, image: `${siteUrl}/assets/og-image.png`, content, jsonLd: data.map(jsonLd).join('\n  ') }),
    );
    slugs.push(slug);
  }
  return slugs;
}

/** Structured data for the home page. The FAQ entries are read from the page itself, so
 *  what search engines are told always matches what visitors can read. */
function homeData(html) {
  const faq = faqEntries(html);
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: brand.name,
      alternateName: brand.storeTitle,
      description: brand.shortDescription,
      url: `${siteUrl}/`,
      image: `${siteUrl}/assets/og-image.png`,
      screenshot: `${siteUrl}/assets/screens/00-home.png`,
      applicationCategory: 'BrowserApplication',
      operatingSystem: 'Chrome',
      softwareVersion: version,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@type': 'Person', name: brand.developer.name, url: brand.developer.url },
      publisher,
    },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: brand.name, url: `${siteUrl}/`, inLanguage: 'en', publisher },
  ];
  if (faq.length > 0) data.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq });
  return data.map(jsonLd).join('\n  ');
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    // _posts and _templates are sources, not pages.
    if (a === out || entry.name === 'vercel.json' || entry.name.startsWith('_')) continue;
    if (entry.isDirectory()) await copyDir(a, b);
    else if (entry.name.endsWith('.html')) {
      const text = await fs.readFile(a, 'utf8');
      const extra = from === src && entry.name === 'index.html' ? { jsonLd: homeData(render(text, { jsonLd: '', latestPosts: '' })), latestPosts: posts.slice(0, 3).map(postCard).join('') } : {};
      await fs.writeFile(b, render(text, extra));
    } else await fs.copyFile(a, b);
  }
}

await fs.rm(out, { recursive: true, force: true });
await copyDir(src, out);
await copyDir(path.join(root, 'docs', 'screenshots'), path.join(out, 'assets', 'screens'));
await copyDir(path.join(root, 'public', 'icons'), path.join(out, 'assets', 'icons'));
if (posts.length > 0) await buildBlog(posts);
const extraPages = await buildPages();

// sitemap.xml and robots.txt: one entry per page, at the clean URL Vercel serves it from.
const today = new Date().toISOString().slice(0, 10);
const newest = posts.reduce((latest, post) => ((post.updated ?? post.date) > latest ? (post.updated ?? post.date) : latest), '');
const pages = (await fs.readdir(src))
  .filter((file) => file.endsWith('.html') && file !== '404.html')
  .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)))
  .map((file) => (file === 'index.html' ? { loc: `${siteUrl}/`, lastmod: today, priority: '1.0' } : { loc: `${siteUrl}/${file.replace(/\.html$/, '')}`, lastmod: today, priority: '0.5' }));
for (const slug of extraPages) pages.push({ loc: `${siteUrl}/${slug}`, lastmod: today, priority: '0.6' });
if (posts.length > 0) {
  pages.splice(1, 0, { loc: `${siteUrl}/blog`, lastmod: newest, priority: '0.8' });
  for (const post of posts) pages.push({ loc: `${siteUrl}/blog/${post.slug}`, lastmod: post.updated ?? post.date, priority: '0.7' });
}
const entries = pages.map((page) => `  <url>\n    <loc>${escapeHtml(page.loc)}</loc>\n    <lastmod>${page.lastmod}</lastmod>\n    <priority>${page.priority}</priority>\n  </url>`);
await fs.writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`);
await fs.writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
console.log(`[website] built ${path.relative(process.cwd(), out) || '.'}/ (${pages.length} pages, ${posts.length} posts, download: ${zip || 'none'})`);

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml' };
  const port = Number(process.env.PORT || 4321);
  const isFile = (file) => fs.stat(file).then((stat) => stat.isFile(), () => false);
  http
    .createServer(async (req, res) => {
      let pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      let file = path.join(out, pathname);
      if (!file.startsWith(out)) return res.writeHead(403).end();
      // Clean URLs, as on Vercel: /privacy → privacy.html, /blog → blog/index.html.
      if (!(await isFile(file))) file = (await isFile(`${file}.html`)) ? `${file}.html` : path.join(file, 'index.html');
      try {
        const body = await fs.readFile(file);
        res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
      } catch {
        const notFound = await fs.readFile(path.join(out, '404.html')).catch(() => 'Not found');
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(notFound);
      }
    })
    .listen(port, '127.0.0.1', () => console.log(`[website] preview: http://127.0.0.1:${port}`));
}
