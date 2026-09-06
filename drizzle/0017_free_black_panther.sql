ALTER TABLE "user_preferences" ALTER COLUMN "accent_color" SET DEFAULT '#4f46e5';--> statement-breakpoint
-- Backfill: the default alone only reaches rows created from here on. Every
-- existing row still carries the old default, and the (app) layout writes it
-- into --color-accent as an inline style, which beats the stylesheet — so
-- without this UPDATE the AA accent never reaches a single real user.
-- Scoped to the exact old default so a deliberate choice of #6366f1 is the
-- only false positive; any other stored colour is untouched.
UPDATE "user_preferences" SET "accent_color" = '#4f46e5' WHERE "accent_color" = '#6366f1';
