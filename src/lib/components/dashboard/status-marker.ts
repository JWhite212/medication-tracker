export type StatusMarkerState = "taken" | "overdue" | "due-now" | "upcoming" | "skipped" | "missed";

/**
 * Each marker's accessible name. "Overdue" survives on the dashboard ONLY
 * here — no visible copy says it. A total Record, so a state added to the
 * union without a label does not compile; status-marker-ssr.test.ts pins
 * the wording against the spec's table.
 */
export const STATUS_MARKER_LABELS: Record<StatusMarkerState, string> = {
  taken: "Taken",
  overdue: "Overdue",
  "due-now": "Due now",
  upcoming: "Upcoming",
  skipped: "Skipped",
  missed: "Missed",
};

export const STATUS_MARKER_STATES = Object.keys(STATUS_MARKER_LABELS) as StatusMarkerState[];
