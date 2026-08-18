# A Shared Database Seam for Unit Tests — Design

Thirty-three of the sixty-six unit test files mock `$lib/server/db`. Fourteen
also mock `$lib/server/db/schema`. Between them they hand-build twenty-four
private Drizzle fakes, and those fakes do not agree with each other about how a
query is dispatched:

| Dispatch strategy | Files | Example                                                          |
| ----------------- | ----- | ---------------------------------------------------------------- |
| Trivial stub      | 9     | `vi.mock("$lib/server/db", () => ({ db: {} }))` — no query runs  |
| Table agnostic    | 13    | `api/commands.test.ts` ignores `_table`, driven by module `let`s |
| Table identity    | 9     | `api/sync.test.ts` maps a table ref to a name, seeds per table   |
| Call index        | 2     | `reminders.test.ts`: 1st select = schedules, 2nd = events        |

Those four are exclusive and sum to 33. Result priming is a second, orthogonal
axis: five of the files above (`api/apple-route`, `auth-oauth-callback`,
`push-test-notification`, `security-revoke-session`, `reminders`) prime results
by `.shift()`-ing off a queue rather than returning a standing value.

This is the duplication the architecture review flagged. It is real, but it is
the symptom rather than the disease, and the fix is worth scoping against the
disease.

## What the duplication actually costs

**A new database-touching test is expensive enough that people skip writing
one.** `getRefillForecast` is named in CLAUDE.md as the single source of truth
for refill rate. It has no test. It is only ever mocked away. That is the cost,
and it compounds: every new fake is another chance to get Drizzle's chain shape
subtly wrong, in private, where no other test benefits from the fix.

**No unit test in this repository verifies that a query is scoped by
`user_id`.** CLAUDE.md states the invariant plainly — _"All DB queries scoped by
`user_id` — never trust client-provided user context"_ — and almost every fake
is written `where: () => …`, discarding the predicate it was handed. The fakes
return their seeded rows no matter who asked. A regression that dropped a
`user_id` filter would leave all 807 tests green.

Only `reminders.test.ts` and `reminders-dispatch.test.ts` inspect predicates at
all. They do it with a copy-pasted, untested helper called `chunksContain`,
which JSON-stringifies the Drizzle SQL object and substring-matches for a
needle. It works. It exists in two places and is covered by nothing.

## What this design does not attempt

Worth stating early, because the obvious larger moves are all wrong here.

**No production code changes.** A repository port — server modules taking an
injected data interface — would give the cleanest seam and is the wrong trade.
It reshapes shipping code to suit the tests, and it widens the blast radius of a
test-infrastructure change into the application itself. The `vi.mock` boundary
already exists and already works; this design makes it consistent, not
different. The mechanical consequence is that `git diff main..HEAD -- src/`
must be **empty**, and that is a check, not an aspiration.

**No predicate evaluation.** The fake captures predicates; it does not
interpret them. Teaching it `eq`/`and`/`inArray` well enough to filter seeded
rows means re-implementing a query planner against `drizzle-orm` internals,
which then breaks on every ORM upgrade — and it duplicates what stage 2 does
properly by running real SQL.

**No migration of `reminders.test.ts`.** See Decision 6.

## The seam

A single helper at `tests/unit/helpers/fake-db.ts`. It is not collected as a
test — `vite.config.ts` sets `include: ["tests/unit/**/*.test.ts"]`, and the
helper does not match.

```ts
export interface RecordedCall {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  /** Verbatim argument to .where(); undefined when the call had none. */
  predicate?: unknown;
  /** .values(...) for an insert, .set(...) for an update. */
  payload?: Row | Row[];
}

export function createFakeDb(): {
  db: FakeClient;
  dbTx: { transaction: <T>(cb: (tx: FakeClient) => Promise<T>) => Promise<T> };

  seed(table: Table, rows: Row[]): void;
  seedQueue(table: Table, batches: Row[][]): void;
  failNext(op: RecordedCall["op"], opts: { table?: Table; error: Error }): void;
  reset(): void;

  readonly attempted: readonly RecordedCall[];
  readonly committed: readonly RecordedCall[];
};

export function predicateIncludes(predicate: unknown, needle: string): boolean;
```

