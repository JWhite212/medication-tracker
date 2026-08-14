# Reminder Dispatch Invariant — Design

`reminders.ts` has one rule that matters more than any other:

> After a successful claim, every code path MUST reach `completeReminder`.

Today that rule is a comment. It is written out twice, in two ~100-line loops that
each re-implement the same claim → dispatch → complete shape, and nothing but care
stops a future edit from returning early between the claim and the completion. A
leaked row stays at `status='pending'`, and the retry predicate only reclaims a
stale pending after `RETRY_DELAY_MS`, so the reminder is late at best.

Move the rule out of prose and into the only code path that exists.

## What the two loops actually share, and where they genuinely differ

Both loops are: select rows → per row, decide channels → claim → send → complete.
The shared part is the tail. The differences are real, and each one carries a
comment recording why it is the way it is:

|                                        | `checkOverdueMedications`         | `checkLowInventoryMedications`    |
| -------------------------------------- | --------------------------------- | --------------------------------- |
| push probe (`hasPushSubscriptions`)    | **after** claim, inside the `try` | **before** claim, own `try/catch` |
| probe throws                           | becomes a failed push channel     | `continue` — nothing is claimed   |
| pre-claim "can any channel fire?" gate | absent                            | present                           |
| catch marks push failed based on       | raw opt-in                        | post-probe `pushWillFire`         |
| tests today                            | 15                                | 3                                 |

### Why the probe sits on opposite sides of the claim

This reads like an inconsistency and is not one. It follows from the dedupe keys.

`deriveOverallStatus` returns `sent` when no channel was configured — "best-effort,
nothing to retry". So claiming a row when nothing can actually fire consumes the
dedupe key and records a delivery that never happened. What that costs depends on
how long the key lives:

- **Low inventory** keys on `(user, medication, inventoryCount)`. The key persists
  for as long as the count does, so a user who re-subscribes later still hits the
  suppressed key. The harm is durable, and the pre-claim gate exists to prevent it —
  its comment says exactly this.
- **Overdue** keys include the slot. The next slot mints a fresh key, so the harm is
  bounded to one misleading `sent` row.

The asymmetry is therefore justified by the key shapes, not an oversight. Recorded
here so it is not re-litigated as duplication.

Overdue **is** still able to claim a slot when nothing can fire and complete it as
`sent`. That is a real defect with bounded harm. It is deliberately **out of scope**
— see below.

## Decisions

1. **Enforce the invariant structurally; do not merge the loops.** A combinator owns
   claim → dispatch → complete. Both loops keep their own SQL, key construction and
   channel bodies. Full unification was considered and rejected: it would push the
   incident-hardened differences above through a shared flag surface
   (`probeBeforeClaim`, `gateOnNoChannel`, `markFailedOn`), and a wrong combination
   of those flags is a production incident.
2. **Zero behaviour change.** This ships as a pure refactor. The review signal is
   that every existing test passes **unmodified**.
3. **Backfill the low-inventory tests before restructuring**, not after. It carries
   the extra logic and a fifth of the coverage.

Decision 3 is the direct lesson of #110, which was reverted after merge: the tests
pinning the old contract were deleted, then the behaviour they protected was
changed, and 753 green tests proved nothing.

## Architecture

`withReminderClaim` joins `claimReminderSlot` and `completeReminder` in
`src/lib/server/reminders/dispatch.ts`.

```ts
export type ChannelResults = { email: EmailResult | null; push: PushResult | null };

export type ChannelIntent = { email: boolean; push: boolean };

export async function withReminderClaim(
  input: { userId: string; medicationId: string; reminderType: ReminderType; dedupeKey: string },
  intent: ChannelIntent,
  send: (out: ChannelResults) => Promise<void>,
): Promise<void>;
```

It claims; returns immediately if the claim is `null`; runs `send` inside a `try`;
on a throw marks each **intended** channel whose result is still `null` as failed;
then derives the channel statuses and calls `completeReminder`. Unconditionally.
There is no path through the function that claims without completing.

The substituted failure results must be **exactly** these, copied from the current
catch blocks:

```ts
out.email = { ok: false, reason: "provider_error", message: dispatchError };
out.push = { ok: false, reason: "all_failed", message: dispatchError };
```

The `reason` values are load-bearing, not decorative. `summariseError` includes the
push channel in `lastError` only when `reason === "all_failed"`, and
`pushStatusFromResult` maps `not_configured` and `no_subscriptions` to
`not_configured` rather than `failed`. Choosing a different `reason` would change
both the stored `last_error` text and the derived overall status — a behaviour
change, which Decision 2 forbids.

