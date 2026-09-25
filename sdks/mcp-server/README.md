# @openswissdata/mcp

Passerelle MCP STDIO vers le service HTTPS OpenSwissData, pour les clients qui lancent un processus local. Elle transmet les descriptions et les résultats du serveur, y compris les avertissements de source non officielle.

## Accès disponible

Le serveur expose huit outils. Trois sont accessibles anonymement, avec une limite de 100 appels par jour et par IP : `tariff_lookup`, `cross_walk`, `kyc_check`.

`tariff_semantic_search`, `tariff_changelog`, `classify_text`, `finma_search` et `entity_history` exigent des droits existants. Les nouvelles souscriptions payantes sont fermées. L’achat d’un fichier ne crée pas de clé API. `statent_lookup` a été retiré du service.

## Configuration

Version 0.1.2 relue dans le registre public le 25.09.2026, avec une intégrité identique à l’archive vérifiée.

Exemple pour un client compatible avec `mcpServers` :

```json
{
  "mcpServers": {
    "openswissdata": {
      "command": "npx",
      "args": ["-y", "@openswissdata/mcp"]
    }
  }
}
```

Les clients qui acceptent directement MCP HTTP peuvent utiliser `https://mcp.openswissdata.com/jsonrpc`, sans cette passerelle. Les outils et leurs schémas proviennent du serveur à chaque consultation.

| Variable | Valeur par défaut | Usage |
| --- | --- | --- |
| `OPENSWISSDATA_API_KEY` | Aucune | Jeton déjà accordé, pour les droits associés |
| `OPENSWISSDATA_BASE_URL` | `https://mcp.openswissdata.com` | Serveur de substitution |
| `OPENSWISSDATA_TIMEOUT_MS` | `30000` | Délai incluant la lecture complète de la réponse |

Une clé reste dans la configuration privée du client. Les diagnostics vont vers stderr ; stdout est réservé au protocole. `openswissdata-mcp --version` et `--help` affichent la version et l’aide.

## Développement et vérification

Node 22 est utilisé pour les contrôles. Le runtime conserve sa déclaration Node 18+ ; utiliser une version encore maintenue.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Les tests vérifient un échange MCP complet avec le SDK officiel et l’interruption d’une réponse dont le corps reste bloqué. Une modification du dépôt ne publie pas automatiquement une nouvelle version npm : vérifier séparément le registre avant distribution.

Le Dockerfile fournit une alternative locale : `docker build -t openswissdata-mcp .`, puis `docker run --rm -i openswissdata-mcp`.

## Limites métier

OpenSwissData est une copie non officielle. Conserver les avertissements remis à l’utilisateur. Une correspondance approchée exige une validation métier ; un tarif absent ne signifie pas gratuité ; l’absence de résultat FINMA n’est pas une certification de conformité. Consulter les sources originales avant une décision.

Licence Apache-2.0. [Documentation du SDK MCP utilisé](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).
