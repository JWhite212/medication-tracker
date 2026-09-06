// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, userPreferences } from "../../../src/lib/server/db/schema";

// Real Postgres, not the fake: the assertion below is about WHICH row
// version the diff is computed against, and only a database decides that.
// The two calls also have to reach one connection in the order they were
// issued, which fakeDb's synchronous chains cannot model.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { updatePreferences } = await import("../../../src/lib/server/preferences");

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
