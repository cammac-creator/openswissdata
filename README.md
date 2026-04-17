# openswissdata.com

Normalized Swiss government datasets for data engineers and compliance officers.

## Local dev

```bash
npm install
cp .env.example .env
# fill in secrets
npm run db:migrate && npm run db:seed
npm run dev
```

API on http://localhost:3000

## Scripts

- `npm run dev` — hot-reload backend
- `npm run web:dev` — Astro frontend
- `npm run etl:tares|classifications|finma` — refresh dataset and release new version
- `npm run test` — run test suite
