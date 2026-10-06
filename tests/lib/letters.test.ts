import { describe, it, expect } from "vitest";
import {
  ALLOWED_RECIPIENT_DOMAINS,
  isAllowedRecipient,
  easterSunday,
  isSwissFederalHoliday,
  isSwissBusinessDay,
  scheduleSlot,
  toZurichParts,
} from "../../src/lib/letters.js";

// --- Horloge Zurich indépendante de l'implémentation, pour construire les
// `now` de test et décoder les résultats sans réutiliser le code sous test.

function zurichOffsetHours(utcGuessMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", timeZoneName: "shortOffset" });
  const part = dtf.formatToParts(new Date(utcGuessMs)).find((p) => p.type === "timeZoneName")!.value;
  const match = /GMT([+-]\d+)/.exec(part);
  return match ? Number(match[1]) : 0;
}

/** Construit l'instant epoch (ms) correspondant à une heure murale de Zurich. */
function zurichEpoch(year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  return guess - zurichOffsetHours(guess) * 3_600_000;
}

function decodeZurich(ms: number): { year: number; month: number; day: number; hour: number; minute: number; weekday: string } {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) if (part.type !== "literal") map[part.type] = part.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour, minute: Number(map.minute), weekday: map.weekday };
}

describe("isAllowedRecipient", () => {
  it("accepte les domaines de la liste fermée et leurs sous-domaines", () => {
    expect(ALLOWED_RECIPIENT_DOMAINS).toEqual(["admin.ch", "finma.ch", "un.org", "gleif.org"]);
    expect(isAllowedRecipient("boite-fictive@admin.ch")).toBe(true);
    expect(isAllowedRecipient("boite-fictive@seco.admin.ch")).toBe(true);
    expect(isAllowedRecipient("boite-fictive@fosc.seco.admin.ch")).toBe(true); // sous-sous-domaine
    expect(isAllowedRecipient("boite-fictive@finma.ch")).toBe(true);
    expect(isAllowedRecipient("boite-fictive@un.org")).toBe(true);
    expect(isAllowedRecipient("boite-fictive@gleif.org")).toBe(true);
  });

  it("la comparaison de domaine est insensible à la casse", () => {
    expect(isAllowedRecipient("Boite-Fictive@SECO.ADMIN.CH")).toBe(true);
  });

  it("refuse un domaine hors liste", () => {
    expect(isAllowedRecipient("boite-fictive@example.com")).toBe(false);
  });

  it("refuse les imitations de domaine", () => {
    expect(isAllowedRecipient("boite-fictive@admin.ch.example.com")).toBe(false);
    expect(isAllowedRecipient("boite-fictive@xadmin.ch")).toBe(false);
    expect(isAllowedRecipient("boite-fictive@notadmin.ch")).toBe(false);
  });

  it("refuse les adresses à plusieurs « @ »", () => {
    expect(isAllowedRecipient("a@b@admin.ch")).toBe(false);
    expect(isAllowedRecipient("a@admin.ch,b@evil.com")).toBe(false);
  });

  it("refuse les espaces et caractères de contrôle", () => {
    expect(isAllowedRecipient("boite fictive@admin.ch")).toBe(false);
    expect(isAllowedRecipient("boite-fictive@admin.ch\n")).toBe(false);
    expect(isAllowedRecipient("boite-fictive@admin.ch\t")).toBe(false);
    expect(isAllowedRecipient('"FINMA" <boite-fictive@finma.ch>')).toBe(false);
  });

  it("refuse les labels de domaine vides et le point final", () => {
    expect(isAllowedRecipient("x@.admin.ch")).toBe(false);
    expect(isAllowedRecipient("x@a..admin.ch")).toBe(false);
    expect(isAllowedRecipient("x@admin.ch.")).toBe(false);
  });

  it("refuse un caractère non-ASCII ressemblant (ex. а cyrillique)", () => {
    expect(isAllowedRecipient("x@аdmin.ch")).toBe(false); // а U+0430, pas 'a' U+0061
  });

  it("refuse une chaîne vide ou un type non-string", () => {
    expect(isAllowedRecipient("")).toBe(false);
    // @ts-expect-error -- test délibéré d'une entrée invalide
    expect(isAllowedRecipient(undefined)).toBe(false);
  });
});

describe("easterSunday (Meeus/Jones/Butcher)", () => {
  it("2026 : 5 avril", () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
  });
  it("2027 : 28 mars", () => {
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
  });
});

