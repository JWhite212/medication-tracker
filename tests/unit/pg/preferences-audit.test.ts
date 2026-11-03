// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";
import { auditLogs, userPreferences } from "../../../src/lib/server/db/schema";

// Real Postgres, not the fake: the assertion below is about WHICH row
// version the diff is computed against, and only a database decides that.
// The two calls also have to reach one connection in the order they were
// issued, which fakeDb's synchronous chains cannot model.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { updatePreferences, getOrCreatePreferences } =
  await import("../../../src/lib/server/preferences");
const { PRESETS } = await import("../../../src/lib/dashboard/presets");
const { TIME_SINCE_DAYS_FROM_HOURS } = await import("../../../src/lib/utils/time");

const A = "#4f46e5";
const B = "#ff0000";
// Distinct from both A and B. Seeding here (rather than A, as the two
// racing calls target) is what makes the "either order" claim below true
// rather than aspirational: if the seed were A and one call's target were
// ALSO A, whichever of the two runs first when the row still holds A
// would be a no-op -- computeChanges sees before === after and skips the
// audit row entirely -- and only one row would ever appear, regardless of
// how many times you ran this. Seeding a third value means every possible
// interleaving of {write B, write A} is a real change against whatever
// came before it.
const C = "#22c55e";

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedPreferences({ accentColor: C });
});

describe("updatePreferences — the before-image under a double-click", () => {
  it("audits both writes when two saves for the same field overlap", async () => {
    // Instant save posts one field per control change. A double-click
    // sends two writes close enough together that the second request's
    // read lands before the first request's write.
    await Promise.all([
      updatePreferences("u1", { accentColor: B }),
      updatePreferences("u1", { accentColor: A }),
    ]);

    const [stored] = await pgDb.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, "u1"));
    const rows = await pgDb.db.select().from(auditLogs);

    // Before the fix: one row. Whichever save's before-read was captured
    // first, the other diffs its before-image against a value the row no
    // longer holds -- and if that stale before-image happens to equal the
    // second save's own target, the diff finds nothing and writes
    // nothing. Not incomplete: wrong.
    expect(rows).toHaveLength(2);

    // Genuinely order-independent, unlike a fixed pair of {from, to}
    // values would be: PGlite is one backend, so the two writes commit in
    // SOME order, and which one runs first decides whether the edges are
    // C->B, B->A or C->A, A->B. Both are real, single-hop swatch changes;
    // asserting the shape (not a specific pair) is what stays true either
    // way. created_at is not a usable sort key either -- it defaults to
    // now() per implicit transaction, and two statements microseconds
    // apart don't order reliably by it.
    for (const row of rows) {
      expect(row.changes).toMatchObject({
        accentColor: { from: expect.any(String), to: expect.any(String) },
      });
    }

    // The property that actually matters, stated directly: replaying the
    // logged edges from the seeded value has to land on what the column
    // holds, whichever order they committed in.
    const edges = rows.map(
      (r) => (r.changes as Record<string, { from: string; to: string }>).accentColor,
    );
    let value = C;
    for (let i = 0; i < edges.length; i++) {
      const next = edges.find((e) => e.from === value);
      expect(next).toBeDefined();
      value = next!.to;
    }
    expect(value).toBe(stored.accentColor);
  });

  it("still writes exactly one audit row for a single save", async () => {
    await updatePreferences("u1", { accentColor: B });

    const rows = await pgDb.db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual({ accentColor: { from: C, to: B } });
  });
});

