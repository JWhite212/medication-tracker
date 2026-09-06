import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  APPEARANCE_ACTION_KEYS,
  appearanceFieldSchemas,
  appearanceImportShape,
  appearancePayloadShape,
} from "$lib/appearance/schema";
import { APPEARANCE_KEYS } from "$lib/appearance/registry";

describe("arity 1 — the per-field form doors", () => {
  it("defines one action schema per registry key", () => {
    expect(APPEARANCE_ACTION_KEYS.sort()).toEqual([...APPEARANCE_KEYS].sort());
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
