/** Historique local distinct du bundle vendu : aucun appel réseau ni publication. */
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { z } from "zod";
import { computeDelta } from "./delta.js";
import {
  buildMovements, compareRegistry, inheritedMovements, MOVEMENTS_METHOD, MOVEMENT_RULES,
  type MovementsBlock, type MovementsSnapshot, type RegistryKind,
} from "./movements.js";
import { FINMA_BUNDLE_ENTITY_TYPES, type FinmaEntity } from "./types.js";
import { writeCsv, writeJson } from "../shared/formats.js";
import {
  buildSignedProvenance, generateProvenance, sha256OfBuffer,
  type ProvenanceSourceRef,
} from "../shared/provenance.js";

export const HISTORY_START = "2026-07-17";
const DAY = 86_400_000;
const versionPattern = /^\d{4}\.\d{2}\.\d{2}(\.[0-9A-Za-z]+)?$/;
const uidPattern = /^CHE-\d{3}\.\d{3}\.\d{3}$/;
const cantons = new Set("AG AI AR BE BL BS FR GE GL GR JU LU NE NW OW SG SH SO SZ TG TI UR VD VS ZG ZH".split(" "));
const dateOf = (version: string) => version.slice(0, 10).replaceAll(".", "-");
const keyOf = (row: FinmaEntity) => `${row.uid ?? row.name}::${row.entity_type}::${row.licence_type ?? ""}`;
const identityOf = (row: FinmaEntity) => row.uid ?? row.name;
const cantonOf = (row: FinmaEntity) => row.canton && cantons.has(row.canton) ? row.canton : null;
const count = z.number().int().nonnegative();
const version = z.string().regex(versionPattern);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const category = z.string().refine(v => FINMA_BUNDLE_ENTITY_TYPES.includes(v as FinmaEntity["entity_type"]));
const registryCounts = z.object({
  added: count, removed: count, licence_changed: count, name_changed: count,
  city_changed: count, status_changed: count, address_changed: count,
}).strict();
const registry = z.object({
  totals: registryCounts, by_category: z.record(category, registryCounts), reclassified_by_collection: count,
}).strict();
const coverage = { comparisons: count, days_covered: count, complete: z.boolean() };
const warnings = { appeared: count, appeared_late: count, removed: count, removed_possible_url_change: count };
const reason = z.string().regex(/^\d+ (mouvements du registre|apparitions et retraits de la liste d'alerte) pour un seuil de \d+ : changement probable de la collecte, à examiner$/);
const excludedSchema = z.object({
  from: version, to: version, days: count, list: z.enum(["registry", "warnings"]), movements: count, limit: count, reason,
}).strict();
/** Un bloc hérité reste inchangé, mais aucune propriété libre ne peut transporter une identité. */
const movementsSchema = z.object({
  schema_version: z.literal(1), method: z.literal(MOVEMENTS_METHOD),
  rules: z.object({ gap_days: z.literal(2), freeze_day: z.literal(3), anomaly_min_rows: z.literal(30), anomaly_share: z.literal(0.01) }).strict(),
  computed_in_version: version, first_observed: date.nullable(), last_observed: date.nullable(),
  months: z.array(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/), status: z.enum(["open", "frozen"]), frozen_in_version: version.nullable(),
    days_in_month: count, first_observed: date.nullable(), last_observed: date.nullable(), partial: z.boolean(),
    registry: registry.extend(coverage),
    warnings: z.object({ ...warnings, ...coverage, added_dated_in_month: count, added_as_of: version }).strict(),
    excluded: z.array(excludedSchema),
  }).strict()),
  resumptions: z.array(z.object({
    from: version, to: version, days: count, registry, registry_anomaly: reason.nullable(),
    warnings: z.object({
      ...warnings, appeared_by_finma_month: z.record(z.string().regex(/^\d{4}-\d{2}$/), count), appeared_undated: count,
    }).strict().nullable(), warnings_anomaly: reason.nullable(),
  }).strict()), warnings_without_date_added: count.nullable(),
}).strict();

