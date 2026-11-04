/**
 * Noms d'organisations relus à la main, là où la règle de `parse.ts` ne peut pas conclure.
 * Dépôt public : empreintes seulement, jamais un nom (SHA-256 de `personCheckKey`, 16 caractères).
 * Relevé sur la liste du 04.11.2026 ; un nom absent de ces listes suit la règle, donc sort s'il est pris.
 */
import { createHash } from "node:crypto";

export const reviewHash = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 16);

/** Pris à tort par la règle : mots courants, ou institution qui porte le nom d'un défunt. Gardés et comptés. */
const REVIEWED_NOT_A_PERSON: ReadonlySet<string> = new Set<string>([
  "bb00fe8ee7e067e2", // 9479 : institution, nom d'un défunt
  "d64a31d81d2063a7", // 78529 : institution, nom d'un défunt
  "e9190d7c24477c9b", // 76313 : fondation « named after » un défunt
  "846a65626a34b5a7", // 89553 : banque, mots géographiques
  "e6d4fae65c6ae00b", // 87831 : mots courants, aucun nom
  "cc2f6386d7d11aad", // 87728 : sigle du groupe
  "f1f6d2213d91b8da", // 88151 : groupe, nom d'un défunt
  "a7e69014723b3b7a", // 88151 : même groupe
  "37279797b5e2415c", // 88151 : même groupe, nom d'un défunt
  "d3c39c13f7320c5d", // 88151 : même groupe, nom d'un défunt
]);

/** Portent un nom de personne que la règle ne voit pas. Retirés. */
const REVIEWED_AS_PERSON: ReadonlySet<string> = new Set<string>([
  "e174ff7209696763", // 80387 : autre nom, se lit comme un prénom et un nom
  "ec489507ac33e0f8", // 87380 : autre nom, porte une personne
  "ea58e2249ef26835", // 87380 : autre nom, porte une personne
]);

export const isReviewedNotAPerson = (key: string): boolean => REVIEWED_NOT_A_PERSON.has(reviewHash(key));
export const isReviewedAsPerson = (key: string): boolean => REVIEWED_AS_PERSON.has(reviewHash(key));
