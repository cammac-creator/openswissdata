/** Lecture de l’or : vérifie les polices distribuées et leurs licences, sans réseau ni écriture. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const dist = join(web, 'dist');
const manifest = JSON.parse(await readFile(join(web, 'src/assets/fonts/provenance.json'), 'utf8'));
const errors = new Set();
const expected = new Set();
let licenses = 0;
for (const entry of manifest.fichiers) {
  const data = await readFile(join(web, entry.fichier));
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== entry.sha256 || data.length !== entry.octets) errors.add(`Source modifiée : ${entry.fichier}`);
  if (entry.fichier.endsWith('.woff2')) {
    if (data.toString('ascii', 0, 4) !== 'wOF2') errors.add(`WOFF2 invalide : ${entry.fichier}`);
    expected.add(sha);
  } else {
    licenses++;
    const served = await readFile(join(dist, entry.fichier.replace(/^public\//, '')));
    if (!data.equals(served)) errors.add(`Licence distribuée différente : ${entry.fichier}`);
  }
}
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
}
const files = await walk(dist);
const found = new Set();
for (const file of files.filter(f => /\.(woff|ttf|otf)$/.test(f))) errors.add(`Format de police non contrôlé : ${relative(dist, file)}`);
for (const file of files.filter(f => f.endsWith('.woff2'))) {
  const sha = createHash('sha256').update(await readFile(file)).digest('hex');
  if (!expected.has(sha)) errors.add(`Police sans provenance : ${relative(dist, file)}`);
  found.add(sha);
}
for (const sha of expected) if (!found.has(sha)) errors.add(`Police absente du build : ${sha}`);
for (const file of files.filter(f => /\.(css|html|js)$/.test(f))) {
  const text = await readFile(file, 'utf8');
  if (/\/\/fonts\.(googleapis|gstatic)\.com/.test(text)) errors.add(`Appel Google Fonts : ${relative(dist, file)}`);
  if (file.endsWith('.js')) continue;
  // Astro peut intégrer les petites feuilles de style dans le HTML.
  for (const m of text.matchAll(/url\(["']?([^\s"')]+\.woff2)["']?\)/g)) {
    const url = new URL(m[1], 'https://local.invalid/' + relative(dist, file));
    if (url.origin !== 'https://local.invalid') { errors.add(`Police distante : ${m[1]}`); continue; }
    try { await readFile(join(dist, decodeURIComponent(url.pathname))); }
    catch { errors.add(`Lien de police absent : ${m[1]}`); }
  }
}
if (errors.size) {
  console.error([...errors].join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Polices : ${found.size} WOFF2 intacts, ${licenses} licences distribuées, aucun appel Google Fonts dans le build.`);
}
