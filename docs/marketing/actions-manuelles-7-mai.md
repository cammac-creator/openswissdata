# Actions manuelles — 7 mai 2026

10 actions, ~3h total. Classées par impact / urgence.

## 1. Activer TWINT dans Stripe Dashboard (5 min)

1. Aller sur https://dashboard.stripe.com/settings/payment_methods
2. Onglet "Switzerland" / cliquer sur "TWINT"
3. Activer (ils confirment instantanément si compte CH validé)
4. Vérifier que le checkout affiche TWINT : ouvrir https://www.openswissdata.com/bundle, cliquer "Acheter", et regarder les options de paiement sur la page Stripe

Le code est déjà prêt : `src/routes/checkout.ts` utilise désormais `automatic_payment_methods.enabled = true`, qui surface automatiquement toutes les méthodes activées dans le dashboard.

## 2. Republier au MCP Registry officiel (3 min)

```bash
cd /Users/claude-alainmartin/openswissdata
mcp-publisher login github     # navigateur va s'ouvrir, tu approuves
mcp-publisher publish          # publie server.json (déjà v0.2.0)
```

Vérifier ensuite :
```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers/io.github.cammac-creator%2Fopenswissdata" | jq .version
# devrait retourner "0.2.0"
```

## 3. Soumettre openswissdata sur glama.ai (10 min)

1. Login GitHub sur https://glama.ai
2. "Add MCP server" → coller URL repo `https://github.com/cammac-creator/openswissdata`
3. Attendre le scan automatique (~5 min, retour par email)
4. Si Quality < A ou Security < A : lire les recommandations Glama et ajuster le repo
5. Une fois badge AAA obtenu : commenter sur PR awesome-mcp-servers#5966 avec le lien badge

Ce badge débloque le merge de la PR (sinon les bots de triage la fermeront comme la première PR ibanforge #4053).

## 4. Editer le listing mcp.so (5 min)

1. Login GitHub sur https://mcp.so
2. Submit nouveau MCP server avec :
   - Repo: https://github.com/cammac-creator/openswissdata
   - Tags: `swiss, federal, tares, finma, noga, compliance, customs, government, kyc, classifications`
   - Description courte: "Swiss federal open data via MCP — TARES, FINMA, NOGA with cryptographic provenance"

## 5. Google Search Console : désindexer /famille (3 min)

1. Aller sur https://search.google.com/search-console
2. Sélectionner la propriété `https://www.openswissdata.com`
3. Outils → "Suppression d'URL"
4. Soumettre `https://www.openswissdata.com/famille`
5. Sélectionner "Supprimer définitivement de Search"

Sous 24h, /famille disparaît de Google. La page reste accessible si on connaît l'URL (mais elle a `noindex` donc Google ne la re-indexera plus).

## 6. Créer la Sàrl + obtenir IDE/UID via EasyGov (40 min puis 10 jours d'attente)

1. Aller sur https://www.easygov.swiss/easygov/
2. Login eIAM ou créer compte (si pas déjà fait)
3. "Création d'entreprise" → "Sàrl"
4. Dénomination : "openswissdata Sàrl" ou "openswissdata SA" (vérifier dispo via Zefix)
5. Adresse : Rue de l'Église 23, 1045 Ogens (idem raison individuelle)
6. Capital social : 20 000 CHF (10 000 libérables minimum)
7. Activité : "Commerce de données et services informatiques"
8. Frais inscription RC + IDE : ~500-800 CHF total
9. Délai : ~10 jours calendaires

À la réception du numéro IDE :
- Mettre à jour `web/src/pages/legal/impressum.astro`
- Mettre à jour Stripe (Settings → Business → Tax info)
- Ajouter "IDE: CHE-XXX.XXX.XXX" sur le footer du site
- Notifier les clients existants (newsletter)

## 7. Pitcher Magic Heidi (5 min)

Email prêt dans `docs/marketing/partenariats-pitch-2026-05-07.md`. Copier-coller, vérifier nom expéditeur (ne PAS utiliser ton mail employeur), envoyer à `contact@magicheidi.ch`.

## 8. Pitcher Spedlogswiss (5 min)

Email prêt dans `docs/marketing/partenariats-pitch-2026-05-07.md`. Copier-coller, ajouter ton numéro de téléphone (ils préfèrent l'oral), envoyer à `info@spedlogswiss.com`.

## 9. Pitcher Pelt8 (10 min)

1. Identifier le founder de Pelt8 sur LinkedIn (page entreprise → posts récents → identifier qui signe)
2. LinkedIn DM (depuis ton compte burner ou un compte propre dédié — PAS ton perso)
3. Texte prêt dans `docs/marketing/partenariats-pitch-2026-05-07.md`

## 10. Décider du stack outreach (15 min de réflexion)

3 options dans le rapport HTML (`.design-preview/debrief-7-mai-2026.html`) :

- **200 CHF/mois** — Smartlead Basic + Dropcontact + Chatbase + 6 mailboxes. ZÉRO LinkedIn. 200-300 emails/jour conformes nLPD.
- **700 CHF/mois** — Stack 200 + La Growth Machine (LinkedIn cloud safe sur compte burner) + Clay Launch (signaux). Recommandé si tu veux cumuler email + LinkedIn outbound sans risquer l'employeur.
- **1240 CHF/mois** — Stack 700 + Apollo + Regie.ai AI SDR + Clay Growth. Optimal mais à valider après 1 mois sur stack 700.

Ma reco : **commencer 200 CHF**, valider que les emails convertissent (open > 40 %, reply > 3 %), puis upgrade vers 700 CHF en mois 2.

Si tu valides le 200 CHF, je peux configurer Smartlead + Dropcontact + Chatbase + 6 mailboxes Google Workspace en autonomie demain matin (tu auras juste à payer les souscriptions et m'envoyer les credentials).

---

## Quand tu reviens demain matin

1. Ouvrir le rapport HTML : `open .design-preview/debrief-7-mai-2026.html`
2. Lire les 10 actions ci-dessus
3. Décider de l'ordre (mon ordre suggéré : 1 → 2 → 5 → 7 → 8 → 9 → 10 → 4 → 3 → 6)
4. Si je suis encore réveillé : me dire ce que tu fais, je continue

Bonne nuit ✦
