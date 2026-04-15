import { describe, it, expect, vi } from "vitest";

vi.mock("$lib/server/db", () => ({ db: {} }));

import { computeChanges } from "$lib/server/audit";

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
