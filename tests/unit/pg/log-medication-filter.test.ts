// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { load } = await import("../../../src/routes/(app)/log/+page.server");

/**
 * The /log medication filter offers every medication whose doses the list
 * can show, archived ones included.
 *
 * The dose query never filtered on `isArchived`, so an archived medication's
 * doses were listed, but the filter's options did, so those doses could not
 * be isolated and `?medication=<archivedId>` drew "All medications" over a
 * filtered list. Dose history is a question about the past (CLAUDE.md's
 * archiving rule), so the options come from `getMedicationOptions`, the same
 * source as the Analytics filter.
 *
 * On PGlite because which rows the real `WHERE` returns is the point; a
 * fake-db fixture would answer from its seed whatever the predicate said.
 */

type Option = { id: string; name: string; isArchived?: boolean };

const parent = async () => ({ preferences: { doseLogPageSize: 20 } });

function loadWith(query = "") {
  return load({
    locals: { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } },
    url: new URL(`http://x/log${query}`),
    parent,
  } as never) as Promise<{ doses: Array<{ id: string }>; medications: Option[] }>;
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
  await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
  await pgDb.seedMedication({ id: "active", name: "Ibuprofen" });
  await pgDb.seedMedication({
    id: "stopped",
    name: "Sertraline",
    isArchived: true,
    archivedAt: new Date("2026-03-01T00:00:00Z"),
  });
  await pgDb.seedMedication({ id: "theirs", userId: "u2", name: "Someone else's" });
  await pgDb.seedDose({
    id: "d-active",
    medicationId: "active",
    takenAt: new Date("2026-04-15T08:00:00Z"),
  });
  await pgDb.seedDose({
    id: "d-stopped",
    medicationId: "stopped",
    takenAt: new Date("2026-02-15T08:00:00Z"),
  });
});

describe("the /log medication filter", () => {
  it("offers an archived medication whose doses the list shows", async () => {
    const { doses, medications } = await loadWith();

    // The unfiltered list already includes the archived medication's dose...
    expect(doses.map((d) => d.id)).toContain("d-stopped");
    // ...so the filter must offer it, marked archived, after the active one.
    expect(medications.map((m) => [m.id, Boolean(m.isArchived)])).toEqual([
      ["active", false],
      ["stopped", true],
    ]);
  });

  it("filters to an archived medication's doses alone", async () => {
    const { doses, medications } = await loadWith("?medication=stopped");

    expect(doses.map((d) => d.id)).toEqual(["d-stopped"]);
    expect(medications.map((m) => m.id)).toContain("stopped");
  });

  it("never offers another user's medication", async () => {
    const { medications } = await loadWith();

    expect(medications.map((m) => m.id)).not.toContain("theirs");
  });
});
