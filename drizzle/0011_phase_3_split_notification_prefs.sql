ALTER TABLE "user_preferences" ADD COLUMN "overdue_email_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "overdue_push_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "low_inventory_email_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "low_inventory_push_alerts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: existing users keep their effective behaviour.
--
--   email_reminders        -> overdue_email_reminders
--   email_reminders        -> overdue_push_reminders
--   low_inventory_alerts   -> low_inventory_email_alerts
--
-- Before this PR, overdue dispatch was globally gated by
-- email_reminders, so a user who turned that off received NEITHER
-- email NOR push. Mapping the same flag onto overdue_push_reminders
-- preserves that opt-out: a user who was previously silenced stays
-- silenced until they explicitly opt in via the split UI.
--
-- low_inventory_push_alerts keeps its column default (false): push
-- for low-inventory is a new capability and we should not auto-enrol
-- users.
UPDATE "user_preferences"
SET "overdue_email_reminders" = "email_reminders",
    "overdue_push_reminders" = "email_reminders",
    "low_inventory_email_alerts" = "low_inventory_alerts";