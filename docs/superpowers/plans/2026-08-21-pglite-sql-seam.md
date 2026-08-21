# PGlite SQL Seam (Stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real in-process Postgres (PGlite) as a second backing for the existing database seam, and use it to test the eleven behaviours that the database decides and no fake can reach.

**Architecture:** A second helper, `tests/unit/helpers/pg-db.ts`, exports the same `dbMock` surface as `fake-db.ts` and is backed by PGlite with the real Drizzle migrations applied. Test files opt in by changing one `vi.mock` line. Five new test files live under `tests/unit/pg/`. No existing fake-backed file is migrated.

**Tech Stack:** Vitest 4, `@electric-sql/pglite` (new devDependency), `drizzle-orm/pglite`, `drizzle-orm/pglite/migrator`, drizzle-orm 0.45.

**Spec:** `docs/superpowers/specs/2026-08-21-pglite-sql-seam-design.md`

## Global Constraints

- **No production code changes.** `git diff origin/main..HEAD -- src/` must be empty at the end. The only exception is a bug found under Decision 5, which stops that target and is reported, not fixed here.
- **Use `origin/main`, never local `main`,** for every diff and comparison. Local `main` goes stale in this repo.
- **`@electric-sql/pglite` is a devDependency only.** It must never appear in `dependencies`.
- **CI requires no changes.** PGlite needs no service container and no `DATABASE_URL`.
- **Suite budget: ≤20s** (baseline 6.36s, 848 tests / 67 files).
- **Commit messages carry no Claude/AI attribution** — no trailer, no session URL, no `Co-Authored-By`.
- **Never push to `main`, never force-push, never merge.** Work lands on `test/pglite-sql-seam` via PR.
- Branch is already created: `test/pglite-sql-seam`, based on `origin/main` at `514bf57`.

---

## THE VERIFICATION CYCLE — READ THIS BEFORE TASK 3

**This plan is not standard TDD, and following standard TDD here will produce worthless tests.**

Every test from Task 3 onward characterises **production code that already exists and already works**. A newly written test is therefore expected to **pass immediately**. There is no red phase from a missing implementation.

The failure signal comes from mutation instead. For every test:

1. Write the test.
2. Run it. **Expect PASS.** (If it fails, you have found a bug — see Decision 5 below, stop this target and report.)
3. Apply the **named mutation** to the production file.
4. Run it again. **Expect FAIL.** ← this is the actual gate.
5. Revert the mutation with `git checkout -- <production file>`.
6. Run again. **Expect PASS.**
7. Commit.

**If step 4 does not fail, the test is vacuous.** Fix the test until it fails. Do not proceed, and do not commit a test you could not make fail. Stage 1 shipped three assertions that passed vacuously (`expect(updates).toHaveLength(0)` where `updates` was a function — `toHaveLength` checked its arity), and the assertion-count gate was structurally blind to them. Mutation is the only gate that catches this class.

Record each mutation result in the ledger in Task 8.

**Decision 5 (from the spec) — when a test contradicts production:** stop work on that target only, continue with the others, and report the finding with the reproducing test. Do not fix `src/`. Do not rewrite the test to assert the wrong behaviour.

---

## Three gotchas found while writing this plan

These will each cost an hour if discovered the hard way.

**1. PGlite needs the `node` environment, not `jsdom`.** `vitest.config.ts` sets `environment: "jsdom"` globally. PGlite detects `window` and can take a browser code path. **Every file under `tests/unit/pg/` must start with the docblock `// @vitest-environment node`.**

**2. `vi.useFakeTimers()` will hang PGlite.** PGlite's WASM layer uses real `setTimeout` internally; faking all timers stalls it. Where a test needs a frozen clock (Tasks 5 and 7), use **`vi.useFakeTimers({ toFake: ["Date"] })`** so only `Date` is faked and timers keep running.

**3. Real Postgres enforces foreign keys; the fake never did.** `reminder_events` and `dose_logs` both cascade-reference `users` and `medications`. Fixtures must insert user → medication → row, in that order, or the insert is rejected. This is a feature — it proves fixtures are realistic — but it is a behaviour change from every existing test.

Additional environment note: this worktree's `node_modules/` contains only Vite caches; packages currently resolve up to the parent checkout. The first `npm install` here populates a full worktree-local `node_modules` and takes several minutes. That is expected, not a hang.

---

## File Structure

| File                                    | Responsibility                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `tests/unit/helpers/pg-db.ts`           | **Create.** Boots PGlite, applies migrations, exports `dbMock` + `pgDb` harness |
| `tests/unit/helpers/pg-db.test.ts`      | **Create.** Tests the harness itself — migrations, truncation, fixtures         |
| `tests/unit/pg/rate-limit.test.ts`      | **Create.** `checkRateLimit`'s two `CASE` arms                                  |
| `tests/unit/pg/reminders-claim.test.ts` | **Create.** `claimReminderSlot`'s `setWhere` gate                               |
| `tests/unit/pg/auth-totp.test.ts`       | **Create.** The real TOTP compare-and-set                                       |
| `tests/unit/pg/log-search.test.ts`      | **Create.** `jsonb_array_length` + `ilike` escaping                             |
| `tests/unit/pg/analytics-tz.test.ts`    | **Create.** `AT TIME ZONE` grouping (conditional on Task 1)                     |
| `tests/unit/auth-totp.test.ts`          | **Modify.** Drop the bespoke fake and the 4 db-touching tests; use `unusedDb`   |
| `CLAUDE.md`                             | **Modify.** Bespoke-fake count 2 → 1; add the backing-choice rule               |
| `package.json`                          | **Modify.** Add `@electric-sql/pglite` to devDependencies                       |

---

## Task 1: PGlite boots, migrations apply, timezone resolves

This task is a **go/no-go**. It resolves the spec's Risk 1 and Risk 2 before any effort is spent on tests.

**Files:**

- Modify: `package.json`
- Create: `tests/unit/helpers/pg-db.ts`
- Create: `tests/unit/helpers/pg-db.test.ts`

