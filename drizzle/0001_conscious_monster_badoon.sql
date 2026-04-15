ALTER TABLE "medications" ADD COLUMN "colour_secondary" text;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "pattern" text DEFAULT 'solid' NOT NULL;