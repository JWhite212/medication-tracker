import type { InferSelectModel } from "drizzle-orm";
import type {
  users,
  medications,
  doseLogs,
  auditLogs,
  sessions,
  userPreferences,
} from "$lib/server/db/schema";

export type User = InferSelectModel<typeof users>;
export type Medication = InferSelectModel<typeof medications>;
export type DoseLog = InferSelectModel<typeof doseLogs>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type SessionRecord = InferSelectModel<typeof sessions>;

export type SessionUser = Pick<
  User,
  | "id"
  | "email"
  | "name"
  | "avatarUrl"
  | "timezone"
  | "twoFactorEnabled"
  | "emailVerified"
>;

export type UserPreferences = InferSelectModel<typeof userPreferences>;

export type SideEffect = {
  name: string;
  severity: "mild" | "moderate" | "severe";
};

export type DoseLogWithMedication = DoseLog & {
  medication: Pick<
    Medication,
    | "name"
    | "dosageAmount"
    | "dosageUnit"
    | "form"
    | "colour"
    | "colourSecondary"
    | "pattern"
  >;
};

export type MedicationWithStats = Medication & {
  lastTakenAt: Date | null;
  weeklyDoseCount: number;
  avgDailyConsumption: number;
  daysUntilRefill: number | null;
};

export type MedicationTimingStatus = {
  medicationId: string;
  status: "ok" | "due_soon" | "due_now" | "overdue";
  minutesUntilDue: number; // negative if overdue
  lastTakenAt: Date | null;
};
