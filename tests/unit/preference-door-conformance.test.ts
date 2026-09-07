import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getTableColumns } from "drizzle-orm";
import { updatePreferencesPayload, backupEnvelopeSchema, dataSchema } from "$lib/utils/validation";
import { APPEARANCE_KEYS } from "$lib/appearance/registry";
import { EXPORT_FORMATS, NON_APPEARANCE_PREFERENCE_KEYS } from "$lib/preferences/schema";
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
    expect(columns).toHaveLength(13);
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

// ---------------------------------------------------------------------------
// Value domains, not just key sets
// ---------------------------------------------------------------------------
// The key-set tests above pass just as happily when a key is present at both
// doors with two DIFFERENT domains -- which is precisely how `heatmapPeriod`
// shipped unbounded at /api/v1 and bounded 1..3650 on import.
//
// The seven non-appearance keys no longer restate their domain: both doors
// spread `$lib/preferences/schema`, so an accidental divergence there is now
// unrepresentable rather than merely detectable. That makes what follows a
// backstop, not the primary guard -- it still earns its place because it
// covers the five appearance keys on the same terms, and because a
// deliberate per-door override is one line away by design.

/** Peel `.optional()` / `.nullable()` / `.default()` down to the real type. */
function innerType(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault
  ) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}

const NOT_A_VALID_VALUE = "not-a-valid-value";

/**
 * Probe values derived FROM A DOOR'S OWN SCHEMA rather than hand-written, so
 * this cannot become a fourth restatement of the domains it is checking.
 *
 * Every accessor used here is public API on zod 4.3.6, measured, not
 * assumed: `instanceof z.ZodNumber | ZodEnum | ZodBoolean | ZodString`,
 * `.minValue` / `.maxValue` on a number, `.options` on an enum.
 *
 * The caller unions the probes derived from BOTH doors, which is the whole
 * trick: when one door is bounded and the other is not, the bounded side
 * contributes `max + 1` and the unbounded side is the one that accepts it.
 * A divergence is caught whichever door carries the narrower domain.
 */
function probesFor(schema: z.ZodType): unknown[] {
  const inner = innerType(schema);
  // Shared across all types: absence, null, and a plainly wrong type. These
  // agree at both doors today; a future `.catch()` on the import side would
  // legitimately change that, and this is where it would surface.
  const universal: unknown[] = [undefined, null, NOT_A_VALID_VALUE];

  if (inner instanceof z.ZodNumber) {
    const { minValue, maxValue } = inner;
    return [
      ...universal,
      0,
      1,
      3.5, // non-integer: .int() is part of the domain too
      ...(minValue === null ? [] : [minValue - 1, minValue]),
      ...(maxValue === null ? [] : [maxValue, maxValue + 1]),
    ];
  }
  if (inner instanceof z.ZodEnum) return [...universal, ...inner.options];
  if (inner instanceof z.ZodBoolean) return [...universal, true, false, "on", 1];
  // Strings carry a regex we cannot introspect (accentColor). Probe a
  // plausible value and a plainly bad one; the assertion is that the doors
  // AGREE, not that either verdict is a particular one.
  if (inner instanceof z.ZodString) return [...universal, "", "#4f46e5", "#GGGGGG"];
  return universal;
}

/**
 * Keys the two doors are deliberately allowed to disagree on. Empty today.
 *
 * The doors are permitted to diverge -- the bound belongs to the arity, not
 * the option (spec decision 7). This list is where an intentional divergence
 * gets recorded and justified, so that the reviewable act is adding a named
 * exemption rather than deleting a test.
 */
const INTENTIONAL_DIVERGENCES = new Set<string>();

