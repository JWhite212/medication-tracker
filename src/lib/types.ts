import type { InferSelectModel } from "drizzle-orm";
import type {
  users,
  medications,
  doseLogs,
  auditLogs,
  sessions,
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

export type DoseLogWithMedication = DoseLog & {
  medication: Pick<
    Medication,
    "name" | "dosageAmount" | "dosageUnit" | "form" | "colour"
  >;
};
