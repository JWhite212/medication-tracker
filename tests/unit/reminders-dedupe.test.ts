import { describe, it, expect } from "vitest";
import { buildOverdueDedupeKey, buildLowInventoryDedupeKey } from "$lib/server/reminders/domain";

// Due-ness itself is covered by tests/unit/due.test.ts and
// tests/unit/due-parity.test.ts. What remains here is reminder identity.

describe("buildOverdueDedupeKey", () => {
  it("is deterministic for the same inputs", () => {
    const slot = new Date("2026-05-01T08:00:00.000Z");
    expect(buildOverdueDedupeKey("u", "m", "fixed_time", "s", slot)).toBe(
      buildOverdueDedupeKey("u", "m", "fixed_time", "s", slot),
    );
  });

  it("differs when slot differs", () => {
    const a = buildOverdueDedupeKey("u", "m", "fixed_time", "s", new Date("2026-05-01T08:00:00Z"));
    const b = buildOverdueDedupeKey("u", "m", "fixed_time", "s", new Date("2026-05-01T20:00:00Z"));
    expect(a).not.toBe(b);
  });

  it("differs when scheduleId differs", () => {
    const slot = new Date("2026-05-01T08:00:00Z");
    expect(buildOverdueDedupeKey("u", "m", "fixed_time", "s1", slot)).not.toBe(
      buildOverdueDedupeKey("u", "m", "fixed_time", "s2", slot),
    );
  });

  it("encodes the slot as ISO-8601", () => {
    const slot = new Date("2026-05-01T08:00:00.000Z");
    expect(buildOverdueDedupeKey("u", "m", "fixed_time", "s", slot)).toContain(
      "2026-05-01T08:00:00.000Z",
    );
  });
});

describe("buildLowInventoryDedupeKey", () => {
  it("changes only when the count changes", () => {
    expect(buildLowInventoryDedupeKey("u", "m", 5)).toBe(buildLowInventoryDedupeKey("u", "m", 5));
    expect(buildLowInventoryDedupeKey("u", "m", 5)).not.toBe(
      buildLowInventoryDedupeKey("u", "m", 4),
    );
  });

  it("includes the low_inventory marker so it cannot collide with overdue keys", () => {
    expect(buildLowInventoryDedupeKey("u", "m", 5)).toContain(":low_inventory:");
  });
});
