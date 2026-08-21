import { z } from "zod";
import { MAX_INTERVAL_HOURS } from "$lib/utils/schedule-rate";

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(100),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

/**
 * A per-medication override that can also say "inherit the account
 * default".
 *
 * A checkbox cannot express this: `checkboxField` maps a missing field to
 * `false`, so "never configured" and "explicitly muted" would be the same
 * value. The form renders a three-option select, and a select always
 * submits, so absence only happens for an API caller that omitted it —
 * which also means inherit.
 *
 * This is also the `/api/v1` upsert door, and it must accept its own
 * window: `serializeMedication` emits `true` / `false` / `null` for these
 * fields (see `serialize.ts`), not the form's strings. Zod's `.default()`
 * only substitutes for `undefined`, never for `null` — so without the
 * `z.boolean()` / `z.null()` arms below, a client that reads a medication
 * and writes it straight back has its whole upsert rejected over a field
 * it never touched. `null` and omission both mean "inherit", same as the
 * form's `"inherit"` string.
 */
const triStateField = z
  .union([z.enum(["inherit", "on", "off"]), z.boolean(), z.null()])
  .default("inherit")
  .transform((v) => {
    if (v === "inherit" || v === null) return null;
    if (v === "on") return true;
    if (v === "off") return false;
    return v;
  });

export const MIN_REPEAT_MINUTES = 1;
export const MAX_REPEAT_MINUTES = 1440;
export const MAX_OFFSET_MINUTES = 720;
export const MAX_NAG_REPEATS = 10;

/**
 * Minutes, where an empty string means "not set" rather than zero.
 *
 * `z.coerce.number()` coerces "" to 0, which is the trap that already
 * mis-stores inventoryAlertThreshold. For a repeat interval the two are
 * emphatically different: null is "do not repeat" and 0 is an interval
 * of zero minutes.
 */
const optionalMinutesField = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const s = typeof v === "number" ? String(v) : v.trim();
    return s === "" ? null : Number(s);
  })
  .pipe(z.union([z.null(), z.number().int().min(MIN_REPEAT_MINUTES).max(MAX_REPEAT_MINUTES)]));

export const medicationSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  dosageAmount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  dosageUnit: z.string().min(1, "Unit is required").max(20),
  form: z.enum([
    "tablet",
    "capsule",
    "liquid",
    "softgel",
    "patch",
    "injection",
    "inhaler",
    "drops",
    "cream",
    "other",
  ]),
  category: z.enum(["prescription", "otc", "supplement"]),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex colour"),
  colourSecondary: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
  pattern: z
    .enum(["solid", "split", "gradient", "stripes", "h-stripes", "dots", "checkerboard", "radial"])
    .default("solid"),
  scheduleType: z.enum(["scheduled", "as_needed"]).default("scheduled"),
  notes: z.string().max(1000).optional(),
  scheduleIntervalHours: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  inventoryCount: z.coerce.number().int().min(0).optional(),
  inventoryAlertThreshold: z.coerce.number().int().min(0).optional(),
  // The kill switch defaults to ON: a medication the user never
  // configured should behave exactly as it did before this feature.
  // Also accepts a real boolean (see `triStateField` above) so this
  // door round-trips `serializeMedication`'s output for /api/v1 clients.
  notificationsEnabled: z
    .union([z.literal("on"), z.literal("off"), z.boolean(), z.undefined()])
    .transform((v) => v !== "off" && v !== false),
  notifyOverdueEmail: triStateField,
  notifyOverduePush: triStateField,
  notifyLowInventoryEmail: triStateField,
  notifyLowInventoryPush: triStateField,
  notifyOffsetMinutes: z.coerce.number().int().min(0).max(MAX_OFFSET_MINUTES).default(0),
  notifyRepeatEveryMinutes: optionalMinutesField,
  notifyMaxRepeats: z.coerce.number().int().min(0).max(MAX_NAG_REPEATS).default(3),
});

const sideEffectsField = z
  .string()
  .optional()
  .transform((val) => {
    if (!val) return undefined;
    try {
      return JSON.parse(val) as Array<{ name: string; severity: string }>;
    } catch {
      return undefined;
    }
  })
  .pipe(
    z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          severity: z.enum(["mild", "moderate", "severe"]),
        }),
      )
      .max(20)
      .optional(),
  );

export const doseLogSchema = z.object({
  medicationId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).default(1),
  takenAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  sideEffects: sideEffectsField,
});

export const doseEditSchema = z.object({
  doseId: z.string().min(1),
  takenAt: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(10),
  notes: z.string().max(500).optional(),
  sideEffects: sideEffectsField,
});

const validTimezones = new Set(Intl.supportedValuesOf("timeZone"));