const optionalText = z.string().nullish().transform(v => v ?? undefined);
const entitySchema = z.object({
  entity_type: category, name: z.string().min(1), uid: optionalText, licence_type: optionalText,
  city: optionalText, canton: optionalText, status: optionalText, address: optionalText,
  address_source_url: optionalText, source_list: z.string(), source_url: z.string(),
});
const warningSchema = z.object({
  name: z.string(), source_url: z.string().min(1), source_list: z.literal("finma-warnings"),
  warning_type: z.string(), date_added: optionalText,
});

/** Erreurs fixes : ne jamais recopier le contenu d'une ligne dans un journal. */
export function validateHistorySnapshot(input: MovementsSnapshot): MovementsSnapshot {
  if (!versionPattern.test(input.version) || !Number.isFinite(Date.parse(dateOf(input.version)))
    || new Date(dateOf(input.version)).toISOString().slice(0, 10) !== dateOf(input.version)) {
    throw new Error("Version historique invalide");
  }
  const entities = z.array(entitySchema).safeParse(input.entities);
  const warningRows = input.warnings === undefined ? undefined : z.array(warningSchema).safeParse(input.warnings);
  if (!entities.success || (warningRows && !warningRows.success)) throw new Error(`Données historiques illisibles : ${input.version}`);
  return {
    version: input.version, entities: entities.data as FinmaEntity[],
    warnings: warningRows?.success ? warningRows.data : undefined, quality: input.quality,
  };
}

interface DetailedChange { kind: RegistryKind | "canton_changed"; before?: FinmaEntity; after?: FinmaEntity }

/** Même calcul et même appariement que compareRegistry ; vérification croisée à chaque comparaison. */
function detailedChanges(before: FinmaEntity[], after: FinmaEntity[]) {
  const comparable = (rows: FinmaEntity[]) => rows.map(r => ({
    ...r, name: r.name.replaceAll('"', ""), address: r.address_source_url ? undefined : r.address,
  }));
  const previous = comparable(before), current = comparable(after);
  const changes: DetailedChange[] = [];
  const added = new Map<string, FinmaEntity[]>(), removed = new Map<string, FinmaEntity[]>();
  for (const c of computeDelta(previous, current).changes) {
    const row = c.kind === "added" ? c.after : c.kind === "removed" ? c.before : undefined;
    if (!row) continue;
    const map = c.kind === "added" ? added : removed;
    const id = identityOf(row as FinmaEntity);
    map.set(id, [...(map.get(id) ?? []), row as FinmaEntity]);
  }
  let reclassified = 0;
  for (const [id, appearing] of added) {
    const disappearing = removed.get(id) ?? [];
    const paired = new Set<FinmaEntity>();
    for (const label of new Set(appearing.map(r => r.licence_type ?? ""))) {
      const a = appearing.filter(r => (r.licence_type ?? "") === label);
      const b = disappearing.filter(r => (r.licence_type ?? "") === label);
      if (a.length === 1 && b.length === 1) { reclassified++; paired.add(a[0]).add(b[0]); }
    }
    const a = appearing.filter(r => !paired.has(r)), b = disappearing.filter(r => !paired.has(r));
    if (a.length === 1 && b.length === 1) {
      changes.push({ kind: "licence_changed", before: b[0], after: a[0] });
      paired.add(a[0]).add(b[0]);
    }
    for (const row of appearing) if (!paired.has(row)) changes.push({ kind: "added", after: row });
    removed.set(id, disappearing.filter(r => !paired.has(r)));
  }
  for (const rows of removed.values()) for (const row of rows) changes.push({ kind: "removed", before: row });
  const previousMap = new Map(previous.map(r => [keyOf(r), r]));
  for (const row of new Map(current.map(r => [keyOf(r), r])).values()) {
    const old = previousMap.get(keyOf(row));
    if (!old) continue;
    // La comparaison unitaire conserve l'autorisation exacte, absente des deltas partiels de computeDelta.
    for (const c of computeDelta([old], [row]).changes) changes.push({ kind: c.kind, before: old, after: row });
    // Le canton GLEIF est un enrichissement, jamais un mouvement FINMA. Le canton seul
    // n'est pas suivi par computeDelta : son complément est séparé des totaux de la vitrine.
    if (!old.address_source_url && !row.address_source_url && cantonOf(old) !== cantonOf(row)) {
      changes.push({ kind: "canton_changed", before: old, after: row });
    }
  }
  const expected = compareRegistry(before, after);
  for (const kind of Object.keys(expected.totals) as RegistryKind[]) {
    if (changes.filter(c => c.kind === kind).length !== expected.totals[kind]) throw new Error("Divergence avec les mouvements du registre");
  }
  if (reclassified !== expected.reclassified_by_collection) throw new Error("Divergence des reclassements du registre");
  return { changes, reclassified, expected };
}

