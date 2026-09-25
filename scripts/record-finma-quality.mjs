// Or public → témoin de contrôle : uniquement les agrégats publics, sans clients.
import { mkdirSync, writeFileSync } from "node:fs";
const response = await fetch("https://www.openswissdata.com/api/catalog/finma");
if (!response.ok) throw new Error(`Catalogue FINMA : HTTP ${response.status}`);
const data = await response.json();
const today = new Date().toISOString().slice(0,10);
if (data.collected_on !== today || data.registry_rows < 2000 || data.warning_rows < 1000) throw new Error("Collecte du jour absente ou incomplète");
const { sample, ...quality } = data;
mkdirSync("docs/data-status", {recursive:true});
writeFileSync("docs/data-status/finma.json", JSON.stringify(quality,null,2)+"\n");
console.log(JSON.stringify({version:quality.version, registry_rows:quality.registry_rows, lei_rows:quality.populated_fields.lei, checked:true}));
