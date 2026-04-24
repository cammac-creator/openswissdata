# Automatisation marketing openswissdata.com — analyse 7 agents

Date : 2026-04-24
Mission : cartographier toutes les pistes pour automatiser prospection + acquisition à coût marginal (<100 CHF/mois) pour solo founder.
Méthode : 7 agents Claude Code en parallèle, chacun spécialisé.

---

## TL;DR — La vérité brutale

**Aucun outil "AI SDR" no-code (Nanocorp, 11x.ai, Artisan AI) n'est adapté à un solo founder à <100 CHF/mois.** Tous coûtent 500-5000 USD/mois minimum. Solution réaliste : **stack DIY 70-95 CHF/mois** (Apollo Free + Smartlead + Claude API + Resend déjà payé) avec scripts Node maison.

**Cap réaliste de volume légal/safe** : 30-50 emails/jour personnalisés + 15-20 LinkedIn invits/jour (compte perso, pas plus sans risque ban).

**Durée avant 1ère vente** : 60-90 jours typique B2B niche CH. Mois 1 = 0-3 ventes. Cycle long inhérent au B2B.

---

## 1. Verdict Nanocorp — court

**Nanocorp n'est PAS un AI SDR.** C'est un "company-builder" YC W24 : tu décris une idée, l'agent génère nom, landing Vercel, config Stripe, task list outreach. Coût $30/mois pour 30 crédits. Pas d'envoi LinkedIn/email automatique.

**Verdict** : inutile pour openswissdata. Mais inspirant comme veille produit (modèle Claude API + Vercel + Stripe = ce que tu as déjà bâti).

