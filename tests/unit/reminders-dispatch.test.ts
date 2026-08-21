import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeDb, predicateIncludes } from "./helpers/fake-db";
import { reminderEvents } from "$lib/server/db/schema";

// Capture the values, conflict config, and where clauses that the
// claim helper builds so tests can assert the SQL is shaped the way
// we expect.

// The database comes from the shared seam, which captures the predicate and
// the .set(...) payload of every write — which is all this file asserted on.
// chunksContain used to live here in a second copy; predicateIncludes is the
// shared, unit-tested reader with the same circular-safe replacer.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const claimCalls = () =>
  fakeDb.attempted
    .filter((c) => c.op === "insert")
    .map((c) => ({
      values: (c.payload ?? {}) as Record<string, unknown>,
      conflict: c.conflict ?? null,
    }));

const updateCalls = () =>
  fakeDb.attempted
    .filter((c) => c.op === "update")
    .map((c) => ({
      payload: (c.payload ?? {}) as Record<string, unknown>,
      predicate: c.predicate,
    }));

const {
  claimReminderSlot,
  completeReminder,
  deriveOverallStatus,
  withReminderClaim,
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
  SEND_TIMEOUT_MS,
} = await import("../../src/lib/server/reminders/dispatch");

beforeEach(() => {
  fakeDb.reset();
  fakeDb.seed(reminderEvents, [{ id: "evt-1", attemptCount: 1 }]);
});

describe("claimReminderSlot", () => {
  it("issues an INSERT with status=pending and a retryable setWhere predicate", async () => {
    const claim = await claimReminderSlot({
      userId: "u1",
      medicationId: "med-A",
      reminderType: "overdue",
      dedupeKey: "key-1",
    });

    expect(claim).toEqual({ id: "evt-1", attemptCount: 1 });
    expect(claimCalls()).toHaveLength(1);
    expect(claimCalls()[0].values.dedupeKey).toBe("key-1");
    expect(claimCalls()[0].values.status).toBe("pending");
    expect(claimCalls()[0].values.attemptCount).toBe(1);

    const conflict = claimCalls()[0].conflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.target).toBeDefined();

    // The retry-state update must flip the row to pending, increment
    // attempt_count, refresh last_attempt_at, and clear last_error so a
    // successful retry doesn't carry the previous failure forward.
    const setPayload = conflict?.set as Record<string, unknown>;
    expect(setPayload.status).toBe("pending");
    expect(setPayload.lastError).toBeNull();
    expect(setPayload.attemptCount).toBeDefined();
    expect(setPayload.lastAttemptAt).toBeDefined();
    // attemptCount and lastAttemptAt are SQL expressions, not literals.
    expect(typeof setPayload.attemptCount).not.toBe("number");
    expect(typeof setPayload.lastAttemptAt).not.toBe("string");

    // The setWhere predicate must encode the cooldown + max-attempts
    // guard AND must accept stale 'pending' rows for lease recovery.
    const setWhere = conflict?.setWhere;
    expect(setWhere).toBeDefined();
    expect(predicateIncludes(setWhere, "status")).toBe(true);
    expect(predicateIncludes(setWhere, "attempt_count")).toBe(true);
    expect(predicateIncludes(setWhere, "last_attempt_at")).toBe(true);
    expect(predicateIncludes(setWhere, "failed")).toBe(true);
    expect(predicateIncludes(setWhere, "pending")).toBe(true);
  });

  it("returns null when the database refused the upsert (row exists, not retryable)", async () => {
    fakeDb.seed(reminderEvents, []);
    const claim = await claimReminderSlot({
      userId: "u1",
      medicationId: "med-A",
      reminderType: "overdue",
      dedupeKey: "key-2",
    });
    expect(claim).toBeNull();
  });

  it("exposes the retry policy constants so tests pin the expected values", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(RETRY_DELAY_MS).toBe(30 * 60 * 1000);
  });
});

