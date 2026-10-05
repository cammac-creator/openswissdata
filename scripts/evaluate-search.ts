/**
 * Évaluation rejouable des outils de recherche MCP, sans réseau pendant la mesure.
 *
 * Mesure le rang de la première réponse juste de chaque requête du jeu `scripts/search-eval/cases.json`
 * en appelant les vrais gestionnaires des outils (index, modèle figé et données embarqués), puis
 * calcule top-1, top-5 et rang réciproque moyen (MRR, borné à la liste renvoyée).
 *
 *   npx tsx scripts/evaluate-search.ts [--tool tares|noga|finma|all] [--out resultats.json]
 *                                      [--structure Tarifstruktur.xlsx] [--holdout]
 *                                      [--enregistrer reference.json] [--comparer reference.json]
 *
 * Préalable : `npm run models:prepare:embedding` (poids figés dans dist/models). Pendant la mesure,
 * `fetch` est remplacé par une fonction qui échoue : un téléchargement caché ferait échouer le script.
 * `--structure` vérifie en plus que chaque désignation citée en justification figure mot pour mot
 * dans le chemin officiel d'une ligne attendue (fichier Tarifstruktur de l'OFDF, lu localement).
 *
 * Groupes : langues du jeu principal (et leur ensemble), requêtes en forme de code, puis « contrôle »
 * (jeu écrit après le choix de la méthode, rapporté séparément, mesuré seulement avec --holdout ;
 * ses attentes et désignations sont vérifiées à chaque exécution).
 *
 * tâche osd.S15 : banc rejoué seul. `--enregistrer` écrit une référence (par cas du jeu PRINCIPAL
 * seulement : réussi au rang 1, au rang 5, ou échoué) à partir d'une vraie exécution, jamais à la
 * main ; `--comparer` rejoue et échoue (code 1) si un cas recule par rapport à cette référence
 * (un progrès est signalé, jamais bloquant). Les deux exigent `--tool all` (par défaut).
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
  /** Jeu de contrôle, écrit après le choix de la méthode : mesuré à part, jamais mêlé à l'ensemble principal. */
  tares_holdout: CodeCase[]; noga_holdout: CodeCase[];
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
// Le jeu de contrôle n'est mesuré qu'à la demande explicite, une fois la méthode figée.
const withHoldout = args.includes("--holdout");
if (!["tares", "noga", "finma", "all"].includes(tool)) throw new Error("--tool attend tares, noga, finma ou all");
const registerPath = option("--enregistrer");
const comparePath = option("--comparer");
if ((registerPath || comparePath) && tool !== "all") {
  throw new Error("--enregistrer et --comparer exigent --tool all (ne pas passer --tool)");
}

const cases = JSON.parse(readFileSync(`${root}scripts/search-eval/cases.json`, "utf8")) as Cases;
const holdoutCases = { tares: cases.tares_holdout, noga: cases.noga_holdout };
if (!withHoldout) { cases.tares_holdout = []; cases.noga_holdout = []; }

function csv<T>(path: string): T[] {
  return parse(readFileSync(`${root}${path}`, "utf8"), { columns: true, skip_empty_lines: true }) as T[];
}

