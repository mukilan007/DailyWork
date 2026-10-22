// Work Done → report. A thin adapter over the shared engine in report-core.ts.
import { buildReport, type ReportItem, type ReportMeta, type ReportData } from "@/lib/report-core";
import type { WorkLogEntry, WorkLogStatus } from "@/types";

export {
  downloadReport,
  formatDay,
  formatMinutes,
  renderCsvRows,
  renderHtml,
  renderMarkdown,
  renderPdf,
  renderVisualHtml,
  REPORT_FORMAT_LABEL,
  type ReportData,
  type ReportFormat,
  type ReportMeta,
} from "@/lib/report-core";

export const STATUS_LABEL: Record<WorkLogStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  fixed_in_developer: "Fixed in developer",
  fixed: "Fixed",
  not_an_issue: "Not an issue",
  later: "Later",
  not_reproduced: "Not reproduced",
  completed: "Completed",
  closed: "Closed",
  on_hold: "On hold",
};

/** States that count as finished in the headline figures. */
const DONE_STATUSES: ReadonlySet<WorkLogStatus> = new Set<WorkLogStatus>([
  "fixed",
  "not_an_issue",
  "not_reproduced",
  "completed",
  "closed",
]);

export function workLogItems(entries: WorkLogEntry[]): ReportItem[] {
  return entries.map((e) => ({
    id: e.id,
    entryType: e.entry_type,
    day: e.worked_on,
    title: e.title,
    details: e.details,
    module: e.module,
    category: e.category,
    statusKey: e.status,
    statusLabel: STATUS_LABEL[e.status],
    statusDone: DONE_STATUSES.has(e.status),
    minutes: e.minutes,
    position: e.position,
    created_at: e.created_at,
  }));
}

export function buildWorkLogReport(
  entries: WorkLogEntry[],
  meta: ReportMeta
): ReportData {
  return buildReport(workLogItems(entries), meta);
}
