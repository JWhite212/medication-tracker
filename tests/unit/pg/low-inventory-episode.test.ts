// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The low-inventory alert, scoped to an EPISODE.
 *
 * The dedupe key used to embed `inventoryCount`, which made the threshold
 * decide the alert volume — a threshold of 10 sent eleven alerts on one
 * descent — and then suppressed each individual count for the 90-day life of
 * its `reminder_events` row, so a user who refilled and ran low again heard
 * nothing at all.
 *
 * These run on PGlite because the behaviour is decided by the database: the
 * re-arm is one UPDATE with a column predicate, the episode open is a
 * compare-and-set on `isNull`, and the suppression is `claimReminderSlot`'s
 * upsert. A fake that captures predicates without evaluating them cannot
 * tell any of those from a no-op.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

const sentLowInventoryEmails: Array<{ count: number; threshold: number }> = [];

vi.mock("$lib/server/email", () => ({
  sendReminderEmail: vi.fn(async () => ({ ok: true })),
  sendLowInventoryEmail: vi.fn(
    async (_to: string, _name: string, count: number, threshold: number) => {
      sentLowInventoryEmails.push({ count, threshold });
      return { ok: true };
    },
  ),
  isEmailConfigured: () => true,
}));
vi.mock("$lib/server/push", () => ({
  sendPushNotification: vi.fn(async () => ({ ok: true })),
  hasPushSubscriptions: vi.fn(async () => false),
}));

import { pgDb } from "../helpers/pg-db";
import { reminderEvents, medications, users } from "../../../src/lib/server/db/schema";
import { eq } from "drizzle-orm";

const { checkLowInventoryMedications } = await import("../../../src/lib/server/reminders");
const { logDose } = await import("../../../src/lib/server/doses");
const { refillMedication } = await import("../../../src/lib/server/inventory-events");
const { updateMedicationWithSchedules } = await import("../../../src/lib/server/medications");

const START = new Date("2026-05-01T09:00:00.000Z");
const HOUR = 3_600_000;

// Move the clock on between sweeps.
//
// The episode's identity IS its opening instant, so two episodes of the same
// medication opened in the same millisecond would share a dedupe key. That
// cannot happen in production — an episode can only re-open on a LATER tick
// than the one that closed it (step 0 closes before the select reads, and a
// recovered medication fails the select's `count <= threshold` predicate in
// the same tick), and the cron's finest cadence is 30 minutes. Under a frozen
// test clock it happens immediately, so the fixtures advance time the way the
// real timeline does.
let clock = START;
function advance(ms: number) {
  clock = new Date(clock.getTime() + ms);
  vi.setSystemTime(clock);
}

async function claimedKeys(): Promise<string[]> {
  const rows = await pgDb.db.select().from(reminderEvents);
  return rows.map((r) => r.dedupeKey);
}

async function episodeAt(): Promise<Date | null> {
  const [row] = await pgDb.db
    .select({ at: medications.lowInventoryEpisodeAt })
    .from(medications)
    .where(eq(medications.id, "m1"));
  return row?.at ?? null;
}

/** Tracked medication, threshold 10, `count` doses in stock. */
async function seedTracked(count: number, overrides = {}) {
  await pgDb.seedMedication({
    id: "m1",
    name: "Tracked",
    scheduleType: "scheduled",
    inventoryCount: count,
    inventoryAlertThreshold: 10,
    ...overrides,
  });
}

