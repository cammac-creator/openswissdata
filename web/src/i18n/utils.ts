import fr from "./fr.json";
import de from "./de.json";
import en from "./en.json";

export type Lang = "fr" | "de" | "en";

export const LANGS: Lang[] = ["fr", "de", "en"];

export const LANG_LABELS: Record<Lang, string> = {
  fr: "FR",
  de: "DE",
  en: "EN",
};

export const LANG_NAMES: Record<Lang, string> = {
  fr: "Français",
  de: "Deutsch",
  en: "English",
};

const dictionaries = { fr, de, en } as const;

/**
 * Resolves a dot-path key against the dictionary for the given language.
 * Falls back to FR when missing, then to the key string itself.
 */
export function t(key: string, lang: Lang = "fr"): string {
  const dict = dictionaries[lang] as Record<string, unknown>;
  const fallback = dictionaries.fr as Record<string, unknown>;
  const parts = key.split(".");

  const resolve = (source: Record<string, unknown>): string | undefined => {
    let cur: unknown = source;
    for (const part of parts) {
      if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return typeof cur === "string" ? cur : undefined;
  };

  return resolve(dict) ?? resolve(fallback) ?? key;
}

/**
 * Detects the current language from the URL pathname.
 * `/de/...` => "de", `/en/...` => "en", anything else => "fr".
 */
export function getLangFromPath(pathname: string): Lang {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (seg === "de" || seg === "en") return seg;
  return "fr";
}

/**
 * Builds an absolute path for the given language, preserving the rest of the URL.
 * Examples:
 *   localizePath("/bundle", "de") => "/de/bundle"
 *   localizePath("/de/bundle", "fr") => "/bundle"
 *   localizePath("/de/bundle", "en") => "/en/bundle"
 *   localizePath("/", "de") => "/de/"
 */
export function localizePath(pathname: string, target: Lang): string {
  const current = getLangFromPath(pathname);
  let withoutLang = pathname;
  if (current !== "fr") {
    withoutLang = pathname.replace(new RegExp(`^/${current}`), "") || "/";
  }
  if (target === "fr") return withoutLang;
  if (withoutLang === "/") return `/${target}/`;
  return `/${target}${withoutLang}`;
}

/**
 * Like localizePath but takes an explicit list of locales the path is
 * available in. If the target lang is missing, falls back to the first
 * available lang in priority order: target → de → fr.
 *
 * Used for legal pages (FR + DE only — EN visitors get DE) and similar
 * partial-coverage sections.
 */
export function localizePathOrFallback(
  pathname: string,
  target: Lang,
  available: Lang[],
): string {
  const order: Lang[] = [target, "de", "fr"];
  const chosen = order.find((l) => available.includes(l)) ?? "fr";
  return localizePath(pathname, chosen);
}

/**
 * Returns the list of hreflang alternates for a given pathname.
 * Used to render <link rel="alternate"> tags in <head>.
 */
export function getHreflangAlternates(pathname: string): Array<{ lang: Lang; url: string }> {
  return LANGS.map((lang) => ({ lang, url: localizePath(pathname, lang) }));
}
