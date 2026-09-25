import { readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "./db.js";

/** Vérification locale de démarrage ; aucune requête à un prestataire externe. */
export function checkReadiness(dbProvider: () => Database.Database = getDb, webRoot = resolve("web/dist")) {
  const checks = { database: false, frontend: false };
  try {
    const db = dbProvider();
    // Une base vide créée au mauvais endroit ne suffit pas à rendre le service prêt.
    const versions = db.prepare(`SELECT d.id,v.sha256,v.size_bytes,v.r2_key FROM datasets d
      JOIN versions v ON v.dataset_id=d.id AND v.version=d.current_version
      WHERE d.id IN ('tares','classifications','finma')`).all() as Array<{id:string;sha256:string;size_bytes:number;r2_key:string}>;
    db.prepare("SELECT refunded_chf,dispute_status FROM orders LIMIT 0").all();
    db.prepare("SELECT state FROM order_deliveries LIMIT 0").all();
    db.prepare("SELECT order_id FROM order_grants LIMIT 0").all();
    db.prepare("SELECT state FROM stripe_financial_jobs LIMIT 0").all();
    checks.database = !db.readonly && versions.length === 3 && versions.every(v =>
      /^[a-f0-9]{64}$/.test(v.sha256) && v.size_bytes > 0 && v.r2_key.startsWith(`${v.id}/`));
  } catch { /* La réponse publique ne révèle ni chemin ni détail SQLite. */ }
  try {
    for (const page of ["index.html", "de/index.html", "en/index.html", "admin/index.html", "datasets/finma/index.html", "datasets/tares/index.html", "datasets/classifications/index.html"]) {
      const path = join(webRoot, page), size = statSync(path).size;
      if (size < 100 || size > 2_000_000) throw new Error("Page absente ou incomplète");
      const html = readFileSync(path, "utf8");
      if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) throw new Error("HTML incomplet");
      const assets = [...html.matchAll(/(?:src|href)=["'](\/_astro\/[^"'?#]+)(?:[?#][^"']*)?["']/g)].map(m => m[1]);
      if (!assets.some(a => a.endsWith(".css"))) throw new Error("Styles absents");
      for (const asset of new Set(assets)) {
        if (asset.includes("..") || !statSync(join(webRoot, asset)).isFile() || statSync(join(webRoot, asset)).size === 0) throw new Error("Ressource absente");
      }
    }
    checks.frontend = true;
  } catch { /* Aucun chemin serveur dans le point de contrôle public. */ }
  return { ready: checks.database && checks.frontend, checks };
}
