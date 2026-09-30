import { describe, expect, it } from 'vitest';
import { renderMailWatchStatus } from '../../web/src/lib/mail-watch-status';
import type { MailWatchStatus } from '../../src/lib/mail-watch-types';

const now = Date.parse('2026-09-30T12:00:00Z');
const status = (patch: Partial<MailWatchStatus> = {}): MailWatchStatus => ({ checked_at: now - 5 * 60_000, status: 'ok', code: null, http_status: null, last_success_at: now - 5 * 60_000, last_alert_at: now - 3_600_000, matched: 2, alerted: 1, pending: 0, total_alerted: 4, domains: 4, ...patch });

describe('Panneau de la veille des réponses', () => {
  it('présente un passage récent, ses compteurs et la façon de couper la veille', () => {
    const html = renderMailWatchStatus(status(), now);
    expect(html).toContain('Veille des réponses active.');
    expect(html).toContain('pill green');
    expect(html).toContain('2 message(s) d’un domaine surveillé sur trois jours · 1 alerte(s) au dernier passage · 0 en attente · 4 alerte(s) depuis la mise en service.');
    expect(html).toContain('retirer ses variables Telegram sur Railway');
  });
  it('signale un passage ancien, même réussi', () => {
    const html = renderMailWatchStatus(status({ checked_at: now - 31 * 60_000 }), now);
    expect(html).toContain('dernier passage ancien');
    expect(html).not.toContain('pill green');
  });
  it('traduit les codes fermés et le code HTTP de Telegram', () => {
    expect(renderMailWatchStatus(status({ status: 'inactive', code: 'not_configured' }), now)).toContain('Les variables Telegram de la veille ne sont pas réglées');
    expect(renderMailWatchStatus(status({ status: 'inactive', code: 'mailbox_not_connected' }), now)).toContain('La boîte contact@ n’est pas connectée');
    const failed = renderMailWatchStatus(status({ status: 'error', code: 'telegram_http', http_status: 401 }), now);
    expect(failed).toContain('Telegram a refusé l’envoi.');
    expect(failed).toContain('Code de réponse 401.');
  });
  it('n’affiche pas de succès sans témoin', () => {
    const html = renderMailWatchStatus(null, now);
    expect(html).toContain('aucun passage enregistré');
    expect(html).toContain('pill amber');
  });
});
