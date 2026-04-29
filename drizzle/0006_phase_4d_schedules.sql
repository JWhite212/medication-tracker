CREATE TABLE "medication_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"medication_id" text NOT NULL,
	"user_id" text NOT NULL,
	"schedule_kind" text NOT NULL,
	"time_of_day" text,
	"interval_hours" numeric,
	"days_of_week" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medication_schedules_med_idx" ON "medication_schedules" USING btree ("medication_id");--> statement-breakpoint
CREATE INDEX "medication_schedules_user_idx" ON "medication_schedules" USING btree ("user_id");--> statement-breakpoint
-- Backfill: every scheduled medication with an interval becomes one
-- interval row. md5(id) keeps the new row id deterministic so a replay
-- of this migration is idempotent (ON CONFLICT below).
INSERT INTO "medication_schedules"
  ("id", "medication_id", "user_id", "schedule_kind", "interval_hours", "sort_order", "created_at")
SELECT
  'sched_' || md5("id"),
  "id",
  "user_id",
  'interval',
  "schedule_interval_hours",
  0,
  now()
FROM "medications"
WHERE "schedule_type" = 'scheduled'
  AND "schedule_interval_hours" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Backfill: as_needed medications become a single prn row.
INSERT INTO "medication_schedules"
  ("id", "medication_id", "user_id", "schedule_kind", "sort_order", "created_at")
SELECT
  'sched_' || md5("id"),
  "id",
  "user_id",
  'prn',
  0,
  now()
FROM "medications"
WHERE "schedule_type" = 'as_needed'
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Defense-in-depth: enforce the discriminated-union shape at the DB
-- level so a stray write can't produce an inconsistent row that
-- readers would have to special-case.
ALTER TABLE "medication_schedules"
  ADD CONSTRAINT "chk_medication_schedules_kind"
  CHECK ("schedule_kind" IN ('fixed_time', 'interval', 'prn'));--> statement-breakpoint
ALTER TABLE "medication_schedules"
  ADD CONSTRAINT "chk_medication_schedules_fixed_time"
  CHECK (
    "schedule_kind" <> 'fixed_time'
    OR ("time_of_day" IS NOT NULL AND "interval_hours" IS NULL)
  );--> statement-breakpoint
ALTER TABLE "medication_schedules"
  ADD CONSTRAINT "chk_medication_schedules_interval"
  CHECK (
    "schedule_kind" <> 'interval'
    OR ("interval_hours" IS NOT NULL AND "time_of_day" IS NULL)
  );--> statement-breakpoint
ALTER TABLE "medication_schedules"
  ADD CONSTRAINT "chk_medication_schedules_prn"
  CHECK (
    "schedule_kind" <> 'prn'
    OR ("time_of_day" IS NULL AND "interval_hours" IS NULL AND "days_of_week" IS NULL)
  );