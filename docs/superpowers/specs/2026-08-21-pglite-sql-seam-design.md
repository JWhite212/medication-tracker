# Real Postgres for SQL-Resident Logic — Stage 2 Design

Stage 1 (PR #117) gave the unit suite one database fake with one owner. It
deliberately stopped at capture-and-seed: predicates are recorded, never
evaluated. That line was drawn on purpose, and this document is what sits on
the other side of it.

The suite today is 848 tests across 67 files in 6.4s. Thirty-four files mock
`$lib/server/db`; thirty-two route that mock through
`tests/unit/helpers/fake-db.ts`, and two keep a bespoke fake on purpose, both
documented in CLAUDE.md.

This stage does **not** move any of them. It adds a second backing for the same
seam — a real Postgres, in-process, via PGlite — and uses it only where no fake
could ever have worked.

## What Stage 1 left unreachable

Across nine modules there are eleven behaviours that the _database_ decides
rather than the application. A fake returns its seeded rows regardless, so at
every one of these the test asserts against the fixture instead of against the
behaviour.

They fall into two kinds, and the distinction drives everything below. Note
that Kind A is not about raw SQL — `verifyAndConsumeTOTPCode`'s gate is built
from ordinary Drizzle helpers (`and`/`or`/`isNull`/`lt`). What makes it
unreachable is that Stage 1 captures predicates without evaluating them, which
is a property of the seam, not of how the query was written.

**Kind A — the predicate _is_ the mechanism.** Not a filter over results, but a
gate that decides whether a write happens at all.

| Site                       | What the database decides                                     |
| -------------------------- | ------------------------------------------------------------- |
| `auth/rate-limit.ts:18-25` | Two `CASE` arms: reset the counter to 1, or increment it      |
| `reminders/dispatch.ts:89` | `setWhere` — whether a reminder slot may be re-claimed at all |
| `auth/totp.ts:83`          | Whether a replayed TOTP code is rejected (compare-and-set)    |

**Kind B — SQL semantics the fixture cannot model.**

| Site                                       | Semantics                                                    |
| ------------------------------------------ | ------------------------------------------------------------ |
| `log/+page.server.ts:46`                   | `jsonb_array_length(coalesce(…, '[]'::jsonb)) > 0`           |
| `log/+page.server.ts:49`                   | `ilike` with escaped `%` / `_` / `\`                         |
| `analytics.ts:145,150,151`                 | `date(takenAt AT TIME ZONE tz)` grouping                     |
| `analytics.ts:430,435,436`                 | `extract(hour from … AT TIME ZONE tz)`                       |
| `analytics.ts:447,452,453`                 | `extract(dow from … AT TIME ZONE tz)`                        |
| `doses.ts:108,191,280`                     | `GREATEST(0, inventoryCount - n)` clamping                   |
| `reminders.ts:189`                         | column-to-column `inventoryCount <= inventoryAlertThreshold` |
| `import/apply.ts:211`, `api/wipe.ts:29,50` | `syncEpoch + 1`                                              |

## Where this diverges from Stage 1's handoff

Stage 1's closing section predicted the targets would be _"analytics, log
search, inventory, import."_ Two of those four survive investigation. The
handoff was written from the outside; the ranking below comes from reading the
call sites.

**`checkRateLimit` has no test at all.** It is the login brute-force control.
Its entire window-reset behaviour is the two `CASE` expressions above, and both
test files that touch it — `auth-login-action.test.ts` and
`auth-2fa-action.test.ts` — `vi.mock` the whole module away. `row.count` and
`row.resetAt` _are_ the database's evaluation of those branches, so no fake can
produce them. This is the same shape as Stage 1's `getRefillForecast` finding:
a database-touching test expensive enough that nobody wrote it. Stage 1's
handoff did not anticipate it.

**`claimReminderSlot`'s `setWhere` is captured and discarded.** Stage 1 added
`RecordedCall.conflict` specifically because that upsert is the dedupe
mechanism — but capturing a predicate proves only that it was _sent_, not that
it _blocks_. The gate has three clauses (status, attempt ceiling, retry
threshold) and nothing verifies any of them fire.

**`auth-totp.test.ts` is a documented Stage 1 exception that this stage
retires.** It keeps a bespoke fake because its update _simulates_ the
production WHERE clause, and that compare-and-set is the entire mechanism
behind its replay-rejection test. CLAUDE.md records why migrating it to the
seam would make the test pass unconditionally. Under real Postgres the actual
clause runs and the simulation is deleted.

**Inventory and import drop out.** `GREATEST(0, …)` and `syncEpoch + 1` are
real SQL, but they are simple arithmetic with no defect history. They are
listed above for completeness and excluded from scope; the return per test is
too low to justify the slower backing.

## What this design does not attempt

**It does not migrate the 32 fake-backed files.** They landed in #117 on
2026-08-18 and they work. Re-platforming them would re-run the #110 risk profile — a changed
harness under a green suite — for no new coverage. If per-file cost turns out
low enough to make selective re-platforming attractive, that is a Stage 3
decision made with real numbers, not a guess made here.

**It does not fix bugs.** See Decision 5.

**It does not replace E2E.** PGlite proves SQL semantics. It does not prove
Neon's driver behaviour, connection pooling, or serverless cold-start paths.

**It does not chase coverage percentage.** Route files stay out of the coverage
denominator, exactly as `vitest.config.ts` has them today.

## The approach

A second helper, `tests/unit/helpers/pg-db.ts`, exporting the same surface as
`fake-db.ts`. A test file chooses its backing with one line:

```ts
// fake-backed — the default, unchanged
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

// postgres-backed
vi.mock("$lib/server/db", async () => (await import("./helpers/pg-db")).dbMock);
```

This is the claim from #117's description made good: two files that differ in
their `beforeEach`, not in their assertions.

### Decision 1 — the helper mirrors `fake-db`'s export surface

`pg-db.ts` exports `dbMock` (`{ db, dbTx }`) and a `pgDb` harness with
`reset()` and seeding helpers. Both `db` and `dbTx` are the same PGlite
instance wrapped by `drizzle-orm/pglite`.

Production splits these: `db` is neon-http and **cannot** open a transaction,
`dbTx` is neon-serverless and can. PGlite collapses that distinction, so a test
cannot catch "used a transaction on `db`". This is a real fidelity loss, and it
is the same one `fake-db` already has — recording it here so it is not
rediscovered as a surprise.

### Decision 2 — one instance per test file, truncate between tests

Vitest's default `isolate: true` gives each test file its own module registry.
A module-level `PGlite.create()` is therefore per-file automatically — the same
property that makes `fakeDb` a safe singleton today. Schema is applied once at
module load; `TRUNCATE … RESTART IDENTITY CASCADE` runs in `beforeEach`.

Considered and rejected:

- **Snapshot/restore per test** (`dumpDataDir` / `loadDataDir`). Cleaner
  isolation than truncate, but likely a higher per-test cost. It is a drop-in
  change _inside_ the helper if truncate proves slow — no test file changes
  either way. That is the reason for putting lifecycle behind the helper.
- **One shared instance via `globalSetup`.** Amortises boot best, but requires
  serialising access across parallel workers and reintroduces cross-file data
  bleed — precisely the hazard per-file isolation exists to prevent.

### Decision 3 — schema comes from the real migrations

`migrate()` from `drizzle-orm/pglite/migrator`, over `drizzle/`, all fifteen
files in journal order. The migrations use btree indexes only and declare no
extensions, so PGlite will take them.

Side benefit worth stating: **nothing currently verifies that these migration
files apply cleanly in sequence.** This makes them tested for the first time.

The alternative — hand-maintained DDL, or a snapshot generated from
`schema.ts` — is the fallback if Risk 2 below materialises, not the first
choice, because it would drift.

### Decision 4 — targets are chosen by "no fake could do this"

Not by module, and not by coverage gain. Five new files:

**Tier 1 — Kind A, the gates:**

- `checkRateLimit` — counter increments within a window; resets to 1 once
  `resetAt < NOW()`; `resetAt` is preserved on increment and replaced on reset;
  `allowed` flips exactly at `maxAttempts`, not one either side.
- `claimReminderSlot` — the `setWhere` gate blocks a slot at `MAX_ATTEMPTS`,
  blocks one already `sent`, and blocks one inside the retry threshold; and
  permits a `failed` slot outside it.
- `auth/totp` — a replayed counter value is rejected by the real
  compare-and-set, and two concurrent consumes of the same step resolve so that
  at most one wins.

  This one restructures an existing file rather than only adding to it, so the
  split is stated exactly. `auth-totp.test.ts` has eleven tests; only the four
  in the `verifyAndConsumeTOTPCode` block touch the database. Those four move to
  the PGlite-backed file. The remaining seven are pure crypto and encoding
  (`generateTOTPSecret`, `verifyTOTPCode` ×3, `getTOTPUri`, `generateQRDataUrl`)
  and need no database at all, so the file drops to `unusedDb` — Stage 1's stub
  that throws on any property access.

  The bespoke fake is then deleted outright, and CLAUDE.md's _"exactly two files
  keep a bespoke fake"_ becomes one: `reminders.test.ts`, which stays bespoke
  because it asserts on `whereArgsByCall[1]` ordering, a reason PGlite does not
  address. **Updating that CLAUDE.md paragraph is part of this work**, not a
  follow-up.

**Tier 2 — Kind B, the shipped-bug classes:**

- Log search — `jsonb_array_length(coalesce(…))` excludes rows with `null`
  side effects **and** rows with `[]`; `ilike` escaping means a literal `%` in
  a search term matches only a literal `%`.
- Analytics timezone grouping — doses either side of a BST boundary land in the
  correct local day, hour, and day-of-week. **Conditional on Risk 1.**

Route files are reachable without any production change: six route modules are
already unit-tested, and `log-dose-actions.test.ts` already imports
`src/routes/(app)/log/+page.server` to exercise its `actions`. This design
imports its `load` the same way. The coverage config excludes routes from the
_denominator_, which is not the same as excluding them from testing.

### Decision 5 — a found bug stops the work, it does not ride along

These tests assert behaviour that has never been asserted. Some of it may be
wrong.

When a test contradicts production behaviour, work on **that target** stops and
the finding is reported with a reproducing test. Work on the other targets
continues; only the disputed one waits. The bug is not fixed in this branch: a
fix changes user-visible behaviour and deserves its own review, and this
repository reverted #110 over exactly that kind of change arriving inside a
larger diff.

That leaves the question of what the disputed test looks like when the branch
lands, and the answer depends on the decision it is waiting for:

- **Fix approved separately** — the test stays out of this branch and ships with
  the fix, green.
- **Fix deferred** — the test lands marked `it.fails`, linked to the issue. In
  Vitest that passes CI precisely while the bug is present and starts failing
  the moment someone fixes it, which is the behaviour we want from a defect
  record.

The rejected alternative is worse than it looks: writing the test to assert the
current, wrong behaviour and filing an issue separately. A green test asserting
wrong behaviour is how a bug becomes the specification — the next reader takes
it as intent.

### Decision 6 — the gate is per-test mutation proof

Stage 1's headline evidence was that total assertions rose 1598 → 1663 while
`git diff origin/main -- src/` stayed empty. **Neither transfers to this
stage.** These are new files, so the assertion count rises trivially; and the
count is structurally blind to a vacuous assertion, which is how three
`expect(updates).toHaveLength(0)` calls against a _function_ shipped green in
Stage 1 and were caught only on a late re-read.

The risk here is precisely that: a new test that passes without exercising
anything. So the gate is direct. **Every new test must be observed failing
against a deliberately broken production line, recorded as a ledger in the
plan.** A test that cannot be made to fail does not ship.

The specific mutations, one per assertion group:

| Test                | Mutation                                                       |
| ------------------- | -------------------------------------------------------------- |
| rate-limit reset    | `resetAt < NOW()` → `resetAt > NOW()` in both `CASE` arms      |
| rate-limit ceiling  | `count <= maxAttempts` → `count < maxAttempts`                 |
| dispatch gate       | delete `setWhere` from the `onConflictDoUpdate` config         |
| dispatch ceiling    | `attemptCount < MAX_ATTEMPTS` → `attemptCount <= MAX_ATTEMPTS` |
| TOTP replay         | drop the counter comparison from the update's WHERE            |
| side-effects filter | remove the `coalesce(…, '[]'::jsonb)`                          |
| ilike escaping      | drop the `escapeLikePattern` call                              |
| timezone grouping   | remove `AT TIME ZONE` from `groupBy` only, leaving `select`    |

The last one matters: it reproduces the original BST defect shape, where the
projection and the grouping disagree.

`git diff origin/main -- src/` still ends empty, conditional on Decision 5
finding nothing.

## Risks

**Risk 1 — PGlite may not ship the timezone database.** If
`AT TIME ZONE 'Europe/London'` does not resolve, the analytics file leaves
scope. Everything else is unaffected — no other target depends on tz data.
Resolved by Task 1 before any test is written.

**Risk 2 — the migration files may have drifted from `schema.ts`.** Production
schema was pushed, not migrated (recorded in project memory), so the two are
not known to agree. If they have drifted, `migrate()` produces a database that
`schema.ts` queries cannot address, and these tests fail immediately. That is a
genuinely valuable signal about production, and it is also blocking. Fallback:
generate the test schema from `schema.ts` and file the drift separately as its
own finding. Resolved by Task 1.

**Risk 3 — suite time.** 6.4s today. Budget: ≤20s. PGlite boot is the cost and
it is paid per file, so five files is the natural ceiling before mitigation is
needed. If exceeded: snapshot/restore (Decision 2), or consolidate the five
files into fewer.

**Risk 4 — two backings is a fork in the road.** Every future test author now
picks one. Mitigated by a rule stated in CLAUDE.md rather than left to taste:
_use `fake-db` unless the behaviour under test is decided by the database._
Kind A and Kind B above are the test for that.

**Risk 5 — a WASM devDependency.** `@electric-sql/pglite` is pure npm with no
service container and no `DATABASE_URL`, so **CI requires no changes**. The
cost is install size and a new supply-chain surface in devDependencies only; it
never ships to production.

## Task 1 is a go/no-go

Before any test is written: install PGlite, boot it, run the fifteen
migrations, and execute one `AT TIME ZONE 'Europe/London'` query.

- Both succeed → full scope proceeds.
- Timezone fails → drop the analytics file, proceed with four.
- Migrations fail → stop, report the drift, and confirm the `schema.ts`
  fallback before continuing.

## What this still does not prove

Worth being plain, so the next handoff is better than the one this document
corrects.

PGlite is Postgres, but it is not _this_ Postgres. It will not catch Neon
driver quirks, pooling behaviour, `sslmode` handling, or anything that depends
on the HTTP-versus-websocket split that Decision 1 collapses. Nor does it prove
the migration files match the deployed production schema — only that they are
internally consistent and that `schema.ts` can address the result.

Those remain E2E's job, and the `E2E_DATABASE_URL` Neon branch already covers
the driver path.
