import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the values, conflict config, and where clauses that the
// claim helper builds so tests can assert the SQL is shaped the way
// we expect.
type ClaimCall = {
  values: Record<string, unknown>;
  conflict: Record<string, unknown> | null;
};
const claimCalls: ClaimCall[] = [];
let nextClaimReturning: Array<{ id: string; attemptCount: number }> = [
  { id: "evt-1", attemptCount: 1 },
];

const updateCalls: Array<{ payload: Record<string, unknown>; predicate: unknown }> = [];

vi.mock("$lib/server/db", () => ({
  db: {
    insert: () => {
      const captured: Partial<ClaimCall> = {};
      const chain: Record<string, unknown> = {};
      chain.values = (v: Record<string, unknown>) => {
        captured.values = v;
        return chain;
      };
      chain.onConflictDoUpdate = (c: Record<string, unknown>) => {
        captured.conflict = c;
        return chain;
      };
      chain.returning = () => {
        claimCalls.push({ values: captured.values ?? {}, conflict: captured.conflict ?? null });
        return Promise.resolve(nextClaimReturning);
      };
      return chain;
    },
    update: () => {
      let captured: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.set = (payload: Record<string, unknown>) => {
        captured = payload;
        return chain;
      };
      chain.where = (predicate: unknown) => {
        updateCalls.push({ payload: captured, predicate });
        return Promise.resolve();
      };
      return chain;
    },
  },
}));

// Drizzle SQL objects expose their template chunks as `.queryChunks`,
// each chunk being either a string fragment, a column reference, or a
// param. Stringifying the tree is enough to assert which columns and
// literals the predicate references, but we need a circular-safe
// replacer because Drizzle column nodes hold a back-pointer to their
// table.
function chunksContain(sqlObj: unknown, needle: string): boolean {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(sqlObj, (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
  return json.includes(needle);
}

const { claimReminderSlot, completeReminder, deriveOverallStatus, MAX_ATTEMPTS, RETRY_DELAY_MS } =
  await import("../../src/lib/server/reminders/dispatch");

beforeEach(() => {
  claimCalls.length = 0;
  updateCalls.length = 0;
  nextClaimReturning = [{ id: "evt-1", attemptCount: 1 }];
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
    expect(claimCalls).toHaveLength(1);
    expect(claimCalls[0].values.dedupeKey).toBe("key-1");
    expect(claimCalls[0].values.status).toBe("pending");
    expect(claimCalls[0].values.attemptCount).toBe(1);

    const conflict = claimCalls[0].conflict;
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
    expect(chunksContain(setWhere, "status")).toBe(true);
    expect(chunksContain(setWhere, "attempt_count")).toBe(true);
    expect(chunksContain(setWhere, "last_attempt_at")).toBe(true);
    expect(chunksContain(setWhere, "failed")).toBe(true);
    expect(chunksContain(setWhere, "pending")).toBe(true);
  });

  it("returns null when the database refused the upsert (row exists, not retryable)", async () => {
    nextClaimReturning = [];
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
    expect(updateCalls).toHaveLength(1);
    const payload = updateCalls[0].payload;
    expect(payload.status).toBe("sent");
    expect(payload.emailStatus).toBe("sent");
    expect(payload.pushStatus).toBe("failed");
    expect(payload.lastError).toBe("push:all_failed=boom");
    expect(payload.lastAttemptAt).toBeInstanceOf(Date);
    // Predicate captured by the mock proves the UPDATE targets the
    // specific evt id we claimed, not a global match.
    expect(updateCalls[0].predicate).toBeDefined();
    expect(chunksContain(updateCalls[0].predicate, "evt-1")).toBe(true);
  });

  it("derives status=failed when every configured channel failed", async () => {
    await completeReminder("evt-1", {
      emailStatus: "failed",
      pushStatus: "failed",
      lastError: "all channels failed",
    });
    expect(updateCalls[0].payload.status).toBe("failed");
  });

  it("derives status=sent when both channels are not_configured (nothing to retry)", async () => {
    await completeReminder("evt-1", {
      emailStatus: "not_configured",
      pushStatus: "not_configured",
      lastError: null,
    });
    expect(updateCalls[0].payload.status).toBe("sent");
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
