import type { InferSelectModel } from "drizzle-orm";
import type { users, medications, doseLogs, userPreferences } from "$lib/server/db/schema";

export type User = InferSelectModel<typeof users>;
export type Medication = InferSelectModel<typeof medications>;
export type DoseLog = InferSelectModel<typeof doseLogs>;

export type SessionUser = Pick<
  User,
  "id" | "email" | "name" | "avatarUrl" | "timezone" | "twoFactorEnabled" | "emailVerified"
>;

export type UserPreferences = InferSelectModel<typeof userPreferences>;

export type SideEffect = {
  name: string;
  severity: "mild" | "moderate" | "severe";
};

export type DoseLogWithMedication = DoseLog & {
  medication: Pick<
    Medication,
    "name" | "dosageAmount" | "dosageUnit" | "form" | "colour" | "colourSecondary" | "pattern"
  >;
};

export type MedicationWithStats = Medication & {
  lastTakenAt: Date | null;
  weeklyDoseCount: number;
  avgDailyConsumption: number;
  daysUntilRefill: number | null;
  // 14-day daily-dose count series, oldest → newest. Optional so
  // existing callers don't need to populate it.
  sparkline?: number[];
  // Refill severity tier from src/lib/server/inventory.ts. Optional;
  // populated only by the Medications-list loader.
  refillSeverity?: "critical" | "warning" | "watch" | "ok";
};

export type MedicationTimingStatus = {
  medicationId: string;
  status: "ok" | "due_soon" | "due_now" | "overdue";
  minutesUntilDue: number; // negative if overdue
  lastTakenAt: Date | null;
};

// Analytics insight returned from buildInsights (server-side) and
// rendered by InsightsCard (client-side). Lives here so client
// components don't reach into $lib/server/* — type-only imports are
// technically erased, but keeping the boundary clean avoids accidental
// runtime imports and matches SvelteKit conventions.
export type Insight = {
  id: string;
  severity: "info" | "positive" | "warning";
  text: string;
};

export type RefillSeverity = "critical" | "warning" | "watch" | "ok";

export type RefillForecastEntry = {
  medicationId: string;
  medicationName: string;
  colour: string;
  inventoryCount: number;
  dailyRate: number;
  daysUntilRefill: number | null;
  severity: RefillSeverity;
};