describe("updatePreferences — the dashboard layout columns", () => {
  it("a freshly seeded user reads the Phase 1 defaults", async () => {
    // Through the real migrations, so this proves 0023 and not just schema.ts.
    await pgDb.reset();
    await pgDb.seedUser();
    const prefs = await getOrCreatePreferences("u1");
    expect(prefs.dashboardSectionOrder).toBeNull();
    expect(prefs.dashboardShowLater).toBe(true);
    expect(prefs.dashboardShowQuickLog).toBe(true);
    expect(prefs.dashboardShowRefills).toBe(true);
    expect(prefs.timeSinceDaysFromHours).toBe(48);
  });

  it("a freshly seeded user reads the Phase 2 defaults", async () => {
    // Through the real migrations, so this proves 0024 and not just schema.ts.
    await pgDb.reset();
    await pgDb.seedUser();
    const prefs = await getOrCreatePreferences("u1");
    expect(prefs.dashboardLaterMode).toBe("next");
    expect(prefs.dashboardDoneTime).toBe("both");
  });

  it("pins the column default to the named constant", () => {
    expect(getTableColumns(userPreferences).timeSinceDaysFromHours.default).toBe(
      TIME_SINCE_DAYS_FROM_HOURS,
    );
  });

  it("saving an order audits once and an identical re-save audits nothing", async () => {
    const order = ["refills", "done", "later", "quickLog"] as const;
    await updatePreferences("u1", { dashboardSectionOrder: [...order] });
    let rows = await pgDb.db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual({ dashboardSectionOrder: { from: null, to: [...order] } });

    await updatePreferences("u1", { dashboardSectionOrder: [...order] });
    rows = await pgDb.db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
  });

  it("the threshold audits only its own key", async () => {
    await updatePreferences("u1", { timeSinceDaysFromHours: 72 });
    const rows = await pgDb.db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual({ timeSinceDaysFromHours: { from: 48, to: 72 } });
  });

  it("reset audits the order back to null and the flags back to true in one row", async () => {
    await pgDb.db
      .update(userPreferences)
      .set({
        dashboardSectionOrder: ["refills", "done"],
        dashboardShowLater: false,
        dashboardShowRefills: false,
      })
      .where(eq(userPreferences.userId, "u1"));

    await updatePreferences("u1", {
      dashboardSectionOrder: null,
      dashboardShowLater: true,
      dashboardShowQuickLog: true,
      dashboardShowRefills: true,
    });

    const rows = await pgDb.db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    // dashboardShowQuickLog did not change, so it is absent.
    expect(rows[0].changes).toEqual({
      dashboardSectionOrder: { from: ["refills", "done"], to: null },
      dashboardShowLater: { from: false, to: true },
      dashboardShowRefills: { from: false, to: true },
    });
  });
});

describe("updatePreferences — dashboard presets", () => {
  it("applying Focused over the defaults audits exactly the two keys it changes, in one row", async () => {
    await updatePreferences("u1", PRESETS.focused.patch);
    const rows = await pgDb.db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].changes as object).sort()).toEqual([
      "dashboardDoneTime",
      "dashboardShowLater",
    ]);
    expect(rows[0].changes).toEqual({
      dashboardShowLater: { from: true, to: false },
      dashboardDoneTime: { from: "both", to: "since" },
    });
  });

  it("re-applying the preset already in force audits nothing", async () => {
    await updatePreferences("u1", PRESETS.focused.patch);
    await updatePreferences("u1", PRESETS.focused.patch);
    expect(await pgDb.db.select().from(auditLogs)).toHaveLength(1);
  });

  it("Standard after Just log restores every changed key in one row", async () => {
    await updatePreferences("u1", PRESETS.justLog.patch);
    await updatePreferences("u1", PRESETS.standard.patch);
    const rows = await pgDb.db.select().from(auditLogs);
    expect(rows).toHaveLength(2);
    const last = rows.find(
      (r) =>
        "dashboardSectionOrder" in (r.changes as object) &&
        (r.changes as Record<string, { to: unknown }>).dashboardSectionOrder.to === null,
    )!;
    expect(last.changes).toEqual({
      dashboardSectionOrder: { from: ["quickLog", "done", "refills", "later"], to: null },
      dashboardShowLater: { from: false, to: true },
      dashboardDoneTime: { from: "since", to: "both" },
    });
  });
});
