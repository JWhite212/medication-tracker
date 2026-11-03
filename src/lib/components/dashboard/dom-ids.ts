/**
 * DashboardHeader's `<h1>`. It is the dashboard's last-resort focus target,
 * but focus reaches it as the page heading (`pageHeading` in
 * dose-writes/focus-after.ts, which parks it without scrolling), never by
 * this id: the id only names it.
 */
export const DASHBOARD_HEADING_ID = "dashboard-heading";

/** DoneList's `<h2>`: focus lands here after Remove or Remove skip, and after an Undo restores a row with no Edit. Always rendered. */
export const DONE_HEADING_ID = "done-heading";

/** Edit mode's `<h2>` ("Customising your dashboard"): focus lands here on entering. Rendered only while editing. */
export const CUSTOMISE_HEADING_ID = "customise-heading";

/** The edit-mode region around the sections. Always rendered, so the footer control's `aria-controls` always resolves. */
export const DASHBOARD_EDITOR_ID = "dashboard-editor";
