# Interval Rate Precedence — Design

`24 / intervalHours` is written out six times across the codebase. Each
restatement carries its own guard against a non-positive interval, and each
guard is spelled differently:

| #   | Site                          | Guard as written                                             |
| --- | ----------------------------- | ------------------------------------------------------------ |
| 1   | `analytics.ts:21-23`          | `s.intervalHours` then `hrs > 0`                             |
| 2   | `inventory.ts:47-49`          | `!== null` then `Number.isFinite(hrs) && hrs > 0`            |
| 3   | `medications.ts:109-113`      | `!= null` then `Number.isFinite(legacyHrs) && legacyHrs > 0` |
| 4   | `time.ts:88-95`               | `!== null && !== undefined` then `Number.isFinite && > 0`    |
| 5   | `schedule.ts:127`, `:220-221` | `!intervalHours \|\| intervalHours <= 0`                     |
| 6   | `reminders/domain.ts:43-44`   | `!row.intervalHours`                                         |

Five of the six are correct. The sixth is not, and it is the one that sends
notifications.

## What is actually broken

**`computeOverdueSlot` admits a zero interval.** Its guard is
`if (!row.intervalHours || !row.lastEventAt) return null`, and `intervalHours`
arrives from Drizzle as a **string**. `"0"` is truthy. It passes:

```ts
const intervalMs = Number(row.intervalHours) * 3600000; // 0
const lastMs = new Date(row.lastEventAt).getTime();
if (now.getTime() - lastMs <= intervalMs) return null; // any past dose: false
return new Date(lastMs + intervalMs); // === lastEventAt
```

The slot returned is the dose the user just logged. The medication is overdue
the instant it is taken. `isScheduleOverdue` is a one-line delegate to this
function, so both the flag and the slot are wrong from a single defect.

The blast radius is bounded, and worth stating precisely so the fix is not
oversold: the dedupe key is `…:overdue:interval:<scheduleId>:<slot.toISOString()>`,
and the slot equals `lastEventAt`, which is **fixed until the next dose**. So
this is one spurious reminder per logged dose, not the per-tick churn that got
#110 reverted.

**The import door admits the value that triggers it.** Of the three write doors,
two are strict and identical — the web form and `/api/v1` both parse through
`scheduleRowSchema` (`validation.ts:170-174`):

```ts
intervalHours: z.coerce.number().positive().max(72),
```

The import door does not. `importScheduleSchema` (`validation.ts:337`) uses the
shared `numericString`, whose only constraint is the regex `/^\d+(\.\d+)?$/`:

```ts
intervalHours: numericString.nullable().optional().default(null),
```

`"0"` matches. So does `"99999"` — the import door has no upper bound at all
where the other two cap at 72. `import/backup.ts:102` then decides whether the
row is usable with a null check only:

```ts
schedule.scheduleKind === "interval" && schedule.intervalHours !== null;
```

`"0" !== null`, so the row is written as a live interval schedule, and site 6
turns it into a reminder.

## The constraint: `utils/` cannot import `server/`

`inventory.ts:dailyRateFor` is the documented single source of truth for daily
rate (`CLAUDE.md`, and the doc comment at `medications.ts:87`). The obvious move
is to put the shared primitive there.

It cannot go there. Sites 4 and 5 live in `src/lib/utils/time.ts` and
`src/lib/utils/schedule.ts`, which are client-reachable; `src/lib/server/` is
server-only and must never be imported from client code. A primitive every site
can call has to live in `utils/`.

This is the same constraint that placed `push-payload.ts` in `utils/` rather
than `server/` in #115, for the same class of reason.

## Decisions

1. **A new module `src/lib/utils/schedule-rate.ts` owns the primitive** — what
   counts as a usable interval, and what rate it implies.
2. **`inventory.ts:dailyRateFor` keeps owning the precedence** — which signal
   wins (schedule rows → legacy column → 30-day history). Its role and its
   `CLAUDE.md` status are unchanged. Two responsibilities, two modules: the new
   one answers _is this interval usable_, the existing one answers _which signal
   wins_. Merging them would put a client-safe primitive behind a server-only
   import and re-create the constraint above.