[nanocorp.so/pricing](https://www.nanocorp.so/pricing)

---

## 2. Comparatif AI SDR commerciaux 2026 (vérifié)

| Outil | Tier d'entrée | Volume | Verdict solo |
|---|---|---|---|
| **11x.ai (Alice)** | ~$5 000/mois | 3 000 contacts/mois | ❌ Hors sujet enterprise |
| **Artisan AI (Ava)** | ~$2 000/mois | 12 000 leads/an | ❌ Contrats annuels rigides |
| **Reply.io Jason** | $500/mois | 1 000 contacts | ❌ Hors budget |
| **Regie.ai** | $35 000/an | ICP-driven | ❌ Hors budget |
| **Apollo.io Basic** | $49/mois | 30 000 crédits/an | ✅ OK |
| **Clay.com Launch** | $185/mois | 2 500 crédits | ⚠️ Trop cher en récurrent |
| **Relevance AI** | $19/mois Pro | 4 crédits/run | ✅ Custom agents |
| **Smartlead** | $39/mois | inboxes illimitées | ✅ Best price/quality |
| **Instantly Growth** | $37/mois | 1 000 leads | ✅ Best deliverability |

---

## 3. Cap LinkedIn 2026 — règles non-négociables

Sources : LeadLoft, Northlight, Growleads (avril 2026)

- **Connection requests** : 100-200/semaine max (15-30/jour). Sans Sales Navigator, rester <80/sem.
- **Warm-up obligatoire** : démarrer 20/jour puis +5/jour/semaine.
- **Profil visits** : <250/jour cloud safe.
- **23% des comptes utilisant tools sont restricted en 90 jours** (Growleads 2026).
- **HeyReach a reçu cease-and-desist LinkedIn février 2025** — outils API-level morts.
- **Solution survivante** : browser-based humain-mimétique (Heyreach Cloud, Expandi, Lemlist) avec proxy IP CH dédié. Risque modéré.

**Conséquence** : LinkedIn DM = volume cap structurel (15-20/jour réaliste). Le scaling viendra de l'email + content, pas du LinkedIn.

---

## 4. Cap Cold Email 2026 — règles non-négociables

Sources : Instantly Benchmark Report 2026, Litemail Gmail 2026

- **30 emails/inbox/jour max** (post-règles Google/Microsoft 2026)
- **Reply rates B2B tombés à 4-5% moyenne** (vs 8-10% en 2022)
- **Warmup 14-21 jours obligatoire** avant envois prod
- **78% des inboxes neuves non chauffées meurent en 30 jours**
- **Bounce rate <2% obligatoire** sinon hard-reject Google
- **Ne JAMAIS cold-emailer depuis hello@openswissdata.com** (grille tes envois transac)
- Acheter 2-3 domaines secondaires (`openswissdata.email`, `swissdata-ch.com`)

---

## 5. Cadre légal CH/UE pour cold

**nFADP CH (en vigueur sept 2023)** :
- B2B autorisé sur **intérêt légitime documenté** (art. 31)
- Obligatoire : transparence, opt-out 1-clic, mention vie privée
- Pas d'opt-in préalable strict pour B2B (vs B2C)
- Sanction max : 250 000 CHF (sur la personne physique)

**RGPD UE** : intérêt légitime art. 6.1.f, opt-out, registre traitement
**LCD art. 3 lit. o (CH)** : interdit "envois en masse non sollicités". Jurisprudence : envoi B2B ciblé personnalisé = OK. Pas de loterie/promo dans 1er email.

**À implémenter v1** :
- Champ `unsubscribe_token` par lead + handler `/api/unsubscribe/:token` (Hono)
- Header `List-Unsubscribe: <mailto:unsub@...>` automatique
- Footer auto FR/DE/EN avec lien désinscription
- Registre traitement basique (qui contacté quand pourquoi)

---

## 6. Stack DIY recommandée openswissdata

### Option A — "Lean MVP" 55-95 CHF/mois (RECOMMANDÉ)

| Brique | Service | Coût mensuel CHF |
|---|---|---|
| Sourcing | Apollo Basic ($49) | ~45 |
| LLM (qualif + écriture) | Claude API (Haiku 4.5 + Sonnet 4.6) | ~10-25 |
| Email envoi + warmup | Smartlead Basic ($39) | 35 |
| Domaines secondaires (2) | Cloudflare/Infomaniak (24 CHF/an) | 2 |
| Inboxes secondaires (3) | Google Workspace ($6/u) | 18 |
| Storage/cron | Railway (existant) | 0 marginal |
| CRM | SQLite (existant) | 0 |
| **TOTAL v1** | | **~98 CHF/mois** |

**Capacité réaliste** : 30-50 emails/jour personnalisés + 15-20 LinkedIn invits/jour (manuel via compte Alain).

### Option B — "Free tier max" <30 CHF/mois (BOOTSTRAP TOTAL)

- Apollo Free (50 emails/mois UI, gratuit) → suffit pour 1500 leads stockés
- Resend Free (3k/mois, 100/jour, déjà actif)
- Claude API Haiku 4.5 ~7 CHF/mois
- 2 domaines secondaires (24 CHF/an = 2 CHF/mois)
- n8n self-hosted Railway (existant) : 0
- SQLite leads/sequences custom code dans repo : 0
- **Total : ~10 CHF/mois**

⚠️ **Mais** : tu codes tout (warmup orchestration, séquences, follow-up logic, dashboard). 5-7 jours de dev TS pour MVP. Volume cap 100/jour.

### Option C — "Browser agent autonome" 70-110 CHF/mois (EXPÉRIMENTAL)

- Browserbase Developer $39/mois + Stagehand SDK
- Apollo Basic $49/mois
- Claude Sonnet 4.6 ~$15/mois
- Resend (existant) : 0
- **Total : ~110 CHF/mois**

⚠️ Ban LinkedIn risk élevé sur compte Alain. Maintenance lourde (LinkedIn change DOM tous les 2-3 mois). Setup 1 semaine.

---

## 7. Data flow détaillé Option A

```
[Cron Railway 09:00]
  → fetchApolloLeads(savedSearchId) → SQLite prospects (status=new)
[Cron 09:15]
  → SELECT new → Haiku 4.5 ICP filter (qualif/reject/needs_review)
  → UPDATE status
[Cron 09:30]
  → SELECT qualified → Sonnet 4.6 writeIcebreaker (FR/DE/EN selon lang)
  → INSERT draft_message
[Cron 10:00]
  → SELECT drafts (max 30/jour) → Smartlead send + Langfuse trace
  → UPDATE status=sent + timestamp
[Webhook Smartlead] → INSERT events (open/click/bounce/reply)
[Cron J+3, J+7] → follow-up sequences si no-reply
[Cal.com webhook] → INSERT meeting_booked → mark won
```

Tout en TypeScript dans le repo openswissdata existant, sous `src/marketing/`.

---

## 8. 3 ICPs prioritaires + séquences prêtes

### ICP1 — Payroll Engineering (Lano, Multiplier, Deel, Remote, Papaya)

**Filtre Apollo** : `title contains payroll, tax, compliance` + `company in [Lano, Multiplier, Deel, Remote, Papaya, Native Teams]` + `seniority >= manager`

**Hook** : ils maintiennent eux-mêmes mappings TARES/HS pour facturation customs CH employeurs.

**Email 1 J0** :
```
Subject: {{firstName}}, comment {{company}} gère les codes TARES updates ?

Salut {{firstName}},

J'ai vu votre stack publique sur {{company}} side ({{icebreaker}}).
Question concrète : comment vous tenez à jour les correspondances HS/TARES côté payroll CH quand le BAZG pousse un changement (3-4×/an) ?

On a normalisé TARES en JSON/Parquet versionné (semver, diff par release).
Snapshot test : 7 511 lignes, ~140 changements/an traçables.

Worth 15min ?
Alain — openswissdata.com
[Disclaimer: dataset non-officiel dérivé de TARES, opérateur indépendant]
```

**Email 2 J+3** : value-add (extrait JSON 50 lignes + screenshot diff GitHub style)
**Email 3 J+7** : case usage + CTA Cal.com
**Email 4 J+12** : break-up `Je clos la boucle, ping moi si besoin un jour`

### ICP2 — Compliance Officers IAM CH (banques cantonales, gestionnaires)

**Filtre Apollo** : `country=CH` + `industry in [investment management, financial services]` + `headcount 5-200` + `title contains compliance, MLRO, risk`

**Cadrage** : waitlist FINMA Registry. Pas de vente — phase research.

**Email 1** :
```
Subject: Research : un FINMA Registry unifié JSON serait-il utile pour {{company}} ?

{{firstName}},

Je construis openswissdata.com — Registry FINMA unifié (assujettis + intermédiaires + retraits) en JSON/SQL versionné, à la place du PDF + 3 portails séparés.

Pas de vente — phase research jusqu'à autorisation FINMA. 5 IAM sont sur la waitlist early-access.

Vous voulez tester gratuitement le sample 100 entités quand prêt ?
Reply « yes » ou : openswissdata.com/finma-waitlist

Alain
```

### ICP3 — CTOs Proptech CH (Houzy, Properti, RealAdvisor, Neho, IMMOMIG)

**Filtre Apollo** : `country=CH` + `industry=real estate` + `headcount 10-100` + `title contains CTO, founder, head of engineering`

**Cadrage** : waitlist Classifications + futur RegBL

**Email 1** :
```
Subject: {{firstName}}, vos données NOGA viennent d'où ?

{{firstName}},

J'ai testé l'API {{company}} — quand un agent enregistre une entreprise vendeur/acheteur, le code NOGA est saisi à la main ou auto ?

Je prépare un dataset NOGA/NACE/ISIC normalisé avec cross-walks (lookup nom commercial → code) + sync trimestrielle. Sample gratuit early-access dispo.

Worth 10min de feedback sur ce qu'un proptech consommerait vraiment ?

Alain — openswissdata.com
```

---

## 9. Templates icebreaker LLM (Claude Haiku 4.5)

**System prompt cached** :
```
Tu génères 1 phrase d'icebreaker FR ou EN selon langue détectée.
Règles strictes :
- 12-22 mots, factuelle, jamais flatteuse ("loved your post" interdit)
- Cite UN détail vérifiable du signal fourni
- Pas de "I noticed that", commencer par le détail
- Si signal vide → renvoyer null (jamais inventer)
```

**Coût par lead** : ~0.02 CHF (Sonnet) ou ~0.005 CHF (Haiku). 1000 leads/mois = 5-20 CHF.

**3 sources de signaux** :
- Post LinkedIn récent (titre + 300 chars)
- News entreprise (funding, hire, launch)
- GitHub commit/changelog produit public

---

## 10. Inbound + content (long terme, ROI 6-12 mois)

### Top 5 SEO long-tail prioritaires (volume × concurrence)

| Mot-clé | Vol. CH/mois | Concurrence | Action |
|---|---|---|---|
| `TARES download` / `TARES JSON` | 70-150 | Très faible | Page dédiée + tool gratuit |
| `Quellensteuer Tarif CSV` | 80-180 | Moyenne | Dataset + article |
| `NOGA codes CSV` | 100-200 | Moyenne | Page + CSV téléchargeable |
| `HS code lookup Switzerland` | 200-400 | Moyenne | Tool web freemium |
| `BFS opendata CSV` | 100-200 | Faible | Index pages |

### Lead magnets ROI top 3

1. **HS Code Lookup Tool freemium** (10 lookups/jour) — 12h setup, 100-300 leads 6 mois
2. **Calculateur droits import CH** (HS6 + pays + valeur) — 20-30h setup, 150-400 leads 6 mois
3. **Newsletter "Swiss Compliance Weekly"** — 6h setup + 2h/post, 200-500 abonnés 6 mois

### Programmatic SEO (long-terme, gros levier)

Astro static generation :
- `/hs/[code]` → 9 500 pages TARES (500-2 000 visites/mois cumulé)
- `/noga/[code]` → 1 200 pages (100-400/mois)
- `/finma/[uid]` → 3 500 pages (50-200/mois)
- `/quellensteuer/[canton]/[year]` → 260 pages (200-600/mois saisonnier)

**Total potentiel 12 mois** : 1 000-3 500 visites organiques/mois après ramp-up Google 4-6 mois.

### Distribution sans budget (top 5)

1. **Show HN launch** : 1 post HN qualité = 5 000-15 000 visites spike + tail durable
2. **awesome-lists PR** : `awesome-ogd-switzerland` + `awesome-public-datasets` = backlinks DR à vie (2h)
3. **GitHub `openswissdata/datasets-sample`** : sample 100 lignes par dataset, MIT, 50-200 stars 1ère année si bien promu
4. **npm `@openswissdata/sdk`** : 100-500 DL/sem si bien listé
5. **LinkedIn founder-led** : 3 posts/sem (NOGA insights, TARES updates, FINMA news)

---

## 11. Programmes startup CH à candidater

| Programme | Bénéfice | Effort | Verdict |
|---|---|---|---|
| **Venture Kick** | 10k + 40k + 150k CHF + visibilité | 20h pitch | ✅ TOP priorité |
| **Swisscom StartUp Challenge** | Silicon Valley + presse | 1 application/an | ✅ Levier presse même finaliste |
| **Kickstart Innovation** | 11 sem + 25-150k + corporates | Q1 application | ✅ Si OK Zurich plusieurs sem |
| **>>venture>>** | 10-150k + presse | Plan 30 pages | ✅ Échéance avril-juin |
| **Innosuisse** | Coaching gratuit | 40h dossier | ⚠️ Subventions = partenaire académique requis |

**Action 30j** : candidater Venture Kick stage 1 + Swisscom Challenge simultanément. ROI = 60k CHF potentiel + 10 articles presse.

---

## 12. Plan opérationnel 30 jours (Phase 1 prioritaire)

### Semaine 1 — Setup infra (J1-J7)
- J1 : 3 mailboxes secondaires + DKIM/SPF/DMARC (24 CHF/an)
- J2-3 : Smartlead warmup 14j lance + schéma SQLite leads/events/sequences
- J4 : 3 ICPs définis + filtres Apollo URL
- J5 : Script `pull-leads.ts` Apollo → SQLite (300 ICP1 + 200 ICP2 + 150 ICP3)
- J6 : Enrichissement signaux (LinkedIn posts récents)
- J7 : Pré-qualif Haiku 4.5 (200 leads score ≥60)

### Semaine 2 — Outbound automation (J8-J15)
- J8 : Génération 200 icebreakers Haiku
- J9 : ICP1 Payroll seq A live (4 emails/8 jours)
- J10 : LinkedIn manuel — 20 connect/jour ICP1 (compte Alain, note Haiku-generated)
- J11 : ICP2 Compliance seq B (waitlist FINMA)
- J12 : ICP3 Proptech seq C (waitlist Classifications)
- J13 : Stripe LIVE switch + bouton TARES
- J14 : A/B test subject lines
- J15 : 1er debrief data

### Semaine 3 — Inbound (J16-J22)
- J16 : Post LinkedIn long-form Alain "Why we built openswissdata"
- J17 : Show HN `Show HN: Swiss customs tariff data, normalized`
- J18 : Mini-tool gratuit `tares.openswissdata.com/lookup`
- J19 : Indexer 200 pages HS code SEO
- J20 : Soumettre à 3 newsletters niche
- J21 : Listing 5 directories
- J22 : 1er appel discovery booké

### Semaine 4 — Mesure + itération (J23-J30)
- J23 : Dashboard Hono `/admin/funnel`
- J24 : Analyse cohorte par séquence
- J25 : Doubler budget sur ICP gagnant
- J26 : Réécrire séquence perdante
- J27 : Newsletter broadcast Resend
- J28 : LinkedIn → 30 connect/j sur ICP gagnant
- J29 : Rapport J+30 généré auto
- J30 : Décision GO/PIVOT/KILL

---

## 13. KPIs cibles 30 jours (réalistes)

| Métrique | Floor (échec) | Target | Stretch |
|---|---|---|---|
| Leads sourcés DB | 500 | 800 | 1 200 |
| Leads contactés (email) | 400 | 650 | 1 000 |
| Open rate | <25 % | 35-45 % | >50 % |
| Reply rate | <1 % | 2-4 % | >5 % |
| Réponses positives | <3 | 8-15 | 25 |
| Meetings discovery | 0 | 2-5 | 8 |
| LinkedIn connections | 50 | 100-150 | 200 |
| Inbound waitlist signups | 5 | 20-40 | 80 |
| Visiteurs landing | <200 | 500-800 | 1 500 |
| **Ventes TARES bouclées** | **0** | **1-3** | **5** |

**Revenu mois 1 attendu** : 0 à 1 500 CHF. Vraie victoire = pipeline mois 2-3 et signal product/market.

---

## 14. Plan B — décision J+30

1. **Reply rate <1% sur 400+ envois** → pitch cassé, réécrire séquences avec apprentissages
2. **Reply OK mais 0 meeting** → CTA cassée, remplacer par asset gratuit avant call
3. **Meetings OK mais 0 close** → prix cassé, tester 99 CHF entry tier
4. **Waitlist FINMA/Classifications <10 signups** → demande latente faible, doubler sur TARES expansion (HS6 → TARIC EU)
5. **Tout vert sauf revenu** → normal mois 1, continuer 30j sans changer la stack
6. **Tout rouge** → pivoter vers partenariat distributeur (1 deal éditeur ERP CH = 50 ventes directes)

---

## 15. Sources vérifiées HTTP 200

- [Apollo.io Pricing](https://www.apollo.io/pricing) | [API docs](https://docs.apollo.io/docs/api-pricing)
- [Smartlead Pricing](https://www.smartlead.ai/pricing)
- [Instantly Pricing](https://instantly.ai/pricing)
- [Heyreach Pricing](https://www.heyreach.io/pricing)
- [Clay Pricing](https://www.clay.com/pricing)
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Browserbase Pricing](https://www.browserbase.com/pricing)
- [Resend Pricing](https://resend.com/pricing)
- [Hunter.io Pricing](https://hunter.io/pricing)
- [Lemlist Pricing](https://www.lemlist.com/pricing)
- [LinkedIn Limits 2026 — LeadLoft](https://www.leadloft.com/blog/linkedin-limits)
- [LinkedIn Ban Risk 23% — Growleads](https://growleads.io/blog/linkedin-automation-ban-risk-2026-safe-use/)
- [HeyReach C&D 2025 — Kondo](https://www.trykondo.com/blog/heyreach-review)
- [nFADP — admin.ch KMU](https://www.kmu.admin.ch/kmu/en/home/facts-and-trends/digitization/data-protection/new-federal-act-on-data-protection-nfadp.html)
- [Gmail 2026 sender requirements](https://litemail.ai/blog/gmail-2026-sender-requirements-prewarmed-inboxes-mandatory)
- [Cold email benchmarks 2026 — DevCommX](https://www.devcommx.com/blogs/b2b-cold-email-benchmarks)
- [Nanocorp Pricing](https://www.nanocorp.so/pricing)
- [Venture Kick](https://www.venturekick.ch/)
- [Swisscom StartUp Challenge](https://www.swisscom-startupchallenge.ch/)