export interface HistoryOptions {
  /** IDE exacts du fichier finma_seats.csv ; aucune déduction par nom ou catégorie. */
  allowedUids: ReadonlySet<string>;
  includeWithdrawnNames?: boolean;
}

function projectEntity(row: FinmaEntity | undefined) {
  if (!row) return null;
  return {
    name: row.name, entity_type: row.entity_type, licence_type: row.licence_type ?? null,
    city: row.city ?? null, canton: cantonOf(row),
    canton_source: cantonOf(row) === null ? null : row.address_source_url ? "GLEIF" : "FINMA",
  };
}

/** Calcul pur : n'expose jamais les lignes brutes ni les identités filtrées. */
export function buildFullHistory(input: MovementsSnapshot[], options: HistoryOptions) {
  const snapshots = input.map(validateHistorySnapshot).filter(s => dateOf(s.version) >= HISTORY_START)
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  if (snapshots.length === 0) throw new Error("Aucun relevé depuis le 17.07.2026");
  if (new Set(snapshots.map(s => s.version)).size !== snapshots.length) throw new Error("Version historique en double");
  const current = snapshots.at(-1)!;
  const inherited = inheritedMovements(snapshots);
  // Si la dernière archive porte déjà son bloc, elle fait foi même pour le mois ouvert.
  const rawMovements = inherited?.version === current.version ? inherited.block
    : buildMovements(snapshots.slice(0, -1), current);
  const checked = movementsSchema.safeParse(rawMovements);
  if (!checked.success) throw new Error("Bloc des mouvements illisible ou contenant des champs non autorisés");
  const movements: MovementsBlock = checked.data;
  // Totaux distincts sur toute la période pour la liste d'alerte, comme le détail
  // complet du registre. Le bloc hérité de la vitrine n'est jamais remplacé.
  const fullPeriod = buildMovements(snapshots.slice(0, -1).map(s => ({ ...s, quality: undefined })), { ...current, quality: undefined });
  const warningMonthly = fullPeriod.months.map(m => ({ month: m.month, ...m.warnings }));
  const stillListed = new Set(current.entities.map(r => r.uid).filter((id): id is string => !!id));
  const includeWithdrawnNames = options.includeWithdrawnNames === true;
  const named = [] as Array<{
    observed_at: string; previous_version: string; version: string; kind: DetailedChange["kind"];
    uid: string; before: ReturnType<typeof projectEntity>; after: ReturnType<typeof projectEntity>;
  }>;
  const groups = new Map<string, {
    month: string; kind: DetailedChange["kind"]; entity_type: string; canton: string | null;
    canton_source: string | null; total: number; named: number; totals_only: number;
  }>();
  const observations = [] as Array<{
    version: string; observed_at: string; previous_version: string | null; days: number;
    registry_rows: number; warning_rows: number | null;
    registry_status: "baseline" | "counted" | "excluded" | "resumption";
    warnings_status: "baseline" | "counted" | "excluded" | "resumption" | "unavailable";
    registry_movements: number; reclassified_by_collection: number; canton_changes: number;
  }>;
  const excluded = [] as z.infer<typeof excludedSchema>[];
  for (let i = 0; i < snapshots.length; i++) {
    const after = snapshots[i], before = snapshots[i - 1];
    const observed = dateOf(after.version);
    if (!before) {
      observations.push({ version: after.version, observed_at: observed, previous_version: null, days: 0,
        registry_rows: after.entities.length, warning_rows: after.warnings?.length ?? null,
        registry_status: "baseline", warnings_status: after.warnings ? "baseline" : "unavailable",
        registry_movements: 0, reclassified_by_collection: 0, canton_changes: 0 });
      continue;
    }
    const days = (Date.parse(observed) - Date.parse(dateOf(before.version))) / DAY;
    // Réutilise les seuils, reprises et exclusions du calcul de la vitrine, sans hériter de mois figés.
    const pair = buildMovements([{ ...before, quality: undefined }], { ...after, quality: undefined });
    const omissions = pair.months.flatMap(m => m.excluded);
    excluded.push(...omissions);
    const resumption = days > MOVEMENT_RULES.gap_days;
    const registryExcluded = omissions.some(e => e.list === "registry");
    const warningExcluded = omissions.some(e => e.list === "warnings");
    const detail = detailedChanges(before.entities, after.entities);
    observations.push({ version: after.version, observed_at: observed, previous_version: before.version, days,
      registry_rows: after.entities.length, warning_rows: after.warnings?.length ?? null,
      registry_status: resumption ? "resumption" : registryExcluded ? "excluded" : "counted",
      warnings_status: !before.warnings || !after.warnings ? "unavailable" : resumption ? "resumption" : warningExcluded ? "excluded" : "counted",
      registry_movements: Object.values(detail.expected.totals).reduce((a, b) => a + b, 0),
      reclassified_by_collection: detail.reclassified,
      canton_changes: detail.changes.filter(c => c.kind === "canton_changed").length });
    // Les reprises ne livrent que leurs totaux ; aucun détail daté artificiellement pendant le trou.
    if (resumption || registryExcluded) continue;
    for (const change of detail.changes) {
      const row = (change.after ?? change.before)!;
      const uid = row.uid;
      const eligible = !!uid && uidPattern.test(uid) && options.allowedUids.has(uid)
        && (includeWithdrawnNames || (change.kind !== "removed" && stillListed.has(uid)));
      const group = {
        month: observed.slice(0, 7), kind: change.kind, entity_type: row.entity_type,
        canton: cantonOf(row), canton_source: projectEntity(row)!.canton_source,
      };
      const key = JSON.stringify(group);
      const tally = groups.get(key) ?? { ...group, total: 0, named: 0, totals_only: 0 };
      tally.total++; tally[eligible ? "named" : "totals_only"]++;
      groups.set(key, tally);
      if (eligible) named.push({
        observed_at: observed, previous_version: before.version, version: after.version,
        kind: change.kind, uid, before: projectEntity(change.before), after: projectEntity(change.after),
      });
    }
  }
  const monthly = [...groups.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // La couverture complète peut précéder un mois figé de la vitrine ; rendre l'écart explicite.
  const reconciliation = movements.months.map(m => {
    const full = Object.fromEntries(Object.keys(m.registry.totals).map(kind => [kind,
      monthly.filter(r => r.month === m.month && r.kind === kind).reduce((n, r) => n + r.total, 0),
    ])) as Record<RegistryKind, number>;
    const warningFull = warningMonthly.find(w => w.month === m.month);
    return { month: m.month, full_history: full, storefront: m.registry.totals,
      difference: Object.fromEntries(Object.entries(full).map(([kind, n]) => [kind, n - m.registry.totals[kind as RegistryKind]])),
      warnings_difference: warningFull ? {
        appeared: warningFull.appeared - m.warnings.appeared,
        removed: warningFull.removed - m.warnings.removed,
        added_dated_in_month: warningFull.added_dated_in_month - m.warnings.added_dated_in_month,
      } : null,
    };
  });
  return {
    schema_version: 1, version: current.version,
    policy: { include_withdrawn_names: includeWithdrawnNames, exact_uid_only: true, warnings_totals_only: true },
    coverage: {
      requested_from: HISTORY_START, available_from: dateOf(snapshots[0].version), available_until: dateOf(current.version),
      versions: snapshots.length, observed_days: new Set(observations.map(r => r.observed_at)).size,
      registry_days_covered: new Set(observations.filter(r => r.registry_status === "counted").map(r => r.observed_at)).size,
      warning_days_covered: new Set(observations.filter(r => r.warnings_status === "counted").map(r => r.observed_at)).size,
    },
    history: { movements }, named, monthly, warningMonthly, observations, excluded, reconciliation,
  };
}

export type FullHistory = ReturnType<typeof buildFullHistory>;

function readme(history: FullHistory, signed: boolean): string {
  return `# Historique complet FINMA — ${history.version}

## Français
Archive de préparation, sans mise en vente. Ceci n'est pas une publication officielle de la FINMA.
OpenSwissData est indépendant de la FINMA. Source : listes publiques FINMA relevées par OpenSwissData.
Période effectivement lue : ${history.coverage.available_from} → ${history.coverage.available_until}.
Les dates sont des dates d'OBSERVATION, jamais des dates de décision FINMA. Une disparition n'est pas une sanction.
Le premier relevé est une référence, pas une série d'apparitions. Aucun relevé ni mouvement n'est inventé.
Le trou connu du 24.08 au 25.09.2026 reste une reprise séparée dans history.movements.resumptions.
Toute comparaison de plus de deux jours reste en totaux de reprise ; les comparaisons anormales sont exclues et listées.
Un reclassement de notre collecte n'est pas un mouvement. Les guillemets des noms sont neutralisés comme dans la vitrine.

Seules les personnes morales dont l'IDE correspond EXACTEMENT à finma_seats.csv peuvent être nommées.
Ce filtre vient de la liste blanche des formes juridiques LINDAS ; les personnes physiques, les IDE absents
et les formes inconnues restent en totaux. La catégorie asset_manager_individual n'indique pas la forme juridique.
${history.policy.include_withdrawn_names ? "Option de retraits nommés activée explicitement, toujours sous le filtre IDE." : "Retraits jamais nommés : totaux par mois, catégorie d'autorisation et canton. Les mouvements d'une entité absente du dernier relevé restent aussi en totaux."}
La liste d'alerte ne contient que des nombres, jamais un nom, un IDE ou une adresse de page de détail.
Les ajouts FINMA datés (added_dated_in_month) se distinguent des apparitions observées (appeared).
Les changements d'adresse et de statut sont comptés comme dans la vitrine, mais leurs valeurs ne sont pas livrées.
Les cantons restent ceux du relevé, sans déduction ni remplissage rétroactif : null = inconnu.
canton_source distingue FINMA de GLEIF ; un enrichissement GLEIF n'est jamais un changement de canton FINMA.
Les seuls changements de canton FINMA sont un complément canton_changed, séparé des sept compteurs de la vitrine.
Aucun OS (LEFin) ni affiliation OAR (LBA) n'est livré par cette archive.

## English
Preparation archive, not offered for sale. This is not an official FINMA publication.
OpenSwissData is independent of FINMA. Source: FINMA public lists observed by OpenSwissData.
Dates are OBSERVATION dates, never FINMA decision dates. A disappearance does not establish a sanction.
The first snapshot is a baseline. The known 24 August–25 September 2026 gap is a separate resumption;
no missing days are reconstructed. Gaps over two days and abnormal comparisons do not enter monthly movements.
Collection reclassifications are not movements. Quotes in names are normalised as in the storefront calculation.
Only legal entities with an EXACT UID in finma_seats.csv can be named. Natural persons, missing UIDs and
unknown legal forms appear only in totals. This whitelist is based on LINDAS legal forms, not FINMA categories.
${history.policy.include_withdrawn_names ? "Withdrawn names were explicitly enabled, still subject to the UID whitelist." : "Withdrawals have no names, only monthly totals by authorisation category and canton. Entities absent from the latest snapshot also remain in totals for all their movements."}
The warning list is totals only: no names, UIDs or detail page URLs. FINMA-dated additions differ from observed appearances.
Address and status changes are counted without their values. Canton null means unknown; no historical backfill.
Canton sources distinguish FINMA from GLEIF; enrichment is not a FINMA movement. Canton-only FINMA changes
are supplementary and do not alter the seven storefront counters. No supervisory organisation or SRO affiliation is included.

## Fichiers / Files
- registry_movements.csv/json : mouvements nommables, avant/après limités aux champs autorisés / eligible named changes.
- registry_monthly.csv/json : tous les mouvements comptés depuis le début, named + totals_only = total ; canton_changed séparé.
- warnings_monthly.csv/json : totaux de la liste d'alerte sur toute la période lue / warning totals over the full observed period.
- movements.json : history.movements identique au bloc de la dernière archive quand présent ; mois figés et reprises conservés.
- movements_monthly.csv : mêmes agrégats mensuels, sous-objets encodés en JSON / same monthly aggregates, JSON-encoded nested cells.
- observations.csv/json : chaque version et son statut, y compris jours sans mouvement / every version, including zero-movement days.
- exclusions.csv/json : comparaisons anormales recalculées sur toute la période / abnormal comparisons across the full period.
- reconciliation.json : écarts entre détail complet et mois de vitrine figés sur une fenêtre plus courte ; aucun mois figé n'est réécrit.
- quality.json : couverture, politique et nombres seulement / coverage, policy and counts only.
- checksums.sha256, provenance.json : empreintes de chaque fichier / file hashes.

Les cellules imbriquées des CSV sont du JSON ; un CSV vide indique zéro ligne. Lire les CSV comme du texte.
Frozen storefront months may cover a shorter period than the full detail; reconciliation.json records the difference without rewriting them.
Sources: https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/
https://www.finma.ch/en/finma-public/warnungen/warning-list/
https://register.ld.admin.ch/query (filtre de personnes morales / legal-entity filter)
https://www.gleif.org/en/lei-data/gleif-api (cantons enrichis identifiés / labelled enriched cantons)

${signed ? "Manifeste signé avec la clé explicitement fournie, sans horodatage RFC-3161 (essai local). / Explicit-key signature, no RFC-3161 timestamp (local test)." : "MANIFESTE NON SIGNÉ. Aucune clé lue, aucun horodatage distant demandé. / UNSIGNED MANIFEST. No key read, no remote timestamp requested."}
La signature utilise le JSON canonique à clés triées (rfc8785-like), hors signature et timestamp_authority.
Canonical signature payload: sorted-key JSON (rfc8785-like), excluding signature and timestamp_authority.
Ce manifeste ne constitue pas une nouvelle autorisation de redistribution de l'historique ou des retraits.
This manifest does not establish new permission to redistribute historical or withdrawn entries.
`;
}

/** Sortie explicite dans un dossier local ; clés de test uniquement passées à l'appel. */
export async function writeFullHistoryArchive(history: FullHistory, outDir: string, options: {
  signing?: { privateKeyBase64: string; publicKeyPem: string };
  inputs?: { version: string; size_bytes: number; sha256: string }[];
  seatsSha256?: string;
} = {}) {
  if (options.signing && (!options.signing.privateKeyBase64 || !options.signing.publicKeyPem)) {
    throw new Error("Deux clés explicites sont obligatoires pour signer un essai");
  }
  mkdirSync(outDir, { recursive: true });
  const workDir = mkdtempSync(join(outDir, ".historique-"));
  const files: string[] = [];
  const saveJson = (name: string, value: unknown) => { writeJson(value, join(workDir, name)); files.push(name); };
  const table = (name: string, rows: object[]) => {
    saveJson(`${name}.json`, rows);
    writeCsv(rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) =>
      [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]))), join(workDir, `${name}.csv`));
    files.push(`${name}.csv`);
  };
  const zipPath = join(outDir, `finma-historique-complet-${history.version}.zip`);
  try {
    table("registry_movements", history.named);
    table("registry_monthly", history.monthly);
    table("warnings_monthly", history.warningMonthly);
    table("observations", history.observations);
    table("exclusions", history.excluded);
    saveJson("movements.json", history.history);
    writeCsv(history.history.movements.months.map(m => ({
      ...m, registry: JSON.stringify(m.registry), warnings: JSON.stringify(m.warnings), excluded: JSON.stringify(m.excluded),
    })), join(workDir, "movements_monthly.csv"));
    files.push("movements_monthly.csv");
    saveJson("reconciliation.json", history.reconciliation);
    saveJson("quality.json", {
      schema_version: history.schema_version, policy: history.policy, coverage: history.coverage,
      named_movements: history.named.length, totals_only_movements: history.monthly.reduce((n, r) => n + r.totals_only, 0),
      signing: options.signing ? "explicit_key_without_timestamp" : "unsigned",
      seats_sha256: options.seatsSha256 ?? null, inputs: options.inputs ?? [],
    });
    writeFileSync(join(workDir, "README.md"), readme(history, !!options.signing), "utf8");
    files.push("README.md");
    writeFileSync(join(workDir, "checksums.sha256"), files.map(f => `${sha256OfBuffer(readFileSync(join(workDir, f)))}  ${f}`).join("\n") + "\n");
    files.push("checksums.sha256");
    const sources: ProvenanceSourceRef[] = [
      { id: "finma-public-lists", institution: "FINMA", url: "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/" },
      { id: "finma-warning-list", institution: "FINMA", url: "https://www.finma.ch/en/finma-public/warnungen/warning-list/" },
      { id: "lindas-legal-entity-filter", institution: "OFRC / LINDAS", url: "https://register.ld.admin.ch/query" },
      { id: "gleif-canton", institution: "GLEIF", url: "https://www.gleif.org/en/lei-data/gleif-api" },
    ].map(s => ({ ...s, permission_reference: "LOCAL-PREPARATION-NO-PUBLICATION", permission_authority: s.institution, jurisdiction: "Switzerland" }));
    const args = {
      dataset: "finma-historique-complet", version: history.version, sourceUrl: sources[0].url, sources,
      permissionReference: "LOCAL-PREPARATION-NO-PUBLICATION", permissionAuthority: "FINMA — portée historique en attente", jurisdiction: "Switzerland",
      files: files.map(name => { const bytes = readFileSync(join(workDir, name)); return { name, size: bytes.length, sha256: sha256OfBuffer(bytes) }; }),
    };
    const manifest = options.signing ? await buildSignedProvenance({ ...args, signing: options.signing, withTimestamp: false }) : generateProvenance(args);
    saveJson("provenance.json", manifest);
    // Création exclusive : ne remplace jamais une archive déjà produite.
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath, { flags: "wx" });
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("error", error => { archive.abort(); reject(error); });
      archive.on("error", error => { output.destroy(); reject(error); });
      archive.on("warning", error => { archive.abort(); output.destroy(); reject(error); });
      output.on("close", resolve);
      archive.pipe(output);
      for (const name of [...files].sort()) archive.file(join(workDir, name), { name });
      void archive.finalize().catch(reject);
    });
    const bytes = readFileSync(zipPath);
    return { zipPath, sizeBytes: bytes.length, sha256: sha256OfBuffer(bytes), files: [...files].sort(), signed: !!options.signing };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
