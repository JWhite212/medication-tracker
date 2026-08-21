// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import { reminderEvents } from "../../../src/lib/server/db/schema";
import {
  purgeExpiredReminderEvents,
  REMINDER_EVENT_RETENTION_DAYS,
} from "../../../src/lib/server/reminders/retention";

const NOW = new Date("2026-08-21T12:00:00Z");
const DAY_MS = 86_400_000;

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

async function seedEvent(overrides: Partial<typeof reminderEvents.$inferInsert>) {
  await pgDb.db.insert(reminderEvents).values({
    id: overrides.id ?? "re-default",
    userId: "u1",
    medicationId: "m1",
    reminderType: "overdue",
    dedupeKey: overrides.id ?? "re-default",
    ...overrides,
  });
}

async function survivingIds(): Promise<string[]> {
  const rows = await pgDb.db.select({ id: reminderEvents.id }).from(reminderEvents);
  return rows.map((r) => r.id).sort();
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication();
});

describe("purgeExpiredReminderEvents", () => {
  it("deletes only the row older than the retention window, keeping the recent one", async () => {
    await seedEvent({ id: "old", sentAt: daysBefore(91) });
    await seedEvent({ id: "recent", sentAt: daysBefore(1) });

    await purgeExpiredReminderEvents(NOW);

    expect(await survivingIds()).toEqual(["recent"]);
  });

  it("keeps a row exactly at the retention boundary (strictly-older comparison)", async () => {
    await seedEvent({ id: "boundary", sentAt: daysBefore(REMINDER_EVENT_RETENTION_DAYS) });
    await seedEvent({ id: "old", sentAt: daysBefore(91) });

    await purgeExpiredReminderEvents(NOW);

    expect(await survivingIds()).toEqual(["boundary"]);
  });
});
