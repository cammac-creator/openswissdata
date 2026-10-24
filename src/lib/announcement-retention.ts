// Effacement des inscriptions « être prévenu » (texte validé par Claude-Alain le 24.10.2026), appelé par le
// nettoyage périodique (catégorie `announcement_subscriptions`). Fichier distinct de retention-rules.ts (F2).
// - demande non confirmée : effacée 7 jours après la première demande du cycle ;
// - inscription dont l'annonce est partie : effacée 12 mois après la date de l'annonce (jour civil de Zurich :
//   effacée dès le début du jour anniversaire, donc jamais plus tard que les 12 mois) ;
// - inscription sans annonce : effacée à la fin du 30.06.2027, heure de Zurich (date du bilan du 21.10.2026) ;
// - désinscription : effacement immédiat par la route, hors de ce passage.
// Jetons échus : déjà refusés à la confirmation (contrôle de l'échéance) ; ce passage efface en plus leur
// empreinte, qui ne sert plus à rien (le lien de désinscription ne dépend pas du jeton). Seules les lignes
// effacées sont comptées dans le témoin.
// Chaque ligne effacée entre au registre propre aux inscriptions (announcement-erasures.ts), dans la même transaction.
import type Database from 'better-sqlite3';
import { calendarDay, swissDay, swissMidnight } from './crm-period.js';
import { PENDING_RETENTION_MS } from './announcements.js';
import { recordAnnouncementErasures } from './announcement-erasures.js';

/** Fin du 30.06.2027 à Zurich = début du 01.07.2027 (2027-06-30T22:00:00Z, heure d'été). */
export const ANNOUNCEMENT_FALLBACK_END = swissMidnight('2027-07-01');
const DATE_FLOOR = 1_000_000_000_000;

/** Même jour civil un an plus tôt ; le 29 février devient le 28. */
function sameDayLastYear(day: string): string {
  const [year, month, date] = day.split('-');
  const previous = String(Number(year) - 1).padStart(4, '0');
  return month === '02' && date === '29' ? `${previous}-02-28` : `${previous}-${month}-${date}`;
}

/**
 * Instant avant lequel une annonce a plus de 12 mois : toute annonce d'un jour civil de Zurich antérieur ou égal
 * au même jour de l'année précédente. Exemple : le 15.03.2028, les annonces du 15.03.2027 ou avant sont échues.
 */
export function announcementAnniversaryCutoff(now: number): number {
  return swissMidnight(calendarDay(sameDayLastYear(swissDay(now)), 1));
}

export type AnnouncementRetentionOutcome = { deleted: number; error?: 'timestamp_format' | 'database_error' };

export function applyAnnouncementRetention(db: Database.Database, now = Date.now()): AnnouncementRetentionOutcome {
  try {
    if (!Number.isSafeInteger(now) || now < DATE_FLOOR) return { deleted: 0, error: 'timestamp_format' };
    return db.transaction((): AnnouncementRetentionOutcome => {
      // Précontrôle comme les autres catégories : une date qui n'est pas un entier en millisecondes laisse tout intact.
      const malformed = db.prepare(`SELECT 1 FROM announcement_subscriptions WHERE
        typeof(requested_at)<>'integer' OR requested_at<?
        OR (announced_at IS NOT NULL AND (typeof(announced_at)<>'integer' OR announced_at<?))
        OR (confirmed_at IS NOT NULL AND (typeof(confirmed_at)<>'integer' OR confirmed_at<?)) LIMIT 1`).get(DATE_FLOOR, DATE_FLOOR, DATE_FLOOR);
      if (malformed) return { deleted: 0, error: 'timestamp_format' };
      const erased = db.prepare(`DELETE FROM announcement_subscriptions WHERE
        (confirmed_at IS NULL AND requested_at <= ?)
        OR (announced_at IS NOT NULL AND announced_at < ?)
        OR (announced_at IS NULL AND ? >= ?) RETURNING id`)
        .all(now - PENDING_RETENTION_MS, announcementAnniversaryCutoff(now), now, ANNOUNCEMENT_FALLBACK_END) as Array<{ id: number }>;
      recordAnnouncementErasures(db, erased.map(row => row.id), now);
      db.prepare('UPDATE announcement_subscriptions SET token_hash=NULL,token_expires_at=NULL WHERE confirmed_at IS NULL AND token_expires_at IS NOT NULL AND token_expires_at <= ?').run(now);
      return { deleted: erased.length };
    }).immediate();
  } catch {
    return { deleted: 0, error: 'database_error' };
  }
}
