// Todos → report. A thin adapter over the shared engine in report-core.ts, so
// a ticket board exports the same five formats as the Work Done log.
import { buildReport, type ReportItem, type ReportMeta, type ReportData } from "@/lib/report-core";
import { DEFAULT_STATUS_KEY, type SpaceConfig } from "@/lib/todo-config";
import type { Todo } from "@/types";

export {
  downloadReport,
  formatDay,
  formatMinutes,
  REPORT_FORMAT_LABEL,
  type ReportData,
  type ReportFormat,
  type ReportMeta,
} from "@/lib/report-core";

/** The day a ticket belongs to in the report.
 *
 *  `task_date` is the date the ticket is *for*, which is what a reader expects
 *  a day-by-day report to be keyed on. Tickets without one fall back to the
 *  day they were created, so nothing silently drops out of the period. */
function dayOf(t: Todo): string {
  if (t.task_date) return t.task_date;
  return t.created_at.slice(0, 10);
}

export function todoItems(todos: Todo[], config: SpaceConfig, spaceName: string): ReportItem[] {
  const statusByKey = new Map(config.statuses.map((s) => [s.key, s]));
  const categoryByKey = new Map(config.categories.map((c) => [c.key, c]));

  return todos.map((t, i) => {
    const key = t.status ?? DEFAULT_STATUS_KEY;
    const status = statusByKey.get(key);
    // `is_done` is the source of truth the rest of the app keys off, so a
    // ticket counts as finished if either it or its status says so.
    const done = t.is_done || status?.done === true;
    return {
      id: t.id,
      // Rows created before the field existed are tasks, matching the DB default.
      entryType: t.entry_type ?? "task",
      day: dayOf(t),
      title: t.title,
      details: t.description,
      // The space is the natural "module" for a ticket; its category config
      // supplies the finer grouping, matching the work log's two dimensions.
      module: spaceName,
      category: t.category ? categoryByKey.get(t.category)?.label ?? t.category : null,
      statusKey: key,
      statusLabel: status?.label ?? key,
      statusDone: !!done,
      minutes: t.estimated_min ?? null,
      position: i,
      created_at: t.created_at,
    };
  });
}

export function buildTodoReport(
  todos: Todo[],
  config: SpaceConfig,
  spaceName: string,
  meta: ReportMeta
): ReportData {
  return buildReport(todoItems(todos, config, spaceName), meta);
}
