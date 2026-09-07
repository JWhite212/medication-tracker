import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getTableColumns } from "drizzle-orm";
import { updatePreferencesPayload, backupEnvelopeSchema } from "$lib/utils/validation";
import { APPEARANCE_KEYS } from "$lib/appearance/registry";
import { userPreferences } from "$lib/server/db/schema";

const importPreferences = backupEnvelopeSchema.shape.preferences;

/**
 * Reach the object schema's shape through the import door's wrapper chain
 * (`importPreferencesSchema.nullable().optional().default(null)`).
 *
 * Measured directly against the installed zod 4.3.6, not assumed: the
 * chain is `ZodDefault -> ZodOptional -> ZodNullable -> ZodObject`, i.e.
 * THREE `.unwrap()` calls, not the two the `.nullable().optional()`
 * construction order might suggest (`.default()` is the outermost wrap,
 * applied last). This loop keeps unwrapping until it reaches something
 * with a `.shape` rather than hardcoding that depth, so it stays correct
 * if a wrapper is ever added or removed upstream.
 */
function shapeObject(schema: z.ZodType): z.ZodObject<z.ZodRawShape> {
  let current: unknown = schema;
  while (current && typeof current === "object" && "unwrap" in current) {
    if ("shape" in (current as Record<string, unknown>)) break;
    current = (current as { unwrap: () => unknown }).unwrap();
  }
  if (!current || typeof current !== "object" || !("shape" in current)) {
    throw new Error("could not reach the object shape");
  }
  return current as z.ZodObject<z.ZodRawShape>;
}

function shapeKeys(schema: z.ZodType): string[] {
  return Object.keys(shapeObject(schema).shape);
}

const apiKeys = shapeKeys(updatePreferencesPayload);
const importKeys = shapeKeys(importPreferences);

describe("preference door conformance", () => {
  it("carries every registry key at the /api/v1 door", () => {
    for (const key of APPEARANCE_KEYS) expect(apiKeys).toContain(key);
  });

  it("carries every registry key at the import door", () => {
    for (const key of APPEARANCE_KEYS) expect(importKeys).toContain(key);
  });

  it("carries every mutable preference column at both doors", () => {
    // The round trip in docs/api-v1-contract.md §5 breaks silently if a
    // column is emitted on export but unreadable on import: a 200, no
    // error, no audit row, and the setting is gone.
    //
    // getTableColumns (not Object.keys(userPreferences)) because the
    // table proxy also carries non-column own keys like `enableRLS` --
    // measured on this table with drizzle-orm 0.45.2 -- and a plain
    // Object.keys would assert that both doors carry a method name.
    const columns = Object.keys(getTableColumns(userPreferences)).filter(
      (c) => c !== "userId" && c !== "updatedAt",
    );
    // Guards against the loop below silently asserting nothing if this
    // ever returned an empty (or truncated) list -- a drizzle refactor, a
    // mis-merge, or an accidental re-export would all still leave this
    // test green with zero real assertions run.
    expect(columns).toHaveLength(12);
    for (const column of columns) {
      expect(apiKeys, `/api/v1 door is missing ${column}`).toContain(column);
      expect(importKeys, `import door is missing ${column}`).toContain(column);
    }
  });

  it("keeps the two API doors on the same key set", () => {
    expect([...apiKeys].sort()).toEqual([...importKeys].sort());
  });

  it("agrees on heatmapPeriod's bound at both doors", () => {
    // These disagreed: unbounded at /api/v1, 1..3650 on import. The value
    // flows unclamped into the heatmap's per-day render loop, so an
    // out-of-range save rendered millions of DOM nodes on the owner's own
    // analytics page.
    const api = z.object({ heatmapPeriod: updatePreferencesPayload.shape.heatmapPeriod });
    const imp = z.object({
      heatmapPeriod: shapeObject(importPreferences).shape.heatmapPeriod,
    });
    for (const schema of [api, imp]) {
      expect(schema.safeParse({ heatmapPeriod: 90 }).success).toBe(true);
      expect(schema.safeParse({ heatmapPeriod: 3650 }).success).toBe(true);
      expect(schema.safeParse({ heatmapPeriod: 3651 }).success).toBe(false);
      expect(schema.safeParse({ heatmapPeriod: 0 }).success).toBe(false);
      expect(schema.safeParse({ heatmapPeriod: -1 }).success).toBe(false);
    }
  });
});
