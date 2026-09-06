// Covers: the fix for the "already saved" short-circuit in
// src/routes/(app)/settings/appearance/+page.svelte, extracted into
// `shouldSubmitField` because the page's interactive behaviour (debounce,
// single-flight queue) cannot be exercised by a mounted-component test in
// this repo -- see the module doc on shouldSubmitField for why.
import { describe, it, expect } from "vitest";
import { shouldSubmitField } from "../../src/lib/appearance/save-guard";

describe("shouldSubmitField", () => {
  it("skips the POST when the value already matches the last acked value and nothing is in flight", () => {
    // Arrowing away and back should not burn a rate-limit token.
    expect(shouldSubmitField("comfortable", "comfortable", false)).toBe(false);
  });

  it("submits when the value differs from the last acked value", () => {
    expect(shouldSubmitField("compact", "comfortable", false)).toBe(true);
  });

  it("submits even when the value matches acked, IF a save for this key is in flight", () => {
    // This is the regression case: acked ("comfortable") is stale during
    // an in-flight save that will resolve to "compact". The user's second
    // change lands back on "comfortable" -- equal to the stale acked, but
    // still a real, newer intent that must reach the queue.
    expect(shouldSubmitField("comfortable", "comfortable", true)).toBe(true);
  });

  it("submits when both the value differs and a save is in flight", () => {
    expect(shouldSubmitField("compact", "comfortable", true)).toBe(true);
  });
});
