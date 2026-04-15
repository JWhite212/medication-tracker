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
  notes: z.string().max(1000).optional(),
  scheduleIntervalHours: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  inventoryCount: z.coerce.number().int().min(0).optional(),
  inventoryAlertThreshold: z.coerce.number().int().min(0).optional(),
});

export const doseLogSchema = z.object({
  medicationId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).default(1),
  takenAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

export const doseEditSchema = z.object({
  doseId: z.string().min(1),
  takenAt: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(10),
  notes: z.string().max(500).optional(),
});

export const settingsSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1),
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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MedicationInput = z.infer<typeof medicationSchema>;
export type DoseLogInput = z.infer<typeof doseLogSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
