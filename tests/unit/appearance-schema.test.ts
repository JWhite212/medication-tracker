import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  APPEARANCE_ACTION_KEYS,
  appearanceFieldSchemas,
  appearanceImportShape,
  appearancePayloadShape,
} from "$lib/appearance/schema";
import {
  APPEARANCE_ENTRIES,
  APPEARANCE_KEYS,
  type AppearanceEntries,
} from "$lib/appearance/registry";

describe("arity 1 — the per-field form doors", () => {
  it("defines one action schema per registry key", () => {
    expect([...APPEARANCE_ACTION_KEYS].sort()).toEqual([...APPEARANCE_KEYS].sort());
  });

  it("accepts exactly its own field", () => {
    expect(appearanceFieldSchemas.uiDensity.safeParse({ uiDensity: "compact" })).toMatchObject({
      success: true,
      data: { uiDensity: "compact" },
    });
  });

  it("rejects an empty body — the field is required", () => {
    expect(appearanceFieldSchemas.uiDensity.safeParse({}).success).toBe(false);
  });

  it("rejects a mistyped field name instead of silently stripping it", () => {
    // This is the whole point of arity 1. A plain z.object strips the
    // typo and, if the schema were all-optional, would report success
    // for a save that changed nothing -- or worse, for checkboxField,
    // would write `false` over the user's setting.
    const result = appearanceFieldSchemas.uiDensity.safeParse({
      uiDensity: "compact",
      uiDensty: "comfortable",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].code).toBe("unrecognized_keys");
  });

  it("rejects a value outside the registry's option list", () => {
    expect(appearanceFieldSchemas.uiDensity.safeParse({ uiDensity: "roomy" }).success).toBe(false);
  });

  it("keeps the custom hex message on accentColor", () => {
    const result = appearanceFieldSchemas.accentColor.safeParse({ accentColor: "nope" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe("Must be a valid hex colour");
  });

  it("maps the checkbox's on/off pair to a boolean, both ways", () => {
    expect(appearanceFieldSchemas.reducedMotion.safeParse({ reducedMotion: "on" })).toMatchObject({
      success: true,
      data: { reducedMotion: true },
    });
    expect(appearanceFieldSchemas.reducedMotion.safeParse({ reducedMotion: "off" })).toMatchObject({
      success: true,
      data: { reducedMotion: false },
    });
    // An absent field must NOT parse as false: under one-field-per-action
    // that is indistinguishable from a mistyped field name.
    expect(appearanceFieldSchemas.reducedMotion.safeParse({}).success).toBe(false);
  });
});

describe("arity 2 — the /api/v1 payload shape", () => {
  const schema = z.object(appearancePayloadShape);

  it("accepts a single field", () => {
    expect(schema.safeParse({ accentColor: "#4f46e5" })).toMatchObject({
      success: true,
      data: { accentColor: "#4f46e5" },
    });
  });

  it("accepts an empty object — every field is optional", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("takes reducedMotion as a JSON boolean, not the form's on/off string", () => {
    expect(schema.safeParse({ reducedMotion: true }).success).toBe(true);
    expect(schema.safeParse({ reducedMotion: "on" }).success).toBe(false);
  });

  it("uses the registry's option values", () => {
    expect(schema.safeParse({ timeFormat: "24h" }).success).toBe(true);
    expect(schema.safeParse({ timeFormat: "36h" }).success).toBe(false);
  });
});

describe("arity 3 — the backup import shape", () => {
  const schema = z.object(appearanceImportShape);

  it("accepts every field optionally", () => {
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ uiDensity: "compact", reducedMotion: false }).success).toBe(true);
  });
});

describe("option-value coverage — every registry select value round-trips through every arity", () => {
  // schema.ts's `satisfies` clauses only catch a schema that ACCEPTS a value
  // the registry disallows; they do not catch a schema that OMITS one of
  // the registry's option values (a narrower z.enum still satisfies the
  // wider ZodType). This closes that gap at runtime. Expectations are
  // derived from APPEARANCE_ENTRIES, never hand-written, so this can't
  // become a second restatement of the registry's option lists.
  //
  // reducedMotion is deliberately excluded: it's a checkbox, not a select,
  // and its differing per-arity input types (on/off string vs boolean) are
  // already covered by "maps the checkbox's on/off pair..." and "takes
  // reducedMotion as a JSON boolean..." above.
  const selectEntries = APPEARANCE_ENTRIES.filter(
    (e): e is Extract<AppearanceEntries[number], { control: "select" }> => e.control === "select",
  );

  const arityPayloadSchema = z.object(appearancePayloadShape);
  const arityImportSchema = z.object(appearanceImportShape);
  const NOT_A_REGISTRY_OPTION = "not-a-registry-option";

  for (const entry of selectEntries) {
    const key = entry.key;

    it(`arity 1 (form) accepts exactly ${key}'s registry option set`, () => {
      const fieldSchema = appearanceFieldSchemas[key];
      for (const option of entry.options) {
        expect(fieldSchema.safeParse({ [key]: option.value }).success).toBe(true);
      }
      expect(fieldSchema.safeParse({ [key]: NOT_A_REGISTRY_OPTION }).success).toBe(false);
    });

    it(`arity 2 (/api/v1 payload) accepts exactly ${key}'s registry option set`, () => {
      for (const option of entry.options) {
        expect(arityPayloadSchema.safeParse({ [key]: option.value }).success).toBe(true);
      }
      expect(arityPayloadSchema.safeParse({ [key]: NOT_A_REGISTRY_OPTION }).success).toBe(false);
    });

    it(`arity 3 (import) accepts exactly ${key}'s registry option set`, () => {
      for (const option of entry.options) {
        expect(arityImportSchema.safeParse({ [key]: option.value }).success).toBe(true);
      }
      expect(arityImportSchema.safeParse({ [key]: NOT_A_REGISTRY_OPTION }).success).toBe(false);
    });
  }
});

describe("the three arities are genuinely different objects", () => {
  it("does not share one schema between the form and the API doors", () => {
    // Same field, three different accepted inputs. Collapsing these into
    // one object schema changes behaviour at whichever door loses.
    expect(appearanceFieldSchemas.reducedMotion.safeParse({ reducedMotion: "on" }).success).toBe(
      true,
    );
    expect(z.object(appearancePayloadShape).safeParse({ reducedMotion: "on" }).success).toBe(false);
  });
});