describe("isSwissFederalHoliday / isSwissBusinessDay", () => {
  it("1er et 2 janvier 2026 sont fériés", () => {
    expect(isSwissFederalHoliday(2026, 1, 1)).toBe(true);
    expect(isSwissFederalHoliday(2026, 1, 2)).toBe(true);
  });

  it("Vendredi saint et lundi de Pâques 2026 (dérivés de Pâques) sont fériés, un jour ouvrable l'encadre", () => {
    // Pâques 2026 = 5 avril (dimanche).
    expect(decodeZurich(zurichEpoch(2026, 4, 2, 12, 0)).weekday).toBe("Thu");
    expect(isSwissFederalHoliday(2026, 4, 2)).toBe(false); // jeudi avant, jour ouvrable
    expect(decodeZurich(zurichEpoch(2026, 4, 3, 12, 0)).weekday).toBe("Fri");
    expect(isSwissFederalHoliday(2026, 4, 3)).toBe(true); // Vendredi saint
    expect(decodeZurich(zurichEpoch(2026, 4, 6, 12, 0)).weekday).toBe("Mon");
    expect(isSwissFederalHoliday(2026, 4, 6)).toBe(true); // lundi de Pâques
  });

  it("Ascension et lundi de Pentecôte 2026 (Pâques + 39 et + 50 jours)", () => {
    expect(decodeZurich(zurichEpoch(2026, 5, 14, 12, 0)).weekday).toBe("Thu");
    expect(isSwissFederalHoliday(2026, 5, 14)).toBe(true); // Ascension
    expect(decodeZurich(zurichEpoch(2026, 5, 25, 12, 0)).weekday).toBe("Mon");
    expect(isSwissFederalHoliday(2026, 5, 25)).toBe(true); // lundi de Pentecôte
  });

  it("1er août, 25 et 26 décembre 2026 sont fériés (même un samedi)", () => {
    expect(isSwissFederalHoliday(2026, 8, 1)).toBe(true);
    expect(isSwissFederalHoliday(2026, 12, 25)).toBe(true);
    expect(isSwissFederalHoliday(2026, 12, 26)).toBe(true);
  });

  it("2027 : Vendredi saint le 26 mars, lundi de Pâques le 29 mars", () => {
    expect(isSwissFederalHoliday(2027, 3, 26)).toBe(true);
    expect(isSwissFederalHoliday(2027, 3, 29)).toBe(true);
  });

  it("isSwissBusinessDay exclut week-ends et jours fériés, inclut le reste", () => {
    expect(decodeZurich(zurichEpoch(2026, 4, 4, 12, 0)).weekday).toBe("Sat");
    expect(isSwissBusinessDay(2026, 4, 4)).toBe(false); // samedi
    expect(isSwissBusinessDay(2026, 4, 3)).toBe(false); // Vendredi saint
    expect(isSwissBusinessDay(2026, 4, 2)).toBe(true); // jeudi ouvrable
    expect(isSwissBusinessDay(2026, 4, 7)).toBe(true); // mardi ouvrable après le week-end pascal
  });
});

