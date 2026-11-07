// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { medications } from "../../../src/lib/server/db/schema";

// Real Postgres: whether the archive survives a failed audit insert is
// decided by the database's transaction boundary, not by TypeScript.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { archiveMedication, unarchiveMedication } =
  await import("../../../src/lib/server/medications");

// /api/v1's runCommands releases the idempotency reservation when a handler
// throws, so a handler must be all-or-nothing: a throw must leave no write.
// Make the audit insert fail at the database, wherever logAudit runs it.
async function breakAuditInserts() {
  await pgDb.client.exec(`
    CREATE OR REPLACE FUNCTION fail_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'audit insert failed'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fail_audit();
  `);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
});

afterEach(async () => {
  await pgDb.client.exec(`DROP TRIGGER IF EXISTS fail_audit ON audit_logs;`);
});

describe("archive / unarchive are all-or-nothing", () => {
  it("archiveMedication leaves the medication active when its audit row fails", async () => {
    await pgDb.seedMedication({ isArchived: false, archivedAt: null });
    await breakAuditInserts();

    await expect(archiveMedication("u1", "m1")).rejects.toThrow();

    const [row] = await pgDb.db
      .select({ isArchived: medications.isArchived, archivedAt: medications.archivedAt })
      .from(medications)
      .where(eq(medications.id, "m1"));
    expect(row).toEqual({ isArchived: false, archivedAt: null });
  });

  it("unarchiveMedication leaves the medication archived when its audit row fails", async () => {
    const archivedAt = new Date("2026-10-01T09:00:00.000Z");
    await pgDb.seedMedication({ isArchived: true, archivedAt });
    await breakAuditInserts();

    await expect(unarchiveMedication("u1", "m1")).rejects.toThrow();

    const [row] = await pgDb.db
      .select({ isArchived: medications.isArchived, archivedAt: medications.archivedAt })
      .from(medications)
      .where(eq(medications.id, "m1"));
    expect(row).toEqual({ isArchived: true, archivedAt });
  });
});
