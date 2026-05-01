import {
  pgTable,
  text,
  boolean,
  timestamp,
  numeric,
  integer,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("UTC"),
  totpSecret: text("totp_secret"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerUserId] }),
    index("oauth_accounts_user_idx").on(table.userId),
  ],
);

export const medications = pgTable(
  "medications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dosageAmount: numeric("dosage_amount").notNull(),
    dosageUnit: text("dosage_unit").notNull(),
    form: text("form").notNull(),
    category: text("category").notNull(),
    colour: text("colour").notNull(),
    colourSecondary: text("colour_secondary"),
    pattern: text("pattern").notNull().default("solid"),
    notes: text("notes"),
    // DEPRECATED — read from `medication_schedules` instead. Will be
    // removed in a follow-up after one prod cycle.
    scheduleType: text("schedule_type").notNull().default("scheduled"),
    // DEPRECATED — read from `medication_schedules` instead.
    scheduleIntervalHours: numeric("schedule_interval_hours"),
    inventoryCount: integer("inventory_count"),
    inventoryAlertThreshold: integer("inventory_alert_threshold"),
    sortOrder: integer("sort_order").notNull().default(0),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Lifecycle window. Analytics treats days outside [startedAt, endedAt]
    // as "not expected" — a med added yesterday no longer shows 0%
    // adherence for days before it was added.
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("medications_user_archived_idx").on(table.userId, table.isArchived),
    index("medications_user_name_idx").on(table.userId, table.name),
    index("medications_user_started_idx").on(table.userId, table.startedAt),
  ],
);

export const doseLogs = pgTable(
  "dose_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    sideEffects:
      jsonb("side_effects").$type<
        Array<{ name: string; severity: "mild" | "moderate" | "severe" }>
      >(),
    status: text("status").notNull().default("taken").$type<DoseLogStatus>(),
  },
  (table) => [
    index("dose_logs_user_taken_idx").on(table.userId, table.takenAt),
    index("dose_logs_med_taken_idx").on(table.medicationId, table.takenAt),
    index("dose_logs_user_status_taken_idx").on(table.userId, table.status, table.takenAt),
  ],
);

export type DoseLogStatus = "taken" | "skipped" | "missed";

export type ScheduleKind = "fixed_time" | "interval" | "prn";

export const medicationSchedules = pgTable(
  "medication_schedules",
  {
    id: text("id").primaryKey(),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scheduleKind: text("schedule_kind").notNull().$type<ScheduleKind>(),
    timeOfDay: text("time_of_day"),
    intervalHours: numeric("interval_hours"),
    daysOfWeek: jsonb("days_of_week").$type<number[]>(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Lifecycle window for the schedule itself — lets a user change a
    // dosing schedule without back-filling adherence under the new rate.
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("medication_schedules_med_idx").on(table.medicationId),
    index("medication_schedules_user_idx").on(table.userId),
    index("medication_schedules_med_effective_idx").on(table.medicationId, table.effectiveFrom),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_user_created_idx").on(table.userId, table.createdAt)],
);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accentColor: text("accent_color").notNull().default("#6366f1"),
  dateFormat: text("date_format").notNull().default("DD/MM/YYYY"),
  timeFormat: text("time_format").notNull().default("12h"),
  uiDensity: text("ui_density").notNull().default("comfortable"),
  reducedMotion: boolean("reduced_motion").notNull().default(false),
  emailReminders: boolean("email_reminders").notNull().default(true),
  lowInventoryAlerts: boolean("low_inventory_alerts").notNull().default(true),
  doseLogPageSize: integer("dose_log_page_size").notNull().default(20),
  heatmapPeriod: integer("heatmap_period").notNull().default(90),
  exportFormat: text("export_format").notNull().default("pdf"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("push_subscriptions_user_idx").on(table.userId)],
);

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reminderEvents = pgTable(
  "reminder_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    reminderType: text("reminder_type").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    dedupeKey: text("dedupe_key").notNull().unique(),
  },
  (table) => [index("reminder_events_user_sent_idx").on(table.userId, table.sentAt)],
);

export const reauthTokens = pgTable(
  "reauth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("reauth_tokens_user_purpose_idx").on(table.userId, table.purpose)],
);
