ALTER TABLE "medications" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "medications_user_name_idx" ON "medications" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_idx" ON "oauth_accounts" USING btree ("user_id");