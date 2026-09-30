import type { MailWatchCode, MailWatchStatus } from '../../../src/lib/mail-watch-types';

// Textes fixes : aucune valeur reçue du serveur n'est insérée telle quelle, seulement des nombres et des dates.
const REASONS: Record<MailWatchCode, string> = {
  not_configured: 'Les variables Telegram de la veille ne sont pas réglées sur le serveur. Aucune alerte ne part.',
  telegram_config_invalid: 'Le jeton ou le destinataire Telegram réglé sur le serveur n’a pas le format attendu. Aucune alerte ne part.',
  mailbox_not_connected: 'La boîte contact@ n’est pas connectée dans l’espace Mails. La veille attend sa connexion.',
  mailbox_unreadable: 'L’accès enregistré à la boîte contact@ ne peut pas être relu. Reconnecter la boîte dans l’espace Mails.',
  imap_failed: 'La lecture de la boîte chez Infomaniak a échoué. Nouvel essai au passage suivant.',
  telegram_http: 'Telegram a refusé l’envoi. Les messages concernés seront proposés de nouveau au passage suivant.',
  telegram_timeout: 'Telegram n’a pas répondu à temps. Les messages concernés seront proposés de nouveau au passage suivant.',
  telegram_network: 'Telegram était injoignable. Les messages concernés seront proposés de nouveau au passage suivant.',
  telegram_not_ok: 'Telegram n’a pas confirmé l’envoi. Les messages concernés seront proposés de nouveau au passage suivant.',
};
const STALE_AFTER = 30 * 60_000;

export function renderMailWatchStatus(status: MailWatchStatus | null | undefined, now = Date.now()): string {
  const formatDate = (time: number) => new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(time);
  const whole = (value: number) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  const intro = 'Toutes les dix minutes, le serveur lit la boîte contact@ sans rien y modifier et envoie un message Telegram quand un organisme surveillé (FINMA, OFS, ONU ou un domaine ajouté dans la configuration) répond.';
  if (!status) {
    return `<section class="panel" style="margin-bottom:24px"><div class="panel-heading"><div><h2>Veille des réponses : aucun passage enregistré.</h2><p>${intro}</p></div><span class="pill amber">À vérifier</span></div><p class="fine">Le premier passage a lieu une minute après le démarrage du serveur. Un témoin absent signifie une version sans veille ou un serveur qui n’a pas encore démarré.</p></section>`;
  }
  const age = now - status.checked_at;
  const stale = !(age >= 0 && age < STALE_AFTER);
  const healthy = status.status === 'ok' && !stale;
  const title = stale ? 'Veille des réponses : dernier passage ancien.' : status.status === 'ok' ? 'Veille des réponses active.' : status.status === 'inactive' ? 'Veille des réponses en attente de réglage.' : 'Veille des réponses : dernier passage en échec.';
  const pill = healthy ? '<span class="pill green">Active</span>' : `<span class="pill amber">${status.status === 'inactive' && !stale ? 'Inactive' : 'À vérifier'}</span>`;
  const reason = status.code ? REASONS[status.code] ?? 'Consulter les journaux du serveur.' : '';
  const http = status.code === 'telegram_http' && Number.isSafeInteger(status.http_status) ? ` Code de réponse ${status.http_status}.` : '';
  const counts = `${whole(status.matched)} message(s) d’un domaine surveillé sur trois jours · ${whole(status.alerted)} alerte(s) au dernier passage · ${whole(status.pending)} en attente · ${whole(status.total_alerted)} alerte(s) depuis la mise en service.`;
  const success = status.last_success_at ? `Dernier passage complet : ${formatDate(status.last_success_at)}.` : 'Aucun passage complet enregistré.';
  const alert = status.last_alert_at ? ` Dernière alerte : ${formatDate(status.last_alert_at)}.` : '';
  return `<section class="panel" style="margin-bottom:24px"><div class="panel-heading"><div><h2>${title}</h2><p>Dernier passage : ${formatDate(status.checked_at)} · heure suisse. ${whole(status.domains)} domaine(s) surveillé(s).</p></div>${pill}</div>${reason ? `<p class="fine">${reason}${http}</p>` : ''}${stale ? '<p class="fine">Aucun passage depuis plus de trente minutes : le serveur est peut-être arrêté ou redémarre.</p>' : ''}<p class="fine">${counts}</p><p class="fine">${success}${alert} Heure suisse.</p><p class="source-note">${intro} Aucun contenu n’est conservé : le témoin garde seulement des empreintes des messages déjà signalés. Pour couper la veille, retirer ses variables Telegram sur Railway.</p></section>`;
}