3. **The read primitive enforces positivity and finiteness only. The 72-hour cap
   is a door policy, not a read policy.** See below — this is the decision most
   likely to be got wrong.
4. **An unusable interval row demotes to PRN on import, with the warning that
   already exists**, reusing the `usable` gate at `import/backup.ts:99-119`
   verbatim in shape.
5. **`medications.ts:109-113` is deleted, not migrated.** It re-derives the
   legacy-column rate five lines below a `dailyRateFor(...)` call that already
   contains that exact branch. It is a duplicate, not a sixth opinion.

### Why the cap is a door policy and not a read policy

The tempting version of `parseIntervalHours` rejects anything over
`MAX_INTERVAL_HOURS`, making one function express the whole rule.

That would be a regression. Both strict doors have capped at 72 for their
whole life, but the import door never has, and the deprecated
`medications.scheduleIntervalHours` column has no bound either. A stored value
above the cap — 168 for a weekly injection — is a **meaningful** rate, and it is
already in production data. Reading it as "no schedule" would silently drop that
medication out of refill forecasting, out of the adherence denominator, and out
of reminders.

So the split is:

- **Read side** (`parseIntervalHours`): finite and `> 0`. Answers "can I compute
  a rate from this?" A stored 168 keeps working exactly as it does today.
- **Door side** (`MAX_INTERVAL_HOURS`): the admission bound, applied where data
  enters. Answers "should we accept this as new input?"

A cap that rejects data already on disk is a different change from a cap that
rejects new input, and only the second one is wanted here.

## Architecture

```ts
// src/lib/utils/schedule-rate.ts

/** Admission bound for new interval input. A door policy — deliberately NOT
 *  applied when reading stored rows. See the design doc. */
export const MAX_INTERVAL_HOURS = 72;

/** The single usability test for an interval, for every reader.
 *  Drizzle `numeric` columns arrive as strings, so `"0"` is truthy and
 *  `!raw` is not a sufficient guard — that bug is why this module exists. */
export function parseIntervalHours(raw: string | number | null | undefined): number | null;

/** Doses per day implied by an interval row: 24 / hours, or 0 if unusable. */
export function intervalDosesPerDay(raw: string | number | null | undefined): number;
```

`parseIntervalHours` returns the parsed hours or `null`. Returning `null` rather
than a boolean is what lets call sites replace _both_ halves of their current
two-step (`guard`, then `Number(...)`) with one call, which is what removes the
opportunity to spell the guard a seventh way.

## Migration

| Site                                 | Today                              | After                                                     |
| ------------------------------------ | ---------------------------------- | --------------------------------------------------------- |
| `validation.ts:173` (web + API door) | `.max(72)` literal                 | `.max(MAX_INTERVAL_HOURS)`                                |
| `import/backup.ts:102`               | `intervalHours !== null`           | see below — parse first, then bound the **parsed number** |
| `analytics.ts:21-23`                 | inline guard + divide              | `intervalDosesPerDay(s.intervalHours)`                    |
| `inventory.ts:47-49`                 | inline legacy guard                | `parseIntervalHours`                                      |
| `medications.ts:109-113`             | inline legacy re-derivation        | **deleted** (Decision 5)                                  |
| `time.ts:88-95`                      | inline guard                       | `parseIntervalHours`                                      |
| `schedule.ts:127`, `:220-221`        | double guard, two spellings        | `parseIntervalHours`                                      |
| `reminders/domain.ts:43-44`          | `!row.intervalHours` — **the bug** | `parseIntervalHours` → `null` means no slot               |

### The import gate, written out

The door check is two steps and the order matters — the bound is applied to the
**parsed number**, never to the raw value. `intervalHours` is a string off the
wire, and `"100" <= 72` is a string/number comparison: exactly the coercion
class this module exists to eliminate.

```ts
// src/lib/server/import/backup.ts
const hours = parseIntervalHours(schedule.intervalHours);
const usable =
  (schedule.scheduleKind === "fixed_time" && schedule.timeOfDay !== null) ||
  (schedule.scheduleKind === "interval" && hours !== null && hours <= MAX_INTERVAL_HOURS) ||
  schedule.scheduleKind === "prn";
```

