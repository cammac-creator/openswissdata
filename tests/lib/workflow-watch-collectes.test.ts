import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Les collectes ajoutées les 06-07.10.2026 sont suivies par la veille des tâches planifiées, et chaque
// fichier suivi existe bien dans .github/workflows (un nom mal recopié serait toujours « absent »).
describe('veille des tâches : collectes ajoutées', () => {
  const source = readFileSync(new URL('../../src/lib/workflow-watch.ts', import.meta.url), 'utf8');
  const bloc = source.slice(source.indexOf('const SCHEDULED'), source.indexOf('] as const', source.indexOf('const SCHEDULED')));
  const suivis = [...bloc.matchAll(/'([a-z0-9-]+\.yml)'/g)].map(m => m[1]);
  it.each(['refresh-localities.yml', 'refresh-streets.yml', 'refresh-finma-seats.yml', 'refresh-bfe-pv.yml', 'prospect-sources.yml'])('%s est suivie', (fichier) => {
    expect(suivis).toContain(fichier);
  });
  it('chaque workflow suivi existe dans .github/workflows', () => {
    for (const fichier of suivis) expect(existsSync(new URL(`../../.github/workflows/${fichier}`, import.meta.url)), fichier).toBe(true);
  });
});
