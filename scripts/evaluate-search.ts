/**
 * Évaluation rejouable des outils de recherche MCP, sans réseau pendant la mesure.
 *
 * Mesure le rang de la première réponse juste de chaque requête du jeu `scripts/search-eval/cases.json`
 * en appelant les vrais gestionnaires des outils (index, modèle figé et données embarqués), puis
 * calcule top-1, top-5 et rang réciproque moyen (MRR, borné à la liste renvoyée).
 *
 *   npx tsx scripts/evaluate-search.ts [--tool tares|noga|finma|all] [--out resultats.json]
 *                                      [--structure Tarifstruktur.xlsx]
 *
 * Préalable : `npm run models:prepare:embedding` (poids figés dans dist/models). Pendant la mesure,
 * `fetch` est remplacé par une fonction qui échoue : un téléchargement caché ferait échouer le script.
 * `--structure` vérifie en plus que chaque désignation citée en justification figure mot pour mot
 * dans le chemin officiel d'une ligne attendue (fichier Tarifstruktur de l'OFDF, lu localement).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

interface CodeCase { id: string; lang?: string; query: string; expected: string[]; designation?: string }
interface NameCase { id: string; kind: string; query: string; expected: string[] }
interface AbsentCase { id: string; query: string }
interface Cases {
  tares: CodeCase[]; tares_codes: CodeCase[]; noga: CodeCase[]; noga_codes: CodeCase[];
  finma: NameCase[]; finma_absent: AbsentCase[];
}
interface CaseResult { id: string; group: string; query: string; expected: string[]; rank: number | null; top: string[]; ms: number }
interface Summary { cases: number; top1: number; top5: number; mrr: number }

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const tool = option("--tool") ?? "all";
if (!["tares", "noga", "finma", "all"].includes(tool)) throw new Error("--tool attend tares, noga, finma ou all");

const cases = JSON.parse(readFileSync(`${root}scripts/search-eval/cases.json`, "utf8")) as Cases;

function csv<T>(path: string): T[] {
  return parse(readFileSync(`${root}${path}`, "utf8"), { columns: true, skip_empty_lines: true }) as T[];
}

/** Aucune attente inventée : chaque code ou nom attendu doit exister dans les données embarquées. */
function checkExpectations(): string[] {
  const problems: string[] = [];
  const hs8 = csv<{ hs8: string }>("src/mcp/data/tares.csv").map((r) => r.hs8);
  for (const c of [...cases.tares, ...cases.tares_codes]) {
    for (const prefix of c.expected) if (!hs8.some((code) => code.startsWith(prefix))) problems.push(`${c.id} : ${prefix} absent du TARES embarqué`);
  }
  const noga = csv<{ code: string; label_fr: string }>("data/classifications/classifications-2026.04.29-test-work/noga_2025.csv");
  for (const c of [...cases.noga, ...cases.noga_codes]) {
    for (const prefix of c.expected) if (!noga.some((r) => r.code === prefix)) problems.push(`${c.id} : ${prefix} absent de NOGA 2025`);
    if (c.designation && !c.expected.some((prefix) => noga.find((r) => r.code === prefix)?.label_fr === c.designation)) {
      problems.push(`${c.id} : désignation différente du libellé officiel`);
    }
  }
  const names = new Set(csv<{ name: string }>("src/mcp/data/finma_registry.csv").map((r) => r.name));
  for (const c of cases.finma) for (const name of c.expected) if (!names.has(name)) problems.push(`${c.id} : ${name} absent du registre embarqué`);
  const folded = [...names].map((n) => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase());
  for (const c of cases.finma_absent) {
    const needle = c.query.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (folded.some((n) => n.includes(needle))) problems.push(`${c.id} : « ${c.query} » figure pourtant dans le registre`);
  }
  return problems;
}

/** Justifications TARES : fragment verbatim du chemin officiel d'une ligne attendue. */
async function checkDesignations(structurePath: string): Promise<string[]> {
  const { readStructureLines, buildTaresPaths, pathDesignations } = await import("../etl/tares/hierarchy.js");
  const paths = [...buildTaresPaths(readStructureLines(structurePath)).values()];
  const problems: string[] = [];
  for (const c of cases.tares) {
    const under = paths.filter((p) => c.expected.some((prefix) => p.hs8.startsWith(prefix)));
    const found = under.some((p) => pathDesignations(p, "fr", { chapter: true }).join(" › ").includes(c.designation ?? "\u0000"));
    if (!found) problems.push(`${c.id} : « ${c.designation} » absent des chemins officiels de ${c.expected.join(", ")}`);
  }
  return problems;
}

function rankOf(top: string[], expected: string[], matches: (value: string, wanted: string) => boolean): number | null {
  const index = top.findIndex((value) => expected.some((wanted) => matches(value, wanted)));
  return index < 0 ? null : index + 1;
}

