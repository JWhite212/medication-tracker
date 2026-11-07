import { describe, it, expect, expectTypeOf, vi } from "vitest";

// This module imports `db` but must never reach it. unusedDb THROWS on any
// property access, so an accidental query fails loudly instead of silently
// returning [] — do not "upgrade" this to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

import { computeChanges, logAudit, REDACTED } from "$lib/server/audit";
import type { auditLogs } from "$lib/server/db/schema";

describe("computeChanges", () => {
  it("detects changed fields", () => {
    const before = { name: "Old", dosage: 200 };
    const after = { name: "New", dosage: 200 };
    const changes = computeChanges(before, after);
    expect(changes).toEqual({ name: { from: "Old", to: "New" } });
  });

  it("returns null for no changes", () => {
    const before = { name: "Same", dosage: 200 };
    const after = { name: "Same", dosage: 200 };
    const changes = computeChanges(before, after);
    expect(changes).toBeNull();
  });

  it("detects multiple changes", () => {
    const before = { name: "Old", dosage: 200, colour: "#aaa" };
    const after = { name: "New", dosage: 400, colour: "#aaa" };
    const changes = computeChanges(before, after);
    expect(changes).toEqual({
      name: { from: "Old", to: "New" },
      dosage: { from: 200, to: 400 },
    });
  });
});

describe("computeChanges options (opt-in)", () => {
  it("leaves an ignored key out, so rows differing only there are no change", () => {
    const before = { name: "Same", updatedAt: new Date("2026-01-01T00:00:00Z") };
    const after = { name: "Same", updatedAt: new Date("2026-01-02T00:00:00Z") };
    expect(computeChanges(before, after, { ignore: ["updatedAt"] })).toBeNull();
    // Without the option the plain diff is unchanged for every other caller.
    expect(computeChanges(before, after)).toEqual({
      updatedAt: { from: before.updatedAt, to: after.updatedAt },
    });
  });

  it("records a redacted key's change without its content", () => {
    const changes = computeChanges(
      { notes: null, sideEffects: [{ name: "a" }] },
      { notes: "private text", sideEffects: null },
      { redact: ["notes", "sideEffects"] },
    );
    expect(changes).toEqual({
      notes: { from: null, to: REDACTED },
      sideEffects: { from: REDACTED, to: null },
    });
    expect(JSON.stringify(changes)).not.toContain("private text");
  });

  it("still detects a redacted change between two set values", () => {
    expect(computeChanges({ notes: "one" }, { notes: "two" }, { redact: ["notes"] })).toEqual({
      notes: { from: REDACTED, to: REDACTED },
    });
    expect(computeChanges({ notes: "one" }, { notes: "one" }, { redact: ["notes"] })).toBeNull();
  });
});

describe("logAudit", () => {
  it("records a restore, with no diff", async () => {
    // A deleted dose put back by its Undo is audited as "restore". Like the
    // delete before it, the row carries no diff: a diff of a dose would carry
    // its note text into the synced, never-purged audit log.
    // Type-level: `npm run check` enforces the next line, vitest does not.
    expectTypeOf<Parameters<typeof logAudit>[3]>().toEqualTypeOf<
      "create" | "update" | "delete" | "failed_login" | "restore"
    >();

    const inserted: Array<typeof auditLogs.$inferInsert> = [];
    const client = {
      insert: () => ({
        values: async (values: typeof auditLogs.$inferInsert) => {
          inserted.push(values);
        },
      }),
    };

    await logAudit("u1", "dose_log", "d1", "restore", undefined, client);

    expect(inserted).toEqual([
      expect.objectContaining({
        userId: "u1",
        entityType: "dose_log",
        entityId: "d1",
        action: "restore",
        changes: undefined,
      }),
    ]);
  });
});
