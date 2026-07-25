import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(100),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

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
    intervalHours: z.coerce.number().positive().max(72),
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
