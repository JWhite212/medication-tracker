// Plain row -> JSON serializers shared by the /api/v1 sync (Task 10) and
// export (Task 14) endpoints, and by the auth routes' session-user
// projection. Rules: `Date -> ISO string`; numeric-as-string columns
// (dosageAmount, scheduleIntervalHours, intervalHours) pass through
// UNCHANGED — they're already strings from Drizzle and the Swift client
// parses them to Decimal itself; JSON columns (sideEffects, daysOfWeek,
// changes) pass through as-is.
import type { DoseLogStatus, InventoryEventType, ScheduleKind } from "$lib/server/db/schema";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toSessionUser(u: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    timezone: u.timezone,
    twoFactorEnabled: u.twoFactorEnabled,
    emailVerified: u.emailVerified,
  };
}

export function serializeMedication(m: {
  id: string;
  userId: string;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  form: string;
  category: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  notes: string | null;
  scheduleType: string;
  scheduleIntervalHours: string | null;
  inventoryCount: number | null;
  inventoryAlertThreshold: number | null;
  sortOrder: number;
  isArchived: boolean;
  archivedAt: Date | null;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...m,
    archivedAt: iso(m.archivedAt),
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    createdAt: iso(m.createdAt),
    updatedAt: iso(m.updatedAt),
  };
}

export function serializeSchedule(s: {
  id: string;
  medicationId: string;
  userId: string;
  scheduleKind: ScheduleKind;
  timeOfDay: string | null;
  intervalHours: string | null;
  daysOfWeek: number[] | null;
  sortOrder: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
}) {
  return {
    ...s,
    effectiveFrom: iso(s.effectiveFrom),
    effectiveTo: iso(s.effectiveTo),
    createdAt: iso(s.createdAt),
  };
}

export function serializeDoseLog(d: {
  id: string;
  userId: string;
  medicationId: string;
  quantity: number;
  takenAt: Date;
  loggedAt: Date;
  notes: string | null;
  sideEffects: Array<{ name: string; severity: "mild" | "moderate" | "severe" }> | null;
  status: DoseLogStatus;
  updatedAt: Date;
}) {
  return {
    ...d,
    takenAt: iso(d.takenAt),
    loggedAt: iso(d.loggedAt),
    updatedAt: iso(d.updatedAt),
  };
}

export function serializeInventoryEvent(e: {
  id: string;
  userId: string;
  medicationId: string;
  eventType: InventoryEventType;
  quantityChange: number;
  previousCount: number | null;
  newCount: number | null;
  note: string | null;
  createdAt: Date;
}) {
  return { ...e, createdAt: iso(e.createdAt) };
}

export function serializeAuditLog(a: {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
  createdAt: Date;
}) {
  return { ...a, createdAt: iso(a.createdAt) };
}

export function serializePreferences(p: {
  userId: string;
  accentColor: string;
  dateFormat: string;
  timeFormat: string;
  uiDensity: string;
  reducedMotion: boolean;
  overdueEmailReminders: boolean;
  overduePushReminders: boolean;
  lowInventoryEmailAlerts: boolean;
  lowInventoryPushAlerts: boolean;
  doseLogPageSize: number;
  heatmapPeriod: number;
  exportFormat: string;
  updatedAt: Date;
}) {
  return { ...p, updatedAt: iso(p.updatedAt) };
}

export function serializeTombstone(t: {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  deletedAt: Date;
}) {
  return { ...t, deletedAt: iso(t.deletedAt) };
}
