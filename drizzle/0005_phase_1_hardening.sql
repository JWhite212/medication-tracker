-- Note: email_verification_tokens table already exists in production
-- from the legacy drizzle-kit push workflow; its CREATE TABLE was
-- removed from this migration. The 0005 snapshot still records it,
-- so future drizzle-kit generate runs see the correct state.

CREATE TABLE "reauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"medication_id" text NOT NULL,
	"reminder_type" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL,
	CONSTRAINT "reminder_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "dose_logs" ADD COLUMN "status" text DEFAULT 'taken' NOT NULL;--> statement-breakpoint
ALTER TABLE "reauth_tokens" ADD CONSTRAINT "reauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD CONSTRAINT "reminder_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD CONSTRAINT "reminder_events_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reauth_tokens_user_purpose_idx" ON "reauth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "reminder_events_user_sent_idx" ON "reminder_events" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "dose_logs_user_status_taken_idx" ON "dose_logs" USING btree ("user_id","status","taken_at");--> statement-breakpoint
-- Backfill legacy skipped doses (quantity=0 AND notes='Skipped') to status='skipped'
UPDATE "dose_logs" SET "status" = 'skipped' WHERE "quantity" = 0 AND "notes" = 'Skipped';