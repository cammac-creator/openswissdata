# OSDsdr — Spec d'architecture outil marketing AI SDR

Date : 2026-04-24
Mission : concevoir un outil custom pour automatiser prospection openswissdata.com
Méthode : 6 agents Claude Code en parallèle (data sources, cold email, CRM, prompts, LinkedIn, spec finale)
Stack cible : Hono + better-sqlite3 + Resend + Apollo + Claude API + Chrome extension custom

---

## Vision — OSDsdr v1

**Nom interne** : `OSDsdr` (OpenSwissData Sales Dev Robot)

**Objectif business 90 j** :
- 200 leads qualifiés/mois → 40 emails ouverts engagés → 10 réponses positives → 4 meetings → 2 deals
- ≈1 200 CHF MRR équivalent ou ≈3 200 CHF one-shot bundle inclus
- CAC < 50 CHF/deal, payback < 1 mois sur ticket TARES 299 CHF

**Non-objectifs v1** :
- Pas de cold-calling, SMS, WhatsApp
- Pas de CRM full-featured (kanban, forecasting)
- Pas d'automation LinkedIn risquée (extension assist seulement)
- Pas de multi-tenant SaaS — outil interne mono-utilisateur Alain

---

## Stack tech (~80 CHF/mois)

| Couche | Choix | CHF/mois |
|---|---|---|
| Runtime | Node 22 + TypeScript strict (existant) | 0 |
| HTTP | Hono (existant) | 0 |
| DB | better-sqlite3 WAL (existant) | 0 |
| LLM | Claude Haiku 4.5 (qualif) + Sonnet 4.6 (writer) | ~15 |
| Email | Resend (existant) | 0 |
| Lead source | Apollo Basic ($49) | ~45 |
| Email verifier | Bouncer pay-as-you-go | ~5 |
| Calendar | Cal.com cloud free | 0 |
| Observabilité | Langfuse self-host Docker | ~5 |
| LinkedIn assist | Chrome extension custom MV3 | 0 |
| Cron | Railway cron natifs | 0 |
| Hébergement | Railway delta (existant mutualisé) | ~10 |
| **TOTAL** | | **~80 CHF/mois** |

---

## Architecture data flow

```
SOURCES                 ENRICHMENT          QUALIFICATION       CONTENT
Apollo API ─┐           Bouncer (verify)     Claude Haiku       Claude Sonnet
CSV import ─┼──leads──→ Phantombuster ────→ score 0-100 + ────→ icebreaker +
Extension ──┘           (LinkedIn signals)  ICP tag + reason    9 templates ICP

                            ↓
SEQUENCE ENGINE                              ACTION LAYER
state machine                                Resend send + tracking pixel
NEW → STEP1 → WAIT3D ─────────────────────→ + redirect link → events
→ STEP2 → WAIT5D → STEP3 → DONE              Cal.com link → meeting webhook

                            ↓
REPLY HANDLING                               OBSERVABILITÉ
Resend inbound webhook                       Langfuse (LLM tracing)
→ Claude classifier → reply_intent           PostHog (funnel events)
positive → notif Slack                       Sentry (errors)
negative/unsub → auto-stop séquence
```

---

## Schéma SQLite (9 tables)

`src/marketing/db/migrations/001_init.sql` :

