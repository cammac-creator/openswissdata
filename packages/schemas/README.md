# openswissdata-schemas

JSON Schemas (Draft-07) describing the datasets distributed by [openswissdata.com](https://openswissdata.com).

These schemas are the canonical structural contract for each dataset. They are versioned alongside the dataset bundles.

## Available schemas

- [tares.schema.json](./tares.schema.json) — Swiss customs tariff codes (HS8)
- [classifications.schema.json](./classifications.schema.json) — NOGA 2008/2025 + NACE Rev 2/2.1 + ISIC Rev 4 + cross-walks
- [finma.schema.json](./finma.schema.json) — FINMA authorised institutions registry (unified across 10 source lists)

## License

[CC0 1.0 Universal](./LICENSE) — public domain dedication. Use these schemas freely, no attribution required.

## Versioning

Schemas follow semantic versioning. A breaking change bumps major; new optional fields bump minor.

## Linking from code

### TypeScript / Node

```bash
npm install @openswissdata/schemas
```

```ts
import tares from "@openswissdata/schemas/tares.schema.json" assert { type: "json" };
```

### Python

Schemas are JSON; load with `json.load` or `jsonschema`.

## Contributing

Open an issue or PR. Schemas track the commercial datasets sold at openswissdata.com. Changes to structure coordinate with dataset version releases.

---

© 2026 Alain Martin · openswissdata.com · CC0
