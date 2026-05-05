ALTER TABLE "reminder_events" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD COLUMN "email_status" text DEFAULT 'not_configured' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD COLUMN "push_status" text DEFAULT 'not_configured' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD COLUMN "attempt_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD COLUMN "last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "reminder_events_retryable_idx" ON "reminder_events" USING btree ("status","last_attempt_at") WHERE "reminder_events"."status" = 'failed';--> statement-breakpoint
-- Backfill: existing rows pre-date the status fields and represent
-- past successful sends (the row only existed because the dedupe-key
-- insert succeeded and the email/push call did not throw). Mark them
-- sent + email_sent so they are not picked up as retryable. Push
-- status cannot be reconstructed and stays at the default.
UPDATE "reminder_events"
SET "status" = 'sent', "email_status" = 'sent'
WHERE "status" = 'pending';