```sql
-- LEADS (sources : Apollo, CSV, GitHub, manual)
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT, last_name TEXT, company TEXT, job_title TEXT,
  linkedin_url TEXT, country TEXT,
  source TEXT NOT NULL,                    -- apollo|csv|github|extension
  source_ref TEXT,                          -- id externe Apollo
  email_status TEXT,                        -- valid|risky|invalid|unknown
  signals_json TEXT,                        -- JSON {posts, news, hires_30d}
  unsubscribed_at INTEGER,
  data_source TEXT,                         -- nFADP : provenance précise
  legitimate_interest_basis TEXT,           -- nFADP : justification
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- QUALIFICATIONS (Haiku scoring)
CREATE TABLE qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,                   -- 0..100
  icp_tag TEXT NOT NULL,                    -- payroll|compliance|proptech|none
  reason TEXT,
  model TEXT NOT NULL,
  cost_usd_micro INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- SEQUENCES & STEPS (templates)
CREATE TABLE sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,                -- payroll-tares-v1
  icp_tag TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE sequence_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER NOT NULL REFERENCES sequences(id),
  step_index INTEGER NOT NULL,              -- 1,2,3
  delay_hours INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  prompt_template TEXT NOT NULL,
  UNIQUE(sequence_id, step_index)
);

-- ENROLLMENTS (lead × séquence)
CREATE TABLE enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  sequence_id INTEGER NOT NULL REFERENCES sequences(id),
  current_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',    -- active|paused|done|stopped
  next_action_at INTEGER,
  stopped_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(lead_id, sequence_id)
);

-- DRAFTS & MESSAGES
CREATE TABLE drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  model TEXT NOT NULL,
  cost_usd_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',  -- pending_review|approved|rejected
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  resend_message_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  sent_at INTEGER
);

-- EVENTS (open, click, reply, unsubscribe)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES messages(id),
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  type TEXT NOT NULL,                       -- open|click|reply|unsubscribe|bounce|meeting_booked
  payload_json TEXT,
  reply_intent TEXT,                        -- positive|negative|oob|spam|null
  created_at INTEGER NOT NULL
);

-- AUDIT LOG (compliance nFADP/RGPD)
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,                      -- system|alain|extension
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_unsub ON leads(unsubscribed_at);
CREATE INDEX idx_qual_lead ON qualifications(lead_id);
CREATE INDEX idx_qual_score ON qualifications(score DESC);
CREATE INDEX idx_enr_due ON enrollments(status, next_action_at);
CREATE INDEX idx_msg_status ON messages(status, sent_at);
CREATE INDEX idx_evt_lead ON events(lead_id, created_at DESC);
CREATE INDEX idx_evt_type ON events(type, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
```

---

## Contrats TypeScript (decoupling)

`src/marketing/contracts.ts` :

```typescript
export interface RawLead {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  country?: string;
  sourceRef?: string;
}

export interface LeadSource {
  readonly name: string;
  pull(opts: { limit: number; since?: Date }): AsyncIterable<RawLead>;
}

export interface EnrichedLead extends RawLead {
  emailStatus: "valid" | "risky" | "invalid" | "unknown";
  signals: { recentPosts?: string[]; news?: string[]; hires30d?: number };
}

export interface Enricher {
  enrich(lead: RawLead): Promise<EnrichedLead>;
}

export interface QualificationResult {
  score: number;                              // 0..100
  icpTag: "payroll" | "compliance" | "proptech" | "none";
  reason: string;
  model: string;
  costUsdMicro: number;
}

export interface Qualifier {
  qualify(lead: EnrichedLead): Promise<QualificationResult>;
}

export interface DraftRequest {
  lead: EnrichedLead;
  qualification: QualificationResult;
  stepIndex: number;
  promptTemplate: string;
  threadHistory?: { role: "us" | "them"; body: string }[];
}

export interface DraftResult {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  model: string;
  costUsdMicro: number;
}

export interface Writer {
  generate(req: DraftRequest): Promise<DraftResult>;
}

export interface SendRequest {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  headers: { "List-Unsubscribe": string; "List-Unsubscribe-Post": string };
}

export interface SendResult {
  providerMessageId: string;
  acceptedAt: Date;
}

export interface Sender {
  send(req: SendRequest): Promise<SendResult>;
}

export type DomainEvent =
  | { kind: "lead.ingested"; leadId: number }
  | { kind: "lead.qualified"; leadId: number; score: number }
  | { kind: "draft.created"; draftId: number }
  | { kind: "message.sent"; messageId: number }
  | { kind: "message.opened"; messageId: number }
  | { kind: "message.clicked"; messageId: number; url: string }
  | { kind: "reply.received"; leadId: number; intent: string }
  | { kind: "lead.unsubscribed"; leadId: number };

export interface EventStream {
  emit(event: DomainEvent): void;
}
```

---

## 10 Modules