describe("scheduleSlot", () => {
  it("retient un créneau dans la fenêtre, jamais multiple de 5, pour un balayage de rng", () => {
    const now = zurichEpoch(2026, 6, 10, 9, 0); // mercredi, jour ouvrable, dans la fenêtre
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const slot = scheduleSlot(now, [], () => r);
      const z = toZurichParts(slot);
      expect(z.minuteOfDay % 5).not.toBe(0);
      expect(z.minuteOfDay).toBeGreaterThanOrEqual(9 * 60 + 5);
      expect(z.minuteOfDay).toBeLessThanOrEqual(17 * 60 + 30);
      expect(slot).toBeGreaterThan(now);
    }
  });

  it("un week-end : rien ne part, le prochain jour ouvré reçoit le créneau", () => {
    // Samedi 2026-06-13.
    expect(decodeZurich(zurichEpoch(2026, 6, 13, 10, 0)).weekday).toBe("Sat");
    const now = zurichEpoch(2026, 6, 13, 10, 0);
    const slot = scheduleSlot(now, [], () => 0);
    const z = toZurichParts(slot);
    expect(`${z.year}-${z.month}-${z.day}`).toBe("2026-6-15"); // lundi suivant
  });

  it("un jour férié : le créneau saute au jour ouvré suivant (semaine pascale 2026)", () => {
    // Jeudi 2 avril 17:31 (CEST, UTC+2) : fenêtre fermée pour aujourd'hui ; Vendredi saint (3),
    // le week-end (4-5) et le lundi de Pâques (6) sont tous sautés → mardi 7 avril.
    const now = zurichEpoch(2026, 4, 2, 17, 31);
    const slot = scheduleSlot(now, [], () => 0);
    const z = toZurichParts(slot);
    expect(`${z.year}-${z.month}-${z.day}`).toBe("2026-4-7");
    expect(z.minuteOfDay).toBe(9 * 60 + 6); // rng()=0 → première minute valide, 09:06
  });

  it("17:31 Zurich : rien ne part aujourd'hui, même constat en hiver et en été (DST)", () => {
    const winterLate = scheduleSlot(zurichEpoch(2026, 1, 15, 17, 31), [], () => 0); // jeudi, hiver (UTC+1)
    expect(`${decodeZurich(winterLate).day}`).not.toBe("15");
    expect(decodeZurich(winterLate).day).toBe(16); // vendredi suivant

    const summerLate = scheduleSlot(zurichEpoch(2026, 7, 16, 17, 31), [], () => 0); // jeudi, été (UTC+2)
    expect(decodeZurich(summerLate).day).toBe(17); // vendredi suivant
  });

  it("09:00 Zurich : il reste de la place aujourd'hui, en hiver et en été", () => {
    const winterEarly = scheduleSlot(zurichEpoch(2026, 1, 15, 9, 0), [], () => 0);
    expect(decodeZurich(winterEarly).day).toBe(15);
    expect(decodeZurich(winterEarly).hour * 60 + decodeZurich(winterEarly).minute).toBe(9 * 60 + 6);

    const summerEarly = scheduleSlot(zurichEpoch(2026, 7, 16, 9, 0), [], () => 0);
    expect(decodeZurich(summerEarly).day).toBe(16);
  });

  it("jamais dans le passé : le créneau choisi est strictement après `now`", () => {
    const now = zurichEpoch(2026, 6, 10, 17, 0); // peu de marge avant la fin de fenêtre
    const slot = scheduleSlot(now, [], () => 0.999999);
    expect(slot).toBeGreaterThan(now);
  });

  it("écart minimal de 12 minutes : 11 min refusé, 12 min accepté (lettre existante à 10:00)", () => {
    // now = 09:48 → la première minute testée est 09:49 ; la lettre existante est à 10:00
    // (600 min). 09:49..10:11 sont tous à moins de 12 min de 600 et donc exclus ; 10:12
    // (612 min, écart exact de 12) est la première minute valide.
    const now = zurichEpoch(2026, 6, 10, 9, 48);
    const existingAt1000 = zurichEpoch(2026, 6, 10, 10, 0);
    const slot = scheduleSlot(now, [existingAt1000], () => 0);
    const z = toZurichParts(slot);
    expect(z.minuteOfDay).toBe(10 * 60 + 12);
  });

  it("un jour déjà saturé (5 lettres) reporte la 6e au jour ouvré suivant", () => {
    const now = zurichEpoch(2026, 6, 10, 9, 0); // mercredi
    const fiveSlots = [0, 1, 2, 3, 4].map((i) => zurichEpoch(2026, 6, 10, 10 + i, 0));
    const slot = scheduleSlot(now, fiveSlots, () => 0);
    const z = toZurichParts(slot);
    expect(`${z.year}-${z.month}-${z.day}`).not.toBe("2026-6-10");
    expect(`${z.year}-${z.month}-${z.day}`).toBe("2026-6-11"); // jeudi, jour ouvrable suivant
  });

  it("des lettres planifiées un autre jour ne comptent pas pour le plafond du jour courant", () => {
    const now = zurichEpoch(2026, 6, 10, 9, 0);
    const otherDay = [0, 1, 2, 3, 4].map((i) => zurichEpoch(2026, 6, 11, 10 + i, 0)); // le lendemain
    const slot = scheduleSlot(now, otherDay, () => 0);
    const z = toZurichParts(slot);
    expect(`${z.year}-${z.month}-${z.day}`).toBe("2026-6-10"); // aujourd'hui, pas saturé
  });

  it("une fin de journée très occupée (aucune minute valide dans le reste de la fenêtre) reporte au jour suivant", () => {
    // Il reste 10 min avant 17:30 (17:20 → fenêtre jusqu'à 17:30), mais une lettre est déjà
    // à 17:20 : tout le reste de la fenêtre est à moins de 12 min de 17:20.
    const now = zurichEpoch(2026, 6, 10, 17, 20);
    const existingAt1720 = zurichEpoch(2026, 6, 10, 17, 20);
    const slot = scheduleSlot(now, [existingAt1720], () => 0);
    const z = toZurichParts(slot);
    expect(`${z.year}-${z.month}-${z.day}`).not.toBe("2026-6-10");
  });

  it("l'ordre des jours est respecté : la 6e lettre déposée successivement atterrit plus tard que les cinq premières", () => {
    const now = zurichEpoch(2026, 6, 10, 9, 0);
    let scheduled: number[] = [];
    let firstDayKey = "";
    for (let i = 0; i < 6; i++) {
      const slot = scheduleSlot(now, scheduled, () => 0);
      const z = toZurichParts(slot);
      const dayKey = `${z.year}-${z.month}-${z.day}`;
      if (i === 0) firstDayKey = dayKey;
      if (i === 5) expect(dayKey > firstDayKey).toBe(true);
      scheduled = [...scheduled, slot];
    }
  });
});
