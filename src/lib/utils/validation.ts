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
    .optional(),
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

export const appearanceSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex colour"),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  timeFormat: z.enum(["12h", "24h"]),
  uiDensity: z.enum(["comfortable", "compact"]),
  reducedMotion: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

export const notificationSchema = z.object({
  emailReminders: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  lowInventoryAlerts: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

export const dataSchema = z.object({
  exportFormat: z.enum(["pdf", "csv"]),
});

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
