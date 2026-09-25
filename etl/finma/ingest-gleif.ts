/** Source GLEIF → bronze JSON ; rapprochement argent uniquement par UID exact. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fetchBronze } from "../shared/bronze.js";
import type { FinmaEntity } from "./types.js";

export interface GleifRecord {
  attributes: {
    lei: string;
    entity: {
      registeredAs: string;
      registeredAt?: { id?: string };
      legalAddress?: { addressLines?: string[]; postalCode?: string; city?: string; country?: string; region?: string };
    };
    registration?: { status?: string; lastUpdateDate?: string };
  };
}

export function canonicalUid(value: string): string | undefined {
  const match = value.trim().toUpperCase().replace(/[\u2010-\u2015\u2212]/g, "-").match(/^CHE[- .]?(\d{3})[. ]?(\d{3})[. ]?(\d{3})$/);
  return match ? `CHE-${match[1]}.${match[2]}.${match[3]}` : undefined;
}

export function enrichWithGleif(entities: FinmaEntity[], records: GleifRecord[]) {
  const byUid = new Map<string, Map<string, GleifRecord>>();
  for (const record of records) {
    const a = record.attributes;
    const uid = canonicalUid(a.entity.registeredAs);
    if (!uid || !/^[A-Z0-9]{18}\d{2}$/.test(a.lei)) continue;
    if (!["ISSUED", "LAPSED", "PENDING_TRANSFER", "PENDING_ARCHIVAL"].includes(a.registration?.status ?? "")) continue;
    const entries = byUid.get(uid) ?? new Map<string, GleifRecord>();
    entries.set(a.lei, record); byUid.set(uid, entries);
  }
  let matched = 0;
  const ambiguous = new Set<string>();
  for (const entity of entities) {
    const records = entity.uid ? byUid.get(entity.uid) : undefined;
    if (!records) continue;
    if (records.size !== 1) { ambiguous.add(entity.uid!); continue; }
    const { attributes: a } = [...records.values()][0];
    entity.lei = a.lei;
    entity.lei_source_url = `https://api.gleif.org/api/v1/lei-records/${a.lei}`;
    entity.lei_registration_status = a.registration?.status;
    entity.lei_updated_at = a.registration?.lastUpdateDate;
    const address = a.entity.legalAddress;
    if (address?.country === "CH") {
      entity.address = [...(address.addressLines ?? []), [address.postalCode, address.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      const canton = address.region?.match(/^CH-([A-Z]{2})$/)?.[1];
      if (canton) entity.canton = canton;
      entity.address_source_url = entity.lei_source_url;
    }
    // Le statut juridique GLEIF n'est pas un statut d'autorisation FINMA.
    matched++;
  }
  return { matched, ambiguous_uids: ambiguous.size };
}

export async function ingestGleif(entities: FinmaEntity[], cacheDir: string) {
  const uids = [...new Set(entities.map(e => e.uid).filter((u): u is string => !!u))].sort();
  const records: GleifRecord[] = [];
  for (let offset = 0; offset < uids.length; offset += 50) {
    const batch = uids.slice(offset, offset + 50);
    const key = createHash("sha256").update(batch.join(",")).digest("hex").slice(0, 16);
    const url = new URL("https://api.gleif.org/api/v1/lei-records");
    url.searchParams.set("filter[entity.registeredAs]", batch.join(","));
    url.searchParams.set("page[size]", "200");
    const path = await fetchBronze(url.toString(), cacheDir, `gleif-${key}.json`);
    const result = JSON.parse(readFileSync(path, "utf8")) as { data?: GleifRecord[]; meta?: { pagination?: { total?: number } } };
    if (!Array.isArray(result.data) || (result.meta?.pagination?.total ?? Infinity) !== result.data.length) {
      throw new Error("Réponse GLEIF incomplète : publication annulée");
    }
    for (const record of result.data) {
      if (!batch.includes(canonicalUid(record.attributes.entity.registeredAs) ?? "")) {
        throw new Error("GLEIF a retourné un UID hors du lot demandé");
      }
    }
    records.push(...result.data);
    if (offset % 500 === 0) console.log(`[gleif] ${Math.min(offset + 50, uids.length)}/${uids.length} UID vérifiés`);
  }
  const stats = enrichWithGleif(entities, records);
  if (entities.length >= 2_000 && stats.matched < 100) throw new Error("Couverture GLEIF anormalement faible : publication annulée");
  return stats;
}
