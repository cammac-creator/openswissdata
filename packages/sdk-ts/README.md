# @openswissdata/sdk

TypeScript SDK for working with datasets from [openswissdata.com](https://openswissdata.com).

## Install

```bash
npm install @openswissdata/sdk
```

## Usage

### Load TARES

```ts
import { loadTares } from "@openswissdata/sdk";

const rows = await loadTares("./tares-2026.04.22/tares.csv");
console.log(rows.length, "codes loaded");

// Find a specific HS code
const row = rows.find(r => r.hs8 === "84820010");
console.log(row?.designation_fr);
```

### Load Classifications with cross-walks

```ts
import { loadClassifications, loadCrossWalks } from "@openswissdata/sdk";

const nomenclatures = await loadClassifications("./classifications-2026.04.22/");
const walks = await loadCrossWalks("./classifications-2026.04.22/crosswalks.csv");

// Map NOGA 2008 '6411' to ISIC 4
const walk = walks.find(w => w.noga_2008 === "6411");
console.log("ISIC equivalent:", walk?.isic_4);
```

### Load FINMA registry

```ts
import { loadFinmaRegistry } from "@openswissdata/sdk";

const entities = await loadFinmaRegistry("./finma-2026.04.22/finma_registry.csv");
const banks = entities.filter(e => e.entity_type === "bank");
console.log(banks.length, "banks in the registry");
```

## Helpers

### Join by key

```ts
import { joinBy } from "@openswissdata/sdk";

const enriched = joinBy(
  tares,
  hsLookups,
  row => row.hs6,
  lookup => lookup.code
);
```

## Buying datasets

The SDK is free and open-source. The datasets themselves are sold at https://openswissdata.com.
- TARES: CHF 299 · Classifications Bundle: CHF 399 · FINMA Registry: CHF 299 · Full Bundle: CHF 799.

## License

[Apache 2.0](./LICENSE)