`emailStatusFromResult`, `pushStatusFromResult` and `summariseError` move from
`reminders.ts` into `dispatch.ts`. They are module-private today and only the
combinator needs them. `EmailResult` and `PushResult` come across as `import type`,
so no runtime import edge is added — and neither `email.ts` nor `push.ts` imports
`dispatch.ts`, so there is no cycle to create.

### Why the callback writes into a mutable sink

The current code depends on partial results surviving a throw: email is dispatched
first precisely so that a later push failure cannot poison an already-successful
send, and the catch block reads the `emailResult` local that was assigned before the
throw.

A callback that returns its results loses them when it throws. Recovering them would
force every caller to wrap its own `try/catch` — reinstating the exact duplication
being removed. Writing into `out` as each channel resolves keeps the partial-result
semantics with one `try` in one place.

### Intent is the one asymmetry, and it becomes an argument

The only genuine divergence in the tail is which flag decides that a `null` channel
result becomes `failed` on a throw. It stops being two divergent catch blocks and
becomes one visible argument per call site:

| call site     | `intent.email`    | `intent.push`                               |
| ------------- | ----------------- | ------------------------------------------- |
| overdue       | `emailConfigured` | `row.userOverduePushReminders` (raw opt-in) |
| low inventory | `emailWillFire`   | `pushWillFire` (post-probe)                 |

Both rows reproduce exactly what the current catch blocks test. Overdue passes raw
opt-in because its probe runs _inside_ the callback and may itself be the thrower —
using the post-probe value there would let a probe-time DB blip resolve the row to
`sent` with both channels `not_configured`, consuming the dedupe slot with nothing
delivered. Low inventory passes the post-probe value because its probe already
succeeded before the claim.

## Migration

### `checkOverdueMedications`

The claim, the `try/catch`, the status mapping and the `completeReminder` call are
replaced by one `withReminderClaim`. The callback keeps the email send, the
`hasPushSubscriptions` probe and the push send, in that order. `pushConfigured`
stays a local inside the callback.

### `checkLowInventoryMedications`

Unchanged above the claim: the pre-claim probe with its own `try/catch` + `continue`,
and the "no enabled channel can fire" gate with its `console.warn`, both stay in the
caller. Below that, same replacement as overdue.

### Unchanged

`claimReminderSlot`, `completeReminder`, `deriveOverallStatus`, `MAX_ATTEMPTS`,
`RETRY_DELAY_MS`, both SQL queries, both dedupe-key builders, `computeOverdueSlot`,
every re-export from `reminders/domain`, and the cron route.

## Error handling

Identical to today:

- a throw inside `send` is swallowed into `lastError`; the sweep continues to the
  next row
- a non-`Error` throw keeps the message `"non-Error thrown during dispatch"`
- `completeReminder` throwing propagates, as it does now
- `lastError` is `dispatchError ?? summariseError(...)`, unchanged

## Testing

**Wave 1 — backfill, against current code, before any restructure.** Three tests
that pin `checkLowInventoryMedications` invariants which no test currently covers:

1. `completeReminder` is still called when the email sender throws
2. a throwing push probe skips the row — `claimReminderSlot` is never called
3. the no-channel gate fires when email is opted-in but the address is unverified
   and push is off — no claim, and the warn is emitted

**Wave 2 — the combinator, in `reminders-dispatch.test.ts`:**

1. a callback that throws after assigning `out.email` keeps the email result and
   marks only push failed
2. `claim === null` → the callback never runs and `completeReminder` is never called
3. a non-`Error` throw still reaches `completeReminder`
4. a channel with `intent === false` stays `not_configured` even when the callback
   throws
5. the happy path derives statuses from the results and completes once

**The review signal:** all 56 existing reminder tests — 18 in `reminders.test.ts`,
6 in `reminders-dispatch.test.ts`, 32 in `reminders-dedupe.test.ts` — plus the 3
added in wave 1, pass **completely unmodified**. Wave 2 only adds files' worth of
new cases; it edits none. If any existing test needs an edit, the refactor changed
behaviour and the work stops there. This is the property #110 lacked.

## Behaviour changes

None. That is the point of the shape chosen in Decision 1.

## Out of scope

- **The overdue pre-claim gate.** Overdue can still claim a slot when no channel can
  fire and complete it as `sent`. Real, bounded (one slot, fresh key next slot), and
  a behaviour change — so it gets its own candidate, its own tests, and its own PR.
  Bundling it here would forfeit "existing tests pass unmodified" as a safety signal,
  which is the whole review strategy.
- **The probe-position asymmetry.** Justified by the dedupe-key shapes, as argued
  above. Not a defect.
- Merging the two loops' SQL or channel bodies.
