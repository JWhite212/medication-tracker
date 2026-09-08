// Plain row -> JSON serializers shared by the /api/v1 sync (Task 10) and
// export (Task 14) endpoints, and by the auth routes' session-user
// projection. Rules: `Date -> ISO string`; numeric-as-string columns
// (dosageAmount, scheduleIntervalHours, intervalHours) pass through
// UNCHANGED — they're already strings from Drizzle and the Swift client
// parses them to Decimal itself; JSON columns (sideEffects, daysOfWeek,
// changes) pass through as-is.
import type { DoseLogStatus, InventoryEventType, ScheduleKind } from "$lib/server/db/schema";
import type { UserPreferences } from "$lib/types";

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
  notificationsEnabled: boolean;
  notifyOverdueEmail: boolean | null;
  notifyOverduePush: boolean | null;
  notifyLowInventoryEmail: boolean | null;
  notifyLowInventoryPush: boolean | null;
  notifyOffsetMinutes: number;
  notifyRepeatEveryMinutes: number | null;
  notifyMaxRepeats: number;
}) {
  // Projected field by field for the same reason as `serializeDoseLog`
  // below: callers hand this rows from a bare `db.select()`, and structural
  // typing lets a wider row through a narrower parameter, so a spread put
  // every column ever added to `medications` onto the /api/v1 wire and into
  // the JSON backup regardless of what this signature said.
  // `lowInventoryEpisodeAt` is the current example — the identity of an open
  // low-stock episode, meaningful only to the reminder sweep.
  return {
    id: m.id,
    userId: m.userId,
    name: m.name,
    dosageAmount: m.dosageAmount,
    dosageUnit: m.dosageUnit,
    form: m.form,
    category: m.category,
    colour: m.colour,
    colourSecondary: m.colourSecondary,
    pattern: m.pattern,
    notes: m.notes,
    scheduleType: m.scheduleType,
    scheduleIntervalHours: m.scheduleIntervalHours,
    inventoryCount: m.inventoryCount,
    inventoryAlertThreshold: m.inventoryAlertThreshold,
    sortOrder: m.sortOrder,
    isArchived: m.isArchived,
    archivedAt: iso(m.archivedAt),
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    createdAt: iso(m.createdAt),
    updatedAt: iso(m.updatedAt),
    notificationsEnabled: m.notificationsEnabled,
    notifyOverdueEmail: m.notifyOverdueEmail,
    notifyOverduePush: m.notifyOverduePush,
    notifyLowInventoryEmail: m.notifyLowInventoryEmail,
    notifyLowInventoryPush: m.notifyLowInventoryPush,
    notifyOffsetMinutes: m.notifyOffsetMinutes,
    notifyRepeatEveryMinutes: m.notifyRepeatEveryMinutes,
    notifyMaxRepeats: m.notifyMaxRepeats,
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
  // Projected field by field, NOT `{ ...d }`. Callers hand this rows from a
  // bare `db.select()` (see `api/sync.ts`), and TypeScript's structural
  // typing lets a wider row through a narrower parameter — so a spread put
  // every column ever added to `dose_logs` onto the sync wire and into the
  // JSON export silently, whatever this signature said. `inventoryApplied`
  // is the one that would have gone first: internal bookkeeping for how much
  // stock a row removed, of no meaning to a client.
  return {
    id: d.id,
    userId: d.userId,
    medicationId: d.medicationId,
    quantity: d.quantity,
    takenAt: iso(d.takenAt),
    loggedAt: iso(d.loggedAt),
    notes: d.notes,
    sideEffects: d.sideEffects,
    status: d.status,
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

export function serializePreferences(p: UserPreferences) {
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
