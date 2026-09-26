import type Database from 'better-sqlite3';
import { prepareCustomerFunctions, searchText } from './crm-customers.js';
import { isCalendarDate } from './calendar-date.js';

export type TaskSummary = { open: number; overdue: number; today: number; later: number; undated: number; invalid: number };
export const TASK_LIST_LIMIT = 100;
// Le passage par julianday force la normalisation avant comparaison, même avec les anciennes SQLite.
const validDue = "COALESCE(t.due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND t.due_on>='0001-01-01' AND strftime('%Y-%m-%d',julianday(t.due_on))=t.due_on,0)";

export const taskOrderSql = `CASE WHEN t.due_on IS NOT NULL AND NOT ${validDue} THEN 0 WHEN t.due_on IS NOT NULL THEN 1 ELSE 2 END,t.due_on,t.created_at DESC,t.id DESC`;

export function readTaskSummary(db: Database.Database, today: string) {
  if (!isCalendarDate(today)) throw new Error('crm_task_day_invalid');
  const summary = db.prepare(`SELECT COUNT(*) open,
    COALESCE(SUM(${validDue} AND t.due_on<?),0) overdue,
    COALESCE(SUM(${validDue} AND t.due_on=?),0) today,
    COALESCE(SUM(${validDue} AND t.due_on>?),0) later,
    COALESCE(SUM(t.due_on IS NULL),0) undated,
    COALESCE(SUM(t.due_on IS NOT NULL AND NOT ${validDue}),0) invalid
    FROM crm_tasks t WHERE t.done_at IS NULL`).get(today,today,today) as TaskSummary;
  return summary;
}

export function readTaskOverview(db: Database.Database, today: string) {
  const summary=readTaskSummary(db,today);
  const tasks = db.prepare(`SELECT t.*,c.email,COALESCE(p.display_name,'') display_name
    FROM crm_tasks t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id
    WHERE t.done_at IS NULL
    ORDER BY ${taskOrderSql}
    LIMIT ?`).all(TASK_LIST_LIMIT);
  return { tasks, task_summary: summary, task_list: { returned: tasks.length, total: summary.open, limit: TASK_LIST_LIMIT, truncated: summary.open > tasks.length } };
}

export const TASK_FILTERS=['open','due','overdue','today','later','undated','invalid','done'] as const;
export type TaskFilter=typeof TASK_FILTERS[number];
export const TASK_PAGE_SIZE=50;
export function readTaskPage(db:Database.Database,input:{q:string;page:number;status:TaskFilter},today:string){
 if(!isCalendarDate(today))throw new Error('crm_task_day_invalid');
 prepareCustomerFunctions(db);
 const filters:Record<TaskFilter,{sql:string;params:string[]}>= {
  open:{sql:'t.done_at IS NULL',params:[]},
  due:{sql:`t.done_at IS NULL AND t.due_on IS NOT NULL AND (NOT ${validDue} OR t.due_on<=?)`,params:[today]},
  overdue:{sql:`t.done_at IS NULL AND ${validDue} AND t.due_on<?`,params:[today]},
  today:{sql:`t.done_at IS NULL AND t.due_on=?`,params:[today]},
  later:{sql:`t.done_at IS NULL AND ${validDue} AND t.due_on>?`,params:[today]},
  undated:{sql:'t.done_at IS NULL AND t.due_on IS NULL',params:[]},
  invalid:{sql:`t.done_at IS NULL AND t.due_on IS NOT NULL AND NOT ${validDue}`,params:[]},
  done:{sql:'t.done_at IS NOT NULL',params:[]}
 };
 const selected=filters[input.status],params:Array<string|number>=[...selected.params];
 const joins='FROM crm_tasks t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id';
 let where='WHERE '+selected.sql;
 if(input.q){where+=` AND instr(crm_search_text(t.title||char(10)||COALESCE(c.email,'')||char(10)||COALESCE(p.display_name,'')||char(10)||COALESCE(p.company,'')),?)>0`;params.push(searchText(input.q))}
 return db.transaction(()=>{
  const total=(db.prepare(`SELECT COUNT(*) total ${joins} ${where}`).get(...params) as {total:number}).total;
  const pages=Math.max(1,Math.ceil(total/TASK_PAGE_SIZE)),number=Math.min(input.page,pages);
  const order=input.status==='done'?'t.done_at DESC,t.id DESC':taskOrderSql;
  const tasks=db.prepare(`SELECT t.*,c.email,COALESCE(p.display_name,'') display_name ${joins} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params,TASK_PAGE_SIZE,(number-1)*TASK_PAGE_SIZE);
  return {tasks,today,task_summary:readTaskSummary(db,today),query:{q:input.q,status:input.status},page:{number,total_pages:pages,total,returned:tasks.length,limit:TASK_PAGE_SIZE,has_previous:number>1,has_next:number<pages}};
 })();
}
