// Retirer les anciens fichiers générés ; garder le cache des modèles figés.
import { readdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
if (existsSync(root)) {
  for (const name of readdirSync(root)) {
    if (name !== "models") rmSync(join(root, name), { recursive: true, force: true });
  }
}