beforeEach(async () => {
  sentLowInventoryEmails.length = 0;
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC", emailVerified: true });
  await pgDb.seedPreferences();
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  clock = START;
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("one alert per low-inventory episode", () => {
  it("alerts once for a full descent from the threshold to empty", async () => {
    // The headline defect: this descent used to produce ELEVEN alerts, one
    // per distinct count, because the count was in the dedupe key.
    await seedTracked(10);

    for (let i = 0; i < 10; i++) {
      await checkLowInventoryMedications();
      await logDose("u1", "m1", 1);
    }
    await checkLowInventoryMedications();

    expect(await claimedKeys()).toHaveLength(1);
    expect(sentLowInventoryEmails).toHaveLength(1);
  });

  it("alerts once however many ticks pass at a static count", async () => {
    // 48 ticks is a day of the 30-minute cron with nothing changing.
    await seedTracked(4);

    for (let i = 0; i < 48; i++) {
      await checkLowInventoryMedications();
    }

    expect(await claimedKeys()).toHaveLength(1);
  });

  it("does not let the threshold decide the alert count", async () => {
    // A threshold of 30 used to send thirty-one alerts; a threshold of 3
    // sent four. The volume is now independent of the threshold.
    await seedTracked(30, { inventoryAlertThreshold: 30 });

    for (let i = 0; i < 30; i++) {
      await checkLowInventoryMedications();
      await logDose("u1", "m1", 1);
    }

    expect(await claimedKeys()).toHaveLength(1);
  });
});

describe("what re-arms the alert", () => {
  it("alerts again after a refill above the threshold and a second descent", async () => {
    // The failure that mattered: under the count-key this second descent
    // re-used the already-claimed keys and was completely silent.
    await seedTracked(10);
    await checkLowInventoryMedications();
    expect(await claimedKeys()).toHaveLength(1);

    await refillMedication("u1", "m1", 50);
    // The sweep is what observes the recovery and closes the episode.
    advance(HOUR);
    await checkLowInventoryMedications();
    expect(await episodeAt()).toBeNull();

    await pgDb.db.update(medications).set({ inventoryCount: 8 }).where(eq(medications.id, "m1"));
    advance(HOUR);
    await checkLowInventoryMedications();

    const keys = await claimedKeys();
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(sentLowInventoryEmails).toHaveLength(2);
  });

  it("re-arms when the refill came from the medication edit form", async () => {
    // The load-bearing case for choosing a COLUMN predicate over a ledger
    // anchor: `updateMedicationWithSchedules` writes `inventoryCount`
    // absolutely and appends no inventory event at all, so a key anchored
    // to the ledger would never re-arm for a user who refills by typing a
    // new number into the form.
    await seedTracked(10);
    await checkLowInventoryMedications();

    const [med] = await pgDb.db.select().from(medications).where(eq(medications.id, "m1"));
    await updateMedicationWithSchedules(
      "u1",
      "m1",
      {
        name: med.name,
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        form: med.form,
        category: med.category,
        colour: med.colour,
        inventoryCount: 60,
        inventoryAlertThreshold: 10,
      } as Parameters<typeof updateMedicationWithSchedules>[2],
      [],
    );

    advance(HOUR);
    await checkLowInventoryMedications();
    expect(await episodeAt()).toBeNull();

    await pgDb.db.update(medications).set({ inventoryCount: 2 }).where(eq(medications.id, "m1"));
    advance(HOUR);
    await checkLowInventoryMedications();

    expect(await claimedKeys()).toHaveLength(2);
  });

  it("stays silent for a partial refill that does not clear the threshold", async () => {
    // A bridging supply that leaves the user still low is the same episode:
    // they are still low and have already been told.
    await seedTracked(2);
    await checkLowInventoryMedications();
    const openedAt = await episodeAt();

    await refillMedication("u1", "m1", 3); // 2 -> 5, threshold is 10
    await checkLowInventoryMedications();

    expect(await claimedKeys()).toHaveLength(1);
    expect(await episodeAt()).toEqual(openedAt);
  });

  it("treats a count sitting exactly at the threshold as still low", async () => {
    // Strictly `>` in the re-arm predicate. `>=` would close the episode of
    // a medication sitting exactly AT its threshold and re-open it on the
    // next tick, alerting forever.
    //
    // The clock must move between the two ticks or this cannot fail: a
    // wrongly re-opened episode would take the same instant as the one it
    // replaced, produce a byte-identical dedupe key, and be suppressed by
    // claimReminderSlot — the test would pass against the broken predicate.
    // (Verified: with the ticks at the same instant, `>=` survives.)
    await seedTracked(10);
    await checkLowInventoryMedications();
    const openedAt = await episodeAt();

    advance(HOUR);
    await checkLowInventoryMedications();

    expect(await episodeAt()).toEqual(openedAt);
    expect(await claimedKeys()).toHaveLength(1);
  });

  it("closes the episode when inventory tracking is switched off", async () => {
    await seedTracked(3);
    await checkLowInventoryMedications();
    expect(await episodeAt()).not.toBeNull();

    await pgDb.db.update(medications).set({ inventoryCount: null }).where(eq(medications.id, "m1"));
    advance(HOUR);
    await checkLowInventoryMedications();

    expect(await episodeAt()).toBeNull();

    // Re-enabling below the threshold is a new episode, and alerts once.
    await pgDb.db.update(medications).set({ inventoryCount: 3 }).where(eq(medications.id, "m1"));
    advance(HOUR);
    await checkLowInventoryMedications();

    expect(await claimedKeys()).toHaveLength(2);
  });
});

describe("the bounded nudges", () => {
  it("nudges once a day, at most twice, then goes quiet", async () => {
    await seedTracked(4);

    await checkLowInventoryMedications(); // t+0   -> first alert
    vi.setSystemTime(new Date(START.getTime() + 12 * HOUR));
    await checkLowInventoryMedications(); // t+12h -> same nudge, suppressed
    vi.setSystemTime(new Date(START.getTime() + 25 * HOUR));
    await checkLowInventoryMedications(); // t+25h -> nudge 1
    vi.setSystemTime(new Date(START.getTime() + 49 * HOUR));
    await checkLowInventoryMedications(); // t+49h -> nudge 2
    vi.setSystemTime(new Date(START.getTime() + 30 * 24 * HOUR));
    await checkLowInventoryMedications(); // a month later -> capped, silent

    const keys = await claimedKeys();
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(sentLowInventoryEmails).toHaveLength(3);
  });

  it("starts the nudge count over for a new episode", async () => {
    await seedTracked(4);
    vi.setSystemTime(new Date(START.getTime() + 49 * HOUR));
    await checkLowInventoryMedications();

    // Recover, then drop again — the second episode gets its own budget.
    await pgDb.db.update(medications).set({ inventoryCount: 40 }).where(eq(medications.id, "m1"));
    advance(HOUR);
    await checkLowInventoryMedications();
    await pgDb.db.update(medications).set({ inventoryCount: 4 }).where(eq(medications.id, "m1"));
    advance(HOUR);
    await checkLowInventoryMedications();

    // Two episodes, each having sent its first alert.
    expect(await claimedKeys()).toHaveLength(2);
  });
});

describe("the episode is not opened by a sweep that cannot deliver", () => {
  it("leaves the episode closed when no channel can fire", async () => {
    // Ordering guard: opening the episode above the channel gates would
    // burn it for a user who received nothing — and under an episode key a
    // burned episode is silent until the count RECOVERS, not merely until
    // it next moves. That is why the pre-claim push probe has to stay.
    //
    // The fixture has to be one the sweep's SQL ADMITS but the in-loop gate
    // then rejects, or the test proves nothing about ordering. Muting both
    // per-medication overrides fails the query's own
    // `coalesce(notifyLowInventoryEmail, …) OR coalesce(notifyLowInventoryPush, …)`
    // predicate, so the row never reaches the loop at all and the assertion
    // holds against any implementation. Instead: opted IN to email, with an
    // unverified address (and push off, `hasPushSubscriptions` already
    // mocked false), so `emailWillFire` is false only at the gate.
    await pgDb.db.update(users).set({ emailVerified: false }).where(eq(users.id, "u1"));
    await seedTracked(3, { notifyLowInventoryEmail: true, notifyLowInventoryPush: false });

    await checkLowInventoryMedications();

    expect(await episodeAt()).toBeNull();
    expect(await claimedKeys()).toHaveLength(0);
  });

  it("opens the episode once a muted channel becomes deliverable", async () => {
    // The other half: the medication above is not permanently barred — the
    // episode is simply not burned while nothing can be sent.
    await pgDb.db.update(users).set({ emailVerified: false }).where(eq(users.id, "u1"));
    await seedTracked(3, { notifyLowInventoryEmail: true, notifyLowInventoryPush: false });
    await checkLowInventoryMedications();
    expect(await claimedKeys()).toHaveLength(0);

    await pgDb.db.update(users).set({ emailVerified: true }).where(eq(users.id, "u1"));
    advance(HOUR);
    await checkLowInventoryMedications();

    expect(await episodeAt()).not.toBeNull();
    expect(await claimedKeys()).toHaveLength(1);
  });
});
