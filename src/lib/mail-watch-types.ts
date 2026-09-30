// Vue exposée au bureau : compteurs, dates et codes fermés seulement, jamais d'adresse, d'objet ni d'empreinte.
export type MailWatchCode =
  | 'not_configured'
  | 'telegram_config_invalid'
  | 'mailbox_not_connected'
  | 'mailbox_unreadable'
  | 'imap_failed'
  | 'telegram_http'
  | 'telegram_timeout'
  | 'telegram_network'
  | 'telegram_not_ok';

export type MailWatchStatus = {
  checked_at: number;
  status: 'ok' | 'inactive' | 'error';
  code: MailWatchCode | null;
  http_status: number | null;
  last_success_at: number | null;
  last_alert_at: number | null;
  /** Messages d'un domaine surveillé reçus dans la fenêtre de trois jours, au dernier passage. */
  matched: number;
  /** Alertes acceptées par Telegram au dernier passage. */
  alerted: number;
  /** Nouveaux messages pas encore signalés (plafond de cinq par passage ou échec d'envoi). */
  pending: number;
  /** Alertes acceptées depuis la création du témoin. */
  total_alerted: number;
  /** Nombre de domaines surveillés ; la liste elle-même reste dans la configuration du serveur. */
  domains: number;
};
