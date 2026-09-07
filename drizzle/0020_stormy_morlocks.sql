ALTER TABLE "dose_logs" ADD COLUMN "inventory_applied" integer;--> statement-breakpoint
-- Backfill: before this column existed, `deleteDose` restored the full
-- `quantity`, so that is what historical rows behaved as having applied.
-- Recording it explicitly keeps the delete path's arithmetic identical for
-- every pre-existing dose rather than silently changing it.
--
-- If this file is ever applied with `drizzle-kit push` instead of `migrate`,
-- push runs the DDL only and these UPDATEs are skipped — which is why the
-- readers fall back to `quantity` when the column is NULL. The fallback is
-- the correctness guarantee for that path, not decoration.
UPDATE "dose_logs" SET "inventory_applied" = "quantity" WHERE "status" = 'taken';--> statement-breakpoint
UPDATE "dose_logs" SET "inventory_applied" = 0 WHERE "status" <> 'taken';