**Interfaces:**

- Produces: `dbMock: { db, dbTx }`, `pgDb: { client, db, reset() }` from `tests/unit/helpers/pg-db.ts`. Tasks 2–7 consume these.

- [ ] **Step 1: Install PGlite**

```bash
npm install --save-dev @electric-sql/pglite
```

Expect a full worktree-local `node_modules` to be created. This takes several minutes on first run.

- [ ] **Step 2: Verify it landed in devDependencies, not dependencies**

```bash
grep -A2 '"devDependencies"' package.json | head -5
grep -c '"@electric-sql/pglite"' package.json
```

Expected: exactly `1` match, and it must sit inside `devDependencies`. If npm put it in `dependencies`, move it.

- [ ] **Step 3: Write the helper**

Create `tests/unit/helpers/pg-db.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../../src/lib/server/db/schema";

/** One PGlite per test FILE. Vitest's default `isolate: true` gives each
    file its own module registry, so this module-level instance is not
    shared across the suite — the same property that makes `fakeDb` a safe
    singleton in fake-db.ts. */
export const client = await PGlite.create();

const database = drizzle(client, { schema });

// Apply the real migrations. This also makes the migration files
// themselves tested — nothing else in the repo verifies they apply
// cleanly in journal order.
await migrate(database, { migrationsFolder: "drizzle" });

/** Empty every table without dropping the schema. Called from beforeEach.
    CASCADE is required because dose_logs and reminder_events carry FK
    references to users and medications. */
export async function reset(): Promise<void> {
  const res = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = res.rows.map((r) => `"${r.tablename}"`);
  if (names.length === 0) return;
  await client.exec(`TRUNCATE TABLE ${names.join(", ")} RESTART IDENTITY CASCADE;`);
}

/** Mirrors fake-db.ts's export shape so a test swaps one vi.mock line.
    Production splits `db` (neon-http, no transactions) from `dbTx`
    (neon-serverless, transactions); PGlite serves both from one instance,
    so a test cannot catch "used a transaction on db". Documented in the
    spec as an accepted fidelity loss. */
export const dbMock = { db: database, dbTx: database };

export const pgDb = { client, db: database, reset };
```

- [ ] **Step 4: Write the feasibility test**

Create `tests/unit/helpers/pg-db.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { pgDb } from "./pg-db";

describe("pg-db harness", () => {
  it("applies every migration, so the schema's tables exist", async () => {
    const res = await pgDb.client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    const names = res.rows.map((r) => r.tablename);
    // A representative slice across several migrations, not an exhaustive
    // list — an exhaustive one would need editing on every future migration.
    expect(names).toEqual(
      expect.arrayContaining([
        "users",
        "medications",
        "dose_logs",
        "rate_limits",
        "reminder_events",
        "medication_schedules",
        "inventory_events",
      ]),
    );
  });

  it("resolves a named IANA timezone (gates the analytics work)", async () => {
    const rows = await pgDb.db.execute(
      sql`select (timestamptz '2026-06-01 23:30:00+00' AT TIME ZONE 'Europe/London')::text as local`,
    );
    // 23:30 UTC on 1 June is 00:30 on 2 June in BST (UTC+1).
    expect((rows.rows[0] as { local: string }).local).toContain("2026-06-02 00:30");
  });

  it("returns numeric columns as strings, as the Neon driver does", async () => {
    const rows = await pgDb.db.execute(sql`select (1.5)::numeric as n`);
    expect(typeof (rows.rows[0] as { n: unknown }).n).toBe("string");
  });
});
```

- [ ] **Step 5: Run the feasibility test — this is the go/no-go**

```bash
npx vitest run tests/unit/helpers/pg-db.test.ts
```

Interpret the result:

- **All three pass** → full scope proceeds. Continue to Task 2.
- **Migration test fails** → the migration files have drifted from `schema.ts` (spec Risk 2). **STOP.** Report the exact error and confirm the `schema.ts` fallback with the user before doing anything else.
- **Timezone test fails** → PGlite lacks tz data (spec Risk 1). Drop **Task 7** from scope and continue with four test files. Record the decision in the Task 8 ledger.
- **Numeric test fails** → note it and continue; it changes no target in this plan but contradicts a CLAUDE.md invariant and is worth reporting.

- [ ] **Step 6: Measure the cost of one PGlite file**

```bash
npx vitest run tests/unit/helpers/pg-db.test.ts 2>&1 | tail -5
```

Record the duration. If a single file exceeds ~8s, raise it before continuing — five such files would breach the 20s budget and Decision 2's snapshot/restore fallback should be considered instead.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tests/unit/helpers/pg-db.ts tests/unit/helpers/pg-db.test.ts
git commit -m "test(pg-db): add a PGlite backing for the database seam

Boots one PGlite per test file and applies the real drizzle
migrations, which also makes those migration files tested for the
first time. Exports the same dbMock shape as fake-db.ts so a test
opts in by changing one vi.mock line.

The three tests are the feasibility gate from the spec: migrations
apply, a named IANA timezone resolves, and numeric comes back as a
string the way the Neon driver returns it."
```

---

## Task 2: Fixtures that satisfy referential integrity

Real Postgres rejects a dose log whose user does not exist. Every later task needs valid parent rows, so the fixtures live here once.

**Files:**

- Modify: `tests/unit/helpers/pg-db.ts`
- Modify: `tests/unit/helpers/pg-db.test.ts`

**Interfaces:**

- Consumes: `pgDb`, `dbMock` from Task 1.
- Produces: `seedUser(overrides?) => Promise<UserRow>`, `seedMedication(overrides?) => Promise<MedRow>`, `seedDose(overrides?) => Promise<DoseRow>`. Defaults are `u1` / `m1`; each returns the row it inserted.

- [ ] **Step 1: Add the fixtures to the helper**

Append to `tests/unit/helpers/pg-db.ts`:

```ts
/** Fixtures. Defaults satisfy every NOT NULL column so a caller
    overrides only what the test is actually about. Insert order matters:
    medications reference users, dose_logs reference both. */

