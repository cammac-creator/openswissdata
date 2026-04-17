# openswissdata — project instructions

## Stack
- Node 20 + TypeScript strict
- Hono for backend API
- Astro for SSG landing
- better-sqlite3 (WAL mode) for data
- Stripe Checkout for payments
- Resend for transactional email
- Cloudflare R2 for ZIP storage

## Conventions
- Language: English in code, French for user-facing copy
- Commits: conventional commits (feat:, fix:, chore:, docs:)
- Tests: Vitest, co-located in `tests/` mirroring `src/` structure
- No `any` unless justified
- Errors: `HTTPException` from Hono, never silent try/catch
