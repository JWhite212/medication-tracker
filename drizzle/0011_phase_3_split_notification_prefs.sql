ALTER TABLE "user_preferences" ADD COLUMN "overdue_email_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "overdue_push_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "low_inventory_email_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "low_inventory_push_alerts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: existing users keep their effective behaviour. The legacy
-- email_reminders maps to overdue_email_reminders, and
-- low_inventory_alerts maps to low_inventory_email_alerts. Push
-- columns keep their column defaults (overdue=true, low_inventory=
-- false) — overdue push was previously always-on for any user with a
-- subscription, and low-inventory push is a new capability that
-- should not opt users in without consent.
UPDATE "user_preferences"
SET "overdue_email_reminders" = "email_reminders",
    "low_inventory_email_alerts" = "low_inventory_alerts";