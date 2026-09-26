import type Database from "better-sqlite3";

export type DownloadActivity = {
  dataset_id: string; version: string; source: "account" | "email";
  order_id: number | null; created_at: number; authorized_at: number | null;
};
export type OrderService = {
  deliveries: Array<{ dataset_id: string; state: string; attempts: number; created_at: number;
    sent_at: number | null; provider_message_id: string | null; last_error: string | null }>;
  downloads: DownloadActivity[];
};

/** Lecture réservée au CRM authentifié. Les secrets et liens ne font jamais partie du résultat. */
export function orderService(db: Database.Database, customerId: number, orderId: number): OrderService {
  const deliveries = db.prepare(`SELECT d.dataset_id,d.state,d.attempts,d.created_at,d.sent_at,d.provider_message_id,d.last_error
    FROM order_deliveries d JOIN orders o ON o.id=d.order_id
    WHERE d.order_id=? AND o.customer_id=? ORDER BY d.created_at,d.id LIMIT 10`).all(orderId, customerId) as OrderService["deliveries"];
  const downloads = db.prepare(`SELECT a.dataset_id,a.version,a.source,a.order_id,a.created_at,a.authorized_at
    FROM download_activity a JOIN orders o ON o.id=a.order_id
    WHERE a.order_id=? AND a.customer_id=? AND o.customer_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 30`)
    .all(orderId, customerId, customerId) as DownloadActivity[];
  return { deliveries, downloads };
}

export function accountDownloadHistory(db: Database.Database, customerId: number): DownloadActivity[] {
  return db.prepare(`SELECT dataset_id,version,source,order_id,created_at,authorized_at
    FROM download_activity WHERE customer_id=? AND source='account' ORDER BY created_at DESC,id DESC LIMIT 30`)
    .all(customerId) as DownloadActivity[];
}
