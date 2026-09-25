/** SheetJS officiel, variante Node avec système de fichiers et encodages inclus. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX: typeof import("xlsx") = require("xlsx");
export default XLSX;
export const { utils, writeFile } = XLSX;