The chain surface is the union of what the twenty-four fakes collectively
exercise: `select().from().where().limit()/.groupBy()/.orderBy()/.innerJoin()/.leftJoin()`,
`insert().values().onConflictDoNothing()/.onConflictDoUpdate().returning()`,
`update().set().where().returning()`, and `delete().where()`. Every step is both
chainable and awaitable — production code sometimes awaits `.where(...)`
directly and sometimes calls `.limit(...)` on it, which is the trap
`api/sync.test.ts` currently hand-rolls as a `Promise` with a `limit` property
bolted on.

### Decision 1 — table identity comes from Drizzle, not from a mock

The fake resolves a table reference through `getTableName(table)`, exported by
`drizzle-orm`. This was verified against the real schema objects under the CI
placeholder `DATABASE_URL`:

```ts
expect(getTableName(medications)).toBe("medications");
expect(getTableName(doseLogs)).toBe("dose_logs");
expect(getTableName(userPreferences)).toBe("user_preferences");
```

**All fourteen `vi.mock("$lib/server/db/schema", …)` blocks are therefore
deleted.** They exist only to give tables a usable identity — some supply
`{ medications: {} }` placeholders, some supply string names. Migrated tests
import the real schema instead, so they bind to real column definitions. This
removes an entire axis of duplication and makes the tests strictly more
truthful than they are today.

### Decision 2 — predicates are captured and made assertable

Every `.where(cond)` records `cond` verbatim on the call. `chunksContain`
becomes a shared, unit-tested `predicateIncludes`, and its circular-safe
`WeakSet` replacer is required rather than defensive: a naive `JSON.stringify`
of a Drizzle predicate throws `Converting circular structure to JSON` on
`PgTable → PgText → table`. That was confirmed by probe before being written
here.

The security consequence is the point. This assertion now holds:

```ts
await db.select().from(medications).where(eq(medications.userId, "u1"));
expect(predicateIncludes(calls[0].predicate, "user_id")).toBe(true);
```

The `user_id` scoping invariant moves from documented-and-unverified to
assertable. See "The security assertions this unlocks" below.

### Decision 3 — transactions expose two views, because the existing tests need both

Two files make contradictory demands of the same recorded-writes array, and
both are right.

`doses-inventory.test.ts:203` asserts that a write survives a rollback, because
what it is testing is _how far execution got_ before the throw:

```ts
await expect(logDose("u1", "m1", 1)).rejects.toThrow("simulated update failure");
expect(updates.some((u) => u.table === medications)).toBe(true);
expect(auditCalls).toEqual([]); // the throw happened before logAudit
```

`createMedicationWithSchedules.test.ts:140` asserts the opposite — that the
inserts array is _restored_ after a throw — because what it is testing is
Postgres's all-or-nothing commit.

Today each file picks one semantic and can only serve itself. The fake provides
both: **`attempted` is append-only and never rolled back; `committed` is
reverted to its pre-transaction snapshot when the callback throws.** Neither
test loses an assertion, and neither has to compromise.

### Decision 3a — the trivial stubs do not get the full fake

Discovered while planning, and it reverses the obvious move. The nine trivial
stubs mock the database as `{}`, so an accidental query throws
`db.select is not a function` immediately. Putting them on `createFakeDb()`
would make that same accident **silently return `[]`** instead — a real loss of
safety bought with extra machinery, for files that by definition run no query.

They get a shared `unusedDb` export instead, which preserves the loud failure
and improves the message:

```ts
/** For modules that import `db` but must never reach it. Any property
    access throws, so an accidental query fails loudly and by name. */
export const unusedDb = {
  db: throwingProxy("db"),
  dbTx: throwingProxy("dbTx"),
};
```

One pattern in the repository, and the stricter of the two behaviours wins.

### Decision 4 — priming and failure injection are generalised, not invented

`seed(table, rows)` sets a standing result. `seedQueue(table, [rowsA, rowsB])`
serves successive calls, which is what the five `.shift()`-driven files need.
`failNext(op, { table, error })` replaces the ad-hoc `nextInsertThrows`,
`failOnUpdateOf` and `updateShouldRejectOnce` flags. Each of these already
exists in at least one file; none is a new capability.

### Decision 5 — the module singleton, not `vi.hoisted`

`vi.mock` is hoisted above module-level `const`s, which is why every existing
fake uses a hoisted `function buildDb()`. The shared helper sidesteps this
because ES modules are singletons:

```ts
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
import { fakeDb } from "./helpers/fake-db";
```

Both the mock factory and the test body resolve the same instance. Verified by
probe. Vitest's default `isolate: true` gives each test file its own module
registry, so the singleton is per-file, not shared across the suite;
`fakeDb.reset()` in `beforeEach` remains the discipline.