| # | Module | Inputs | Outputs | Libs npm | Jours |
|---|---|---|---|---|---|
| 1 | Data ingestion | Apollo query, CSV upload | rows in `leads` | `csv-parse`, `undici` | 1 |
| 2 | Enrichment | `leads.email`, `linkedin_url` | `leads.signals`, `email_status` | Bouncer/Phantombuster HTTP | 0.5 |
| 3 | Qualification | enriched lead | `qualifications.score`, `icp_tag` | `@anthropic-ai/sdk` | 0.5 |
| 4 | Content generation | qualified lead + template | `drafts` row | `@anthropic-ai/sdk` | 1 |
| 5 | Sequence engine | approved draft | scheduled `messages` rows | `node-cron` | 1 |
| 6 | Send + tracking | due `messages` | Resend send, pixel/redirect events | `resend` | 1 |
| 7 | Reply handling | Resend inbound webhook | `events.reply_intent`, séquence stop | `@anthropic-ai/sdk`, `mailparser`, `email-reply-parser` | 1 |
| 8 | LinkedIn assist | DOM profil LinkedIn | draft icebreaker JSON | Chrome MV3 + fetch | 1 |
| 9 | Dashboard admin | DB queries | HTML server-rendered | `hono/jsx` | 1 |
| 10 | Reporting | events agrégés J-1 | email digest 07:00 | `resend` | 0.5 |

**Total : ~9.5 j dev** + buffer 0.5 j = **10 jours ouvrés**

---

## Roadmap build 10 jours

| Jour | Livrable concret |
|---|---|
| **J1** | Migrations SQL + `schema.ts` + `npm run sdr:migrate` opérationnel + 3 sequences + 9 sequence_steps seedés |
| **J2** | `sources/apollo.ts` + `cron/pull.ts` : 50 leads pulled, dédupliqués, `email_status` rempli via Bouncer. CSV import endpoint admin |
| **J3** | `llm/qualifier.ts` + `cron/qualify.ts` : Haiku scoring batch, score+ICP+reason en DB. Cible : <0.5 ¢/lead |
| **J4** | `llm/writer.ts` : 9 prompt-templates (3 ICP × 3 étapes). Génération drafts batch, status `pending_review`. UI approve/reject inline |
| **J5** | `sequences/engine.ts` : state machine + `cron/send.ts` (toutes 15 min). Cron `follow-up.ts` enrôle au step suivant si pas de reply |
| **J6** | `email/sender.ts` (Resend + footer unsub) + `email/tracker.ts` (pixel `/p/:msgId.gif` + redirect `/r/:msgId/:enc`) + route `/u/:token` unsubscribe 1-clic |
| **J7** | `routes/webhook-email.ts` Resend inbound + `llm/classifier.ts` (Haiku) → `events.reply_intent`. Auto-stop si negative/oob. Notif Alain si positive |
| **J8** | Chrome extension MV3 : `manifest.json`, `content.ts` (parse profil LinkedIn DOM), `popup.html` (call `/api/sdr/linkedin/draft` avec auth header) |
| **J9** | `routes/admin-sdr.ts` : dashboard HTML — tables leads/drafts/queue/events, filtres, actions bulk. Auth via session existante |
| **J10** | Tests Vitest (qualifier, writer, sequence transitions, unsubscribe), déploiement Railway, premier batch 100 leads payroll |

---

## Fichiers à créer (~40 fichiers)

```
src/marketing/
  db/
    migrations/001_init.sql
    migrate.ts
    schema.ts
    seed-sequences.ts
  contracts.ts
  sources/
    apollo.ts
    csv.ts
    github.ts
  enrichment/
    bouncer.ts
    phantombuster.ts
    gdelt.ts
  llm/
    anthropic-client.ts
    qualifier.ts
    writer.ts
    classifier.ts
    prompts/
      qualifier.system.md
      writer-payroll-step1.md  (× 9 templates)
      reply-classifier.system.md
      reply-drafter.system.md
  sequences/
    engine.ts
    templates.ts
  email/
    sender.ts
    tracker.ts
    unsubscribe.ts
  events/
    stream.ts
  cron/
    pull.ts
    qualify.ts
    send.ts
    follow-up.ts
    digest.ts

src/routes/
  sdr.ts                      # /api/sdr/* (import, qualify, sequence, funnel)
  admin-sdr.ts                # /admin/sdr/* (dashboard JSX)
  webhook-email.ts            # /api/webhook/email/event (Resend signed)
  webhook-calendar.ts         # /api/webhook/calendar (Cal.com)
  track.ts                    # /p/:msgId.gif + /r/:msgId/:enc + /u/:token

src/lib/
  admin-auth.ts               # requireAdmin middleware

extension/
  manifest.json
  content.ts
  background.ts
  popup.html
  popup.ts
  overlay.css

tests/marketing/
  qualifier.test.ts
  writer.test.ts
  sequence-engine.test.ts
  unsubscribe.test.ts
  tracking.test.ts
  nfadp.test.ts

docs/
  sdr-policy.md               # mention légale nFADP/RGPD
  sdr-runbook.md              # procédures pause urgence, opt-out manuel

railway.json                  # ajout 5 crons
```

