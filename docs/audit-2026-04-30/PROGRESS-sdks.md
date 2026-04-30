# PROGRESS — Open-source SDKs (audit 2026-04-30)

**Date d'exécution :** 2026-04-30
**Cible :** trois packages prêts à publier sur GitHub + npm + PyPI sous Apache 2.0, sans publication automatique. Distribution en attente de validation finale.

## Livrables

Tout vit dans `sdks/` à la racine du repo principal. Aucun repo séparé créé — Alain pourra éclater plus tard si besoin.

### A. `sdks/sdk-ts/` — `@openswissdata/sdk` v0.1.0

Client TypeScript HTTP qui enveloppe l'endpoint MCP JSON-RPC live (`https://mcp.openswissdata.com/jsonrpc`). Anonyme par défaut, Bearer token optionnel.

- **Dual ESM + CJS** (build via 3 tsconfig séparés ; post-build `scripts/postbuild-cjs.cjs` pose `package.json {type:commonjs}` dans `dist/cjs/` pour échapper au `type: module` racine, vérifié par `node -e require(...)` et `node --input-type=module`).
- **Types stricts**, no any non justifié, fichier d'erreurs hiérarchisé (`OpenSwissDataError`, `AuthError`, `RateLimitError`, `ServerError`, `NetworkError`, `ToolError`).
- **Surfaces** : `client.tares.{lookup, search, changelog}`, `client.classifications.{crossWalk, classifyText}`, `client.finma.{kycCheck, search, entityHistory}`.
- **Retry exponentiel + jitter** sur 5xx et erreurs réseau (3 tentatives par défaut), 429 surfacé immédiatement avec `retryAfterSeconds`/`limit`/`remaining`/`reset`.
- **Tests Vitest** (20 tests, fetch mocké) : auth, rate-limit, retry, network errors, tool errors, capture rate-limit, surface TARES + classifications + FINMA.
- **Exemples** : `examples/nodejs.ts` (CRUD complet) et `examples/browser.html` (CDN ESM module).

### B. `sdks/sdk-py/` — `openswissdata` v0.1.0

Sync `Client` + Async `AsyncClient` sur httpx. Type hints partout (Python 3.10+).

- **`pyproject.toml` hatchling**, extras `[pandas]` et `[dev]` (pytest, pytest-asyncio, respx, ruff, mypy strict). `py.typed` shipped.
- **CLI** `openswissdata` (= `python -m openswissdata`) : `discovery`, `tariff-lookup`, `tariff-search`, `crosswalk`, `classify`, `finma-search` ; output JSON ; lit `OPENSWISSDATA_API_KEY` automatiquement.
- **Hiérarchie d'erreurs** symétrique avec le TS : `OpenSwissDataError`, `AuthError`, `RateLimitError`, `ServerError`, `NetworkError`, `ToolError`.
- **Retry exponentiel** côté sync (`time.sleep`) et async (`asyncio.sleep`).
- **Tests pytest** (23 tests, `httpx.MockTransport`) : auth, rate-limit, retry sur 503, server errors, network errors, tool errors, dataset surfaces, async flow complet.
- **Exemples** : `examples/basic.py`, `examples/async_demo.py` (asyncio.gather), `examples/pandas_integration.py` (lookup batch → DataFrame).
- Build sdist + wheel vérifiée : `openswissdata-0.1.0.tar.gz` et `openswissdata-0.1.0-py3-none-any.whl` produits sans warnings.

### C. `sdks/mcp-server/` — `@openswissdata/mcp` v0.1.0

Serveur MCP STDIO standalone qui proxy vers l'endpoint HTTP remote — différent du MCP intégré dans le backend Hono. C'est ce que les utilisateurs Claude Desktop / Cursor / Cline installent localement.

- Utilise **`@modelcontextprotocol/sdk` ^1.0.0** (StdioServerTransport + low-level `Server.setRequestHandler`).
- Forward `tools/list` et `tools/call` vers le remote ; les disclaimers TARES restent intacts dans `content[].text`.
- Configuration via env : `OPENSWISSDATA_API_KEY`, `OPENSWISSDATA_BASE_URL`, `OPENSWISSDATA_TIMEOUT_MS`. Anonyme OK par défaut.
- Bin entrypoint `openswissdata-mcp` exécutable, shebang OK, --help / --version testés.
- **Dockerfile two-stage non-root** (Glama/Smithery friendly).
- **Tests Vitest** (9 tests) : proxy HTTP (auth header, JSON-RPC unwrap, erreur protocol, baseUrl trim) + buildServer wiring.
- **Exemples** : `claude-desktop-config.json`, `cursor-mcp.json`, `cline-config.json` (snippets prêts à coller).

## Validation locale

| Suite | Tests | Résultat |
| ----- | ----- | -------- |
| `sdks/sdk-ts` (vitest) | 20 | ✅ pass |
| `sdks/sdk-py` (pytest) | 23 | ✅ pass |
| `sdks/mcp-server` (vitest) | 9 | ✅ pass |
| **Total** | **52** | **✅ pass** |

Aucun test ne touche l'API live — tout passe par fetch / httpx mocks. Typecheck strict OK pour les 2 packages TypeScript ; build dual ESM+CJS validée par chargement runtime.

## Instructions de publication finale

⚠️ **Rien n'est publié pour le moment.** Étapes à exécuter une fois la validation d'Alain donnée :

### npm (sdk-ts + mcp-server)

```bash
# 1. Login (one-time)
npm login --scope=@openswissdata

# 2. Bump version si besoin (sinon 0.1.0)
cd sdks/sdk-ts && npm version 0.1.0 --no-git-tag-version
cd sdks/mcp-server && npm version 0.1.0 --no-git-tag-version

# 3. Publier (le hook prepublishOnly relance typecheck + tests + build)
cd sdks/sdk-ts && npm publish --access public
cd sdks/mcp-server && npm publish --access public

# 4. Vérifier
npm view @openswissdata/sdk version
npm view @openswissdata/mcp version
```

### PyPI (sdk-py)

```bash
cd sdks/sdk-py
.venv/bin/pip install --upgrade build twine
.venv/bin/python -m build           # produit dist/openswissdata-0.1.0{.tar.gz,-py3-none-any.whl}
.venv/bin/twine check dist/*
.venv/bin/twine upload dist/*       # demande user/pass ou token API PyPI
```

### Docker / Glama / Smithery (mcp-server, optionnel)

```bash
cd sdks/mcp-server
docker build -t openswissdata/mcp:0.1.0 .
docker tag openswissdata/mcp:0.1.0 openswissdata/mcp:latest
docker push openswissdata/mcp:0.1.0
docker push openswissdata/mcp:latest
# Soumettre à Smithery / Glama via leurs flows respectifs (formulaire web).
```

## Conflits de noms

Les anciens packages `packages/sdk-ts` et `packages/sdk-py` (loaders CSV bas-niveau pour les bundles ZIP) restent en place et utilisent les mêmes noms `@openswissdata/sdk` / `openswissdata`. Avant de publier, **deux options** :

1. **Déprécier l'ancien** : supprimer `packages/sdk-ts` et `packages/sdk-py` (les nouveaux SDKs sont strictement supérieurs).
2. **Renommer le nouveau** : `@openswissdata/client` / `openswissdata-client`.

Recommandation : option 1 (les anciens loaders n'ont jamais été publiés).
