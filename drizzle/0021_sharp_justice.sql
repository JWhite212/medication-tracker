CREATE TABLE "dose_log_trash" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"medication_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"inventory_applied" integer,
	"inventory_credited" integer NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"notes" text,
	"side_effects" jsonb,
	"status" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dose_log_trash" ADD CONSTRAINT "dose_log_trash_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_log_trash" ADD CONSTRAINT "dose_log_trash_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dose_log_trash_user_deleted_idx" ON "dose_log_trash" USING btree ("user_id","deleted_at");