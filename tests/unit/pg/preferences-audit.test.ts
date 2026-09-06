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

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedPreferences({ accentColor: A });
});

describe("updatePreferences — the before-image under a double-click", () => {
  it("audits both writes when two saves for the same field overlap", async () => {
    // Instant save posts one field per control change. A double-click
    // sends A -> B and B -> A close enough together that the second
    // request's read lands before the first request's write.
    await Promise.all([
      updatePreferences("u1", { accentColor: B }),
      updatePreferences("u1", { accentColor: A }),
    ]);

    const [stored] = await pgDb.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, "u1"));
    const rows = await pgDb.db.select().from(auditLogs);

    // Before the fix: one row. The second save diffs A against A, finds
    // nothing, and writes nothing -- so the log says the accent is B
    // while the column holds A. Not incomplete: wrong.
    expect(rows).toHaveLength(2);

    // Order-independent on purpose. created_at defaults to now() per
    // implicit transaction, and two statements microseconds apart are not
    // a stable sort key.
    expect(rows.map((r) => r.changes)).toEqual(
      expect.arrayContaining([
        { accentColor: { from: A, to: B } },
        { accentColor: { from: B, to: A } },
      ]),
    );

    // The property that actually matters, stated directly: replaying the
    // logged edges from the seeded value has to land on what the column
    // holds.
    const edges = rows.map(
      (r) => (r.changes as Record<string, { from: string; to: string }>).accentColor,
    );
    let value = A;
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
    expect(rows[0].changes).toEqual({ accentColor: { from: A, to: B } });
  });
});
