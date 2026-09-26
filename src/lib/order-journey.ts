import type Database from 'better-sqlite3';
import type { CrmPeriod } from './crm-period.js';
import {DOWNLOAD_ACTIVITY_RETENTION_DAYS,DOWNLOAD_ACTIVITY_RETENTION_MS} from './service-retention.js';

export type OrderJourney = {
  orders: number; customers: number; complete_mail: number; partial_mail: number;
  no_mail_acceptance: number; no_delivery_tracking: number; no_item_detail: number;
  expected_files: number; accepted_files: number; invalid_acceptances: number; later_acceptances: number;
  email_access_orders: number; email_access_customers: number; older_than_retention: number;
  retained_since: number; retention_days: number;
};

/** Agrégats uniquement : les visites et accès du compte ne sont jamais attribués à un achat. */
export function readOrderJourney(db: Database.Database, period: CrmPeriod, real: {sql:string;params:string[]}, now:number): OrderJourney {
  const retainedSince=now-DOWNLOAD_ACTIVITY_RETENTION_MS;
  // Une ligne par commande avant de compter : ni bundle ni rejeu d’un lien ne multiplie les achats.
  const result=db.prepare(`WITH cohort AS MATERIALIZED (
    SELECT o.id,o.customer_id,o.created_at FROM orders o
    JOIN customers c ON c.id=o.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id
    WHERE o.status='paid' AND o.stripe_session_id GLOB 'cs_live_*'
      AND o.created_at>=? AND o.created_at<? AND ${real.sql}
  ), files AS (
    SELECT o.id,COUNT(g.dataset_id) expected,COUNT(d.id) tracked,
      COALESCE(SUM(d.state='sent' AND typeof(d.created_at)='integer' AND d.created_at>=o.created_at
        AND typeof(d.sent_at)='integer' AND d.sent_at>=d.created_at AND d.sent_at<?),0) accepted,
      COALESCE(SUM(d.state='sent' AND NOT (typeof(d.created_at)='integer' AND d.created_at>=o.created_at
        AND typeof(d.sent_at)='integer' AND COALESCE(d.sent_at>=d.created_at,0))),0) invalid,
      COALESCE(SUM(d.state='sent' AND typeof(d.created_at)='integer' AND d.created_at>=o.created_at
        AND typeof(d.sent_at)='integer' AND d.sent_at>=d.created_at AND d.sent_at>=?),0) later
    FROM cohort o LEFT JOIN order_grants g ON g.order_id=o.id
    LEFT JOIN order_deliveries d ON d.order_id=g.order_id AND d.dataset_id=g.dataset_id GROUP BY o.id
  ), proof AS (
    SELECT o.*,f.*,EXISTS(SELECT 1 FROM download_activity a
      JOIN order_grants g ON g.order_id=a.order_id AND g.dataset_id=a.dataset_id
      WHERE a.order_id=o.id AND a.customer_id=o.customer_id AND a.source='email'
        AND typeof(a.created_at)='integer' AND a.created_at>=o.created_at AND a.created_at>=?
        AND typeof(a.authorized_at)='integer' AND a.authorized_at>=a.created_at AND a.authorized_at<?) used_email
    FROM cohort o JOIN files f ON f.id=o.id
  ) SELECT COUNT(*) orders,COUNT(DISTINCT customer_id) customers,
    COALESCE(SUM(expected>0 AND accepted=expected),0) complete_mail,
    COALESCE(SUM(accepted>0 AND accepted<expected),0) partial_mail,
    COALESCE(SUM(expected>0 AND tracked>0 AND accepted=0),0) no_mail_acceptance,
    COALESCE(SUM(expected>0 AND tracked=0),0) no_delivery_tracking,
    COALESCE(SUM(expected=0),0) no_item_detail,
    COALESCE(SUM(expected),0) expected_files,COALESCE(SUM(accepted),0) accepted_files,
    COALESCE(SUM(invalid),0) invalid_acceptances,COALESCE(SUM(later),0) later_acceptances,COALESCE(SUM(used_email),0) email_access_orders,
    COUNT(DISTINCT CASE WHEN used_email THEN customer_id END) email_access_customers,
    COALESCE(SUM(created_at<?),0) older_than_retention FROM proof`)
    .get(period.start_at,period.end_at,...real.params,now+1,now+1,retainedSince,now+1,retainedSince) as Omit<OrderJourney,'retained_since'|'retention_days'>;
  return {...result,retained_since:retainedSince,retention_days:DOWNLOAD_ACTIVITY_RETENTION_DAYS};
}
