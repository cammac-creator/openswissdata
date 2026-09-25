# @openswissdata/sdk

Client TypeScript du service MCP HTTP OpenSwissData : TARES, classifications NOGA/NACE/ISIC et registre FINMA. Distribution ESM et CommonJS, types inclus, aucune dépendance d’exécution supplémentaire. Ce dossier concerne l’API distante ; `packages/sdk-ts` contient un lecteur de fichiers distinct.

## Commencer

Publication de la version 0.1.0 envoyée au registre le 25.09.2026 ; sa disponibilité externe reste à confirmer au moment de cette mise à jour. Si npm répond 404, utiliser la compilation et l’installation par archive ci-dessous.

```bash
npm install @openswissdata/sdk
```

Pour compiler la version du dépôt : `npm ci`, `npm run build`, puis `npm pack`. Installer ensuite le fichier `.tgz` produit dans le projet consommateur.

```ts
import { Client } from "@openswissdata/sdk";
const client = new Client();
const tarif = await client.tares.lookup({ hs8: "09011100", lang: "fr" });
console.log(tarif.designation, tarif.duty_mfn);
console.log(tarif.disclaimer, tarif.summary_note);
const liens = await client.classifications.crossWalk({
  code: "62.10", source: "NOGA_2025", target: "NACE_2.1",
});
console.log(liens.reference_version, liens.mappings, liens.limitations);
const registre = await client.finma.kycCheck({ name: "UBS", top_k: 3 });
console.log(registre);
```

Ces trois opérations sont accessibles anonymement, dans la limite de 100 appels par jour et par IP. Les recherches sémantiques, historiques et recherches FINMA avancées exigent des droits existants. Les nouvelles souscriptions payantes sont fermées ; acheter un fichier ne donne pas de clé API.

Une mise à jour du dépôt ne publie pas automatiquement le paquet npm. Les champs de version et de qualité documentés ici décrivent le code de cette branche ; contrôler la distribution choisie avant de l’intégrer.

## Configuration et erreurs

```ts
const client = new Client({
  apiKey: process.env.OPENSWISSDATA_API_KEY,
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBackoffMs: 250,
});
```

Le délai couvre les en-têtes et le corps de chaque tentative. Les erreurs réseau et HTTP 500, 502, 503 ou 504 sont réessayées au plus trois fois par défaut : quatre tentatives au total. Les réponses 401/403, 429 et les erreurs métier remontent directement. `maxRetries: 0` désactive la reprise.

Classes exportées : `AuthError`, `RateLimitError`, `ServerError`, `NetworkError`, `ToolError`, `OpenSwissDataError`. `RateLimitError.retryAfterSeconds` et `client.lastRateLimit` exposent les quotas reçus.

Le client accepte `structured` historique et `structuredContent` du standard MCP. Le champ des résultats de classification sémantique est `label`, accompagné de `scheme` ; ce n’est pas `label_fr`.

## Intégration dans un site

Utiliser le client côté serveur pour conserver les clés privées. Un navigateur ne peut appeler le domaine distant que si CORS et la politique de contenu du site l’autorisent ; cette possibilité n’est pas activée universellement. Pour une interface publique, exposer une route de son propre serveur avec les contrôles et limites adaptés. Ne jamais placer un jeton payant dans du JavaScript livré au navigateur.

## Qualité des résultats

Conserver les avertissements de source non officielle. Un droit absent ne signifie pas gratuité ; les taux conditionnels complets sont distincts du résumé. Les correspondances indiquent `relation`, `requires_review`, `path`, leurs sources et limites ; une relation approchée n’est pas une identité. Une recherche FINMA ne remplace pas une vérification auprès de la source.

## Développement

Node 22 est utilisé par la CI. Les déclarations d’exécution restent Node 18+ ; utiliser une version encore maintenue.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Les tests utilisent des réponses fictives et couvrent délais, reprises, droits, quotas et erreurs. La CI construit les distributions ESM/CommonJS et contrôle les avis npm. Licence Apache-2.0.
