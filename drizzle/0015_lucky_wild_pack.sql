ALTER TABLE "medications" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "notify_overdue_email" boolean;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "notify_overdue_push" boolean;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "notify_low_inventory_email" boolean;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "notify_low_inventory_push" boolean;