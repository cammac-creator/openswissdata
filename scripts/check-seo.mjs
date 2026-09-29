/** Contrôle des fichiers réellement produits, sans requête réseau. */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
const origin = 'https://www.openswissdata.com';
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  return nested.flat();
}
const files = await walk(root);
const paths = new Set(files.map(f => '/' + relative(root, f)));
const normalize = path => path.replace(/\/+$/, '') || '/';
const exists = path => {
  try { path = decodeURIComponent(path); } catch { return false; }
  return paths.has(path) || paths.has(path.replace(/\/+$/, '') + '/index.html') || paths.has(path + '.html');
};
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], m[2]]));
const errors = new Set();
const pages = new Map();
let linkCount = 0, alternateCount = 0, sitemapCount = 0, datasetPages = 0, guidePages = 0;
for (const file of files.filter(f => f.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  // Les fichiers de validation Google portent .html mais ne sont pas des pages.
  if (!/<html[\s>]/i.test(html)) continue;
  const filePath = '/' + relative(root, file);
  const path = filePath.endsWith('/index.html') ? filePath.slice(0, -10) : filePath;
  const head = html.split('</head>', 1)[0];
  const tags = [...head.matchAll(/<(?:link|meta)\b[^>]*>/g)].map(m => attrs(m[0]));
  const noindex = tags.some(a => a.name === 'robots' && a.content?.includes('noindex'));
  const canonical = tags.find(a => a.rel === 'canonical')?.href;
  if (!noindex && canonical !== origin + path) errors.add(`Canonique incohérente : ${path}`);
  const alternates = tags.filter(a => a.rel === 'alternate' && a.hreflang);
  for (const a of alternates) {
    alternateCount++;
    const url = new URL(a.href, origin);
    if (url.origin !== origin || !exists(url.pathname)) errors.add(`Traduction absente : ${path} → ${a.href}`);
  }
  pages.set(normalize(path), { canonical, noindex, alternates });
  // Les neuf fiches produit (trois jeux, trois langues) portent un Dataset schema.org dont l'adresse est la canonique.
  if (/^\/(?:(?:de|en)\/)?datasets\/(?:tares|classifications|finma)\/$/.test(path)) {
    datasetPages++;
    const datasets = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(m => { try { return JSON.parse(m[1]); } catch { errors.add(`JSON-LD illisible : ${path}`); return {}; } })
      .filter(data => data['@type'] === 'Dataset');
    const dataset = datasets[0];
    if (datasets.length !== 1) errors.add(`Dataset absent ou multiple : ${path}`);
    else if (dataset.url !== canonical || typeof dataset.name !== 'string' || typeof dataset.description !== 'string' || dataset.description.length < 50 || dataset.isAccessibleForFree !== false || 'distribution' in dataset) {
      errors.add(`Dataset incomplet : ${path}`);
    }
  }
  // Les neuf guides FINMA (trois guides, trois langues) : Article ou TechArticle sans date inventée, fil d'Ariane, sources citées.
  if (/^\/(?:(?:de|en)\/)?guides\/[a-z0-9-]+\/$/.test(path)) {
    guidePages++;
    const graphs = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(m => { try { return JSON.parse(m[1]); } catch { errors.add(`JSON-LD illisible : ${path}`); return {}; } })
      .flatMap(data => Array.isArray(data['@graph']) ? data['@graph'] : [data]);
    const articles = graphs.filter(item => item['@type'] === 'Article' || item['@type'] === 'TechArticle');
    const article = articles[0];
    if (articles.length !== 1 || !graphs.some(item => item['@type'] === 'BreadcrumbList')) errors.add(`Guide sans Article unique ou sans fil d'Ariane : ${path}`);
    else if (article.url !== canonical || article.author?.name !== 'OpenSwissData' || 'datePublished' in article || 'dateModified' in article
      || typeof article.headline !== 'string' || article.headline.length > 110 || !Array.isArray(article.citation) || !article.citation.length
      || article.citation.some(c => !/^https:\/\//.test(c.url))) {
      errors.add(`Guide au balisage incomplet ou daté : ${path}`);
    }
  }
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  for (const m of markup.matchAll(/<a\b[^>]*>/g)) {
    const href = attrs(m[0]).href;
    if (!href || href.startsWith('#')) continue;
    let url; try { url = new URL(href, origin + path); } catch { continue; }
    if (url.origin !== origin || /^\/(api|mcp|oauth|\.well-known)\//.test(url.pathname)) continue;
    linkCount++;
    if (!exists(url.pathname)) errors.add(`Lien absent : ${url.pathname}`);
  }
}
for (const [path, page] of pages) for (const alternate of page.alternates) {
  if (alternate.hreflang === 'x-default') continue;
  const target = pages.get(normalize(new URL(alternate.href, origin).pathname));
  if (target && !target.alternates.some(a => normalize(new URL(a.href, origin).pathname) === path)) {
    errors.add(`Traduction sans retour réciproque : ${path} → ${alternate.href}`);
  }
}
for (const file of files.filter(f => /sitemap-\d+\.xml$/.test(f))) {
  const xml = await readFile(file, 'utf8');
  if (xml.includes('<lastmod>')) errors.add('Dates sitemap présentes sans suivi des changements significatifs.');
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    sitemapCount++;
    const url = new URL(m[1]);
    const page = pages.get(normalize(url.pathname));
    if (url.origin !== origin || !page || page.noindex || page.canonical !== m[1]) errors.add(`URL sitemap non indexable : ${m[1]}`);
  }
  for (const m of xml.matchAll(/<xhtml:link\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (!exists(new URL(a.href, origin).pathname)) errors.add(`Traduction sitemap absente : ${a.href}`);
  }
}
if (!sitemapCount || pages.size < 40) errors.add('Construction ou sitemap incomplet.');
if (datasetPages !== 9) errors.add(`Fiches produit attendues : 9, trouvées : ${datasetPages}.`);
if (guidePages !== 9) errors.add(`Guides attendus : 9, trouvés : ${guidePages}.`);
if (errors.size) {
  console.error([...errors].slice(0, 30).join('\n'));
  throw new Error(`${errors.size} anomalie(s) de référencement.`);
}
console.log(`Référencement vérifié : ${pages.size} pages, ${linkCount} liens internes, ${alternateCount} références de langue, ${sitemapCount} URLs sitemap, ${datasetPages} fiches avec Dataset, ${guidePages} guides avec Article ; zéro anomalie.`);
