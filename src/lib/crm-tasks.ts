import type Database from 'better-sqlite3';
import { isCalendarDate } from './calendar-date.js';

export type TaskSummary = { open: number; overdue: number; today: number; later: number; undated: number; invalid: number };
export const TASK_LIST_LIMIT = 100;
// Le passage par julianday force la normalisation avant comparaison, même avec les anciennes SQLite.
const validDue = "COALESCE(t.due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND t.due_on>='0001-01-01' AND strftime('%Y-%m-%d',julianday(t.due_on))=t.due_on,0)";

export const taskOrderSql = `CASE WHEN t.due_on IS NOT NULL AND NOT ${validDue} THEN 0 WHEN t.due_on IS NOT NULL THEN 1 ELSE 2 END,t.due_on,t.created_at DESC,t.id DESC`;

export function readTaskOverview(db: Database.Database, today: string) {
  if (!isCalendarDate(today)) throw new Error('crm_task_day_invalid');
  const summary = db.prepare(`SELECT COUNT(*) open,
    COALESCE(SUM(${validDue} AND t.due_on<?),0) overdue,
    COALESCE(SUM(${validDue} AND t.due_on=?),0) today,
    COALESCE(SUM(${validDue} AND t.due_on>?),0) later,
    COALESCE(SUM(t.due_on IS NULL),0) undated,
    COALESCE(SUM(t.due_on IS NOT NULL AND NOT ${validDue}),0) invalid
    FROM crm_tasks t WHERE t.done_at IS NULL`).get(today,today,today) as TaskSummary;
  const tasks = db.prepare(`SELECT t.*,c.email,COALESCE(p.display_name,'') display_name
    FROM crm_tasks t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id
    WHERE t.done_at IS NULL
    ORDER BY ${taskOrderSql}
    LIMIT ?`).all(TASK_LIST_LIMIT);
  return { tasks, task_summary: summary, task_list: { returned: tasks.length, total: summary.open, limit: TASK_LIST_LIMIT, truncated: summary.open > tasks.length } };
}
