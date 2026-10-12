/**
 * DashboardHeader's `<h1>`. It is the dashboard's last-resort focus target,
 * but focus reaches it as the page heading (`pageHeading` in
 * dose-writes/focus-after.ts, which parks it without scrolling), never by
 * this id: the id only names it.
 */
export const DASHBOARD_HEADING_ID = "dashboard-heading";

/** DoneList's `<h2>`: focus lands here after Remove or Remove skip, and after an Undo restores a row with no Edit. Always rendered. */
export const DONE_HEADING_ID = "done-heading";
