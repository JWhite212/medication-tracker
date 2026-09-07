// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { load } = await import("../../../src/routes/(app)/log/+page.server");

/**
 * The log page's `from`/`to` params, which were the only ones on this load
 * not validated — `page`, `status`, `q` and `withSideEffects` all were, and
 * the analytics page guarded the identical pair.
 *
 * On PGlite because the assertions are about which rows a real `WHERE`
 * returns across a timezone boundary; `fake-db` captures predicates without
 * evaluating them, so it could not tell a correct bound from a wrong one.
 */

const parent = async () => ({ preferences: { doseLogPageSize: 20 } });

function loadWith(query: string, timezone = "UTC") {
  return load({
    locals: { user: { id: "u1", timezone }, session: { id: "s1" } },
    url: new URL(`http://x/log?${query}`),
    parent,
  } as never) as Promise<{ doses: Array<{ id: string }> }>;
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication();
});

describe("a malformed date param is ignored, not a 500", () => {
  beforeEach(async () => {
    await pgDb.seedDose({ id: "d1", takenAt: new Date("2026-04-15T10:00:00Z") });
  });

  it.each(["from=garbage", "to=garbage", "from=x&to=y", "from=2026-13-99"])(
    "/log?%s still renders",
    async (query) => {
      // `new Date("garbage")` went straight into `gte()`; Drizzle calls
      // toISOString() on it, which throws a RangeError out of the load.
      await expect(loadWith(query)).resolves.toBeDefined();
      const { doses } = await loadWith(query);
      expect(doses.map((d) => d.id)).toEqual(["d1"]);
    },
  );

  it("a valid bound is still applied when its partner is garbage", async () => {
    const { doses } = await loadWith("from=2026-04-16&to=garbage");
    expect(doses).toEqual([]);
  });
});

describe("a bare day key is a civil day in the user's timezone", () => {
  beforeEach(async () => {
    // 23:30 UTC on 15 April is 00:30 on the 16th in London (BST).
    await pgDb.seedDose({ id: "late", takenAt: new Date("2026-04-15T23:30:00Z") });
    // 08:00 UTC on 15 April is 09:00 on the 15th in London.
    await pgDb.seedDose({ id: "morning", takenAt: new Date("2026-04-15T08:00:00Z") });
  });

  it("includes the whole `to` day rather than stopping at its UTC midnight", async () => {
    // The old bound was `lte(takenAt, 2026-04-15T00:00Z)`, which excluded
    // every dose logged ON 15 April. Asking for "up to the 15th" returned
    // nothing from the 15th.
    const { doses } = await loadWith("to=2026-04-15", "Europe/London");
    expect(doses.map((d) => d.id)).toEqual(["morning"]);
  });

  it("puts a dose past local midnight on the NEXT day, in the user's zone", async () => {
    const london = await loadWith("from=2026-04-16", "Europe/London");
    expect(london.doses.map((d) => d.id)).toEqual(["late"]);

    // Same rows, same query, different zone — only the conversion moves it.
    const utc = await loadWith("from=2026-04-16", "UTC");
    expect(utc.doses).toEqual([]);
  });

  it("a single-day range returns that day's doses in that zone", async () => {
    const { doses } = await loadWith("from=2026-04-15&to=2026-04-15", "Europe/London");
    expect(doses.map((d) => d.id)).toEqual(["morning"]);
  });
});
