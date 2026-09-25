import type Database from "better-sqlite3";

export const UPDATE_PERIOD_MS = 360 * 86400_000;

/** Migration de l'accès agrégé vers un historique par achat, sans étendre les droits. */
export function migrateOrderRights(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`INSERT OR IGNORE INTO order_grants(order_id,dataset_id,updates_until,created_at)
      SELECT e.order_id,e.dataset_id,e.updates_until,e.created_at FROM entitlements e
      JOIN orders o ON o.id=e.order_id AND o.customer_id=e.customer_id JOIN datasets d ON d.id=e.dataset_id`);
    // Cette capture se refait au démarrage : elle récupère les commandes ajoutées
    // pendant un éventuel retour temporaire à une ancienne version de l'application.
    if (db.prepare("SELECT 1 FROM app_migrations WHERE name='order_grants_v1'").get()) return;
    // L'ancien webhook accordait 360 jours. Une commande antérieure reste bornée
    // par l'accès effectivement présent : cette reprise ne crée aucun accès nouveau.
    const older = db.prepare(`SELECT o.id,o.items_json,o.created_at,e.dataset_id,e.updates_until
      FROM orders o JOIN entitlements e ON e.customer_id=o.customer_id
      JOIN orders latest ON latest.id=e.order_id AND latest.customer_id=e.customer_id JOIN datasets d ON d.id=e.dataset_id
      WHERE o.status='paid' AND o.id<>e.order_id AND o.created_at<=latest.created_at`).all() as Array<{
        id:number;items_json:string;created_at:number;dataset_id:string;updates_until:number|null;
      }>;
    const insert = db.prepare("INSERT OR IGNORE INTO order_grants(order_id,dataset_id,updates_until,created_at) VALUES(?,?,?,?)");
    for (const order of older) {
      let items: unknown;
      try { items = JSON.parse(order.items_json); } catch { continue; }
      if (!Array.isArray(items) || !(items.includes(order.dataset_id) || items.includes("bundle"))) continue;
      insert.run(order.id, order.dataset_id, Math.min(order.created_at + UPDATE_PERIOD_MS,
        order.updates_until ?? Number.MAX_SAFE_INTEGER), order.created_at);
    }
    db.prepare("INSERT INTO app_migrations(name,applied_at) VALUES('order_grants_v1',?)").run(Date.now());
  })();
}

/** À appeler dans la transaction qui modifie la commande ou ses droits. */
export function refreshOrderRights(db: Database.Database, customerId: number): void {
  const grants = db.prepare(`SELECT g.*,o.customer_id FROM order_grants g JOIN orders o ON o.id=g.order_id
    WHERE o.customer_id=? AND o.status='paid'
    ORDER BY g.updates_until IS NULL DESC,g.updates_until DESC,g.order_id DESC`).all(customerId) as Array<{
      order_id:number;dataset_id:string;updates_until:number|null;created_at:number;
    }>;
  const datasets = new Set<string>();
  for (const grant of grants) {
    if (datasets.has(grant.dataset_id)) continue;
    datasets.add(grant.dataset_id);
    db.prepare(`INSERT INTO entitlements(customer_id,dataset_id,order_id,updates_until,created_at) VALUES(?,?,?,?,?)
      ON CONFLICT(customer_id,dataset_id) DO UPDATE SET order_id=excluded.order_id,updates_until=excluded.updates_until`)
      .run(customerId, grant.dataset_id, grant.order_id, grant.updates_until, grant.created_at);
  }
  db.prepare(`DELETE FROM entitlements WHERE customer_id=? AND dataset_id IN
    (SELECT g.dataset_id FROM order_grants g JOIN orders o ON o.id=g.order_id WHERE o.customer_id=?)
    AND dataset_id NOT IN
    (SELECT g.dataset_id FROM order_grants g JOIN orders o ON o.id=g.order_id WHERE o.customer_id=? AND o.status='paid')`)
    .run(customerId, customerId, customerId);
}
