ALTER TABLE "user_preferences" ADD COLUMN "dashboard_section_order" jsonb;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "dashboard_show_later" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "dashboard_show_quick_log" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "dashboard_show_refills" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "time_since_days_from_hours" integer DEFAULT 48 NOT NULL;