describe("preference door conformance — value domains", () => {
  // Indexed only by keys taken from these objects themselves, so the string
  // index views are honest rather than a way around a real type error.
  const apiShape = updatePreferencesPayload.shape as Record<string, z.ZodType>;
  const importShape = shapeObject(importPreferences).shape as Record<string, z.ZodType>;
  const sharedKeys = Object.keys(apiShape).filter((key) => key in importShape);

  it("checks every key both doors carry", () => {
    // Guards the generated cases below against silently covering nothing.
    // Key-set equality itself is asserted above; this is the count.
    expect(sharedKeys).toHaveLength(13);
  });

  for (const key of sharedKeys) {
    if (INTENTIONAL_DIVERGENCES.has(key)) continue;

    it(`accepts the same values for ${key} at both doors`, () => {
      const apiField = apiShape[key];
      const importField = importShape[key];
      const probes = [...new Set([...probesFor(apiField), ...probesFor(importField)])];

      // Derived from the schemas, so an empty probe set would mean a silent
      // pass for this key.
      expect(probes.length).toBeGreaterThan(3);

      for (const probe of probes) {
        const atApi = z.object({ [key]: apiField }).safeParse({ [key]: probe }).success;
        const atImport = z.object({ [key]: importField }).safeParse({ [key]: probe }).success;
        expect(
          atApi,
          `${key}: /api/v1 ${atApi ? "accepts" : "rejects"} ${JSON.stringify(probe)} but import ` +
            `${atImport ? "accepts" : "rejects"} it. If this divergence is deliberate, add ` +
            `"${key}" to INTENTIONAL_DIVERGENCES with a reason.`,
        ).toBe(atImport);
      }
    });
  }
});

describe("preference door conformance — the domains that shipped", () => {
  // The tests above prove the two doors AGREE; probes derived from the
  // schemas move with the schemas, so they cannot notice both doors widening
  // together. These pin the values that actually shipped, which is what a
  // careless edit to a shared bound would change.
  const at = (shape: Record<string, unknown>, key: string) =>
    z.object({ [key]: shape[key] as z.ZodType });
  const doors = () => [
    at(updatePreferencesPayload.shape, "doseLogPageSize"),
    at(shapeObject(importPreferences).shape, "doseLogPageSize"),
  ];

  it("holds doseLogPageSize to 5..100 at both doors", () => {
    for (const schema of doors()) {
      expect(schema.safeParse({ doseLogPageSize: 5 }).success).toBe(true);
      expect(schema.safeParse({ doseLogPageSize: 100 }).success).toBe(true);
      expect(schema.safeParse({ doseLogPageSize: 4 }).success).toBe(false);
      expect(schema.safeParse({ doseLogPageSize: 101 }).success).toBe(false);
    }
  });

  it("holds exportFormat to pdf and csv at both doors", () => {
    for (const shape of [updatePreferencesPayload.shape, shapeObject(importPreferences).shape]) {
      const schema = at(shape, "exportFormat");
      expect(schema.safeParse({ exportFormat: "pdf" }).success).toBe(true);
      expect(schema.safeParse({ exportFormat: "csv" }).success).toBe(true);
      expect(schema.safeParse({ exportFormat: "xlsx" }).success).toBe(false);
    }
  });

  it("offers exactly the substrate's export formats at the form door", () => {
    // exportFormat is the one substrate key with a form door, and arity 1 is
    // required rather than optional there because a select always submits.
    // Derived from EXPORT_FORMATS on purpose: the point is that /settings/data
    // cannot offer a value the two API doors would reject, so hand-writing
    // the list here would restate the very thing under test.
    for (const format of EXPORT_FORMATS) {
      expect(dataSchema.safeParse({ exportFormat: format }).success).toBe(true);
    }
    expect(dataSchema.safeParse({ exportFormat: NOT_A_VALID_VALUE }).success).toBe(false);
    // Required, unlike both API doors.
    expect(dataSchema.safeParse({}).success).toBe(false);
  });

  it("carries every substrate key at both doors", () => {
    // NON_APPEARANCE_PREFERENCE_KEYS is Object.keys of the substrate's field
    // types, so this fails if a key is dropped from the substrate even
    // though both doors would still agree with each other about its absence.
    expect(NON_APPEARANCE_PREFERENCE_KEYS).toHaveLength(7);
    for (const key of NON_APPEARANCE_PREFERENCE_KEYS) {
      expect(apiKeys, `/api/v1 door is missing ${key}`).toContain(key);
      expect(importKeys, `import door is missing ${key}`).toContain(key);
    }
  });
});