### Decision 6 — `reminders.test.ts` keeps its bespoke fake; `export-pdf-report.test.ts` does not

Two files dispatch by call index, and they are not the same case. The
distinction is whether the ordering is _asserted_ or merely _relied upon to
deliver rows_.

`export-pdf-report.test.ts:98` is the second kind:

```ts
select: () => chain([doseRows, medRows][queryIndex++] ?? []),
```

`queryIndex` appears nowhere in an assertion — it exists only to hand the right
rows to the right query. The two queries read **different tables** (`dose_logs`
and `medications`), so table-identity dispatch delivers exactly the same rows
without depending on order at all. Nothing that was ever asserted is lost, and
an implicit coupling goes away. It migrates.

`reminders.test.ts` is the first kind. It indexes by call number to assert on a
specific query's predicate:

```ts
const aggregatePredicate = whereArgsByCall[1]; // the SECOND select
expect(chunksContain(aggregatePredicate, "skipped")).toBe(true);
```

Its dispatch is brittle by any normal standard, and it is also the only thing
pinning that the schedule query precedes the events query. Migrating it to
table-identity dispatch would make it more robust and would silently delete
that assertion, with the suite staying green throughout — the precise failure
mode that got #110 reverted. It stays as it is, with a comment recording that
the choice is deliberate and what it protects.

## Migration and the gate that makes it safe

Thirty-two files migrate: nine trivial stubs, twenty-three real fakes.

The hazard is specific and this project has already paid for it once. From the
#110 post-mortem: _the tests pinning the old contract were deleted, then the
behaviour they protected was changed — 753 green tests proved nothing._ Here
the harness itself is what changes, so a green suite is close to worthless as
evidence. A shared fake that is more permissive than the hand-rolled one it
replaces will keep every test passing while testing less.

The gate, applied per file:

1. **The helper ships with its own unit tests first.** The harness for the
   harness lands before any test file migrates.
2. **Test names and counts are recorded before and after.** Same names, same
   count, still green — a migration that renames or drops a test is a
   migration that lost an assertion.
3. **Mutation check.** Break the production code the migrated file covers and
   confirm the migrated tests _fail_. This is the house rule from #113–#116; it
   is mandatory here rather than advisable. A test that cannot fail has not
   been migrated, it has been deleted.
4. **Diff discipline.** `git diff main..HEAD -- tests/ | grep '^-' | grep expect`
   should be empty. Any deleted assertion requires a written justification in
   the commit message. This was #114's evidence and it is the right instrument.

Waves, in order: table-identity nine (they already agree with the design), then
table-agnostic eleven, then the trivial stubs.

## Risks

**The eleven table-agnostic files get stricter.** They currently ignore the
table argument entirely; under table-identity dispatch a query against an
unseeded table returns `[]` rather than the primed rows. This will surface
genuine mismatches between what a test claims to set up and what the production
code actually reads. That is a gain, but it means those eleven are not a
mechanical find-and-replace, and they are budgeted as the slowest wave.

**A large diff with no user-visible change.** Thirty-two test files touched to
buy future leverage. The honest justification is the `getRefillForecast` gap
above: the current cost of writing a database-touching test is high enough that
it does not get paid.

**God-object drift.** Mitigated by a hard line rather than good intentions: no
predicate evaluation, no query planning, no result ordering. If the helper wants
to grow past capture-and-seed, the answer is stage 2, not a larger fake.

## The security assertions this unlocks

Bounded deliberately, because it is the one place where new assertions are
nearly free and directly serve the stated invariant. Once predicates are
captured, each migrated file with a user-scoped read gains an assertion that
the read carried a `user_id` predicate. No new test files, no new fixtures —
one assertion appended to reads that already execute.

This is additive: it can only find bugs, never mask them. If it finds one, that
is a separate fix on its own branch, not a widening of this one.

## Stage 2 — real Postgres (separate PR, separate spec)

Out of scope here beyond the handoff. The defects this project has actually
shipped — `jsonb_array_length` returning 0 for `[]`, unescaped `ilike`
wildcards, `numeric` columns arriving as strings, the BST heatmap shift — are
each bugs that no fake can catch, because no fake runs SQL. Stage 2 adds PGlite
and targets the modules where SQL correctness is the risk: analytics, log
search, inventory, import.

The seam built here is what makes that migration incremental rather than a
second rewrite: a file backed by `createFakeDb()` and a file backed by a real
PGlite database differ in their `beforeEach`, not in their assertions.
