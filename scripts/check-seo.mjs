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
let linkCount = 0, alternateCount = 0, sitemapCount = 0;
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
if (errors.size) {
  console.error([...errors].slice(0, 30).join('\n'));
  throw new Error(`${errors.size} anomalie(s) de référencement.`);
}
console.log(`Référencement vérifié : ${pages.size} pages, ${linkCount} liens internes, ${alternateCount} références de langue, ${sitemapCount} URLs sitemap ; zéro anomalie.`);
