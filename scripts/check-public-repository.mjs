#!/usr/bin/env node
// Contrôle du contenu suivi par Git ; aucune valeur détectée n'est affichée.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const patterns = [
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  /\bwhsec_[A-Za-z0-9]{24,}\b/g,
  /\bre_[A-Za-z0-9]{24,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
];
const findings = [];
for (const path of files) {
  if (/^docs\/launch\/mailing-list\/.*\.csv$/i.test(path)) findings.push(`${path} : liste de prospection interdite dans le dépôt public`);
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) continue;
  const content = readFileSync(absolute);
  if (content.includes(0)) continue;
  const text = content.toString('utf8');
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push(`${path}:${line} : motif de secret à retirer`);
    }
  }
}
if (findings.length) {
  process.stderr.write(findings.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`Contrôle public réussi : ${files.length} fichiers suivis, aucun motif sensible détecté.\n`);
}