export const settingsSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().refine((tz) => validTimezones.has(tz), "Invalid timezone"),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// HTML form checkboxes only submit when checked, so each field
// accepts an optional "on" string and transforms to a boolean. Shared
// across appearance and notification schemas.
const checkboxField = z
  .string()
  .optional()
  .transform((v) => v === "on");

export const appearanceSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex colour"),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  timeFormat: z.enum(["12h", "24h"]),
  uiDensity: z.enum(["comfortable", "compact"]),
  reducedMotion: checkboxField,
});

export const notificationSchema = z.object({
  overdueEmailReminders: checkboxField,
  overduePushReminders: checkboxField,
  lowInventoryEmailAlerts: checkboxField,
  lowInventoryPushAlerts: checkboxField,
});

export const dataSchema = z.object({
  exportFormat: z.enum(["pdf", "csv"]),
});

export const logFilterSchema = z.object({
  status: z.enum(["any", "taken", "skipped", "missed"]).default("any"),
  // z.coerce.boolean() runs Boolean(value), which mis-parses the string
  // "false" as true. z.stringbool() correctly handles "true"/"false"/
  // "1"/"0" coming from query strings.
  withSideEffects: z.stringbool().default(false),
  q: z.string().trim().max(100).optional(),
});

export type LogFilter = z.infer<typeof logFilterSchema>;

const ALLOWED_PUSH_ORIGINS = [
  "https://fcm.googleapis.com",
  "https://updates.push.services.mozilla.com",
  "https://notify.windows.com",
  "https://web.push.apple.com",
];

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((url) => ALLOWED_PUSH_ORIGINS.some((origin) => url.startsWith(origin)), {
      message: "Endpoint must be a recognized push service",
    }),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

export type MedicationInput = z.infer<typeof medicationSchema>;

export const scheduleRowSchema = z.discriminatedUnion("scheduleKind", [
  z.object({
    scheduleKind: z.literal("interval"),
    intervalHours: z.coerce.number().positive().max(MAX_INTERVAL_HOURS),
  }),
  z.object({
    scheduleKind: z.literal("fixed_time"),
    timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:mm (00:00–23:59)"),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  }),
  z.object({
    scheduleKind: z.literal("prn"),
  }),
]);

export const schedulesSchema = z.array(scheduleRowSchema).min(1).max(20);

export type ScheduleInput = z.infer<typeof scheduleRowSchema>;

// JSON-native command payload schemas for POST /api/v1/commands. These
// mirror the form-oriented schemas above (doseLogSchema, sideEffectsField)
// but accept real JSON types directly — no checkbox "on"/"off" strings, no
// JSON-string transforms — since command payloads arrive as parsed JSON,
// not multipart form fields.
export const sideEffectJson = z.object({
  name: z.string().min(1).max(100),
  severity: z.enum(["mild", "moderate", "severe"]),
});

export const logDosePayload = z.object({
  medicationId: z.string(),
  quantity: z.number().int().min(1).max(10).default(1),
  takenAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  sideEffects: z.array(sideEffectJson).max(20).optional(),
});

export const skipDosePayload = z.object({ medicationId: z.string() });

export const editDosePayload = z.object({
  doseId: z.string(),
  takenAt: z.string().datetime().optional(),
  quantity: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(500).optional(),
  sideEffects: z.array(sideEffectJson).max(20).nullable().optional(),
});

export const deleteDosePayload = z.object({ doseId: z.string() });

export const refillPayload = z.object({
  medicationId: z.string(),
  quantity: z.number().int().positive(),
  note: z.string().max(200).nullable().optional(),
});

export const adjustInventoryPayload = z.object({
  medicationId: z.string(),
  newCount: z.number().int().min(0),
  note: z.string().max(200).nullable().optional(),
});

export const upsertMedicationPayload = z.object({
  id: z.string().optional(),
  medication: medicationSchema,
  schedules: schedulesSchema,
});

export const archivePayload = z.object({ medicationId: z.string() });

export const reorderPayload = z.object({ medId1: z.string(), medId2: z.string() });

export const updatePreferencesPayload = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
  uiDensity: z.enum(["comfortable", "compact"]).optional(),
  reducedMotion: z.boolean().optional(),
  overdueEmailReminders: z.boolean().optional(),
  overduePushReminders: z.boolean().optional(),
  lowInventoryEmailAlerts: z.boolean().optional(),
  lowInventoryPushAlerts: z.boolean().optional(),
  doseLogPageSize: z.number().int().min(5).max(100).optional(),
  heatmapPeriod: z.number().int().optional(),
  exportFormat: z.enum(["pdf", "csv"]).optional(),
});