This is the only place `MAX_INTERVAL_HOURS` is applied outside a Zod schema, and
the only place a read-side primitive and a door policy are combined. Per
Decision 3 that combination is deliberate and must not spread to the readers.

### Unchanged

- The rate emitted for every valid interval.
- `dailyRateFor`'s precedence order, and its status as the rate owner.
- Every dedupe key shape. This matters: #110 was reverted because a dedupe key
  changed shape and churned one reminder per interval forever. This design
  changes only _whether a slot exists at all_ for a schedule the doors should
  never have admitted. For every valid interval the key is byte-identical.
- `time.ts:calculateDaysUntilRefill` stays dead code. It is migrated for
  consistency, not revived; 13 assertions ride on it and deleting it is a
  separate decision.

## Testing

The ordering is the point, and it is not negotiable. #110 shipped 753 green
tests that proved nothing, because the tests pinning the old contract were
deleted and _then_ the behaviour they protected was changed.

**Wave 1 — characterization tests land first, green against unmodified code.**
Every one of the six read sites and all three doors gets its current behaviour
pinned before a line of production code moves. This includes pinning the bug:
a test asserting that `computeOverdueSlot` _currently_ returns `lastEventAt` for
a `"0"` interval, so the fix has something to visibly flip.

**Wave 2 — the primitive and the migration.**

**Wave 3 — verify every new test can fail.** Each assertion is re-run against a
deliberately broken copy of `schedule-rate.ts`. The breaks: make
`parseIntervalHours` accept `0`; make it reject values over 72 (this must break
the weekly-injection test, or Decision 3 is untested); make it return the raw
value instead of a number; make `intervalDosesPerDay` return `hours` instead of
`24 / hours`. A test that stays green against its own break is not testing what
it claims and gets rewritten.

This step has earned itself in both preceding PRs — #115 caught an assertion
comparing a constant to itself, #113 caught a vacuous whole-row diff. It is not
optional.

New file: `tests/unit/schedule-rate.test.ts`. Cases added to
`tests/unit/reminders-dedupe.test.ts` (the zero-interval slot) and
`tests/unit/import-backup.test.ts` (demotion + warning, extending the existing
`as needed` assertion at `:335`).

### The review signal, stated honestly

`analytics.test.ts:318` already asserts the target behaviour for a `"0"`
interval — _"ignores an interval row with a non-positive interval"_. It must
stay green and **untouched** for the whole PR. That is a free regression check
on site 1, and it is the strongest single signal available here.

The claim this PR makes:

- **No existing assertion is edited.** Not one `expect(...)` line changes.
- Existing test _lines_ may change only where a helper's import path moves.
  Any edit inside an `it(...)` body means behaviour moved somewhere it was not
  supposed to, and the work stops there.

Verified mechanically, as in #114:
`git diff origin/main..HEAD -- tests/ | grep '^-' | grep -v '^---'`

Baseline is 777 tests across 64 files on `origin/main` (`d760d0d`).
Verification: `npx vitest run`, `npm run check`, `npm run lint`.

## Behaviour changes

Three, all deliberate:

1. **`computeOverdueSlot` returns `null` for a zero interval.** The fix. A
   medication is no longer overdue the instant it is logged.
2. **An unusable interval row demotes to PRN on import**, with the existing
   warning, instead of being written as a live interval schedule.
3. **The import door gains the 72-hour cap** the other two doors have always
   had. Applies to _new imports only_ — stored rows above the cap keep reading
   as valid rates, per Decision 3.

No change to any valid interval's rate, at any site.

## Out of scope

- **Deleting the three dead functions** (`calculateDaysUntilRefill`,
  `createMedication`, `updateMedication`). Verified dead in the architecture
  review; removal is its own PR with its own test-deletion argument.
- **The deprecated `scheduleType` / `scheduleIntervalHours` columns.** This
  design routes their reads through the primitive; it does not begin their
  removal.
- **Validating stored rows retroactively.** No migration sweeps existing data
  for zero intervals. If one exists in production it will stop generating
  spurious reminders the moment this ships, which is the entire remedy needed.
- **`isScheduleOverdue`'s never-taken-interval behaviour** (a never-logged
  interval med is never overdue, because there is no baseline). Noted during the
  #110 post-mortem as its own question; untouched here.