describe("completeReminder", () => {
  it("writes the derived overall status plus channel statuses against the claimed row id", async () => {
    await completeReminder("evt-1", {
      emailStatus: "sent",
      pushStatus: "failed",
      lastError: "push:all_failed=boom",
    });
    expect(updateCalls()).toHaveLength(1);
    const payload = updateCalls()[0].payload;
    expect(payload.status).toBe("sent");
    expect(payload.emailStatus).toBe("sent");
    expect(payload.pushStatus).toBe("failed");
    expect(payload.lastError).toBe("push:all_failed=boom");
    expect(payload.lastAttemptAt).toBeInstanceOf(Date);
    // Predicate captured by the mock proves the UPDATE targets the
    // specific evt id we claimed, not a global match.
    expect(updateCalls()[0].predicate).toBeDefined();
    expect(predicateIncludes(updateCalls()[0].predicate, "evt-1")).toBe(true);
  });

  it("derives status=failed when every configured channel failed", async () => {
    await completeReminder("evt-1", {
      emailStatus: "failed",
      pushStatus: "failed",
      lastError: "all channels failed",
    });
    expect(updateCalls()[0].payload.status).toBe("failed");
  });

  it("derives status=sent when both channels are not_configured (nothing to retry)", async () => {
    await completeReminder("evt-1", {
      emailStatus: "not_configured",
      pushStatus: "not_configured",
      lastError: null,
    });
    expect(updateCalls()[0].payload.status).toBe("sent");
  });
});

describe("deriveOverallStatus", () => {
  it.each([
    ["sent", "not_configured", "sent"],
    ["not_configured", "sent", "sent"],
    ["sent", "failed", "sent"],
    ["failed", "sent", "sent"],
    ["failed", "failed", "failed"],
    ["failed", "not_configured", "failed"],
    ["not_configured", "failed", "failed"],
    ["not_configured", "not_configured", "sent"],
  ])("emailStatus=%s pushStatus=%s -> %s", (email, push, expected) => {
    expect(
      deriveOverallStatus(
        email as Parameters<typeof deriveOverallStatus>[0],
        push as Parameters<typeof deriveOverallStatus>[1],
      ),
    ).toBe(expected);
  });
});

describe("withReminderClaim", () => {
  it("completes with derived statuses on the happy path", async () => {
    await withReminderClaim(
      { userId: "u1", medicationId: "m1", reminderType: "overdue", dedupeKey: "k1" },
      { email: true, push: true },
      async (out) => {
        out.email = { ok: true, id: "msg" };
        out.push = { ok: true, deliveredCount: 1, attemptedCount: 1, prunedCount: 0 };
      },
    );

    // The claim must receive the caller's identity unmodified — a bug
    // that swapped or dropped one of these would still "complete
    // successfully" against the wrong row.
    expect(claimCalls()).toHaveLength(1);
    expect(claimCalls()[0].values.userId).toBe("u1");
    expect(claimCalls()[0].values.medicationId).toBe("m1");
    expect(claimCalls()[0].values.reminderType).toBe("overdue");
    expect(claimCalls()[0].values.dedupeKey).toBe("k1");

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0].payload.emailStatus).toBe("sent");
    expect(updateCalls()[0].payload.pushStatus).toBe("sent");
    expect(updateCalls()[0].payload.status).toBe("sent");
    expect(updateCalls()[0].payload.lastError).toBeNull();
    // The completion must target the exact row the claim returned, not
    // some other row — a bug that completed the wrong reminder would
    // still pass every assertion above.
    expect(predicateIncludes(updateCalls()[0].predicate, "evt-1")).toBe(true);
  });

  it("never runs the callback and never completes when the claim is refused", async () => {
    fakeDb.seed(reminderEvents, []); // row exists and is not retryable
    let ran = false;

    await withReminderClaim(
      { userId: "u1", medicationId: "m1", reminderType: "overdue", dedupeKey: "k1" },
      { email: true, push: true },
      async () => {
        ran = true;
      },
    );

    expect(ran).toBe(false);
    expect(updateCalls()).toHaveLength(0);
  });

  it("keeps a partial email success when the callback throws afterwards", async () => {
    // Email is dispatched first precisely so a later push failure
    // cannot poison an already-successful send.
    await withReminderClaim(
      { userId: "u1", medicationId: "m1", reminderType: "overdue", dedupeKey: "k1" },
      { email: true, push: true },
      async (out) => {
        out.email = { ok: true, id: "msg" };
        throw new Error("push blew up");
      },
    );

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0].payload.emailStatus).toBe("sent");
    expect(updateCalls()[0].payload.pushStatus).toBe("failed");
    expect(updateCalls()[0].payload.status).toBe("sent"); // one configured channel succeeded
    expect(String(updateCalls()[0].payload.lastError)).toContain("push blew up");
  });

  it("leaves an unintended channel not_configured even when the callback throws", async () => {
    await withReminderClaim(
      { userId: "u1", medicationId: "m1", reminderType: "overdue", dedupeKey: "k1" },
      { email: false, push: true },
      async () => {
        throw new Error("probe blew up");
      },
    );

    expect(updateCalls()[0].payload.emailStatus).toBe("not_configured");
    expect(updateCalls()[0].payload.pushStatus).toBe("failed");
    expect(updateCalls()[0].payload.status).toBe("failed");
  });

  it("still completes when the callback throws a non-Error", async () => {
    await withReminderClaim(
      { userId: "u1", medicationId: "m1", reminderType: "overdue", dedupeKey: "k1" },
      { email: true, push: false },
      async () => {
        throw "just a string";
      },
    );

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0].payload.emailStatus).toBe("failed");
    expect(String(updateCalls()[0].payload.lastError)).toContain(
      "non-Error thrown during dispatch",
    );
  });
});

