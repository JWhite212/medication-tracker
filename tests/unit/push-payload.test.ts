import { describe, it, expect } from "vitest";
import { TEST_PUSH_TAG, isTestTag, lowInventoryTag, overdueTag } from "$lib/utils/push-payload";

// Every tag builder in the registry. Add new builders here — the
// collision tests below iterate this list, so a tag added without a
// thought for the existing namespaces fails immediately.
const BUILDERS: Array<[string, (medicationId: string) => string]> = [
  ["overdue", overdueTag],
  ["lowInventory", lowInventoryTag],
  ["test", () => TEST_PUSH_TAG],
];

describe("tag builders", () => {
  it("builds the overdue tag already deployed", () => {
    expect(overdueTag("med-A")).toBe("overdue-med-A");
  });

  it("builds the low-inventory tag already deployed", () => {
    expect(lowInventoryTag("med-LI")).toBe("low-inventory-med-LI");
  });

  it("exposes the test tag already deployed", () => {
    expect(TEST_PUSH_TAG).toBe("medtracker-test");
  });
});

describe("tag namespace disjointness", () => {
  // Tags are a replace-key: two notifications sharing one leave only the
  // last. A collision between namespaces would silently erase a real
  // reminder, so it is a correctness property, not tidiness.
  it("issues a distinct tag from every builder for the same medication", () => {
    const tags = BUILDERS.map(([, build]) => build("med-1"));
    expect(new Set(tags).size).toBe(BUILDERS.length);
  });

  it("cannot be made to collide by an id that mimics another namespace", () => {
    const hostile = ["low-inventory-med-1", "overdue-med-1", "medtracker-test", ""];
    for (const id of hostile) {
      expect(overdueTag(id)).not.toBe(lowInventoryTag(id));
      expect(overdueTag(id)).not.toBe(TEST_PUSH_TAG);
      expect(lowInventoryTag(id)).not.toBe(TEST_PUSH_TAG);
    }
  });
});

describe("isTestTag", () => {
  it("recognises the test tag", () => {
    expect(isTestTag(TEST_PUSH_TAG)).toBe(true);
  });

  it("rejects reminder tags", () => {
    expect(isTestTag(overdueTag("med-1"))).toBe(false);
    expect(isTestTag(lowInventoryTag("med-1"))).toBe(false);
  });

  it("rejects an absent tag", () => {
    expect(isTestTag(undefined)).toBe(false);
  });
});