export async function seedUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const row = {
    id: "u1",
    email: "u1@example.com",
    name: "Test User",
    ...overrides,
  } satisfies typeof schema.users.$inferInsert;
  await database.insert(schema.users).values(row).onConflictDoNothing();
  return row;
}

export async function seedMedication(
  overrides: Partial<typeof schema.medications.$inferInsert> = {},
) {
  const row = {
    id: "m1",
    userId: "u1",
    name: "Test Med",
    // numeric NOT NULL — Drizzle takes a string here and returns one.
    dosageAmount: "1",
    dosageUnit: "mg",
    form: "tablet",
    category: "other",
    colour: "#ffffff",
    ...overrides,
  } satisfies typeof schema.medications.$inferInsert;
  await database.insert(schema.medications).values(row).onConflictDoNothing();
  return row;
}

let doseSeq = 0;

export async function seedDose(overrides: Partial<typeof schema.doseLogs.$inferInsert> = {}) {
  doseSeq += 1;
  const row = {
    id: `d${doseSeq}`,
    userId: "u1",
    medicationId: "m1",
    takenAt: new Date("2026-08-01T08:00:00Z"),
    ...overrides,
  } satisfies typeof schema.doseLogs.$inferInsert;
  await database.insert(schema.doseLogs).values(row);
  return row;
}
```

Then extend the `pgDb` export to include them:

```ts
export const pgDb = { client, db: database, reset, seedUser, seedMedication, seedDose };
```

- [ ] **Step 2: Add harness tests**

Append to `tests/unit/helpers/pg-db.test.ts`:

```ts
describe("pg-db fixtures", () => {
  beforeEach(async () => {
    await pgDb.reset();
  });

  it("seeds a user, medication and dose that satisfy the foreign keys", async () => {
    await pgDb.seedUser();
    await pgDb.seedMedication();
    await pgDb.seedDose();

    const rows = await pgDb.db.select().from(doseLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u1");
    expect(rows[0].medicationId).toBe("m1");
  });

  it("rejects a dose whose medication does not exist", async () => {
    await pgDb.seedUser();
    // No medication seeded — the FK must reject this. The old fake
    // accepted anything, which is exactly the fidelity this buys.
    await expect(pgDb.seedDose({ medicationId: "nope" })).rejects.toThrow();
  });

  it("reset() empties every table between tests", async () => {
    await pgDb.seedUser();
    await pgDb.reset();
    const rows = await pgDb.db.select().from(users);
    expect(rows).toHaveLength(0);
  });
});
```

Add the imports this needs at the top of the file:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { users, doseLogs } from "../../../src/lib/server/db/schema";
```

- [ ] **Step 3: Run**

```bash
npx vitest run tests/unit/helpers/pg-db.test.ts
```

Expected: all 6 tests pass. The FK-rejection test is the one that proves fixtures are real; if it passes trivially, check that `seedDose` is not swallowing the error.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/helpers/pg-db.ts tests/unit/helpers/pg-db.test.ts
git commit -m "test(pg-db): add fixtures that satisfy referential integrity

Real Postgres enforces the cascade FKs that dose_logs and
reminder_events carry; the fake never did. Fixtures insert
user then medication then dose, and a test asserts the FK
actually rejects an orphan."
```

---

## Task 3: `checkRateLimit`'s two CASE arms

The login brute-force control. **It has no test today** — both callers (`auth-login-action.test.ts`, `auth-2fa-action.test.ts`) mock the whole module away, and its entire behaviour is two SQL `CASE` expressions whose results come back as `row.count` and `row.resetAt`.

**Files:**

- Create: `tests/unit/pg/rate-limit.test.ts`
- Mutation target: `src/lib/server/auth/rate-limit.ts:18-25`

**Interfaces:**

- Consumes: `dbMock`, `pgDb` from Tasks 1–2.
- Under test: `checkRateLimit(key: string, maxAttempts?: number, windowMs?: number) => Promise<{ allowed: boolean; retryAfterMs: number }>`.

- [ ] **Step 1: Write the test file**

Create `tests/unit/pg/rate-limit.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { rateLimits } from "../../../src/lib/server/db/schema";

// Real Postgres, not the fake: every assertion below is about what the
// two CASE arms in the upsert evaluate to, which a fake cannot produce.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { checkRateLimit } = await import("../../../src/lib/server/auth/rate-limit");

beforeEach(async () => {
  await pgDb.reset();
});

describe("checkRateLimit — counting inside the window", () => {
  it("increments on each attempt and denies once the ceiling is passed", async () => {
    const key = "login:u1";
    expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(true); // count 1
    expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(true); // count 2
    expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(true); // count 3
    expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(false); // count 4
  });

  it("does not extend the window when an attempt is made inside it", async () => {
    const key = "login:u1";
    const original = new Date(Date.now() + 60_000);
    await pgDb.db.insert(rateLimits).values({ key, count: 1, resetAt: original });

    await checkRateLimit(key, 5, 15 * 60_000);

    const [row] = await pgDb.db.select().from(rateLimits).where(eq(rateLimits.key, key));
    // The ELSE arm keeps the original resetAt. If it did not, an attacker
    // could push their own lockout further out by continuing to hammer.
    expect(row.resetAt.getTime()).toBe(original.getTime());
    expect(row.count).toBe(2);
  });
});

describe("checkRateLimit — window expiry", () => {
  it("resets the counter to 1 once resetAt is in the past", async () => {
    const key = "login:u1";
    await pgDb.db.insert(rateLimits).values({
      key,
      count: 99,
      resetAt: new Date(Date.now() - 1_000),
    });

    const result = await checkRateLimit(key, 5, 60_000);

    // 99 attempts, but the window had expired: the CASE resets to 1 and
    // the caller is allowed through.
    expect(result.allowed).toBe(true);
    const [row] = await pgDb.db.select().from(rateLimits).where(eq(rateLimits.key, key));
    expect(row.count).toBe(1);
    expect(row.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps separate keys independent", async () => {
    await checkRateLimit("login:u1", 1, 60_000);
    await checkRateLimit("login:u1", 1, 60_000);
    // u2 is untouched by u1 exhausting its allowance.
    expect((await checkRateLimit("login:u2", 1, 60_000)).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx vitest run tests/unit/pg/rate-limit.test.ts
```

Expected: 4 passed. If any fail, you have found a bug in a security control — **stop, do not fix `src/`, report it** (Decision 5).

- [ ] **Step 3: Mutation A — break the window-expiry comparison**

In `src/lib/server/auth/rate-limit.ts`, change **both** `CASE` arms from `< NOW()` to `> NOW()`:

```ts
        count: sql`CASE
          WHEN ${rateLimits.resetAt} > NOW() THEN 1
          ELSE ${rateLimits.count} + 1
        END`,
        resetAt: sql`CASE
          WHEN ${rateLimits.resetAt} > NOW() THEN ${windowEnd}
          ELSE ${rateLimits.resetAt}
        END`,
```

- [ ] **Step 4: Run — expect FAIL**

```bash
npx vitest run tests/unit/pg/rate-limit.test.ts
```

Expected: "resets the counter to 1 once resetAt is in the past" FAILS (count stays 100, `allowed` false). If it passes, the test is vacuous — fix it before continuing.

- [ ] **Step 5: Revert**

```bash
git checkout -- src/lib/server/auth/rate-limit.ts
```

- [ ] **Step 6: Mutation B — break the ceiling comparison**

In the same file, change the return line from `<=` to `<`:

```ts
return { allowed: row.count < maxAttempts, retryAfterMs };
```

- [ ] **Step 7: Run — expect FAIL**

Expected: "increments on each attempt and denies once the ceiling is passed" FAILS at the third call (count 3 is no longer allowed).

- [ ] **Step 8: Revert and confirm green**

```bash
git checkout -- src/lib/server/auth/rate-limit.ts
npx vitest run tests/unit/pg/rate-limit.test.ts
```

Expected: 4 passed, and `git diff origin/main..HEAD -- src/` is empty.

- [ ] **Step 9: Commit**

```bash
git add tests/unit/pg/rate-limit.test.ts
git commit -m "test(rate-limit): cover the CASE window reset against real Postgres

checkRateLimit had no test at all: both callers mock the module
away, and its whole behaviour is two SQL CASE arms whose results
arrive as row.count and row.resetAt. No fake can produce those.

Covers the increment path, the ceiling boundary, key independence,
and the reset arm — including that an attempt inside the window
does not push resetAt further out.

Mutations verified failing: '< NOW()' flipped to '> NOW()' in both
arms; 'count <= maxAttempts' narrowed to '<'."
```

---

## Task 4: `claimReminderSlot`'s `setWhere` gate

Stage 1 added `RecordedCall.conflict` because this upsert is the dedupe mechanism — but capturing a predicate proves only that it was **sent**, not that it **blocks**. Three clauses gate the reclaim and nothing verifies any of them.

**Files:**

- Create: `tests/unit/pg/reminders-claim.test.ts`
- Mutation target: `src/lib/server/reminders/dispatch.ts:89`

**Interfaces:**

- Consumes: `dbMock`, `pgDb` from Tasks 1–2.
- Under test: `claimReminderSlot({ userId, medicationId, reminderType, dedupeKey }) => Promise<{ id: string; attemptCount: number } | null>`; constants `MAX_ATTEMPTS = 3`, `RETRY_DELAY_MS = 30 * 60 * 1000`.

- [ ] **Step 1: Write the test file**

Create `tests/unit/pg/reminders-claim.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx vitest run tests/unit/pg/reminders-claim.test.ts
```

Expected: 5 passed. Any failure is a bug in reminder delivery — stop and report (Decision 5).

- [ ] **Step 3: Mutation A — delete the gate entirely**

In `src/lib/server/reminders/dispatch.ts`, remove the whole `setWhere:` line from the `onConflictDoUpdate` config.

- [ ] **Step 4: Run — expect FAIL**

Expected: all three "gate refusing" tests FAIL — every slot becomes reclaimable. This is the assertion Stage 1 could not make.

- [ ] **Step 5: Revert**

```bash
git checkout -- src/lib/server/reminders/dispatch.ts
```

- [ ] **Step 6: Mutation B — loosen the attempt ceiling**

Change `${reminderEvents.attemptCount} < ${MAX_ATTEMPTS}` to `<=` inside `setWhere`.

- [ ] **Step 7: Run — expect FAIL**

Expected: "refuses once attemptCount has reached MAX_ATTEMPTS" FAILS. This isolates the ceiling clause from the status clause — mutation A alone could not tell them apart.

- [ ] **Step 8: Revert and confirm green**

```bash
git checkout -- src/lib/server/reminders/dispatch.ts
npx vitest run tests/unit/pg/reminders-claim.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add tests/unit/pg/reminders-claim.test.ts
git commit -m "test(reminders): prove the claim gate actually blocks

Stage 1 captured this upsert's setWhere in RecordedCall.conflict,
which shows the predicate was sent but not that it blocks anything.
Under real Postgres the three clauses are exercised separately:
already-sent, attempt ceiling, and cooldown — plus a positive
control that a failed slot past its cooldown IS reclaimable, so a
gate hard-coded to false could not pass this file.

Mutations verified failing: setWhere deleted; attempt ceiling
loosened from < to <=."
```

---

## Task 5: The real TOTP compare-and-set

This retires a documented Stage 1 exception. `auth-totp.test.ts` keeps a bespoke fake **because** its update simulates the production WHERE clause, and that simulation is the entire mechanism behind its replay test. Under real Postgres the actual clause runs.

**Files:**

- Create: `tests/unit/pg/auth-totp.test.ts`
- Modify: `tests/unit/auth-totp.test.ts` (remove the bespoke fake and the 4 db-touching tests)
- Modify: `CLAUDE.md` (bespoke-fake count 2 → 1)
- Mutation target: `src/lib/server/auth/totp.ts:83`

**Interfaces:**

- Consumes: `dbMock`, `pgDb` from Tasks 1–2.
- Under test: `verifyAndConsumeTOTPCode(userId: string, code: string) => Promise<boolean>`, `currentTOTPStep() => number`, `generateTOTPSecret()`, `encryptTOTPSecret(secret: string)`.

- [ ] **Step 1: Write the PGlite-backed test file**

Create `tests/unit/pg/auth-totp.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { generateTOTP } from "@oslojs/otp";
import { decodeBase32 } from "@oslojs/encoding";
import { eq } from "drizzle-orm";
import { users } from "../../../src/lib/server/db/schema";

vi.mock("$env/dynamic/private", () => ({
  env: { ENCRYPTION_KEY: "test-key-totp" },
}));

// The replay guard is a conditional UPDATE:
//   WHERE id = $1 AND (totp_last_counter IS NULL OR totp_last_counter < $2)
// Stage 1's seam captures predicates without evaluating them, which is why
// the sibling file had to simulate this clause by hand. Here it really runs.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { generateTOTPSecret, encryptTOTPSecret, verifyAndConsumeTOTPCode, currentTOTPStep } =
  await import("../../../src/lib/server/auth/totp");

function currentCode(secret: string): string {
  return generateTOTP(decodeBase32(secret), 30, 6);
}

beforeAll(() => {
  // Fake ONLY Date. Faking timers wholesale stalls PGlite's WASM layer,
  // which uses real setTimeout internally.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
});

async function seedUserWithSecret(secret: string, totpLastCounter: number | null = null) {
  await pgDb.seedUser({ totpSecret: encryptTOTPSecret(secret), totpLastCounter });
}

async function storedCounter(): Promise<number | null> {
  const [row] = await pgDb.db.select().from(users).where(eq(users.id, "u1"));
  return row.totpLastCounter;
}

describe("verifyAndConsumeTOTPCode against real Postgres", () => {
  it("accepts a valid code and stamps the step", async () => {
    const secret = generateTOTPSecret();
    await seedUserWithSecret(secret);

    expect(await verifyAndConsumeTOTPCode("u1", currentCode(secret))).toBe(true);
    expect(await storedCounter()).toBe(currentTOTPStep());
  });

  it("rejects a replay of the same code, via the real WHERE clause", async () => {
    const secret = generateTOTPSecret();
    await seedUserWithSecret(secret);
    const code = currentCode(secret);

    expect(await verifyAndConsumeTOTPCode("u1", code)).toBe(true);
    // The second attempt fails the `totp_last_counter < step` predicate in
    // Postgres itself. No simulation involved.
    expect(await verifyAndConsumeTOTPCode("u1", code)).toBe(false);
  });

  it("rejects a code whose step is older than the stored counter", async () => {
    const secret = generateTOTPSecret();
    // Counter already ahead of the current step.
    await seedUserWithSecret(secret, currentTOTPStep() + 5);

    expect(await verifyAndConsumeTOTPCode("u1", currentCode(secret))).toBe(false);
    expect(await storedCounter()).toBe(currentTOTPStep() + 5);
  });

  it("returns false when the user has no totp secret", async () => {
    await pgDb.seedUser();
    expect(await verifyAndConsumeTOTPCode("u1", "123456")).toBe(false);
  });

  it("lets only one of two concurrent consumes of the same step win", async () => {
    const secret = generateTOTPSecret();
    await seedUserWithSecret(secret);
    const code = currentCode(secret);

    const results = await Promise.all([
      verifyAndConsumeTOTPCode("u1", code),
      verifyAndConsumeTOTPCode("u1", code),
    ]);

    // The compare-and-set is what makes this deterministic. A read-then-write
    // would let both through.
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx vitest run tests/unit/pg/auth-totp.test.ts
```

Expected: 5 passed. The concurrency test is the one most likely to surface something real; if it fails, stop and report (Decision 5).

- [ ] **Step 3: Mutation — drop the counter comparison**

In `src/lib/server/auth/totp.ts:83`, reduce the WHERE to the id alone:

```ts
    .where(eq(users.id, userId))
```

- [ ] **Step 4: Run — expect FAIL**

Expected: "rejects a replay", "rejects a code whose step is older", and the concurrency test all FAIL.

- [ ] **Step 5: Revert**

```bash
git checkout -- src/lib/server/auth/totp.ts
```

- [ ] **Step 6: Strip the bespoke fake from the sibling file**

In `tests/unit/auth-totp.test.ts`:

1. Delete the entire `dbState` object and the `vi.mock("$lib/server/db", () => { ... })` block, including the explanatory comment above it (lines ~11–60).
2. Replace with:

```ts
// The remaining tests in this file are pure crypto and encoding — no
// database is reached. unusedDb THROWS on any property access, so if that
// ever stops being true the failure is loud and named. The database-backed
// tests for verifyAndConsumeTOTPCode live in tests/unit/pg/auth-totp.test.ts,
// where the compare-and-set runs against real Postgres instead of a
// simulation of it.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
```

3. Delete the whole `describe("verifyAndConsumeTOTPCode", ...)` block — all four of its tests now live in the PGlite file.
4. Remove `verifyAndConsumeTOTPCode` and `currentTOTPStep` from the destructured import if nothing else references them, and drop the now-unused `nextInvalidCode` helper and any now-unused imports (`beforeEach` may become unused).

- [ ] **Step 7: Run the sibling file — expect 7 passing, 0 failing**

```bash
npx vitest run tests/unit/auth-totp.test.ts
```

Expected: 7 tests pass (`generateTOTPSecret`, three `verifyTOTPCode`, `getTOTPUri`, `generateQRDataUrl` — count them; the four db-backed ones are gone). If it errors with "Unexpected db.…", a remaining test does reach the database and must move to the PGlite file rather than be given a working fake.

- [ ] **Step 8: Update CLAUDE.md**

Find the sentence beginning **"Exactly two files keep a bespoke fake"** in the fake-db paragraph. Replace that sentence and its `auth-totp.test.ts` clause with:

```
**Exactly one file keeps a bespoke fake, on purpose and commented in place:**
`reminders.test.ts` asserts on `whereArgsByCall[1]`, so table dispatch would
delete that ordering assertion while leaving the suite green. `auth-totp.test.ts`
used to be the second: its update simulated the production WHERE clause, and
that compare-and-set is the entire mechanism behind its replay-rejection test.
That simulation is gone — the real clause now runs against PGlite in
`tests/unit/pg/auth-totp.test.ts`, and the file itself is on `unusedDb`.
```

- [ ] **Step 9: Run both files and commit**

```bash
npx vitest run tests/unit/auth-totp.test.ts tests/unit/pg/auth-totp.test.ts
git add tests/unit/pg/auth-totp.test.ts tests/unit/auth-totp.test.ts CLAUDE.md
git commit -m "test(totp): run the replay guard against real Postgres

The replay guard is a conditional UPDATE, and Stage 1's seam captures
predicates without evaluating them — so auth-totp.test.ts had to
simulate the WHERE clause by hand, which CLAUDE.md recorded as a
deliberate exception. That simulation is now deleted: the four
database-backed tests move to a PGlite file where the real clause
runs, and the original file drops to unusedDb because everything left
in it is pure crypto.

Adds a case the simulation could not express: two concurrent consumes
of the same step, where exactly one must win.

Mutation verified failing: counter comparison dropped from the WHERE."
```

---

## Task 6: `jsonb_array_length` and `ilike` escaping

Both are named in CLAUDE.md as shipped-bug classes. Both live in the log page's `load`, which is reachable without touching production code — `log-dose-actions.test.ts` already imports that module to exercise its `actions`.

**Files:**

- Create: `tests/unit/pg/log-search.test.ts`
- Mutation target: `src/routes/(app)/log/+page.server.ts:46` and `:49`

**Interfaces:**

- Consumes: `dbMock`, `pgDb` from Tasks 1–2.
- Under test: `load({ locals, url, parent })` returning `{ doses, medications, page, hasMore, filters, timezone }`.

**⚠ Read before writing the mutation step.** The obvious mutation for the side-effects filter — deleting the `coalesce` — **does not change behaviour**, because `jsonb_array_length(NULL)` yields `NULL`, and a `NULL` in a `WHERE` is filtered out exactly as `false` is. Both forms exclude a null row. The mutation that actually captures the defect is replacing the whole condition with an `IS NOT NULL` check, which is the naive filter the `coalesce` form exists to avoid: that wrongly includes rows holding `[]`. Use the mutation as written in Step 3.

- [ ] **Step 1: Write the test file**

Create `tests/unit/pg/log-search.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { load } = await import("../../../src/routes/(app)/log/+page.server");

const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } };
const parent = async () => ({ preferences: { doseLogPageSize: 20 } });

function loadWith(query: string) {
  return load({
    locals,
    url: new URL(`http://x/log?${query}`),
    parent,
  } as never) as Promise<{ doses: Array<{ id: string }> }>;
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication();
});

describe("side-effects filter", () => {
  beforeEach(async () => {
    await pgDb.seedDose({ id: "none", sideEffects: null });
    await pgDb.seedDose({ id: "empty", sideEffects: [] });
    await pgDb.seedDose({
      id: "some",
      sideEffects: [{ name: "nausea", severity: "mild" }],
    });
  });

  it("returns every dose when the filter is off", async () => {
    const { doses } = await loadWith("");
    expect(doses.map((d) => d.id).sort()).toEqual(["empty", "none", "some"]);
  });

  it("excludes both null AND empty-array side effects", async () => {
    const { doses } = await loadWith("withSideEffects=true");
    // jsonb_array_length returns 0 for [], not null — so an IS NOT NULL
    // filter would wrongly keep the 'empty' row.
    expect(doses.map((d) => d.id)).toEqual(["some"]);
  });
});

describe("notes search escaping", () => {
  beforeEach(async () => {
    await pgDb.seedDose({ id: "pct", notes: "felt 100% better" });
    await pgDb.seedDose({ id: "plain", notes: "felt better" });
    await pgDb.seedDose({ id: "under", notes: "dose_missed once" });
  });

  it("treats % in a search term as a literal, not a wildcard", async () => {
    const { doses } = await loadWith("q=100%25"); // %25 is an encoded '%'
    expect(doses.map((d) => d.id)).toEqual(["pct"]);
  });

  it("treats _ in a search term as a literal, not a single-char wildcard", async () => {
    const { doses } = await loadWith("q=dose_missed");
    expect(doses.map((d) => d.id)).toEqual(["under"]);
  });

  it("still matches an ordinary substring, case-insensitively", async () => {
    const { doses } = await loadWith("q=FELT");
    // Only pct ("felt 100% better") and plain ("felt better") contain it;
    // under ("dose_missed once") does not. This is the positive control —
    // without it, escaping that matched nothing at all would pass.
    expect(doses.map((d) => d.id).sort()).toEqual(["pct", "plain"]);
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx vitest run tests/unit/pg/log-search.test.ts
```

Expected: 5 passed. A failure here is a live bug in log filtering — stop and report (Decision 5).

- [ ] **Step 3: Mutation A — the naive side-effects filter**

In `src/routes/(app)/log/+page.server.ts:46`, replace the condition with the naive form:

```ts
conditions.push(sql`${doseLogs.sideEffects} is not null`);
```

- [ ] **Step 4: Run — expect FAIL**

Expected: "excludes both null AND empty-array side effects" FAILS, returning `["empty", "some"]`. That is precisely the shipped defect this filter guards against.

- [ ] **Step 5: Revert**

```bash
git checkout -- "src/routes/(app)/log/+page.server.ts"
```

- [ ] **Step 6: Mutation B — drop the LIKE escaping**

At line 49, use the raw term:

```ts
conditions.push(ilike(doseLogs.notes, `%${f.q}%`));
```

- [ ] **Step 7: Run — expect FAIL**

Expected: both "% is a literal" and "\_ is a literal" FAIL — the unescaped wildcards match rows they should not.

- [ ] **Step 8: Revert and confirm green**

```bash
git checkout -- "src/routes/(app)/log/+page.server.ts"
npx vitest run tests/unit/pg/log-search.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add tests/unit/pg/log-search.test.ts
git commit -m "test(log): cover the side-effects filter and LIKE escaping

Two defect classes named in CLAUDE.md, neither reachable with a fake
because both are decided by SQL. jsonb_array_length returns 0 for an
empty array rather than null, so the coalesce form has to exclude
both; and an unescaped % in a search term matches everything.

Reaching these needed no production change — log-dose-actions.test.ts
already imports this route module for its actions, so this imports
load the same way.

Mutations verified failing: the filter replaced with a naive
'is not null'; escapeLikePattern dropped from the ilike term. Note
that merely deleting the coalesce does NOT fail, since
jsonb_array_length(null) is null and a null WHERE result is filtered
out anyway — the naive form is the mutation that reproduces the bug."
```

---

## Task 7: Analytics timezone grouping

**Conditional on Task 1 Step 5.** If the timezone test failed there, skip this task entirely and record that in the Task 8 ledger.

**Files:**

- Create: `tests/unit/pg/analytics-tz.test.ts`
- Mutation target: `src/lib/server/analytics.ts:150`

**Interfaces:**

- Consumes: `dbMock`, `pgDb` from Tasks 1–2.
- Under test: `getDailyDoseCounts(userId, days, timezone, filter?)`, `getTimeOfDayDistribution(...)`, `getDayOfWeekDistribution(...)`.

- [ ] **Step 1: Write the test file**

Create `tests/unit/pg/analytics-tz.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { getDailyDoseCounts, getTimeOfDayDistribution, getDayOfWeekDistribution } =
  await import("../../../src/lib/server/analytics");

beforeAll(() => {
  // Date only — faking all timers stalls PGlite. Mid-June, so British
  // Summer Time (UTC+1) is in effect and the window covers the fixtures.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication();
});

describe("daily grouping across a BST offset", () => {
  it("counts a late-evening UTC dose as the NEXT local day in London", async () => {
    // 23:30 UTC on 1 June is 00:30 on 2 June in BST.
    await pgDb.seedDose({ takenAt: new Date("2026-06-01T23:30:00Z") });

    const rows = await getDailyDoseCounts("u1", 30, "Europe/London");

    expect(rows).toHaveLength(1);
    expect(rows[0].date).toContain("2026-06-02");
    expect(rows[0].count).toBe(1);
  });

  it("counts the same instant as 1 June under UTC", async () => {
    await pgDb.seedDose({ takenAt: new Date("2026-06-01T23:30:00Z") });

    const rows = await getDailyDoseCounts("u1", 30, "UTC");

    expect(rows[0].date).toContain("2026-06-01");
  });

  it("keeps two doses either side of local midnight on separate days", async () => {
    await pgDb.seedDose({ id: "before", takenAt: new Date("2026-06-01T22:00:00Z") }); // 23:00 BST, 1 June
    await pgDb.seedDose({ id: "after", takenAt: new Date("2026-06-01T23:30:00Z") }); // 00:30 BST, 2 June

    const rows = await getDailyDoseCounts("u1", 30, "Europe/London");

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
  });
});

describe("hour and day-of-week extraction", () => {
  it("reports the LOCAL hour, not the UTC hour", async () => {
    await pgDb.seedDose({ takenAt: new Date("2026-06-10T08:15:00Z") }); // 09:15 BST

    const rows = await getTimeOfDayDistribution("u1", 30, "Europe/London");

    expect(rows).toHaveLength(1);
    expect(rows[0].hour).toBe(9);
  });

  it("reports the LOCAL day of week when the offset rolls the date over", async () => {
    // 23:30 UTC Monday 1 June is 00:30 Tuesday 2 June in BST.
    await pgDb.seedDose({ takenAt: new Date("2026-06-01T23:30:00Z") });

    const rows = await getDayOfWeekDistribution("u1", 30, "Europe/London");

    // Postgres extract(dow): Sunday = 0, so Tuesday = 2.
    expect(rows[0].dayOfWeek).toBe(2);
  });
});
```

- [ ] **Step 2: Verify the calendar assumption before trusting a failure**

```bash
node -e "console.log(new Date('2026-06-01T23:30:00Z').toUTCString())"
node -e "console.log(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'long',day:'numeric',month:'long'}).format(new Date('2026-06-01T23:30:00Z')))"
```

Confirm the second prints **Tuesday 2 June**. If it does not, correct the expected `dayOfWeek` and dates in the test rather than assuming production is wrong.

- [ ] **Step 3: Run — expect PASS**

```bash
npx vitest run tests/unit/pg/analytics-tz.test.ts
```

Expected: 5 passed. A failure is a live analytics defect — stop and report (Decision 5). The BST heatmap shift is a known historical bug in this project, so treat a failure here as plausible rather than surprising.

- [ ] **Step 4: Mutation — make projection and grouping disagree**

In `src/lib/server/analytics.ts:150`, drop the timezone from the `groupBy` only, leaving the `select` at line 145 intact:

```ts
    .groupBy(sql`date(${doseLogs.takenAt})`)
```

This reproduces the original defect's exact shape: the projected value and the grouping key disagree.

- [ ] **Step 5: Run — expect FAIL**

Expected: a Postgres error ("column must appear in the GROUP BY clause") or wrong day buckets. Either is a valid failure. If it passes, the test is not actually reading the grouped output — fix it.

- [ ] **Step 6: Revert and confirm green**

```bash
git checkout -- src/lib/server/analytics.ts
npx vitest run tests/unit/pg/analytics-tz.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add tests/unit/pg/analytics-tz.test.ts
git commit -m "test(analytics): pin timezone grouping across a BST boundary

date(), extract(hour) and extract(dow) are all applied AT TIME ZONE,
and nothing verified the result — a fake returns its seeded rows
whatever the SQL says. Covers a late-evening UTC dose landing on the
next local day in London while staying on the same day under UTC,
plus local hour and local day-of-week.

Mutation verified failing: AT TIME ZONE removed from groupBy while
left in the projection, which is the shape of the original defect."
```

---

## Task 8: Document the rule, verify everything, open the PR

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-08-21-pglite-sql-seam.md` (append the ledger)

- [ ] **Step 1: Add the backing-choice rule to CLAUDE.md**

Immediately after the existing `fake-db.ts` paragraph, add:

```
- **`tests/unit/helpers/pg-db.ts` is the second backing, and the choice between
  them is a rule, not a preference.** Use `fake-db` unless the behaviour under
  test is decided by the database — a predicate that gates whether a write
  happens (`checkRateLimit`'s `CASE` arms, `claimReminderSlot`'s `setWhere`, the
  TOTP compare-and-set), or SQL semantics a fixture cannot model
  (`jsonb_array_length` on `[]`, `ilike` escaping, `AT TIME ZONE` grouping).
  Everything else stays on the fake, which is an order of magnitude faster.
  PGlite files live in `tests/unit/pg/`, must carry the
  `// @vitest-environment node` docblock (the suite default is jsdom, which
  sends PGlite down a browser path), and must use
  `vi.useFakeTimers({ toFake: ["Date"] })` if they need a frozen clock —
  faking all timers stalls PGlite's WASM layer. Real Postgres enforces the
  cascade foreign keys that `fake-db` ignored, so fixtures seed user →
  medication → row via `pgDb.seedUser/seedMedication/seedDose`.
```

- [ ] **Step 2: Confirm zero production change**

```bash
git diff origin/main..HEAD --stat -- src/
```

Expected: **no output**. If anything appears, a mutation was not reverted — revert it now. This is a hard gate.

- [ ] **Step 3: Run the full suite and check the budget**

```bash
npx vitest run 2>&1 | tail -8
```

Expected: 72 files (67 + 5 new; 6 if Task 7 was skipped), all passing. Duration must be **≤20s** against the 6.36s baseline. If it exceeds, apply Decision 2's snapshot/restore fallback inside `pg-db.ts` before opening the PR.

- [ ] **Step 4: Typecheck, lint, format**

```bash
npm run check
npx eslint tests/unit
npx prettier --check "tests/**/*.ts" CLAUDE.md docs/superpowers/plans/*.md
```

Expected: 0 errors from each. `svelte-check` catches signature mismatches that Vitest cannot — Stage 1 found zero-arg chain methods this way.

- [ ] **Step 5: Confirm coverage thresholds still pass**

```bash
npm run test:coverage 2>&1 | tail -15
```

Expected: all four metrics at or above 30 / 25 / 25.5 / 30. Coverage should rise, since these tests execute real query paths that were previously mocked out.

- [ ] **Step 6: Append the mutation ledger to this plan**

Add a `## Progress` section recording, for each mutation in Tasks 3–7: the file, the change, and the exact tests observed failing. Also record the Task 1 go/no-go outcome, the measured single-file PGlite cost, and whether Task 7 ran or was skipped.

This ledger is the evidence that the suite is not vacuously green. Without it the PR has no defensible claim, because assertion counts do not transfer to new files.

- [ ] **Step 7: Commit and push**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-08-21-pglite-sql-seam.md
git commit -m "docs: record the backing-choice rule and the mutation ledger"
git push -u origin test/pglite-sql-seam
```

- [ ] **Step 8: Open the PR**

Title: `test: run SQL-resident logic against real Postgres`

The body must lead with what the tests buy, not with the tooling:

- `checkRateLimit` had **no test at all**; it does now.
- `claimReminderSlot`'s gate was captured but never evaluated; the three clauses are now exercised separately, with a positive control.
- The TOTP bespoke fake is deleted, retiring a documented Stage 1 exception.
- Two named shipped-bug classes (`jsonb_array_length` on `[]`, `ilike` escaping) are covered.
- **No production code changed** — state the empty `git diff origin/main..HEAD -- src/` as a gate.
- Include the mutation ledger from Step 6. State plainly that assertion counts prove nothing here because the files are new, and that mutation is the gate that replaces them.

Do not include any Claude/AI attribution.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: Decision 1 → Task 1 Step 3; Decision 2 → Task 1 Step 3 plus the Task 8 budget check; Decision 3 → Task 1 Step 3, gated at Step 5; Decision 4's Tier 1 → Tasks 3–5; Tier 2 → Tasks 6–7; Decision 5 → the verification-cycle preamble and each task's "expect PASS" step; Decision 6 → the mutation steps throughout and the Task 8 ledger. Risk 1 and Risk 2 → Task 1 Step 5. Risk 3 → Task 1 Step 6, Task 8 Step 3. Risk 4 → Task 8 Step 1. Risk 5 → Task 1 Step 2. The spec's requirement to update CLAUDE.md's bespoke-fake count is Task 5 Step 8.

**Placeholders.** None. Every code step carries the code; every mutation names the exact edit and the exact test expected to fail.

**Type consistency.** `pgDb` is `{ client, db, reset, seedUser, seedMedication, seedDose }` from Task 2 onward and is referenced with those names in Tasks 3–7. `dbMock` is `{ db, dbTx }` throughout. `claimReminderSlot` returns `{ id, attemptCount } | null` in both Task 4's interface block and its assertions. `checkRateLimit` returns `{ allowed, retryAfterMs }` and the tests only read `allowed`, reading `count` from the table directly — which is correct, because `count` is not in the return type.

**One deliberate deviation from the skill's template.** Steps 1–2 of Tasks 3–7 do not write a failing test first. That is not an oversight: these tests characterise existing, working code, so a red phase is unavailable and mutation replaces it. The reasoning is stated in full in the verification-cycle preamble, which the executor is told to read before Task 3.