// ---------------------------------------------------------------------------
// Data import
// ---------------------------------------------------------------------------
// Schemas for the `version: 1` account backup produced by
// /api/v1/export/full and /api/export/full. This is the widest
// untrusted-input surface in the app: the file is user-supplied, may
// come from another account, and may be hand-edited. Rules:
//
//   * Unknown keys are STRIPPED, not rejected, so a future `version: 2`
//     export still parses for the fields we understand.
//   * Identity and credential fields (id, userId, email, passwordHash,
//     totpSecret, ...) are deliberately absent from these schemas —
//     what isn't parsed can't be written. `id` survives only as a
//     within-file reference (see `sourceId` in server/import/types.ts).
//   * Cosmetic fields fall back to a default rather than failing the
//     whole import; data-bearing fields are strict.
//   * Every array is capped so a hostile file can't exhaust memory
//     after the byte-size check.

export const IMPORT_MAX_MEDICATIONS = 1000;
export const IMPORT_MAX_SCHEDULES_PER_MED = 20;
export const IMPORT_MAX_DOSE_LOGS = 50_000;
export const IMPORT_MAX_INVENTORY_EVENTS = 50_000;

/** Upload ceiling. Vercel's own limit is ~4.5 MB; stay under it so the
 * rejection is ours (a clear message) rather than a platform 413. */
export const IMPORT_MAX_BYTES = 4 * 1024 * 1024;

export const MIN_IMPORT_TIME = Date.UTC(1900, 0, 1);
/**
 * How far ahead a timestamp may sit. Generous on purpose: the app itself
 * lets a dose be logged with a future `takenAt` (doseLogSchema puts no
 * upper bound on it), so a tighter window here would make the app's own
 * backup unimportable. Still bounded, so a dose dated 2099 can't stretch
 * every future analytics range.
 */
export const IMPORT_FUTURE_SKEW_MS = 365 * 24 * 60 * 60 * 1000;

export function isImportableTime(time: number): boolean {
  return (
    Number.isFinite(time) && time >= MIN_IMPORT_TIME && time <= Date.now() + IMPORT_FUTURE_SKEW_MS
  );
}

const importDate = z
  .string()
  .max(64)
  .transform((value, ctx) => {
    const parsed = new Date(value);
    if (!isImportableTime(parsed.getTime())) {
      ctx.addIssue({
        code: "custom",
        message: Number.isFinite(parsed.getTime())
          ? "Timestamp outside the supported range"
          : "Invalid timestamp",
      });
      return z.NEVER;
    }
    return parsed;
  });

const nullableImportDate = importDate.nullable().optional().default(null);

/** Drizzle `numeric` columns arrive as strings and must stay strings —
 * coercing to number changes the shape on re-export. */
const numericString = z
  .string()
  .max(32)
  .regex(/^\d+(\.\d+)?$/, "Must be a number");

const importScheduleSchema = z.object({
  scheduleKind: z.enum(["fixed_time", "interval", "prn"]),
  timeOfDay: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional()
    .default(null),
  intervalHours: numericString.nullable().optional().default(null),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional().default(null),
  sortOrder: z.number().int().min(0).max(10_000).catch(0),
  effectiveFrom: nullableImportDate,
  effectiveTo: nullableImportDate,
});

const importMedicationSchema = z.object({
  id: z.string().max(64).nullable().optional().default(null),
  name: z.string().min(1).max(200),
  dosageAmount: numericString,
  dosageUnit: z.string().min(1).max(20),
  form: z
    .enum([
      "tablet",
      "capsule",
      "liquid",
      "softgel",
      "patch",
      "injection",
      "inhaler",
      "drops",
      "cream",
      "other",
    ])
    .catch("other"),
  category: z.enum(["prescription", "otc", "supplement"]).catch("otc"),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .catch("#6366f1"),
  colourSecondary: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional()
    .default(null)
    .catch(null),
  pattern: z
    .enum(["solid", "split", "gradient", "stripes", "h-stripes", "dots", "checkerboard", "radial"])
    .catch("solid"),
  notes: z.string().max(1000).nullable().optional().default(null),
  scheduleType: z.enum(["scheduled", "as_needed"]).catch("scheduled"),
  scheduleIntervalHours: numericString.nullable().optional().default(null),
  inventoryCount: z.number().int().min(0).max(1_000_000).nullable().optional().default(null),
  inventoryAlertThreshold: z
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .nullable()
    .optional()
    .default(null),
  sortOrder: z.number().int().min(0).max(10_000).catch(0),
  isArchived: z.boolean().catch(false),
  archivedAt: nullableImportDate,
  startedAt: nullableImportDate,
  endedAt: nullableImportDate,
  // An older backup predates this feature and simply won't have these
  // keys — `optional()` with no `.default()` lets that parse, and
  // apply.ts supplies the "inherit" / "enabled" defaults at insert time.
  notificationsEnabled: z.boolean().optional(),
  notifyOverdueEmail: z.boolean().nullable().optional(),
  notifyOverduePush: z.boolean().nullable().optional(),
  notifyLowInventoryEmail: z.boolean().nullable().optional(),
  notifyLowInventoryPush: z.boolean().nullable().optional(),
  // Same "predates the feature" reasoning as the five fields above — no
  // `.default()`, so an older backup without these keys still parses,
  // and apply.ts supplies the column defaults (0 / null / 3) at insert
  // time.
  notifyOffsetMinutes: z.number().int().min(0).max(MAX_OFFSET_MINUTES).optional(),
  notifyRepeatEveryMinutes: z
    .number()
    .int()
    .min(MIN_REPEAT_MINUTES)
    .max(MAX_REPEAT_MINUTES)
    .nullable()
    .optional(),
  notifyMaxRepeats: z.number().int().min(0).max(MAX_NAG_REPEATS).optional(),
  schedules: z.array(importScheduleSchema).max(IMPORT_MAX_SCHEDULES_PER_MED).optional().default([]),
});

