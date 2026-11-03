/**
 * The dashboard sections an account can reorder. Zod-free and import-free on
 * purpose: the settings page, the dashboard page and the database schema's
 * `$type<>` all reach it, and none of them may pull zod into a bundle.
 */
export const DASHBOARD_SECTIONS = ["done", "later", "quickLog", "refills"] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number];
