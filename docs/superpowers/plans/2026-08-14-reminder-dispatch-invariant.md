# Reminder Dispatch Invariant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "after a successful claim, every code path MUST reach `completeReminder`" a structural property of the code instead of a comment repeated in two loops.

**Architecture:** Add a `withReminderClaim` combinator to `src/lib/server/reminders/dispatch.ts` that owns claim → dispatch → complete. Both sweep functions in `src/lib/server/reminders.ts` call it and keep their own SQL, dedupe-key construction and channel bodies. The loops are **not** merged.

**Tech Stack:** TypeScript, SvelteKit, Drizzle ORM (Neon), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-reminder-dispatch-invariant-design.md`

## Global Constraints

- **Zero behaviour change.** This is a pure refactor. Spec Decision 2.
- **No existing test case may be edited.** All 64 existing reminder tests — 18 in `tests/unit/reminders.test.ts`, 14 in `tests/unit/reminders-dispatch.test.ts`, 32 in `tests/unit/reminders-dedupe.test.ts` — must pass with their bodies untouched. If a test needs an edit, the refactor changed behaviour: STOP and report. (`reminders-dispatch.test.ts` reports 14, not 6: it has 6 `it(...)` blocks plus an `it.each` over `deriveOverallStatus` expanding to 8 cases. Take these counts from a runner, never from grepping `it(`.)
  - Adding new opt-in hooks to the **shared mock setup** in `reminders.test.ts` (Task 1) is permitted and expected. That is test infrastructure, not a test case. The hooks default to inert so no existing case changes behaviour.
- **Failure-result literals are load-bearing.** On a dispatch throw the substituted results must be exactly `{ ok: false, reason: "provider_error", message }` for email and `{ ok: false, reason: "all_failed", message }` for push. `summariseError` only reports push when `reason === "all_failed"`; `pushStatusFromResult` maps `not_configured`/`no_subscriptions` to `not_configured`, not `failed`. A different `reason` changes stored `last_error` and derived status.
- **Non-`Error` throws** keep the message `"non-Error thrown during dispatch"`.
- **Out of scope:** the overdue pre-claim gate; changing the push-probe position; merging the two loops' SQL or channel bodies.
- Run tests with `npx vitest run`. Build/typecheck needs `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require'`.
- Commit messages: no AI/Claude attribution of any kind.

---

### Task 1: Backfill low-inventory coverage

`checkLowInventoryMedications` has 3 tests to `checkOverdueMedications`' 15, and it is the loop carrying the extra logic (pre-claim probe, no-channel gate). These characterization tests pin today's behaviour so Tasks 3–4 have a net to fall into.

These tests **pass on first run** — they describe existing behaviour. That is correct for a refactoring net, but a test that has never failed is not yet proven to work, so Step 5 deliberately breaks the production code to confirm each one can fail.

**Files:**

- Modify: `tests/unit/reminders.test.ts` (mock setup ~lines 105–168; new cases in the `checkLowInventoryMedications` describe, ends line 553)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on. The two mock hooks (`nextLowInventoryEmailThrows`, `claimCallCount`) are used only by this task's tests; later tasks must leave them in place because these tests keep asserting on them.

- [ ] **Step 1: Add the two mock hooks**

The existing `sendLowInventoryEmail` mock cannot throw, and nothing counts claim attempts. Add both.

In `tests/unit/reminders.test.ts`, replace the email mock block (currently lines ~105–119) with:

```ts
// Email mocks return the new EmailResult shape. Per test, push the
// desired result into emailResults; default is { ok: true }.
const emailResults: Array<
  { ok: true; id?: string } | { ok: false; reason: string; message: string }
> = [];
const sentEmails: Array<{ to: string; medicationName: string; sinceLabel: string }> = [];
// Tests opt into throwing behaviour by setting this to an Error.
let nextLowInventoryEmailThrows: Error | null = null;

vi.mock("$lib/server/email", () => ({
  sendReminderEmail: async (to: string, medicationName: string, sinceLabel: string) => {
    sentEmails.push({ to, medicationName, sinceLabel });
    return emailResults.shift() ?? { ok: true, id: "msg-r" };
  },
  sendLowInventoryEmail: async () => {
    if (nextLowInventoryEmailThrows) {
      const err = nextLowInventoryEmailThrows;
      nextLowInventoryEmailThrows = null;
      throw err;
    }
    return emailResults.shift() ?? { ok: true, id: "msg-l" };
  },
  isEmailConfigured: () => true,
}));
```

Then count claim attempts. In the `db` mock's `insert` (currently lines ~70–79), add the counter as the first statement:

```ts
    insert: () => {
      claimCallCount++;
      const result = claimResults.shift() ?? [{ id: "evt", attemptCount: 1 }];
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.values = passthrough;
      chain.onConflictDoNothing = passthrough;
      chain.onConflictDoUpdate = passthrough;
      chain.returning = () => Promise.resolve(result);
      return chain;
    },
```

Declare it next to `claimResults` (~line 13):

```ts
// Number of claimReminderSlot attempts (db.insert calls) this test made.
let claimCallCount = 0;
```

Reset both in `beforeEach` (~line 154), alongside the existing resets:

```ts
claimCallCount = 0;
nextLowInventoryEmailThrows = null;
```

- [ ] **Step 2: Run the full suite to confirm the hooks changed nothing**

Run: `npx vitest run`
Expected: PASS, 735 tests. The hooks are inert by default, so no existing case may change.

- [ ] **Step 3: Write the three characterization tests**

Append inside the `describe("checkLowInventoryMedications — split prefs, mixed channels", ...)` block, after the existing `"skips claim entirely when push opt-in is true but no active subscriptions"` case and before the closing `});`:

```ts
it("still reaches completeReminder when the low-inventory email sender throws", async () => {
  // The claim is already taken at this point, so the throw must not
  // escape without completing — a leaked row sits at status='pending'
  // and is only reclaimed after RETRY_DELAY_MS.
  pushLowInventoryRow({
    userLowInventoryEmailAlerts: true,
    userLowInventoryPushAlerts: false,
  });
  nextLowInventoryEmailThrows = new Error("resend exploded");

  await checkLowInventoryMedications();

  expect(updateCaptures).toHaveLength(1);
  expect(updateCaptures[0].emailStatus).toBe("failed");
  expect(updateCaptures[0].pushStatus).toBe("not_configured");
  expect(updateCaptures[0].status).toBe("failed");
  expect(updateCaptures[0].lastError).toContain("resend exploded");
});

it("claims nothing when the push probe throws", async () => {
  // Unlike the overdue path, the low-inventory probe runs BEFORE the
  // claim, so a probe failure must leave no row at all — the next
  // cron tick retries cleanly.
  //
  // Email is deliberately left ENABLED so the downstream "no enabled
  // channel can fire" gate cannot absorb a fall-through from the
  // probe's catch. With email off, a catch that merely set
  // pushWillFire = false would reach that gate and continue anyway,
  // which is indistinguishable from the correct behaviour — the test
  // would pass against broken code. With email on, only the probe's
  // own `continue` prevents the claim.
  pushLowInventoryRow({
    userLowInventoryEmailAlerts: true,
    userLowInventoryPushAlerts: true,
  });
  nextPushSubsThrows = new Error("transient db error");

  await checkLowInventoryMedications();

  expect(claimCallCount).toBe(0);
  expect(updateCaptures).toHaveLength(0);
  expect(sentPushes).toHaveLength(0);
});

it("claims nothing when email is opted in but unverified and push is off", async () => {
  // Neither channel can fire. Claiming here would consume the
  // (user, medication, inventoryCount) dedupe key and complete as
  // 'sent' with nothing delivered — and that key persists, so the
  // user fixing their setup later would still hit the suppressed key.
  pushLowInventoryRow({
    userEmailVerified: false,
    userLowInventoryEmailAlerts: true,
    userLowInventoryPushAlerts: false,
  });

  await checkLowInventoryMedications();

  expect(claimCallCount).toBe(0);
  expect(updateCaptures).toHaveLength(0);
});
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `npx vitest run tests/unit/reminders.test.ts`
Expected: PASS, 21 tests in this file (18 existing + 3 new).

If any of the three FAILS, the described behaviour is not what the code does. Stop and report — the spec's premise is wrong and the refactor plan needs revisiting.

- [ ] **Step 5: Prove each new test can fail**

A characterization test that has never failed is unproven. Break the production code once per test, confirm the expected failure, then revert. Do **not** commit any of these breaks.

Break A — in `src/lib/server/reminders.ts`, inside `checkLowInventoryMedications`, change the pre-claim gate (~line 277) from `if (!emailWillFire && !pushWillFire) {` to `if (false) {`.
Run: `npx vitest run tests/unit/reminders.test.ts`
Expected: FAIL on `"claims nothing when email is opted in but unverified and push is off"`. This break also fails one or more pre-existing cases that rely on the same gate — expected, and it does not weaken the evidence for the target test.
Revert the line.

Break B — in the same function, change the probe's `catch` block (~line 273) from `continue;` to `pushWillFire = false;`.
Run: `npx vitest run tests/unit/reminders.test.ts`
Expected: FAIL on `"claims nothing when the push probe throws"`, with `claimCallCount` 1 instead of 0.
Revert the line.

**This break only bites because that test enables email.** An earlier draft set `userLowInventoryEmailAlerts: false`, and the fall-through then hit `if (!emailWillFire && !pushWillFire)` — which continued anyway, so the break was invisible and the test passed against broken code. That is exactly the failure mode Step 5 exists to catch; if you find a break that does not fail its target, the test is the thing to fix, not the break.

Break C — in the same function, delete the `catch` clause's body contents so the `try/catch` around the senders (~lines 316–324) becomes `catch { /* nothing */ }`, leaving `emailResult` null.
Run: `npx vitest run tests/unit/reminders.test.ts`
Expected: FAIL on `"still reaches completeReminder when the low-inventory email sender throws"` — `emailStatus` is `not_configured`, not `failed`.
Revert.

- [ ] **Step 6: Confirm the tree is back to green and unmodified except the tests**

Run: `npx vitest run`
Expected: PASS, 738 tests.

Run: `git diff --stat`
Expected: exactly one file changed, `tests/unit/reminders.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/reminders.test.ts
git commit -m "test(reminders): pin low-inventory dispatch invariants

checkLowInventoryMedications had 3 tests to checkOverdueMedications' 15,
and it is the loop carrying the extra logic: a pre-claim push probe and
a no-channel gate, neither of which was covered.

Pins three invariants before the dispatch refactor touches them: a
throwing email sender still reaches completeReminder, a throwing push
probe claims nothing, and the gate refuses to claim when email is opted
in but unverified and push is off.

Each was verified against a deliberately broken copy of the production
code to confirm it can actually fail."
```

---

### Task 2: Add `withReminderClaim`

Build the combinator and move the status-mapping helpers to it. Nothing calls it yet, so behaviour cannot change.

**Files:**

- Modify: `src/lib/server/reminders/dispatch.ts`
- Modify: `src/lib/server/reminders.ts` (delete the three helpers, import them instead)
- Test: `tests/unit/reminders-dispatch.test.ts`

**Interfaces:**

- Consumes: `claimReminderSlot`, `completeReminder`, `ReminderType` (all already in `dispatch.ts`).
- Produces:
  - `export type ChannelResults = { email: EmailResult | null; push: PushResult | null }`
  - `export type ChannelIntent = { email: boolean; push: boolean }`
  - `export async function withReminderClaim(input: { userId: string; medicationId: string; reminderType: ReminderType; dedupeKey: string }, intent: ChannelIntent, send: (out: ChannelResults) => Promise<void>): Promise<void>`
  - `export function emailStatusFromResult(result: EmailResult | null): ReminderChannelStatus`
  - `export function pushStatusFromResult(result: PushResult | null): ReminderChannelStatus`
  - `export function summariseError(email: EmailResult | null, push: PushResult | null): string | null`

  The three helpers are exported **only** so `reminders.ts` can keep compiling between Tasks 2 and 4. Task 4 removes the `export` keyword once both loops are migrated.

- [ ] **Step 1: Write the failing combinator tests**

`tests/unit/reminders-dispatch.test.ts` already mocks `$lib/server/db` with everything needed — reuse it, do not add a second mock. The harness it provides:

- `nextClaimReturning` — what the claim's `.returning()` resolves to. `beforeEach` resets it to `[{ id: "evt-1", attemptCount: 1 }]`, so a **granted** claim needs no setup; assign `[]` for a **refused** one.
- `updateCalls` — one entry per `completeReminder`, as `{ payload, predicate }`. Assert on `updateCalls[0].payload.emailStatus` and friends.

First extend that file's import (currently line 70) to pull in the new function:

```ts
const {
  claimReminderSlot,
  completeReminder,
  deriveOverallStatus,
  withReminderClaim,
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
} = await import("../../src/lib/server/reminders/dispatch");
```

Then append a new describe block at the end of the file:

```ts
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

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.emailStatus).toBe("sent");
    expect(updateCalls[0].payload.pushStatus).toBe("sent");
    expect(updateCalls[0].payload.status).toBe("sent");
    expect(updateCalls[0].payload.lastError).toBeNull();
  });

  it("never runs the callback and never completes when the claim is refused", async () => {
    nextClaimReturning = []; // row exists and is not retryable
    let ran = false;

    await withReminderClaim(
      { userId: "u1", medicationId: "m1", reminderType: "overdue", dedupeKey: "k1" },
      { email: true, push: true },
      async () => {
        ran = true;
      },
    );

    expect(ran).toBe(false);
    expect(updateCalls).toHaveLength(0);
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

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.emailStatus).toBe("sent");
    expect(updateCalls[0].payload.pushStatus).toBe("failed");
    expect(updateCalls[0].payload.status).toBe("sent"); // one configured channel succeeded
    expect(String(updateCalls[0].payload.lastError)).toContain("push blew up");
  });

  it("leaves an unintended channel not_configured even when the callback throws", async () => {
    await withReminderClaim(
      { userId: "u1", medicationId: "m1", reminderType: "overdue", dedupeKey: "k1" },
      { email: false, push: true },
      async () => {
        throw new Error("probe blew up");
      },
    );

    expect(updateCalls[0].payload.emailStatus).toBe("not_configured");
    expect(updateCalls[0].payload.pushStatus).toBe("failed");
    expect(updateCalls[0].payload.status).toBe("failed");
  });

  it("still completes when the callback throws a non-Error", async () => {
    await withReminderClaim(
      { userId: "u1", medicationId: "m1", reminderType: "overdue", dedupeKey: "k1" },
      { email: true, push: false },
      async () => {
        throw "just a string";
      },
    );

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.emailStatus).toBe("failed");
    expect(String(updateCalls[0].payload.lastError)).toContain("non-Error thrown during dispatch");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/reminders-dispatch.test.ts`
Expected: FAIL — `withReminderClaim is not a function` / not exported.

- [ ] **Step 3: Move the three helpers into `dispatch.ts`**

Cut `emailStatusFromResult`, `pushStatusFromResult` and `summariseError` from `src/lib/server/reminders.ts` (lines 33–57) and paste them into `src/lib/server/reminders/dispatch.ts`, after the `deriveOverallStatus` function. Add the `export` keyword to each. Add these type-only imports at the top of `dispatch.ts`, below the existing imports:

```ts
import type { EmailResult } from "../email";
import type { PushResult } from "../push";
```

`import type` is required: it erases at compile time, so no runtime import edge is added between `dispatch.ts` and the email/push modules.

In `src/lib/server/reminders.ts`, extend the existing dispatch import to pull them back in:

```ts
import {
  claimReminderSlot,
  completeReminder,
  emailStatusFromResult,
  pushStatusFromResult,
  summariseError,
} from "./reminders/dispatch";
```

- [ ] **Step 4: Run the full suite — the move alone must change nothing**

Run: `npx vitest run`
Expected: PASS, 738 tests. Only the combinator tests from Step 1 still fail.

- [ ] **Step 5: Implement `withReminderClaim`**

Append to `src/lib/server/reminders/dispatch.ts`:

```ts
export type ChannelResults = { email: EmailResult | null; push: PushResult | null };

/**
 * Which channels this dispatch intended to use. On a throw, an intended
 * channel with no result yet is recorded as failed so the row stays
 * retryable; an unintended one stays `not_configured`.
 *
 * The two sweeps pass different things here, deliberately. Overdue
 * passes the raw push opt-in because its subscription probe runs inside
 * the callback and may itself be the thrower — using a post-probe value
 * would resolve the row to `sent` with nothing delivered. Low inventory
 * probes before claiming, so it passes the post-probe value.
 */
export type ChannelIntent = { email: boolean; push: boolean };

/**
 * Claim a reminder slot, dispatch it, and record the outcome.
 *
 * This is the only place the claim/complete pair may be used. After a
 * successful claim every path through this function reaches
 * `completeReminder` — including a throwing `send`. A leaked claim sits
 * at `status='pending'` and is only reclaimed once it is stale enough
 * for the retry predicate, so the reminder is late at best.
 *
 * `send` writes into `out` as each channel resolves rather than
 * returning its results, so a partial success survives a later throw.
 */
export async function withReminderClaim(
  input: {
    userId: string;
    medicationId: string;
    reminderType: ReminderType;
    dedupeKey: string;
  },
  intent: ChannelIntent,
  send: (out: ChannelResults) => Promise<void>,
): Promise<void> {
  const claim = await claimReminderSlot(input);
  if (!claim) return;

  const out: ChannelResults = { email: null, push: null };
  let dispatchError: string | null = null;

  try {
    await send(out);
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : "non-Error thrown during dispatch";
    // These `reason` values are load-bearing: summariseError only
    // reports push when reason === "all_failed", and
    // pushStatusFromResult maps not_configured/no_subscriptions to
    // not_configured rather than failed.
    if (intent.email && out.email === null) {
      out.email = { ok: false, reason: "provider_error", message: dispatchError };
    }
    if (intent.push && out.push === null) {
      out.push = { ok: false, reason: "all_failed", message: dispatchError };
    }
  }

  await completeReminder(claim.id, {
    emailStatus: emailStatusFromResult(out.email),
    pushStatus: pushStatusFromResult(out.push),
    lastError: dispatchError ?? summariseError(out.email, out.push),
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/reminders-dispatch.test.ts`
Expected: PASS, 19 tests (14 existing + 5 new).

Run: `npx vitest run`
Expected: PASS, 743 tests.

- [ ] **Step 7: Typecheck**

Run: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npm run check`
Expected: 0 errors. Pre-existing `.svelte` warnings are fine.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/reminders/dispatch.ts src/lib/server/reminders.ts tests/unit/reminders-dispatch.test.ts
git commit -m "feat(reminders): add withReminderClaim combinator

Joins claimReminderSlot and completeReminder so that after a successful
claim every path reaches completion, including a throwing dispatch. The
rule was previously a comment restated in two sweep loops.

The callback writes into a mutable results object rather than returning
its results: email is dispatched first so a later push failure cannot
poison an already-successful send, and a returned value would be lost on
throw.

Moves the three status-mapping helpers to dispatch.ts, exported for now
so reminders.ts keeps compiling until both loops are migrated. No caller
uses the combinator yet."
```

---

### Task 3: Migrate `checkOverdueMedications`

**Files:**

- Modify: `src/lib/server/reminders.ts` (the overdue loop body, ~lines 148–216)

**Interfaces:**

- Consumes: `withReminderClaim`, `ChannelResults` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Replace the claim/try/catch/complete block**

In `checkOverdueMedications`, replace everything from `const claim = await claimReminderSlot({` through the closing `});` of the `completeReminder` call with:

```ts
const emailConfigured =
  row.userOverdueEmailReminders && emailGloballyConfigured && row.userEmailVerified;
// "logged", not "taken": the anchor now counts skips, so a reminder can
// follow a skip and asserting the dose was taken would be false.
const sinceLabel = row.lastEventAt ? formatTimeSince(new Date(row.lastEventAt)) : "never";

// Intent passes the raw push opt-in, NOT the post-probe value: the
// probe runs inside the callback below and may itself throw. Using
// the post-probe flag would let a probe-time DB blip resolve the row
// to status=sent with both channels not_configured, consuming the
// dedupe slot for that overdue window with nothing delivered.
await withReminderClaim(
  {
    userId: row.userId,
    medicationId: row.medicationId,
    reminderType: "overdue",
    dedupeKey,
  },
  { email: emailConfigured, push: row.userOverduePushReminders },
  async (out) => {
    // Email first so a transient failure inside the push channel
    // (e.g. the subscription lookup hitting a DB blip) doesn't
    // poison an already-successful email send.
    if (emailConfigured) {
      out.email = await sendReminderEmail(row.userEmail, row.medicationName, sinceLabel);
    }
    // Push is configured when the user has opted in AND has an
    // active subscription on at least one device.
    let pushConfigured = false;
    if (row.userOverduePushReminders) {
      pushConfigured = await hasPushSubscriptions(row.userId);
    }
    if (pushConfigured) {
      out.push = await sendPushNotification(row.userId, {
        title: `${row.medicationName} overdue`,
        body: row.lastEventAt
          ? `Last logged ${formatTimeSince(new Date(row.lastEventAt))} ago`
          : "Not yet logged",
        url: "/dashboard",
        tag: `overdue-${row.medicationId}`,
      });
    }
  },
);
```

Note `emailConfigured` and `sinceLabel` move above the call — they were previously declared after the claim. They have no side effects, so evaluating them a few lines earlier is safe.

- [ ] **Step 2: Run the overdue tests — every one must pass unmodified**

Run: `npx vitest run tests/unit/reminders.test.ts`
Expected: PASS, 21 tests.

If any fails, the migration changed behaviour. Do **not** edit the test. Fix the production code until the test passes as written, or stop and report.

- [ ] **Step 3: Remove now-unused imports**

If `claimReminderSlot` / `completeReminder` are no longer referenced in `reminders.ts`, drop them from the import. `checkLowInventoryMedications` still uses them until Task 4, so expect them to remain for now.

Run: `npm run lint`
Expected: 0 errors, and no new warnings naming `reminders.ts`.

- [ ] **Step 4: Full suite**

Run: `npx vitest run`
Expected: PASS, 743 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/reminders.ts
git commit -m "refactor(reminders): route the overdue sweep through withReminderClaim

The claim, the try/catch, the status mapping and the completeReminder
call collapse into one combinator call. The channel bodies and the
probe's position inside the dispatch are unchanged.

Push intent is passed as the raw opt-in, matching the previous catch
block: the probe runs inside the callback and may itself be the thrower.

All 21 reminders.test.ts cases pass unmodified."
```

---

### Task 4: Migrate `checkLowInventoryMedications` and close the seams

**Files:**

- Modify: `src/lib/server/reminders.ts` (the low-inventory loop body, ~lines 285–330)
- Modify: `src/lib/server/reminders/dispatch.ts` (un-export the three helpers)

**Interfaces:**

- Consumes: `withReminderClaim` from Task 2.
- Produces: final state — `emailStatusFromResult`, `pushStatusFromResult`, `summariseError` are module-private to `dispatch.ts` again, as the spec requires.

- [ ] **Step 1: Replace the claim/try/catch/complete block**

Everything above the claim stays exactly as it is — the pre-claim probe with its own `try/catch` + `continue`, and the "no enabled channel can fire" gate with its `console.warn`. Replace from `const claim = await claimReminderSlot({` through the closing `});` of `completeReminder` with:

```ts
await withReminderClaim(
  {
    userId: med.userId,
    medicationId: med.medicationId,
    reminderType: "low_inventory",
    dedupeKey,
  },
  // Post-probe values, not raw opt-in: unlike the overdue sweep the
  // probe already ran and succeeded before the claim, so pushWillFire
  // is the accurate intent here.
  { email: emailWillFire, push: pushWillFire },
  async (out) => {
    // Email first so a transient push failure can't poison an
    // already-sent email.
    if (emailWillFire) {
      out.email = await sendLowInventoryEmail(
        med.userEmail,
        med.medicationName,
        med.inventoryCount!,
        med.inventoryAlertThreshold!,
      );
    }
    if (pushWillFire) {
      out.push = await sendPushNotification(med.userId, {
        title: `Low inventory: ${med.medicationName}`,
        body: `${med.inventoryCount} doses remaining (threshold ${med.inventoryAlertThreshold}).`,
        url: "/medications",
        tag: `low-inventory-${med.medicationId}`,
      });
    }
  },
);
```

- [ ] **Step 2: Run the reminder tests**

Run: `npx vitest run tests/unit/reminders.test.ts`
Expected: PASS, 21 tests, all unmodified — including the three added in Task 1.

- [ ] **Step 3: Un-export the three helpers**

`reminders.ts` no longer uses them. In `src/lib/server/reminders/dispatch.ts`, remove the `export` keyword from `emailStatusFromResult`, `pushStatusFromResult` and `summariseError`. In `src/lib/server/reminders.ts`, reduce the dispatch import to what is still used:

```ts
import { withReminderClaim } from "./reminders/dispatch";
```

- [ ] **Step 4: Verify no other module imported those helpers**

Run: `grep -rn "emailStatusFromResult\|pushStatusFromResult\|summariseError" src tests --include='*.ts'`
Expected: matches only inside `src/lib/server/reminders/dispatch.ts`. Any other hit means something else depended on the temporary export — re-export it and note why.

- [ ] **Step 5: Full verification**

Run: `npx vitest run`
Expected: PASS, 743 tests.

Run: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npm run check`
Expected: 0 errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npm run build`
Expected: completes, ending `✔ done`.

- [ ] **Step 6: Confirm no existing test was edited**

Run: `git diff origin/main --stat -- tests/`
Expected: `tests/unit/reminders.test.ts` and `tests/unit/reminders-dispatch.test.ts` only, and both **grow**.

Run: `git diff origin/main -- tests/unit/reminders.test.ts | grep '^-' | grep -v '^---'`
Expected: only the mock-setup lines replaced in Task 1 Step 1. No removed line may come from inside an `it(...)` body. If one does, an existing test was edited — the Global Constraints forbid it. Stop and report.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/reminders.ts src/lib/server/reminders/dispatch.ts
git commit -m "refactor(reminders): route the low-inventory sweep through withReminderClaim

Second and last caller. The pre-claim probe and the no-channel gate stay
in the caller, unchanged: this sweep's dedupe key is
(user, medication, inventoryCount), which persists, so claiming when
nothing can fire would suppress the key even after the user fixes their
setup.

Intent passes the post-probe pushWillFire here, matching the previous
catch block, because the probe already succeeded before the claim.

With both callers migrated the three status-mapping helpers are private
to dispatch.ts again. All 21 reminders.test.ts cases pass unmodified."
```

---

## Definition of done

- `claimReminderSlot` and `completeReminder` are called from exactly one place: `withReminderClaim`.
- `grep -rn "claimReminderSlot\|completeReminder" src --include='*.ts'` shows hits only in `src/lib/server/reminders/dispatch.ts`.
- 743 tests pass; `npm run check`, `npm run lint` and `npm run build` are clean.
- No existing test case body was edited.
