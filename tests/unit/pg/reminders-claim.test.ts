// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { reminderEvents } from "../../../src/lib/server/db/schema";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { claimReminderSlot, MAX_ATTEMPTS, RETRY_DELAY_MS } =
  await import("../../../src/lib/server/reminders/dispatch");

const DEDUPE = "u1:m1:overdue:2026-08-21T08:00";

function claim() {
  return claimReminderSlot({
    userId: "u1",
    medicationId: "m1",
    reminderType: "overdue",
    dedupeKey: DEDUPE,
  });
}

/** Insert an existing slot directly, so each test starts from the exact
    state its clause is about. */
async function existingSlot(overrides: Partial<typeof reminderEvents.$inferInsert>) {
  await pgDb.db.insert(reminderEvents).values({
    id: "re1",
    userId: "u1",
    medicationId: "m1",
    reminderType: "overdue",
    dedupeKey: DEDUPE,
    ...overrides,
  });
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication();
});

describe("claimReminderSlot — claiming", () => {
  it("claims a slot that does not exist yet", async () => {
    const result = await claim();
    expect(result).not.toBeNull();
    expect(result!.attemptCount).toBe(1);
  });

  it("reclaims a failed slot once the cooldown has elapsed", async () => {
    await existingSlot({
      status: "failed",
      attemptCount: 1,
      lastAttemptAt: new Date(Date.now() - RETRY_DELAY_MS - 60_000),
    });

    const result = await claim();

    // The positive control. Without it, a suite where every case returns
    // null would still pass with `setWhere` hard-coded to false.
    expect(result).not.toBeNull();
    expect(result!.attemptCount).toBe(2);
  });
});

describe("claimReminderSlot — the gate refusing", () => {
  it("refuses a second claim inside the cooldown", async () => {
    await claim(); // stamps lastAttemptAt = now
    expect(await claim()).toBeNull();
  });

  it("refuses to reclaim a slot that already sent", async () => {
    await existingSlot({
      status: "sent",
      attemptCount: 1,
      lastAttemptAt: new Date(Date.now() - RETRY_DELAY_MS - 60_000),
    });
    // Cooldown has elapsed and attempts remain, so only the status
    // clause can be refusing this one.
    expect(await claim()).toBeNull();
  });

  it("refuses once attemptCount has reached MAX_ATTEMPTS", async () => {
    await existingSlot({
      status: "failed",
      attemptCount: MAX_ATTEMPTS,
      lastAttemptAt: new Date(Date.now() - RETRY_DELAY_MS - 60_000),
    });
    expect(await claim()).toBeNull();
  });
});
