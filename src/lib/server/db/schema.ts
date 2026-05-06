import {
  pgTable,
  text,
  boolean,
  timestamp,
  numeric,
  integer,
  bigint,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("UTC"),
  totpSecret: text("totp_secret"),
  // Highest TOTP step ever accepted for this user. Replay guard:
  // a code can only be consumed if its step strictly exceeds this
  // value (RFC 6238 §5.2). Null = no TOTP code has been consumed yet.
  totpLastCounter: bigint("totp_last_counter", { mode: "number" }),
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
  // DEPRECATED — read from `overdueEmailReminders` instead. Will be
  // removed in a follow-up after one prod cycle. Backfilled into
  // `overdueEmailReminders` by 0011_phase_3_split_notification_prefs.
  emailReminders: boolean("email_reminders").notNull().default(true),
  // DEPRECATED — read from `lowInventoryEmailAlerts` instead.
  lowInventoryAlerts: boolean("low_inventory_alerts").notNull().default(true),
  // Channel-specific preferences split out from the legacy two
  // toggles. Each reminder type (overdue, low-inventory) can be
  // independently configured per channel (email, push).
  overdueEmailReminders: boolean("overdue_email_reminders").notNull().default(true),
  overduePushReminders: boolean("overdue_push_reminders").notNull().default(true),
  lowInventoryEmailAlerts: boolean("low_inventory_email_alerts").notNull().default(true),
  lowInventoryPushAlerts: boolean("low_inventory_push_alerts").notNull().default(false),
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

export type ReminderStatus = "pending" | "sent" | "failed";
export type ReminderChannelStatus = "not_configured" | "pending" | "sent" | "failed";

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
    // sentAt is the time the row was first inserted. lastAttemptAt
    // advances on every retry. The dedupe key gives idempotency; the
    // status fields make "row exists" no longer mean "send succeeded".
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    status: text("status").notNull().default("pending").$type<ReminderStatus>(),
    emailStatus: text("email_status")
      .notNull()
      .default("not_configured")
      .$type<ReminderChannelStatus>(),
    pushStatus: text("push_status")
      .notNull()
      .default("not_configured")
      .$type<ReminderChannelStatus>(),
    attemptCount: integer("attempt_count").notNull().default(1),
    lastError: text("last_error"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reminder_events_user_sent_idx").on(table.userId, table.sentAt),
    // Partial index — only failed rows are eligible for retry, so we
    // only index those.
    index("reminder_events_retryable_idx")
      .on(table.status, table.lastAttemptAt)
      .where(sql`${table.status} = 'failed'`),
  ],
);

export type InventoryEventType =
  | "dose_taken"
  | "dose_deleted"
  | "dose_quantity_updated"
  | "manual_adjustment"
  | "refill"
  | "correction";

export const inventoryEvents = pgTable(
  "inventory_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull().$type<InventoryEventType>(),
    // Signed delta applied to inventory_count. dose_taken is negative,
    // refill / dose_deleted (taken) are positive, manual_adjustment
    // and correction can be either.
    quantityChange: integer("quantity_change").notNull(),
    // Snapshot of the count immediately before and after the change.
    // Nullable for medications without inventory tracking, where the
    // event is recorded for traceability but the count is undefined.
    previousCount: integer("previous_count"),
    newCount: integer("new_count"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_events_user_created_idx").on(table.userId, table.createdAt),
    index("inventory_events_med_created_idx").on(table.medicationId, table.createdAt),
  ],
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
