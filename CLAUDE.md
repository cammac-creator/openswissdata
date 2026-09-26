# openswissdata — project instructions

## Stack
- Node >=22.12 + TypeScript strict (Node 22 dans la CI et Railway)
- Hono for backend API
- Astro for SSG landing
- better-sqlite3 (WAL mode) for data
- Stripe Checkout for payments
- Resend for transactional email
- Cloudflare R2 for ZIP storage

## Conventions
- Langue : français pour les échanges, commentaires et commits ; identifiants de code conservés en anglais
- Commits: conventional commits (feat:, fix:, chore:, docs:)
- Tests: Vitest, co-located in `tests/` mirroring `src/` structure
- No `any` unless justified
- Errors: `HTTPException` from Hono, never silent try/catch
