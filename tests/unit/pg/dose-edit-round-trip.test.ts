// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { doseLogs } from "../../../src/lib/server/db/schema";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { actions } = await import("../../../src/routes/(app)/log/+page.server");
const { formatDateTimeLocal } = await import("../../../src/lib/utils/time");

/**
 * Opening a dose and pressing Save without changing anything must not move
 * it — driven through the REAL form action, because that is the path the
 * defect lived on.
 *
 * On a fall-back day a `datetime-local` value cannot say WHICH of two
 * instants it names: Europe/London 2026-10-25 has 01:30 twice, and both
 * render identically. The action resolved that string to the earlier one by
 * policy, so a dose stored at the second occurrence silently moved an hour
 * earlier on a save that changed nothing — corrupting the history adherence,
 * the heatmap and refill forecasting read.
 *
 * On PGlite rather than `fake-db` because the assertion is what the row
 * actually holds afterwards.
 */

const TZ = "Europe/London";

function submit(fields: Record<string, string>) {
  return actions.editDose({
    request: new Request("http://x", {
      method: "POST",
      body: new URLSearchParams({ quantity: "1", ...fields }),
    }),
    locals: { user: { id: "u1", timezone: TZ }, session: { id: "s1" } },
  } as never);
}

async function storedTakenAt(): Promise<string> {
  const [row] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.id, "d1"));
  return row.takenAt.toISOString();
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: TZ });
  await pgDb.seedMedication();
});

describe("editDose — a Save that changes nothing", () => {
  it.each([
    ["the second occurrence of an ambiguous hour", "2026-10-25T01:30:00.000Z"],
    ["the first occurrence of that same hour", "2026-10-25T00:30:00.000Z"],
    ["an ordinary instant", "2026-06-15T12:30:00.000Z"],
  ])("leaves %s exactly where it was", async (_label, iso) => {
    await pgDb.seedDose({ id: "d1", takenAt: new Date(iso) });
    const rendered = formatDateTimeLocal(new Date(iso), TZ);

    await submit({ doseId: "d1", takenAt: rendered, originalTakenAt: iso });

    expect(await storedTakenAt()).toBe(iso);
  });

  it("moves the dose when the time IS changed", async () => {
    // The other half: preserving an untouched value must not freeze a real
    // edit. 02:30 on that day is unambiguous.
    await pgDb.seedDose({ id: "d1", takenAt: new Date("2026-10-25T01:30:00.000Z") });

    await submit({
      doseId: "d1",
      takenAt: "2026-10-25T02:30",
      originalTakenAt: "2026-10-25T01:30:00.000Z",
    });

    expect(await storedTakenAt()).toBe("2026-10-25T02:30:00.000Z");
  });

  it("still works for a client that sends no originalTakenAt", async () => {
    // The field is optional, so an older form or a scripted POST falls back
    // to normal resolution rather than failing.
    await pgDb.seedDose({ id: "d1", takenAt: new Date("2026-06-15T12:30:00.000Z") });

    await submit({ doseId: "d1", takenAt: "2026-06-15T14:00" });

    expect(await storedTakenAt()).toBe("2026-06-15T13:00:00.000Z");
  });
});