function summarize(results: CaseResult[]): Summary {
  const n = results.length || 1;
  return {
    cases: results.length,
    top1: results.filter((r) => r.rank === 1).length / n,
    top5: results.filter((r) => r.rank !== null && r.rank <= 5).length / n,
    mrr: results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / n,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
function table(title: string, groups: Record<string, CaseResult[]>): string {
  const lines = [`### ${title}`, "", "| Groupe | Requêtes | Top-1 | Top-5 | MRR |", "|---|---:|---:|---:|---:|"];
  for (const [name, rows] of Object.entries(groups)) {
    const s = summarize(rows);
    lines.push(`| ${name} | ${s.cases} | ${pct(s.top1)} | ${pct(s.top5)} | ${s.mrr.toFixed(3)} |`);
  }
  return lines.join("\n");
}

function groupBy(results: CaseResult[], all: string): Record<string, CaseResult[]> {
  const groups: Record<string, CaseResult[]> = {};
  for (const r of results) (groups[r.group] ??= []).push(r);
  return { ...groups, [all]: results.filter((r) => !r.group.startsWith("code")) };
}

const problems = checkExpectations();
const structurePath = option("--structure");
if (structurePath) problems.push(...(await checkDesignations(structurePath)));
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Attentes vérifiées${structurePath ? " (désignations officielles comprises)" : ""} : aucune position ou entité inventée.`);

// Aucun accès réseau pendant la mesure : modèle, index et données doivent être locaux.
globalThis.fetch = (() => { throw new Error("Réseau interdit pendant la mesure"); }) as typeof fetch;

const output: Record<string, unknown> = { measured_at: new Date().toISOString(), node: process.version };
const report: string[] = [];

async function timed<T>(fn: () => Promise<T> | T): Promise<[T, number]> {
  const started = performance.now();
  const value = await fn();
  return [value, performance.now() - started];
}

if (tool === "tares" || tool === "all") {
  const { tariffSemanticSearchHandler } = await import("../src/mcp/tools/tariff-semantic-search.js");
  const results: CaseResult[] = [];
  for (const c of [...cases.tares, ...cases.tares_codes]) {
    const [out, ms] = await timed(() => tariffSemanticSearchHandler({ query: c.query, top_k: 20 }));
    if (out.isError) throw new Error(`${c.id} : ${out.content[0]?.text}`);
    const top = ((out.structured as { hits: { hs_code: string }[] }).hits).map((h) => h.hs_code);
    results.push({ id: c.id, group: c.lang ?? "code", query: c.query, expected: c.expected, rank: rankOf(top, c.expected, (v, w) => v.startsWith(w)), top: top.slice(0, 5), ms });
  }
  output.tares = { summary: summarize(results.filter((r) => r.group !== "code")), codes: summarize(results.filter((r) => r.group === "code")), results };
  report.push(table("tariff_semantic_search (TARES)", groupBy(results, "ensemble FR/DE/EN/IT")));
}

if (tool === "noga" || tool === "all") {
  const { classifyTextHandler } = await import("../src/mcp/tools/classify-text.js");
  const results: CaseResult[] = [];
  for (const c of [...cases.noga, ...cases.noga_codes]) {
    // classify_text accepte cinq caractères au moins ; les requêtes en forme de code sont complétées sans changer le code.
    const text = c.query.length >= 5 ? c.query : `NOGA ${c.query}`;
    const [out, ms] = await timed(() => classifyTextHandler({ text, top_k: 10 }));
    if (out.isError) throw new Error(`${c.id} : ${out.content[0]?.text}`);
    const top = ((out.structured as { hits: { code: string }[] }).hits).map((h) => h.code);
    results.push({ id: c.id, group: c.lang ?? "code", query: text, expected: c.expected, rank: rankOf(top, c.expected, (v, w) => v.startsWith(w)), top: top.slice(0, 5), ms });
  }
  output.noga = { summary: summarize(results.filter((r) => r.group !== "code")), codes: summarize(results.filter((r) => r.group === "code")), results };
  report.push(table("classify_text (NOGA 2025, liste de 10 au plus)", groupBy(results, "ensemble")));
}

if (tool === "finma" || tool === "all") {
  const { finmaSearchHandler } = await import("../src/mcp/tools/finma-search.js");
  const results: CaseResult[] = [];
  for (const c of cases.finma) {
    const [out, ms] = await timed(() => finmaSearchHandler({ name: c.query, top_k: 20 }));
    if (out.isError) throw new Error(`${c.id} : ${out.content[0]?.text}`);
    const top = ((out.structured as { matches: { name: string }[] }).matches).map((m) => m.name);
    results.push({ id: c.id, group: c.kind, query: c.query, expected: c.expected, rank: rankOf(top, c.expected, (v, w) => v === w), top: top.slice(0, 5), ms });
  }
  const absent = [];
  for (const c of cases.finma_absent) {
    const out = finmaSearchHandler({ name: c.query, top_k: 3 });
    const matches = (out.structured as { matches?: Record<string, unknown>[] } | undefined)?.matches ?? [];
    absent.push({ id: c.id, query: c.query, top: matches.slice(0, 3).map((m) => ({ name: m.name, score: m.score, match_type: m.match_type ?? null })) });
  }
  output.finma = { summary: summarize(results), results, absent };
  report.push(table("finma_search (registre FINMA embarqué)", groupBy(results, "ensemble")));
  report.push(["", "Noms absents du registre (premier résultat renvoyé) :", ...absent.map((a) => `- ${a.id} « ${a.query} » → ${a.top[0] ? `${a.top[0].name} (score ${a.top[0].score}${a.top[0].match_type ? `, ${a.top[0].match_type}` : ""})` : "aucun résultat"}`)].join("\n"));
}

console.log(report.join("\n\n"));
const misses: string[] = [];
for (const key of ["tares", "noga", "finma"]) {
  const block = output[key] as { results: CaseResult[] } | undefined;
  for (const r of block?.results ?? []) if (r.rank !== 1) misses.push(`${r.id} « ${r.query} » rang ${r.rank ?? "absent"} ; premiers : ${r.top.join(", ")}`);
}
if (misses.length) console.log(["", "Requêtes sans réponse juste en tête :", ...misses.map((m) => `- ${m}`)].join("\n"));
const outPath = option("--out");
if (outPath) writeFileSync(outPath, JSON.stringify(output, null, 2));
