// @vitest-environment node
import { describe, it, expect, expectTypeOf } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import type { InventoryEventType } from "$lib/server/db/schema";
import { importInventoryEventSchema } from "$lib/utils/validation";

/**
 * An inventory event type has four homes, and they drift independently:
 *
 *  - the `InventoryEventType` union in schema.ts, which types every writer;
 *  - the import enum in validation.ts. Missing there, re-importing a backup
 *    skips every event of that type as "could not be read";
 *  - the history labels on the medication page. Missing there, the page shows
 *    the raw type string;
 *  - the `eventType` list in docs/api-v1-contract.md, which is prose.
 *
 * This file holds the first three together. `dose_restored` (a delete's Undo
 * taking back what that delete credited) is the value that prompted it.
 */

const PAGE = readFileSync(
  fileURLToPath(new URL("../../src/routes/(app)/medications/[id]/+page.svelte", import.meta.url)),
  "utf8",
);

/** The `EVENT_LABELS` object literal, from its declaration to its closing brace. */
function labelBlock(): string {
  const start = PAGE.indexOf("const EVENT_LABELS");
  expect(start, "EVENT_LABELS moved or was renamed: update this test").toBeGreaterThan(-1);
  return PAGE.slice(start, PAGE.indexOf("};", start));
}

const IMPORTABLE = importInventoryEventSchema.shape.eventType.options;

describe("inventory event types", () => {
  it("names the same set in the import enum and the InventoryEventType union", () => {
    // Type-level: `npm run check` enforces this line, vitest does not.
    expectTypeOf<
      z.infer<typeof importInventoryEventSchema>["eventType"]
    >().toEqualTypeOf<InventoryEventType>();
    expect(IMPORTABLE).toContain("dose_restored");
  });

  it("gives every importable event type a history label", () => {
    const block = labelBlock();
    const unlabelled = IMPORTABLE.filter((type) => !new RegExp(`\\b${type}:\\s*"`).test(block));
    expect(unlabelled).toEqual([]);
  });

  it("labels a restore 'Dose restored'", () => {
    expect(labelBlock()).toContain('dose_restored: "Dose restored",');
  });
});
