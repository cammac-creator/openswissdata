-- Migration 004 — announcement_subscriptions
--
-- Inscriptions par e-mail « être prévenu quand l'historique détaillé sera disponible » (vitrine
-- /finma-movements/, 24.10.2026). Double confirmation : un lien valable 48 h, à usage unique.
--
-- Comme 001 et 002, ce DDL est recopié à la fin de src/db/schema.sql, que getDb() exécute à chaque
-- démarrage (CREATE TABLE IF NOT EXISTS) : il n'y a pas de lanceur de migrations. Migration
-- additive : aucune table existante n'est modifiée ; une base plus ancienne reçoit la table vide.
--
-- Données gardées, et rien d'autre : adresse normalisée, langue, sujet, dates de demande, de
-- confirmation, de désinscription (toujours NULL, la désinscription efface la ligne) et d'annonce,
-- empreinte SHA-256 du jeton de confirmation et son échéance. Ni adresse IP, ni agent utilisateur,
-- ni pays, ni jeton en clair. Le lien de désinscription n'est pas stocké : il est scellé à partir de
-- l'identifiant interne et de la date de demande (src/lib/announcements.ts).
--
-- Effacement (src/lib/announcement-retention.ts, catégorie `announcement_subscriptions` du
-- nettoyage) : demande non confirmée après 7 jours, inscription 12 mois après l'annonce ou, sans
-- annonce, à la fin du 30.06.2027 (heure de Zurich) ; désinscription = effacement immédiat.

CREATE TABLE IF NOT EXISTS announcement_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Adresse normalisée (espaces retirés, minuscules) ; la seule donnée de contact gardée.
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254 AND email = lower(trim(email))),
  lang TEXT NOT NULL CHECK(lang IN ('fr','de','en')),
  subject TEXT NOT NULL CHECK(subject IN ('finma-historique')),
  -- Première demande du cycle en cours : jamais repoussée par une nouvelle demande (purge à 7 jours).
  requested_at INTEGER NOT NULL CHECK(typeof(requested_at)='integer' AND requested_at >= 1000000000000),
  confirmed_at INTEGER CHECK(confirmed_at IS NULL OR (typeof(confirmed_at)='integer' AND confirmed_at >= requested_at)),
  -- Toujours NULL en pratique : une désinscription efface la ligne. Colonne gardée car la notice la cite.
  unsubscribed_at INTEGER CHECK(unsubscribed_at IS NULL OR (typeof(unsubscribed_at)='integer' AND unsubscribed_at >= 1000000000000)),
  -- Date de l'annonce de la disponibilité (NULL tant qu'aucune annonce n'est partie) : départ des 12 mois.
  announced_at INTEGER CHECK(announced_at IS NULL OR (typeof(announced_at)='integer' AND announced_at >= 1000000000000)),
  -- Empreinte SHA-256 du jeton de confirmation, jamais le jeton ; effacée à la confirmation (usage unique).
  token_hash TEXT CHECK(token_hash IS NULL OR (length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*')),
  token_expires_at INTEGER CHECK(token_expires_at IS NULL OR (typeof(token_expires_at)='integer' AND token_expires_at >= 1000000000000)),
  CHECK((token_hash IS NULL) = (token_expires_at IS NULL)),
  CHECK(confirmed_at IS NULL OR token_hash IS NULL),
  UNIQUE(email, subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_subscriptions_token ON announcement_subscriptions(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_announcement_subscriptions_pending ON announcement_subscriptions(confirmed_at, requested_at);
