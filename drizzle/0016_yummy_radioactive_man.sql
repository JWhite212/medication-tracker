ALTER TABLE "medications" ADD COLUMN "notify_offset_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "notify_repeat_every_minutes" integer;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "notify_max_repeats" integer DEFAULT 3 NOT NULL;