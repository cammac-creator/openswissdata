import { readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Demandes de licence (plan du 08.10.2026) : le rapport public `docs/data-status/demandes.json` ne
// porte que l'UUID du jeu, l'éditeur, la date et un statut tiré de nos actes ou du catalogue public ;
// la tâche hebdomadaire ne confie le secret d'administration qu'à l'étape de dépôt.

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const STATUTS = new Set(["deposee", "envoyee", "echec_envoi", "annulee", "licence_ouverte_constatee"]);

describe("docs/data-status/demandes.json (public)", () => {
  const report = JSON.parse(read("docs/data-status/demandes.json")) as { generated_on: string | null; entries: Array<Record<string, unknown>> };

  it("a la forme attendue et rien d'autre que id, organisation, date, statut", () => {
    expect(Array.isArray(report.entries)).toBe(true);
    for (const e of report.entries) {
      expect(Object.keys(e).sort()).toEqual(["date", "id", "organisation", "statut"]);
      expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(e.organisation).toMatch(/^[a-z0-9_-]+$/);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(STATUTS.has(String(e.statut)), String(e.statut)).toBe(true);
    }
  });

  it("ne contient aucune adresse", () => {
    expect(read("docs/data-status/demandes.json")).not.toContain("@");
  });
});

describe(".github/workflows/prospect-requests.yml", () => {
  const yml = read(".github/workflows/prospect-requests.yml");

  it("tourne dans l'environnement « collecte », chaque semaine à une minute non ronde", () => {
    expect(yml).toMatch(/environment: collecte/);
    const cron = /cron: "(\d+) (\d+) \* \* (\d)"/.exec(yml);
    expect(cron).not.toBeNull();
    expect(Number(cron![1]) % 5).not.toBe(0);
  });

  it("un déclenchement manuel est une simulation par défaut", () => {
    expect(yml).toMatch(/simulation:[\s\S]*?type: boolean[\s\S]*?default: true/);
  });

  it("le secret d'administration n'est confié qu'à une seule étape, celle du dépôt", () => {
    expect(yml.match(/secrets\.ADMIN_SECRET/g)?.length).toBe(1);
    const steps = yml.split(/\n\s+- name: /);
    const withSecret = steps.filter((s) => s.includes("secrets.ADMIN_SECRET"));
    expect(withSecret).toHaveLength(1);
    expect(withSecret[0]).toContain("scripts/deposit-requests.mjs");
    expect(withSecret[0]).not.toMatch(/npm |npx |tsx/);
  });

  it("ne publie aucun artefact (dépôt public) et ne commite que demandes.json", () => {
    expect(yml).not.toContain("upload-artifact");
    const adds = [...yml.matchAll(/git add ([^\n]+)/g)].map((m) => m[1].trim());
    expect(adds).toEqual(["docs/data-status/demandes.json"]);
  });

  it("est suivie par la veille des tâches planifiées", () => {
    const source = read("src/lib/workflow-watch.ts");
    const bloc = source.slice(source.indexOf("const SCHEDULED"), source.indexOf("] as const", source.indexOf("const SCHEDULED")));
    expect(bloc).toContain("'prospect-requests.yml'");
    expect(existsSync(new URL(".github/workflows/prospect-requests.yml", root))).toBe(true);
  });
});
