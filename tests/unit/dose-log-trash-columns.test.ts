// @vitest-environment node
import { describe, it, expect, expectTypeOf } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { doseLogs, doseLogTrash } from "$lib/server/db/schema";

/**
 * `dose_log_trash` holds a copy of a deleted `dose_logs` row, and a restore
 * puts that copy back under the same id. A `dose_logs` column the trash lacks
 * is therefore silently lost by a delete-then-Undo: the restored row gets NULL
 * or the column default, and nothing downstream can tell. This file makes
 * adding a column to `dose_logs` alone fail.
 *
 * `updatedAt` is the one exemption. It is the sync cursor, and a restore writes
 * it fresh so a delta sync carries the dose back.
 *
 * The keys and cascades are checked here as well as on PGlite, because the two
 * guard different deploy paths. PGlite applies the migration SQL in
 * `drizzle/`. Production runs `drizzle-kit push`, which diffs THIS file
 * (`scripts/vercel-build.mjs`). A cascade missing from either one is a bug.
 */

type ColumnLike = { name: string; notNull: boolean; getSQLType(): string };
type Shape = { name: string; sqlType: string; notNull: boolean };

function shapes(columns: Record<string, ColumnLike>, omit: readonly string[]) {
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !omit.includes(key))
      .map(([key, col]): [string, Shape] => [
        key,
        { name: col.name, sqlType: col.getSQLType(), notNull: col.notNull },
      ]),
  );
}

/** The live row's only column the trash leaves out. */
const LIVE_ONLY = ["updatedAt"] as const;
/** The trash row's only columns the live table does not have. */
const TRASH_ONLY = ["inventoryCredited", "deletedAt"] as const;

describe("dose_log_trash mirrors dose_logs", () => {
  it("has every dose_logs column but updatedAt, with the same SQL name, type and nullability, and nothing else but its own two", () => {
    expect(shapes(getTableColumns(doseLogTrash), TRASH_ONLY)).toEqual(
      shapes(getTableColumns(doseLogs), LIVE_ONLY),
    );
  });

  it("adds exactly inventoryCredited and deletedAt, both NOT NULL", () => {
    const trash = shapes(getTableColumns(doseLogTrash), []);
    expect({ inventoryCredited: trash.inventoryCredited, deletedAt: trash.deletedAt }).toEqual({
      inventoryCredited: { name: "inventory_credited", sqlType: "integer", notNull: true },
      deletedAt: { name: "deleted_at", sqlType: "timestamp with time zone", notNull: true },
    });
  });

  it("is keyed on the dose's own id, cascades from both owners and indexes the purge", () => {
    const config = getTableConfig(doseLogTrash);
    expect(config.name).toBe("dose_log_trash");
    expect(config.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(["id"]);

    const keys = config.foreignKeys
      .map((fk) => {
        const ref = fk.reference();
        return {
          column: ref.columns.map((c) => c.name).join(","),
          references: getTableConfig(ref.foreignTable).name,
          onDelete: fk.onDelete,
        };
      })
      .sort((a, b) => a.column.localeCompare(b.column));
    expect(keys).toEqual([
      { column: "medication_id", references: "medications", onDelete: "cascade" },
      { column: "user_id", references: "users", onDelete: "cascade" },
    ]);

    expect(
      config.indexes.map((i) => ({
        name: i.config.name,
        columns: i.config.columns.map((c) => (c as { name: string }).name),
      })),
    ).toEqual([{ name: "dose_log_trash_user_deleted_idx", columns: ["user_id", "deleted_at"] }]);
  });

  it("types a live row (minus updatedAt) as a trash insert, and a trash row (plus updatedAt) as a live insert", () => {
    // Type-level: `npm run check` enforces these lines, vitest does not. They
    // are the compile-time half of the copy in both directions (the delete
    // writes the trash, the restore writes it back), including the `$type`
    // narrowings on status and side effects, which the column shapes above
    // cannot see.
    type LiveRow = typeof doseLogs.$inferSelect;
    type TrashRow = typeof doseLogTrash.$inferSelect;
    expectTypeOf<TrashRow["status"]>().toEqualTypeOf<LiveRow["status"]>();
    expectTypeOf<TrashRow["sideEffects"]>().toEqualTypeOf<LiveRow["sideEffects"]>();
    expectTypeOf<
      Omit<LiveRow, "updatedAt"> & Pick<TrashRow, "inventoryCredited" | "deletedAt">
    >().toExtend<typeof doseLogTrash.$inferInsert>();
    expectTypeOf<
      Omit<TrashRow, "inventoryCredited" | "deletedAt"> & Pick<LiveRow, "updatedAt">
    >().toExtend<typeof doseLogs.$inferInsert>();
  });
});
