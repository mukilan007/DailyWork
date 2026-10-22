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
  done: "Done",
  in_progress: "In progress",
  blocked: "Blocked",
};

/** Neutral wording for the visual report. Same three states, described by what
 *  they are rather than graded — "blocked" is usually someone else's
 *  dependency. Nothing is hidden: every entry still appears, with its real
 *  state, under a name that isn't a verdict. */
const POSITIVE_LABEL: Record<WorkLogStatus, string> = {
  done: "Completed",
  in_progress: "In progress",
  blocked: "Awaiting input",
};

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
    statusLabelPositive: POSITIVE_LABEL[e.status],
    statusDone: e.status === "done",
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