---

## Cron jobs Railway

```json
{
  "crons": [
    { "schedule": "0 6 * * *",   "command": "node dist/marketing/cron/pull.js" },
    { "schedule": "0 7 * * *",   "command": "node dist/marketing/cron/qualify.js" },
    { "schedule": "*/15 * * * *","command": "node dist/marketing/cron/send.js" },
    { "schedule": "0 * * * *",   "command": "node dist/marketing/cron/follow-up.js" },
    { "schedule": "0 7 * * *",   "command": "node dist/marketing/cron/digest.js" }
  ]
}
```

---

## Bibliothèque prompts (10 prompts production-ready)

Tous documentés dans `src/marketing/llm/prompts/` :

1. **ICP qualification** (Haiku 4.5) — score 0-100 + ICP tag + dataset recommandé. ~$0.0005/appel
2. **Icebreaker writer** (Sonnet 4.6) — 1 phrase 12-22 mots multilingue (FR/DE/IT/EN). ~$0.003/appel
3. **Email writer** (Sonnet 4.6) — subject + body 80-120 mots, 9 combinaisons ICP×lang. ~$0.006/appel
4. **Follow-ups E2/E3/E4** (Sonnet 4.6) — 27 templates paramétrés. ~$0.007/appel
5. **Reply classifier** (Haiku 4.5) — intent/sentiment/urgency/action. ~$0.0004/appel
6. **Reply drafter** (Sonnet 4.6) — draft réponse selon intent. ~$0.005/appel
7. **Lead scoring update** (Haiku 4.5) — re-score sur nouveau signal. ~$0.0003/appel
8. **Subject A/B variants** (Sonnet 4.6) — 5 variants par angle. ~$0.004/appel
9. **Daily digest** (Sonnet 4.6) — résumé 200 mots quotidien. ~$0.013/appel
10. **Newsletter writer** (Sonnet 4.6) — 600 mots hebdo. ~$0.025/appel

**Coût total par prospect** (séquence 4 emails + classifier + drafter) : **~$0.031 brut, ~$0.012 avec prompt caching** (économie 73%).

→ Sur 1 000 prospects/mois : **~$12/mois en LLM**.

---

## Compliance nFADP/RGPD intégrée