export const importDoseLogSchema = z.object({
  medicationId: z.string().max(64),
  quantity: z.number().int().min(1).max(1000).catch(1),
  takenAt: importDate,
  loggedAt: nullableImportDate,
  notes: z.string().max(500).nullable().optional().default(null),
  sideEffects: z.array(sideEffectJson).max(20).nullable().optional().default(null),
  status: z.enum(["taken", "skipped", "missed"]).catch("taken"),
});

export const importInventoryEventSchema = z.object({
  medicationId: z.string().max(64),
  eventType: z.enum([
    "dose_taken",
    "dose_deleted",
    "dose_quantity_updated",
    "manual_adjustment",
    "refill",
    "correction",
  ]),
  quantityChange: z.number().int().min(-1_000_000).max(1_000_000),
  previousCount: z.number().int().min(0).max(1_000_000).nullable().optional().default(null),
  newCount: z.number().int().min(0).max(1_000_000).nullable().optional().default(null),
  note: z.string().max(200).nullable().optional().default(null),
  createdAt: importDate,
});

/** Only `name` and `timezone` are read. Email, 2FA state and verification
 * flags are intentionally not modelled — importing them would let a file
 * rewrite the importer's identity. */
const importProfileSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().refine((tz) => validTimezones.has(tz), "Invalid timezone"),
});

const importPreferencesSchema = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
  uiDensity: z.enum(["comfortable", "compact"]).optional(),
  reducedMotion: z.boolean().optional(),
  overdueEmailReminders: z.boolean().optional(),
  overduePushReminders: z.boolean().optional(),
  lowInventoryEmailAlerts: z.boolean().optional(),
  lowInventoryPushAlerts: z.boolean().optional(),
  doseLogPageSize: z.number().int().min(5).max(100).optional(),
  heatmapPeriod: z.number().int().min(1).max(3650).optional(),
  exportFormat: z.enum(["pdf", "csv"]).optional(),
});

export const IMPORT_SUPPORTED_VERSION = 1;

export const backupEnvelopeSchema = z.object({
  version: z.literal(IMPORT_SUPPORTED_VERSION),
  exportedAt: importDate.nullable().optional().default(null),
  profile: importProfileSchema.nullable().optional().default(null),
  preferences: importPreferencesSchema.nullable().optional().default(null),
  // Medications are validated strictly: they're few, they're structural,
  // and dropping one would silently orphan all of its dose history.
  medications: z.array(importMedicationSchema).max(IMPORT_MAX_MEDICATIONS).optional().default([]),
  // Dose and inventory rows are only bounded and shape-checked here, then
  // validated one at a time in server/import/backup.ts. A single bad row
  // in a 5000-dose backup must not make the whole file unimportable — it
  // is skipped and counted instead.
  doseLogs: z.array(z.unknown()).max(IMPORT_MAX_DOSE_LOGS).optional().default([]),
  inventoryEvents: z.array(z.unknown()).max(IMPORT_MAX_INVENTORY_EVENTS).optional().default([]),
  // auditLogs is deliberately NOT modelled. Replaying a file's audit
  // rows would fabricate a tamper-evident history; import writes one
  // `data_import` row of its own instead.
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

/** Form fields for the import page. Checkboxes follow the existing
 * "only submits when checked" convention. */
export const importOptionsSchema = z.object({
  mode: z.enum(["merge", "replace"]).default("merge"),
  sectionInventory: checkboxField,
  sectionPreferences: checkboxField,
  sectionProfile: checkboxField,
});

/** User decisions for CSV medication names with no match in the account.
 * Keyed by the normalised (lowercased, trimmed) name. */
export const nameMappingSchema = z.record(
  z.string().min(1).max(200),
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("create") }),
    z.object({ action: z.literal("map"), medicationId: z.string().min(1).max(64) }),
    z.object({ action: z.literal("skip") }),
  ]),
);
