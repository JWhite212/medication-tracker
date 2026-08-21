// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { load } = await import("../../../src/routes/(app)/log/+page.server");

const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } };
const parent = async () => ({ preferences: { doseLogPageSize: 20 } });

function loadWith(query: string) {
  return load({
    locals,
    url: new URL(`http://x/log?${query}`),
    parent,
  } as never) as Promise<{ doses: Array<{ id: string }> }>;
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication();
});

describe("side-effects filter", () => {
  beforeEach(async () => {
    await pgDb.seedDose({ id: "none", sideEffects: null });
    await pgDb.seedDose({ id: "empty", sideEffects: [] });
    await pgDb.seedDose({
      id: "some",
      sideEffects: [{ name: "nausea", severity: "mild" }],
    });
  });

  it("returns every dose when the filter is off", async () => {
    const { doses } = await loadWith("");
    expect(doses.map((d) => d.id).sort()).toEqual(["empty", "none", "some"]);
  });

  it("excludes both null AND empty-array side effects", async () => {
    const { doses } = await loadWith("withSideEffects=true");
    // jsonb_array_length returns 0 for [], not null — so an IS NOT NULL
    // filter would wrongly keep the 'empty' row.
    expect(doses.map((d) => d.id)).toEqual(["some"]);
  });
});

describe("notes search escaping", () => {
  // The decoy rows are the whole point. A row merely CONTAINING the search
  // term proves nothing: unescaped, `%100%%` still requires the literal
  // "100", so it matches "felt 100% better" either way. What separates
  // escaped from unescaped is a row the wildcard would reach and the
  // literal would not — "took 1000 mg" for `%`, "dosexmissed" for `_`.
  beforeEach(async () => {
    await pgDb.seedDose({ id: "pct", notes: "felt 100% better" });
    await pgDb.seedDose({ id: "thousand", notes: "took 1000 mg" });
    await pgDb.seedDose({ id: "under", notes: "dose_missed once" });
    await pgDb.seedDose({ id: "anychar", notes: "dosexmissed twice" });
    await pgDb.seedDose({ id: "plain", notes: "felt better" });
  });

  it("treats % in a search term as a literal, not a wildcard", async () => {
    const { doses } = await loadWith("q=100%25"); // %25 is an encoded '%'
    // Unescaped this is `%100%%`, which also sweeps up "took 1000 mg".
    expect(doses.map((d) => d.id)).toEqual(["pct"]);
  });

  it("treats _ in a search term as a literal, not a single-char wildcard", async () => {
    const { doses } = await loadWith("q=dose_missed");
    // Unescaped the `_` matches any single character, pulling in
    // "dosexmissed twice".
    expect(doses.map((d) => d.id)).toEqual(["under"]);
  });

  it("still matches an ordinary substring, case-insensitively", async () => {
    const { doses } = await loadWith("q=FELT");
    // The positive control: escaping that matched nothing at all would
    // otherwise satisfy both tests above.
    expect(doses.map((d) => d.id).sort()).toEqual(["pct", "plain"]);
  });
});
