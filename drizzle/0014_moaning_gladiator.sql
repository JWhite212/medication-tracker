CREATE TABLE "api_commands" (
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_commands_user_id_idempotency_key_pk" PRIMARY KEY("user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "sync_tombstones" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dose_logs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sync_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_commands" ADD CONSTRAINT "api_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_tombstones_user_deleted_idx" ON "sync_tombstones" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "dose_logs_user_updated_idx" ON "dose_logs" USING btree ("user_id","updated_at");--> statement-breakpoint
UPDATE dose_logs SET updated_at = logged_at WHERE updated_at > logged_at;