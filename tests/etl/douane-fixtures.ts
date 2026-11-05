/**
 * Fichiers FICTIFS, fabriqués à la volée : aucune donnée de l'OFDF dans ce dépôt. Tarifs du chapitre 99
 * (inexistant), montants inventés. Le mot TEMOIN marque chaque texte qui ne doit jamais sortir.
 */
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import archiver from "archiver";

export const UPDATED = "2026-10-13T12:24:31.816+02:00";

export const DUTIES_HEADER = "Annee;Trimestre;Trimestre_txt;Mois;Mois_txt;Numero_tarif;Numero_tarif_txt;Pays_isoAlpha2;Pays_Num;Pays_Txt;Type_biens_code;Type_biens_txt;Type_de_taux;Genre_taux_code;Genre_taux_txt;Unite_douniere_code;Unite_douniere_txt;Quantite_douniere;Quantite_kg;Valeur_CHF;Valeur_EUR;Valeur_USD;Recettes_douanieres_CHF;Recettes_douanieres_EUR;Recettes_douanieres_USD;Etat;Date_actualisation";
export const TRADE_HEADER = "Direction_trafic;Annee;Trimestre;Trimestre_txt;Mois;Mois_txt;Numero_tarif8;Numero_tarif8_txt;Numero_tarif6;Numero_tarif4;Numero_tarif2;Total_conjoncturel;Total_general;Pays_isoAlpha2;Pays_num;Pays_txt;Unite_supplementaire_code;Unite_supplementaire_txt;Quantite_supplementaire;Quantite_kg;Valeur_CHF;Valeur_EUR;Valeur_USD;Etat;Date_actualisation";

export interface LineFields {
  year?: number;
  month?: number;
  tariff?: string;
  label?: string;
  country?: string;
  countryText?: string;
  kg?: string;
  value?: string;
  duties?: string;
  status?: string;
  updatedAt?: string;
  conjunctural?: string;
}

export function dutiesLine(f: LineFields = {}): string {
  const month = f.month ?? 1;
  return [
    f.year ?? 2025, Math.ceil(month / 3), "1. TEMOIN-trimestre", month, "TEMOIN-mois", f.tariff ?? "9901.0001", f.label ?? "TEMOIN-libelle", f.country ?? "XA", "901",
    f.countryText ?? "TEMOIN-pays", "1", "TEMOIN-biens", "110", "10", "TEMOIN-genre", "206", "TEMOIN-unite", "999.0", f.kg ?? "100.0", f.value ?? "1000.0", "888.0", "777.0",
    f.duties ?? "50.0", "666.0", "555.0", f.status ?? "def", f.updatedAt ?? UPDATED,
  ].join(";");
}

export function tradeLine(direction: "I" | "E", f: LineFields = {}): string {
  const month = f.month ?? 1;
  const tariff = f.tariff ?? "9901.0001";
  return [
    direction, f.year ?? 2025, Math.ceil(month / 3), "1. TEMOIN-trimestre", month, "TEMOIN-mois", tariff, f.label ?? "TEMOIN-libelle", tariff.slice(0, 7), tariff.slice(0, 4), tariff.slice(0, 2),
    f.conjunctural ?? "Oui", "oui", f.country ?? "XA", "901", f.countryText ?? "TEMOIN-pays", "201", "TEMOIN-unite", "", f.kg ?? "100.0", f.value ?? "1000.0", "888.0", "777.0", f.status ?? "def", f.updatedAt ?? "2026-10-13T00:00:00.000+02:00",
  ].join(";");
}

/** Un ZIP réel sur le disque, pour faire passer toute la chaîne de lecture. */
export async function writeZip(path: string, members: { name: string; text: string }[]): Promise<void> {
  const out = createWriteStream(path);
  const zip = archiver("zip");
  zip.pipe(out);
  for (const member of members) zip.append(member.text, { name: member.name });
  await zip.finalize();
  await finished(out);
}
