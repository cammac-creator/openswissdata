#!/usr/bin/env node
/**
 * Signale des adresses à IndexNow (Bing, Yandex, Seznam, Naver, Internet Archive…), pour que
 * les moteurs qui nourrissent Copilot et la recherche de ChatGPT relisent les pages sans
 * attendre leur passage. Google n'utilise pas IndexNow : il lit le plan du site.
 *
 * Usage :
 *   node scripts/indexnow-ping.mjs https://www.openswissdata.com/en/mcp [autres adresses…]
 *   node scripts/indexnow-ping.mjs --sitemap     # toutes les adresses du plan du site en ligne
 *
 * La clé est publique par construction : le fichier web/public/<clé>.txt la sert à la racine
 * du site, et IndexNow vérifie qu'elle y est avant d'accepter les adresses.
 */
const KEY = '9932c3fffdc45a203290496f13b1dc97';
const HOST = 'www.openswissdata.com';
const MAX_PER_CALL = 10_000;

async function sitemapUrls() {
  const index = await fetch(`https://${HOST}/sitemap-index.xml`);
  if (!index.ok) throw new Error(`plan du site : ${index.status}`);
  const children = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const urls = [];
  for (const child of children) {
    const res = await fetch(child);
    if (!res.ok) throw new Error(`${child} : ${res.status}`);
    urls.push(...[...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()));
  }
  // Seules les adresses du site sont acceptées par IndexNow pour cette clé.
  return urls.filter((u) => new URL(u).host === HOST);
}

let urls = process.argv.slice(2);
if (urls[0] === '--sitemap') {
  urls = await sitemapUrls();
  console.log(`plan du site : ${urls.length} adresses`);
}
if (urls.length === 0) {
  console.error('usage : node scripts/indexnow-ping.mjs <adresse> [adresse…] | --sitemap');
  process.exit(1);
}

// La clé doit être servie avant tout envoi, sinon IndexNow refuse la demande entière.
const keyFile = await fetch(`https://${HOST}/${KEY}.txt`);
if (!keyFile.ok || (await keyFile.text()).trim() !== KEY) {
  console.error(`clé IndexNow non servie à https://${HOST}/${KEY}.txt (${keyFile.status})`);
  process.exit(1);
}

let failed = false;
for (let i = 0; i < urls.length; i += MAX_PER_CALL) {
  const chunk = urls.slice(i, i + MAX_PER_CALL);
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: chunk }),
  });
  // 200 : reçu ; 202 : reçu, clé en cours de vérification. Tout le reste est un échec.
  console.log(`IndexNow : ${chunk.length} adresses → ${res.status} ${res.statusText}`);
  if (res.status !== 200 && res.status !== 202) failed = true;
}
if (failed) process.exit(1);
