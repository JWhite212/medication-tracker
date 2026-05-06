CREATE TABLE "inventory_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"medication_id" text NOT NULL,
	"event_type" text NOT NULL,
	"quantity_change" integer NOT NULL,
	"previous_count" integer,
	"new_count" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_events_user_created_idx" ON "inventory_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_events_med_created_idx" ON "inventory_events" USING btree ("medication_id","created_at");