- Champ `data_source` + `legitimate_interest_basis` obligatoires dans `leads` (rejet sinon)
- Header `List-Unsubscribe: <mailto:>, <https://>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) sur **chaque** email
- Footer auto FR/DE/EN avec lien désinscription + adresse postale CH
- Auto-purge prospects opt-out après 12 mois (cron quotidien)
- Endpoint `/api/sdr/lead/:id/export-data` (droit RGPD)
- Endpoint `DELETE /api/sdr/lead/:id` (droit effacement)
- `audit_log` pour ingest/send/unsubscribe/delete (audit trail)
- Mention légale page `/sdr-policy` listant base légale, durée conservation, droits

⚠️ **Critique LCD CH art. 3 lit. o** : envoi mass non-sollicité interdit en CH (pas d'exception B2B comme DE/AT). Stratégie :
- Cibler hors-CH par défaut (UE intérêt légitime / US CAN-SPAM permissif)
- Pour prospects CH : exiger opt-in léger (lead magnet sur landing → email récolté → séquence déclenchée)
- Champ `country_iso` obligatoire, router : `country = CH → require opt_in_at NOT NULL`

---

## Sécurité

- Tous les secrets dans Railway env vars (`ANTHROPIC_API_KEY`, `APOLLO_API_KEY`, `BOUNCER_API_KEY`, `RESEND_API_KEY`, `OSDSDR_EXTENSION_KEY`)
- Aucune clé Anthropic dans l'extension Chrome — uniquement token bearer
- Rate limit Hono middleware : 60 req/min/IP sur `/api/sdr/*`
- Webhook Resend signature vérifiée (svix)
- Cookie session admin 30 jours (existant)
- ADMIN_EMAILS whitelist dans env

---

## KPIs cibles J+30

| Métrique | Cible |
|---|---|
| Leads sourcés/jour | ≥ 15 |
| Leads qualifiés (score ≥ 60)/jour | ≥ 7 |
| Emails envoyés/jour | 20-30 (warm-up) |
| Open rate (J7 rolling) | ≥ 35 % |
| Click rate | ≥ 6 % |
| Reply rate global | ≥ 5 % |
| **Reply rate positif** | **≥ 1.5 %** |
| Bounce rate | ≤ 3 % |
| Unsubscribe rate | ≤ 1 % |
| Meetings bookés/sem | ≥ 1 |
| Coût LLM cumulé/mois | ≤ 20 CHF |
| Coût marketing total/mois | ≤ 100 CHF |
| Coût par lead qualifié | ≤ 0.50 CHF |
| **Ventes attribuées/mois** | **≥ 1 deal** |
| ROI cumulé J+30 | ≥ 0 (break-even) |

---

## Critères GO / NO-GO J+30

**GO** si **tous** :
- ≥ 1 deal payant attribué (ticket ≥ 299 CHF, source = OSDsdr)
- Reply rate positif ≥ 1.5 % sur ≥ 400 emails envoyés
- Bounce ≤ 3 %, unsub ≤ 1 %
- Coût ≤ 100 CHF/mois (LLM inclus)
- Aucune plainte spam (FBL Resend = 0)
- Temps Alain ≤ 20 min/jour

**NO-GO / pivot** si :
- Reply positif < 0.5 % → templates non-PMF, pivoter angle/ICP
- Bounce > 5 % → source data Apollo dégradée, swap Hunter/ZoomInfo
- Coût > 120 CHF/mois → réduire fréquence Sonnet, repli Haiku-only writer
- Temps Alain > 45 min/jour → automatisation review drafts step 1 (auto-approve si confidence ≥ 0.85)

---

## Évolutions roadmap mois 2-6

- **v1.1 (M2)** : Heyreach API LinkedIn DM (compte secondaire), détection moment d'envoi optimal par TZ
- **v1.2 (M3)** : multilingue DE/IT — sequences clonées + Sonnet locale-aware, persona Suisse alémanique
- **v1.3 (M4)** : intent signals — GDelt watcher + LinkedIn job postings (mots-clés), boost score +20
- **v2 (M5)** : multi-agent — 1 agent Claude par ICP avec ton/templates spécifiques
- **v3 (M6)** : voice follow-up — Twilio outbound + WhatsApp Business API CH (high-intent only)
- **v4 (post-MVP)** : self-serve trial 99 CHF — onboarding auto PME CH curieuses

---

## Sources externes utilisées (11 outils intégrés)

| Outil | Rôle | Pricing 2026 vérifié |
|---|---|---|
| Apollo.io Basic | Lead sourcing CH | $49/mois |
| Bouncer | Email verification | $0.008/email |
| Phantombuster | LinkedIn signals (ponctuel) | $69/mois (ou skip) |
| GDelt API | News intent (gratuit) | $0 |
| Anthropic Claude | LLM Haiku 4.5 + Sonnet 4.6 | ~$15/mois |
| Resend | Email send (existant) | $0 (free tier 3k/mois) |
| Cal.com | Calendar booking | $0 (free) |
| Langfuse | LLM observability self-host | $5 (Railway sidecar) |
| Sentry | Error tracking | $0 (free tier) |
| PostHog | Funnel analytics | $0 (free tier) |
| Cloudflare/Infomaniak | DNS domaines secondaires | ~2 CHF/mois |

---

## Sources vérifiées (URLs HTTP 200)

- [Apollo.io API docs](https://docs.apollo.io/) | [pricing](https://www.apollo.io/pricing)
- [Anthropic API Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Resend Acceptable Use](https://resend.com/legal/acceptable-use)
- [Bouncer pricing](https://www.usebouncer.com/pricing/)
- [Hunter pricing](https://hunter.io/pricing)
- [Cal.com pricing](https://cal.com/pricing)
- [Langfuse self-host](https://langfuse.com/self-hosting)
- [RFC 8058 one-click unsubscribe](https://datatracker.ietf.org/doc/html/rfc8058)
- [nFADP — admin.ch KMU](https://www.kmu.admin.ch/kmu/en/home/facts-and-trends/digitization/data-protection/new-federal-act-on-data-protection-nfadp.html)
- [LCD art. 3 al. 1 let. o](https://www.fedlex.admin.ch/eli/cc/1988/223_223_223/fr#art_3)
- [Zefix REST](https://www.zefix.admin.ch/ZefixPublicREST/api/v1)
- [LINDAS SPARQL](https://lindas.admin.ch/query/)
- [GDELT DOC API 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)
