import type { UserPreferences } from "../../../src/lib/types";

/**
 * A whole `user_preferences` row at the column defaults. Tests that need a
 * preferences object spread this and override only what they assert on, so a
 * new column is added here once instead of in every test that hand-writes the
 * row.
 */
export const preferencesFixture = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "dark",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  dashboardSectionOrder: null,
  dashboardShowLater: true,
  dashboardShowQuickLog: true,
  dashboardShowRefills: true,
  timeSinceDaysFromHours: 48,
  updatedAt: new Date("2026-04-01T00:00:00Z"),
} satisfies UserPreferences;