// The reminder loop awaits withReminderClaim once per medication, in
// sequence (reminders.ts:101). Without a bound on the send, one hung
// provider parks every remaining medication in the tick until the
// serverless function is killed — so the timeout is what keeps the loop
// moving, not a nicety.
describe("withReminderClaim — send timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const claimInput = {
    userId: "u1",
    medicationId: "m1",
    reminderType: "overdue" as const,
    dedupeKey: "k1",
  };

  it("gives up on a send that never settles, and leaves the row retryable", async () => {
    const pending = withReminderClaim(
      claimInput,
      { email: true, push: true },
      // A provider that hangs: never resolves, never rejects.
      () => new Promise<void>(() => {}),
    );

    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    await pending;

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0].payload.emailStatus).toBe("failed");
    expect(updateCalls()[0].payload.pushStatus).toBe("failed");
    // Nothing was delivered, so the row must stay retryable.
    expect(updateCalls()[0].payload.status).toBe("failed");
    expect(String(updateCalls()[0].payload.lastError)).toContain("timed out");
  });

  it("keeps a channel that already succeeded before the hang, and does not retry", async () => {
    const pending = withReminderClaim(claimInput, { email: true, push: true }, async (out) => {
      out.email = { ok: true, id: "msg" };
      // ...and then the push channel hangs.
      await new Promise<void>(() => {});
    });

    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    await pending;

    expect(updateCalls()[0].payload.emailStatus).toBe("sent");
    expect(updateCalls()[0].payload.pushStatus).toBe("failed");
    // deriveOverallStatus resolves to `sent` when any configured channel
    // succeeded. That matters here: the slot is NOT retried, so the email
    // that already went out is never sent a second time.
    expect(updateCalls()[0].payload.status).toBe("sent");
    expect(String(updateCalls()[0].payload.lastError)).toContain("timed out");
  });

  it("leaves a send that finishes in time completely alone", async () => {
    const pending = withReminderClaim(claimInput, { email: true, push: true }, async (out) => {
      out.email = { ok: true, id: "msg" };
      out.push = { ok: true, deliveredCount: 1, attemptedCount: 1, prunedCount: 0 };
    });

    await vi.advanceTimersByTimeAsync(1);
    await pending;

    // The positive control. A timeout of zero would satisfy both tests
    // above while breaking every real send.
    expect(updateCalls()[0].payload.status).toBe("sent");
    expect(updateCalls()[0].payload.lastError).toBeNull();
  });
});
