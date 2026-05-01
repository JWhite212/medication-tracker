-- Add lifecycle window columns. Existing rows are backfilled from
-- created_at so analytics keep working over historical data without
-- treating every existing row as having started "today".
--
-- Rather than ADD COLUMN ... DEFAULT now() NOT NULL (which would
-- stamp every existing row with the migration timestamp), we add the
-- columns nullable, backfill from created_at, then set NOT NULL +
-- DEFAULT now() for future inserts.
ALTER TABLE "medications" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
UPDATE "medications" SET "started_at" = "created_at" WHERE "started_at" IS NULL;--> statement-breakpoint
ALTER TABLE "medications" ALTER COLUMN "started_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ALTER COLUMN "started_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "medications_user_started_idx" ON "medications" USING btree ("user_id","started_at");--> statement-breakpoint

ALTER TABLE "medication_schedules" ADD COLUMN "effective_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "medication_schedules" ADD COLUMN "effective_to" timestamp with time zone;--> statement-breakpoint
UPDATE "medication_schedules" SET "effective_from" = "created_at" WHERE "effective_from" IS NULL;--> statement-breakpoint
ALTER TABLE "medication_schedules" ALTER COLUMN "effective_from" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "medication_schedules" ALTER COLUMN "effective_from" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "medication_schedules_med_effective_idx" ON "medication_schedules" USING btree ("medication_id","effective_from");