/** Aucune attente inventée : chaque code ou nom attendu doit exister dans les données embarquées. */
function checkExpectations(): string[] {
  const problems: string[] = [];
  const hs8 = csv<{ hs8: string }>("src/mcp/data/tares.csv").map((r) => r.hs8);
  for (const c of [...cases.tares, ...cases.tares_codes, ...holdoutCases.tares]) {
    for (const prefix of c.expected) if (!hs8.some((code) => code.startsWith(prefix))) problems.push(`${c.id} : ${prefix} absent du TARES embarqué`);
  }
  const noga = csv<{ code: string; label_fr: string }>("data/classifications/classifications-2026.04.29-test-work/noga_2025.csv");
  for (const c of [...cases.noga, ...cases.noga_codes, ...holdoutCases.noga]) {
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
  for (const c of [...cases.tares, ...holdoutCases.tares]) {
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

const SIDE_GROUPS = new Set(["code", "contrôle"]);
function groupBy(results: CaseResult[], all: string): Record<string, CaseResult[]> {
  const groups: Record<string, CaseResult[]> = {};
  for (const r of results) if (!SIDE_GROUPS.has(r.group)) (groups[r.group] ??= []).push(r);
  const side = Object.fromEntries([...SIDE_GROUPS].map((g) => [g, results.filter((r) => r.group === g)]).filter(([, rows]) => rows.length));
  return { ...groups, [all]: results.filter((r) => !SIDE_GROUPS.has(r.group)), ...side };
}
const main = (results: CaseResult[]) => results.filter((r) => !SIDE_GROUPS.has(r.group));
const only = (results: CaseResult[], group: string) => results.filter((r) => r.group === group);

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
  const tagged = [...cases.tares.map((c) => ({ c, group: c.lang! })), ...cases.tares_codes.map((c) => ({ c, group: "code" })), ...cases.tares_holdout.map((c) => ({ c, group: "contrôle" }))];
  for (const { c, group } of tagged) {
    const [out, ms] = await timed(() => tariffSemanticSearchHandler({ query: c.query, top_k: 20 }));
    if (out.isError) throw new Error(`${c.id} : ${out.content[0]?.text}`);
    const top = ((out.structured as { hits: { hs_code: string }[] }).hits).map((h) => h.hs_code);
    results.push({ id: c.id, group, query: c.query, expected: c.expected, rank: rankOf(top, c.expected, (v, w) => v.startsWith(w)), top: top.slice(0, 5), ms });
  }
  output.tares = { summary: summarize(main(results)), codes: summarize(only(results, "code")), holdout: summarize(only(results, "contrôle")), results };
  report.push(table("tariff_semantic_search (TARES)", groupBy(results, "ensemble principal FR/DE/EN/IT")));
}

if (tool === "noga" || tool === "all") {
  const { classifyTextHandler } = await import("../src/mcp/tools/classify-text.js");
  const results: CaseResult[] = [];
  const tagged = [...cases.noga.map((c) => ({ c, group: c.lang! })), ...cases.noga_codes.map((c) => ({ c, group: "code" })), ...cases.noga_holdout.map((c) => ({ c, group: "contrôle" }))];
  for (const { c, group } of tagged) {
    // classify_text accepte cinq caractères au moins ; les requêtes en forme de code sont complétées sans changer le code.
    const text = c.query.length >= 5 ? c.query : `NOGA ${c.query}`;
    const [out, ms] = await timed(() => classifyTextHandler({ text, top_k: 10 }));
    if (out.isError) throw new Error(`${c.id} : ${out.content[0]?.text}`);
    const top = ((out.structured as { hits: { code: string }[] }).hits).map((h) => h.code);
    results.push({ id: c.id, group, query: text, expected: c.expected, rank: rankOf(top, c.expected, (v, w) => v.startsWith(w)), top: top.slice(0, 5), ms });
  }
  output.noga = { summary: summarize(main(results)), codes: summarize(only(results, "code")), holdout: summarize(only(results, "contrôle")), results };
  report.push(table("classify_text (NOGA 2025, liste de 10 au plus)", groupBy(results, "ensemble principal")));
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

// tâche osd.S15 : référence par cas du jeu PRINCIPAL (jamais le jeu de contrôle), enregistrée
// seulement par une vraie exécution du script, et comparaison qui bloque un recul de cas.
type CaseStatus = "rang1" | "rang5" | "echec";
const STATUS_RANK: Record<CaseStatus, number> = { echec: 0, rang5: 1, rang1: 2 };
const statusOf = (rank: number | null): CaseStatus => (rank === 1 ? "rang1" : rank !== null && rank <= 5 ? "rang5" : "echec");
function mainCases(): CaseResult[] {
  const all: CaseResult[] = [];
  for (const key of ["tares", "noga", "finma"] as const) {
    const block = output[key] as { results: CaseResult[] } | undefined;
    if (block) for (const r of block.results) if (r.group !== "contrôle") all.push(r);
  }
  return all;
}

if (registerPath) {
  const cases_ = mainCases();
  const entries = cases_.map((r) => [r.id, { status: statusOf(r.rank), rank: r.rank }] as const);
  const reference = {
    generated_at: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cases: Object.fromEntries(entries),
  };
  // Un identifiant de cas dupliqué entre outils écraserait silencieusement une entrée.
  if (Object.keys(reference.cases).length !== entries.length) throw new Error("--enregistrer : identifiants de cas en collision entre outils");
  writeFileSync(registerPath, `${JSON.stringify(reference, null, 2)}\n`);
  console.log(`\nRéférence enregistrée (jeu principal seul, code compris, jamais le jeu de contrôle) : ${entries.length} cas dans ${registerPath} (${reference.platform}, Node ${reference.node}).`);
}

if (comparePath) {
  const reference = JSON.parse(readFileSync(comparePath, "utf8")) as { cases: Record<string, { status: CaseStatus; rank: number | null }> };
  const cases_ = mainCases();
  const regressions: string[] = [];
  const progress: string[] = [];
  const nouveaux: string[] = [];
  for (const r of cases_) {
    const before = reference.cases[r.id];
    const after = statusOf(r.rank);
    if (!before) { nouveaux.push(`${r.id} (statut actuel ${after})`); continue; }
    if (STATUS_RANK[after] < STATUS_RANK[before.status]) {
      regressions.push(`${r.id} « ${r.query} » : ${before.status} (rang ${before.rank ?? "absent"}) → ${after} (rang ${r.rank ?? "absent"})`);
    } else if (STATUS_RANK[after] > STATUS_RANK[before.status]) {
      progress.push(`${r.id} : ${before.status} → ${after}`);
    }
  }
  const disparus = Object.keys(reference.cases).filter((id) => !cases_.some((r) => r.id === id));
  console.log(`\nComparaison à la référence (${Object.keys(reference.cases).length} cas) : ${regressions.length} recul(s), ${progress.length} progrès, ${nouveaux.length} nouveau(x) cas${disparus.length ? `, ${disparus.length} disparu(s)` : ""}.`);
  if (progress.length) console.log(["Progrès (ne fait pas échouer la comparaison) :", ...progress.map((p) => `- ${p}`)].join("\n"));
  if (nouveaux.length) console.log(["Cas sans référence (nouveaux, ne font pas échouer la comparaison) :", ...nouveaux.map((p) => `- ${p}`)].join("\n"));
  if (disparus.length) console.log(["Cas de la référence absents de cette mesure (ignorés) :", ...disparus.map((id) => `- ${id}`)].join("\n"));
  if (regressions.length) {
    console.error(["", "RECUL par rapport à la référence enregistrée :", ...regressions.map((r) => `- ${r}`)].join("\n"));
    process.exit(1);
  }
  console.log("Aucun recul par rapport à la référence.");
}

// Le modèle vit dans un processus à part relié par IPC (src/mcp/embedder.ts) : son canal garde
// le script ouvert jusqu'à dix minutes d'inactivité si on ne l'arrête pas nous-mêmes ici.
if (tool === "tares" || tool === "noga" || tool === "all") {
  const { _resetEmbedderCache } = await import("../src/mcp/embedder.js");
  _resetEmbedderCache();
}
process.exitCode ??= 0;
