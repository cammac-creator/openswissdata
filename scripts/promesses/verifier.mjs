#!/usr/bin/env node
// Promesses publiques d'OpenSwissData (charte osd.Q01, version vérifiée du 02.10.2026). Aucune IA, aucun secret.
// Lit scripts/promesses/promesses.json, les catalogues publics et les pages publiques servis, et vérifie chaque
// promesse. Une promesse non tenue fait échouer la tâche verify-promises.yml, qui a SA PROPRE alerte mail
// (« Promesses publiques : problème détecté ») : la collecte FINMA et son témoin public ne sont pas touchés.
// Lancement : node scripts/promesses/verifier.mjs [chemin du fichier de promesses]
// Éprouvé le 05.10.2026 : 19 promesses tenues sur la production ; contre-épreuve à deux promesses faussées détectée.
import { readFileSync } from 'node:fs';

const fichier = process.argv[2] ?? 'scripts/promesses/promesses.json';
const spec = JSON.parse(readFileSync(fichier, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const catalogues = {};
const lire = async url => {
  const r = await fetch(url, { headers: { 'user-agent': 'OpenSwissData-promesses/1' }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};
const valeur = (objet, champ) => champ.split(/\.(?![0-9])/).reduce((v, k) => (v == null ? undefined : v[k]), objet);
const echecs = [];
for (const p of spec.promesses) {
  try {
    if (p.page) {
      const texte = (await (await lire(p.page)).text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
      if (p.contient && !texte.includes(p.contient.toLowerCase())) echecs.push(`${p.id} : phrase absente de la page`);
      for (const interdit of p.ne_contient_pas ?? []) if (texte.includes(interdit.toLowerCase())) echecs.push(`${p.id} : « ${interdit} » présent sur la page`);
      continue;
    }
    if (!catalogues[p.catalogue]) catalogues[p.catalogue] = await (await lire(spec.catalogues[p.catalogue])).json();
    const v = valeur(catalogues[p.catalogue], p.champ);
    const ok = {
      '>=': () => typeof v === 'number' && v >= p.valeur,
      '==': () => v === p.valeur,
      'entre': () => typeof v === 'number' && v >= p.valeur[0] && v <= p.valeur[1],
      'part>=': () => typeof v === 'number' && v / valeur(catalogues[p.catalogue], p.base) >= p.valeur,
      'longueur<=': () => Array.isArray(v) && v.length <= p.valeur,
      'age_jours<=': () => typeof v === 'string' && (Date.parse(today) - Date.parse(v.slice(0, 10).replaceAll('.', '-'))) / 86_400_000 <= p.valeur,
      // Chaque catégorie annoncée (clé de l'objet) doit avoir au moins N lignes : version en ligne du test C4.
      'toutes>=': () => v !== null && typeof v === 'object' && Object.keys(v).length > 0 && Object.values(v).every(n => typeof n === 'number' && n >= p.valeur),
    }[p.op];
    if (!ok) echecs.push(`${p.id} : opérateur inconnu ${p.op}`);
    else if (!ok()) echecs.push(`${p.id} : ${p.champ} = ${JSON.stringify(v)} (attendu ${p.op} ${JSON.stringify(p.valeur ?? '')})`);
  } catch (e) {
    echecs.push(`${p.id} : lecture impossible (${e instanceof Error ? e.message : 'erreur'})`);
  }
}
console.log(JSON.stringify({ date: today, promesses: spec.promesses.length, echecs: echecs.length }));
if (echecs.length) {
  console.error('Promesses publiques non tenues :\n- ' + echecs.join('\n- '));
  process.exitCode = 1;
}
