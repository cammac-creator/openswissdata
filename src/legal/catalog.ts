import { terms, TERMS_VERSION, type LegalLocale, type LegalDocument } from "./terms-2026-09-26.js";

// Ajouter les futures versions ici sans retirer ni modifier celles déjà acceptées.
export const CURRENT_TERMS_VERSION = TERMS_VERSION;
const versions = new Map<string, Readonly<Record<LegalLocale, LegalDocument>>>([[TERMS_VERSION, terms]]);
export function contractDocument(version: string, locale: string): LegalDocument | undefined {
  if (locale !== "fr" && locale !== "de" && locale !== "en") return undefined;
  return versions.get(version)?.[locale];
}

export function termsPath(locale: LegalLocale, version = CURRENT_TERMS_VERSION): string {
  return `${locale === "fr" ? "" : `/${locale}`}/legal/versions/${version}/cgv`;
}
