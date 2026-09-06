# Appearance 1b — Preference Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the appearance options one description in code — a client-safe registry plus a server-only schema module derived from it — convert the appearance form to per-field instant save, and make `updatePreferences` compute its audit before-image against the row the write actually replaced.

**Architecture:** `src/lib/appearance/registry.ts` holds metadata only (key, group, label, control kind, DOM binding) with no zod, so the page can import it without pulling zod into the client bundle. `src/lib/appearance/schema.ts` imports the registry plus zod and derives **three separate arities** — a per-action required schema, an all-optional API payload shape, and an all-optional import shape — which `validation.ts` then spreads instead of restating. The appearance page becomes one `<form>` per control, each targeting its own named action, debounced and single-flighted on the client and rate-limited on the server. `updatePreferences` reads its before-image inside the write via a locking CTE.

**Tech Stack:** SvelteKit 2.57, Svelte 5.55.4 (runes), zod **4.3.6**, drizzle-orm 0.45.2 (neon-http + neon-serverless), Vitest 4.1.5, PGlite 0.5.8.

**Spec:** `docs/superpowers/specs/2026-09-06-appearance-customization-design.md` — the "1b — Preference substrate" section plus Decisions 6, 7 and 8.

---

## Global Constraints

- **Svelte 5 runes only.** `$props()`, `$state()`, `$derived()`, `$effect()`. No `export let`. There is no `onMount` anywhere in `src/` — use `$effect`.
- **`npm run check` must be clean: 0 errors.** This is a **change from the 1a plan**, which recorded a 3-error baseline. `@electric-sql/pglite` is now installed in this worktree, so the 11 PGlite test files import and the 3 errors are gone. Measured: `COMPLETED 1200 FILES 0 ERRORS 26 WARNINGS`. Any error is yours.
- **Test baseline: 87 files, 1193 tests, all passing.** `npx vitest run`. Also a change from 1a's 76/925 — the PGlite files now run.
- **Never hand-edit `drizzle/` migrations.** This PR adds no column and needs no migration. If you think you need one, you have gone out of scope.
- **No new runtime dependency.** Everything here uses zod, drizzle, SvelteKit and `typescript` (already a devDependency) only.
- **Prettier runs on commit** via husky + lint-staged. Run `npx prettier --write` on files you touch rather than fighting the hook.
- **Commit convention: Conventional Commits, lower-case scope, imperative subject.** There is **no commitlint config** — the convention is social. Recent subjects: `fix(theme): guard the tinted chips and raise the two tokens that failed`, `docs(claude): record the token roles the styling section was stale on`. **No Claude/AI attribution in any commit message or PR body.**
- **`$lib/appearance/registry.ts` may import from `$lib/server/*` only with `import type`.** A value import drags drizzle into the browser bundle. Three in-tree precedents already do this safely (`MedicationForm.svelte:5`, `utils/schedule.ts:2`, `medications/medication-form-state.ts:2` all type-import `$lib/server/schedules.ts`), and the build output proves the erasure is real.
- **Form actions run BEFORE layout load functions**, so the `(app)` group's auth guard has not run when your action executes. Use `if (!locals.user) error(401, "Unauthorized")`, not `locals.user!`. Documented in place at `settings/data/import/+page.server.ts:179-183`.
- **SvelteKit throws if a `default` action coexists with any named action.** Documented in place at `settings/notifications/+page.server.ts:59-64` (it previously 500'd every POST).
- Run all commands from the worktree root: `/Users/jamiewhite/Documents/Personal/Projects/medication-tracker/.claude/worktrees/appearance-customization-analysis-d18682`.

---

## Decisions taken during planning

Recorded so they are not re-litigated mid-implementation.

1. **The audit fix is the locking-CTE single statement**, not a transaction. It keeps the hot instant-save path on the neon-http driver at the same three round trips it costs today. The trade accepted: the audit `INSERT` is still a separate statement, so it is not atomic with the write — unchanged from today, therefore not a regression. (User decision.)
2. **`heatmapPeriod` adopts the import door's `1..3650` bound at the `/api/v1` door.** This is a deliberate behaviour change at that door: a client sending an out-of-range value now gets an error instead of a 200. It closes a real self-DoS — the value flows unclamped into `Heatmap.svelte`'s render loop, so `update_preferences` with `heatmapPeriod: 10_000_000` renders ten million DOM nodes. Nothing in this repo or the Mac client sends an out-of-range value today. (User decision.)
3. **The registry owns exactly five options** — `accentColor`, `dateFormat`, `timeFormat`, `uiDensity`, `reducedMotion`. That is precisely `appearanceSchema`'s field set. The notification toggles belong to `/settings/notifications`, `exportFormat` to `/settings/data`, and `doseLogPageSize` / `heatmapPeriod` have **no form door at all**. Forced by the code, not chosen.
4. **The per-field action schemas use `z.strictObject`, not `z.object`.** Verified by execution: today's required `appearanceSchema` already fails to catch a mistyped field name — `{...all five valid, acentColor: "x"}` parses `success: true` with the typo silently stripped. `z.strictObject` exists and works in zod 4.3.6 and turns that into `unrecognized_keys`. This closes a hole the spec's proposal leaves open.
5. **The registry carries no `default` field.** The value a real user gets is the column default in `schema.ts`; `@theme` is only the logged-out fallback. A registry default would be a fourth hand-written restatement of exactly the kind this PR deletes.
6. **Presets stay advisory metadata, never a `z.enum`.** All three doors accept any `#RRGGBB` and spec Decision 4 keeps that true. Enumerating them would reject every stored custom accent and break the `/api/v1` door.
7. **Out of scope, recorded not fixed:** `importPreferencesSchema` has no `.catch()` fallbacks even though `validation.ts:390-391` states cosmetic import fields should fall back rather than fail the envelope — one malformed `accentColor` in a hand-edited backup kills the whole import. And `dateFormat` is **write-only dead code**: stored, validated at three doors, rendered as a control, and read by nothing. Both are pre-existing; changing either is a user-visible behaviour change and does not belong in a PR the spec calls "invisible to users."

---

## File Structure

**Created**

| File                                             | Responsibility                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/appearance/registry.ts`                 | The one description of every appearance option. Metadata only — no zod, no value import from `$lib/server`. Imported by the page and by `schema.ts`. |
| `src/lib/appearance/schema.ts`                   | The three zod arities, derived from the registry. Server-only; imports zod.                                                                          |
| `tests/unit/appearance-registry.test.ts`         | Registry invariants — key set, preset list, option values.                                                                                           |
| `tests/unit/appearance-schema.test.ts`           | The three arities behave differently, and each behaves correctly.                                                                                    |
| `tests/unit/preference-door-conformance.test.ts` | Every registry key appears in both API-door schemas, with matching option sets.                                                                      |
| `tests/unit/appearance-bundle-boundary.test.ts`  | No `.svelte` file transitively reaches zod through a runtime import edge.                                                                            |
| `tests/unit/appearance-actions.test.ts`          | The five named form actions: arity, 401 guard, rate limit, 400 on a typo.                                                                            |
| `tests/unit/pg/preferences-audit.test.ts`        | The decision-8 race. Two overlapping saves for the same field must both leave an audit row.                                                          |
| `tests/unit/pg/preferences.test.ts`              | The existing `preferences.test.ts`, moved. `fake-db` cannot express `$with` / `.for()`.                                                              |

**Modified**

| File                                                                       | Change                                                                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/preferences.ts`                                            | `updatePreferences` reads the before-image inside the write via a locking CTE.                                               |
| `src/lib/utils/validation.ts`                                              | The two API-door schemas spread the registry-derived shapes; `heatmapPeriod` gains its bound; `appearanceSchema` is deleted. |
| `src/routes/(app)/settings/appearance/+page.server.ts`                     | `default` action → five named per-field actions, each rate-limited and 401-guarded.                                          |
| `src/routes/(app)/settings/appearance/+page.svelte`                        | One `<form>` per control, driven from the registry, instant save with debounce + single-flight + revert.                     |
| `src/lib/server/api/serialize.ts:141-156`                                  | Inline parameter literal → `UserPreferences`.                                                                                |
| `src/lib/server/import/types.ts:126-139`                                   | `ImportPreferences` → `Partial<Omit<UserPreferences, "userId" \| "updatedAt">>`.                                             |
| `tests/unit/theme-tokens.test.ts:58-75`                                    | `readAccentPresets()` stops scraping the `.svelte` file and imports the registry.                                            |
| `tests/unit/import-round-trip.test.ts`                                     | Gains a case setting every appearance field to a non-default value.                                                          |
| `tests/unit/preferences.test.ts`                                           | **Deleted** — moved to `tests/unit/pg/`.                                                                                     |
| `docs/api-v1-contract.md`, `docs/database.md`, `CLAUDE.md`, `CHANGELOG.md` | Documentation.                                                                                                               |

**Deliberately NOT touched**

- `src/lib/server/import/apply.ts:192-200` writes `user_preferences` directly with `onConflictDoUpdate`, bypassing `updatePreferences`. Decision 8's fix does not cover it, and that is correct — an import logs one `data_import` audit row for the whole operation. Stated so it is not discovered later and "fixed" into an audit-spam regression.
- `notificationSchema` and `dataSchema` keep their own hand-written shapes. They belong to other pages; folding them in is a different PR.

---

## Verified facts this plan rests on

Every one measured in this worktree, not assumed.

| Claim                                                     | Evidence                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The audit race is real and deterministic                  | Two `updatePreferences` calls under `Promise.all` produce statement order `SELECT \| SELECT \| UPDATE \| UPDATE \| INSERT`. The second diff is `computeChanges(A, A) → null`. **100/100 runs lose the audit row.**                                               |
| `appearanceSchema` rejects a single-field post            | `safeParse({ accentColor: "#4f46e5" })` → `success: false`, three `invalid_value` issues naming `dateFormat`, `timeFormat`, `uiDensity` — fields the user never touched.                                                                                         |
| Making it all-optional is _worse_ than the spec predicted | `appearanceSchema.partial().safeParse({ acentColor: "#4f46e5" })` → `success: true`, `data: { reducedMotion: false }`. `checkboxField`'s transform still fires, so a typo silently **clobbers** the user's reduce-motion setting and audits it as a real change. |
| `z.strictObject` works in zod 4.3.6                       | `{ accentColor: "#4f46e5", acentColor: "x" }` → `success: false`, `[{ code: "unrecognized_keys", keys: ["acentColor"] }]`. `.strict()` is equivalent but carries `/** Consider z.strictObject(A.shape) instead */`.                                              |
| Every current door strips unknown keys                    | Zero occurrences of `.strict()`, `.passthrough()`, `z.strictObject` or `z.looseObject` under `src/` or `tests/`.                                                                                                                                                 |
| `heatmapPeriod` is the only bounds disagreement           | `diff <(sed -n '357,372p') <(sed -n '570,585p')` on `validation.ts` → exactly one differing line.                                                                                                                                                                |
| The API door accepts absurd values today                  | `updatePreferencesPayload.safeParse({ heatmapPeriod: 99999 })` → `success: true`. The import door rejects it with `too_big`.                                                                                                                                     |
| `fake-db` cannot host the fix                             | `db.$with is not a function`. Also `db.update(...).set(...).from is not a function` and `tx.select(...).where(...).for is not a function` for the alternatives.                                                                                                  |
| `pg-db` already has the fixture                           | `seedPreferences(overrides)` is exported from `tests/unit/helpers/pg-db.ts` and included in the `pgDb` aggregate.                                                                                                                                                |
| No `.svelte` reaches zod at runtime                       | Transitive walk over 62 client entrypoints / 166 modules, type-only edges erased: 0 reaches, 0 unresolved. The built client bundle contains "zod" in 0 of 50 JS files.                                                                                           |
| …but six do via **type-only** edges                       | All through `$lib/server/schedules.ts`. **The boundary test must erase `import type` edges or it fails on existing code.**                                                                                                                                       |
| Drizzle 0.45.2 supports every idiom in the fix            | `$with` (`pg-core/db.d.ts:68`), `with().update()` (`:92,105`), `.for("update")` (`select.d.ts:586`), update `.from()` (`update.d.ts:103`), `getTableColumns` (`utils.d.ts:37`).                                                                                  |
| PGlite is PostgreSQL 18.3; Neon is not                    | Do not use PG18-only syntax (`UPDATE ... RETURNING OLD.*`) — it would be green locally and broken in production. Drizzle 0.45.2 cannot express it anyway.                                                                                                        |

---

### Task 1: The audit race — red phase

Prove the defect before fixing it. The repo's rule is that a test which never failed has not been shown to test anything.

**Files:**

- Create: `tests/unit/pg/preferences-audit.test.ts`

**Interfaces:**

- Consumes: `pgDb.reset()`, `pgDb.seedUser()`, `pgDb.seedPreferences({ accentColor })`, `pgDb.db` from `tests/unit/helpers/pg-db.ts`; `updatePreferences` from `src/lib/server/preferences.ts`.
- Produces: nothing. Task 2 makes this file pass.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pg/preferences-audit.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, userPreferences } from "../../../src/lib/server/db/schema";

// Real Postgres, not the fake: the assertion below is about WHICH row
// version the diff is computed against, and only a database decides that.
// The two calls also have to reach one connection in the order they were
// issued, which fakeDb's synchronous chains cannot model.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { updatePreferences } = await import("../../../src/lib/server/preferences");

const A = "#4f46e5";
const B = "#ff0000";

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedPreferences({ accentColor: A });
});

describe("updatePreferences — the before-image under a double-click", () => {
  it("audits both writes when two saves for the same field overlap", async () => {
    // Instant save posts one field per control change. A double-click
    // sends A -> B and B -> A close enough together that the second
    // request's read lands before the first request's write.
    await Promise.all([
      updatePreferences("u1", { accentColor: B }),
      updatePreferences("u1", { accentColor: A }),
    ]);

    const [stored] = await pgDb.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, "u1"));
    const rows = await pgDb.db.select().from(auditLogs);

    // Before the fix: one row. The second save diffs A against A, finds
    // nothing, and writes nothing -- so the log says the accent is B
    // while the column holds A. Not incomplete: wrong.
    expect(rows).toHaveLength(2);

    // Order-independent on purpose. created_at defaults to now() per
    // implicit transaction, and two statements microseconds apart are not
    // a stable sort key.
    expect(rows.map((r) => r.changes)).toEqual(
      expect.arrayContaining([
        { accentColor: { from: A, to: B } },
        { accentColor: { from: B, to: A } },
      ]),
    );

    // The property that actually matters, stated directly: replaying the
    // logged edges from the seeded value has to land on what the column
    // holds.
    const edges = rows.map(
      (r) => (r.changes as Record<string, { from: string; to: string }>).accentColor,
    );
    let value = A;
    for (let i = 0; i < edges.length; i++) {
      const next = edges.find((e) => e.from === value);
      expect(next).toBeDefined();
      value = next!.to;
    }
    expect(value).toBe(stored.accentColor);
  });

  it("still writes exactly one audit row for a single save", async () => {
    await updatePreferences("u1", { accentColor: B });

    const rows = await pgDb.db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual({ accentColor: { from: A, to: B } });
  });
});
```

Do **not** add `vi.useFakeTimers` here. Nothing needs a frozen clock, and faking all timers stalls PGlite's WASM layer.

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
npx vitest run tests/unit/pg/preferences-audit.test.ts
```

Expected: the first test FAILS with `expected [ { …(7) } ] to have a length of 2 but got 1`. The second test PASSES — that is the control proving the harness itself works.

If the first test passes, stop: either the fixture is wrong or you are not exercising the real `updatePreferences`.

- [ ] **Step 3: Commit the red test**

```bash
git add tests/unit/pg/preferences-audit.test.ts
git commit -m "test(preferences): show the audit race two overlapping saves produce

The second save reads its before-image from a separate SELECT that can
land before the first save's UPDATE. It then diffs the stored value
against itself, finds no change, and writes no audit row -- so the log
records A -> B while the column holds A. Reproduces 100/100."
```

Committing red is deliberate here: the next commit is the fix, and the pair is the proof.

---

### Task 2: The audit race — fix

**Files:**

- Modify: `src/lib/server/preferences.ts:46-75`
- Move: `tests/unit/preferences.test.ts` → `tests/unit/pg/preferences.test.ts`

**Interfaces:**

- Consumes: `computeChanges`, `logAudit` from `$lib/server/audit` (unchanged signatures); `getTableColumns` from `drizzle-orm`.
- Produces: `updatePreferences(userId, updates): Promise<UserPreferences>` — **signature unchanged**. Every caller (`settings/appearance`, `settings/notifications`, `settings/data`, `api/commands.ts:118-124`) keeps working untouched.

- [ ] **Step 1: Apply the fix**

Replace `src/lib/server/preferences.ts:46-75` with:

```ts
export async function updatePreferences(
  userId: string,
  updates: Partial<Omit<UserPreferences, "userId" | "updatedAt">>,
): Promise<UserPreferences> {
  // Still the guarantee that the singleton row exists: the UPDATE below
  // matches nothing when it doesn't, which returned undefined to every
  // caller except the API door. It is no longer the before-image.
  await getOrCreatePreferences(userId);

  // The before-image is read INSIDE the write. `for update` is what makes
  // it the row this statement actually replaced: under READ COMMITTED a
  // locking read waits on a concurrent writer and then re-reads the
  // version that writer committed. Without it, two overlapping instant
  // saves both diff against the same stale row and the second one's
  // change is never audited -- see tests/unit/pg/preferences-audit.test.ts.
  const previous = db
    .$with("previous")
    .as(db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).for("update"));

  const [row] = await db
    .with(previous)
    .update(userPreferences)
    .set({ ...updates, updatedAt: new Date() })
    .from(previous)
    .where(eq(userPreferences.userId, userId))
    .returning({
      after: getTableColumns(userPreferences),
      before: previous._.selectedFields,
    });

  // Diff only the fields the caller submitted. computeChanges walks the
  // keys of its second argument, so narrowing the after-image keeps the
  // always-rewritten updatedAt out of the changes -- a whole-row diff
  // would log a change on every save, which is what drove each door to
  // hand-roll its own subset in the first place.
  const submitted = Object.keys(updates);
  const after = row.after as Record<string, unknown>;
  const changes = computeChanges(
    row.before,
    Object.fromEntries(submitted.map((key) => [key, after[key]])),
  );
  if (changes) await logAudit(userId, "user_preferences", userId, "update", changes);

  return row.after;
}
```

Update the import on line 1:

```ts
import { eq, getTableColumns } from "drizzle-orm";
```

Two notes for the implementer:

- The explicit `.returning({ after, before })` is **not** cosmetic. A bare `.returning()` on a joined update produces a runtime shape of flat target columns plus a nested `previous` key, which does not match drizzle's declared type. Naming both sides keeps the runtime and the type in agreement, and keeps `before`/`previous` from leaking into the object callers receive.
- The audit `INSERT` is still a separate statement, so it is not atomic with the write. That is unchanged from today and therefore not a regression — see Decision 1.

- [ ] **Step 2: Run the red test and watch it go green**

```bash
npx vitest run tests/unit/pg/preferences-audit.test.ts
```

Expected: 2 passed.

- [ ] **Step 3: Confirm the existing suite now breaks, and why**

```bash
npx vitest run tests/unit/preferences.test.ts
```

Expected: FAIL with `TypeError: db.$with is not a function`. This is correct and expected — `fake-db`'s client exposes only `select/insert/update/delete`, its write chain has no `.from()` and its select chain has no `.for()`. Per CLAUDE.md, the answer is to move the file to PGlite, **not** to grow the fake.

- [ ] **Step 4: Move the suite to PGlite**

```bash
git mv tests/unit/preferences.test.ts tests/unit/pg/preferences.test.ts
```

Then rewrite the header of the moved file. Replace everything from line 1 through the `beforeEach` block with:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, userPreferences } from "../../../src/lib/server/db/schema";

// Real Postgres, not the fake. updatePreferences now reads its
// before-image through a locking CTE (`with ... for update`), and
// fakeDb's chainable has no `$with`, no update `.from()` and no select
// `.for()`. Per CLAUDE.md, behaviour the database decides belongs here
// rather than in a bigger fake.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { updatePreferences } = await import("../../../src/lib/server/preferences");

// A complete stored row, matching the schema defaults.
const BASE_ROW = {
  userId: "u1",
  accentColor: "#4f46e5",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
};

async function auditRows() {
  return pgDb.db.select().from(auditLogs).where(eq(auditLogs.entityType, "user_preferences"));
}

async function storedRow() {
  const [row] = await pgDb.db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, "u1"));
  return row;
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedPreferences(BASE_ROW);
});
```

Then convert each of the eight existing cases mechanically. The transformation is the same every time:

- `seedUpdated({...})` disappears entirely — a real database produces the after-image itself.
- `expect(auditRows()).toHaveLength(n)` becomes `expect(await auditRows()).toHaveLength(n)`.
- `auditRows()[0].values.changes` becomes `(await auditRows())[0].changes`.
- `expect(updates()).toHaveLength(1)` — "the write still happens" — becomes an assertion on the row itself: `expect((await storedRow()).updatedAt.getTime()).toBeGreaterThan(before.getTime())`.

Worked example — the first case becomes:

```ts
describe("updatePreferences audit", () => {
  it("logs a user_preferences update keyed to the user", async () => {
    await updatePreferences("u1", { accentColor: "#ff0000" });

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "u1",
      entityType: "user_preferences",
      entityId: "u1",
      action: "update",
      changes: { accentColor: { from: "#4f46e5", to: "#ff0000" } },
    });
  });
```

And the no-op case, which is the one that needs the `updatedAt` rework:

```ts
it("writes no audit row when the submitted values match the stored ones", async () => {
  // updatePreferences stamps updatedAt on every write, so the
  // after-image always differs from the before-image somewhere, even on
  // a no-op save. The write must still happen; only the audit row is
  // suppressed.
  const before = (await storedRow()).updatedAt;

  await updatePreferences("u1", { accentColor: "#4f46e5", timeFormat: "12h" });

  expect((await storedRow()).updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  expect(await auditRows()).toHaveLength(0);
});
```

Note `BASE_ROW.accentColor` moves from `#6366f1` to `#4f46e5`, the real column default since migration 0017. Adjust the expected `from:` values in every case accordingly.

- [ ] **Step 5: Run the moved suite**

```bash
npx vitest run tests/unit/pg/preferences.test.ts
```

Expected: 8 passed. If a case fails on `updatedAt` precision, use `toBeGreaterThanOrEqual` — PGlite can resolve two writes to the same microsecond.

- [ ] **Step 6: Prove the fix by mutation**

Temporarily revert `preferences.ts` to read `const before = await getOrCreatePreferences(userId)` and diff against that, keeping everything else. Run:

```bash
npx vitest run tests/unit/pg/preferences-audit.test.ts
```

Expected: the overlap test FAILS, the single-save test PASSES. Restore the fix and confirm both pass. **Do not skip this** — a test that has not been watched fail has not been shown to test anything.

- [ ] **Step 7: Verify the whole suite and the type check**

```bash
npx vitest run && npm run check
```

Expected: 88 files (one added, one moved), all tests passing, 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/preferences.ts tests/unit/pg/preferences.test.ts tests/unit/preferences.test.ts
git commit -m "fix(preferences): read the audit before-image inside the write

A separate non-transactional SELECT let two overlapping saves diff
against the same stored row, so the second one's change was never
audited. A locking CTE makes the before-image the version this statement
actually replaced.

The suite moves to PGlite with it: fake-db has no \$with, no update
.from() and no select .for(), and per CLAUDE.md behaviour the database
decides does not belong in a bigger fake."
```

---

### Task 3: The registry module

**Files:**

- Create: `src/lib/appearance/registry.ts`
- Create: `tests/unit/appearance-registry.test.ts`
- Modify: `tests/unit/theme-tokens.test.ts:58-75` (stop scraping the `.svelte` file)
- Modify: `src/routes/(app)/settings/appearance/+page.svelte:14-25` (import the presets instead of declaring them)

**Interfaces:**

- Consumes: `UserPreferences` from `$lib/types`, **type-only**.
- Produces: `APPEARANCE_ENTRIES`, `APPEARANCE_KEYS`, `entryFor(key)`, `actionFor(key)`, and the types `PreferenceKey`, `AppearanceKey`, `AppearanceEntry`, `AppearanceEntries`, `AppearanceGroup`, `SelectOption`, `DomBinding`. Tasks 4, 5, 6, 8 and 9 all depend on these names.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/appearance-registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { APPEARANCE_ENTRIES, APPEARANCE_KEYS, actionFor, entryFor } from "$lib/appearance/registry";

describe("the appearance registry", () => {
  it("owns exactly the five options the appearance page renders", () => {
    expect([...APPEARANCE_KEYS]).toEqual([
      "accentColor",
      "dateFormat",
      "timeFormat",
      "uiDensity",
      "reducedMotion",
    ]);
  });

  it("gives every entry a label and a control kind", () => {
    for (const entry of APPEARANCE_ENTRIES) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(["swatch", "select", "checkbox"]).toContain(entry.control);
    }
  });

  it("offers ten accent presets, all six-digit hex", () => {
    const accent = entryFor("accentColor");
    expect(accent.presets).toHaveLength(10);
    for (const preset of accent.presets) expect(preset).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps select option values distinct within each entry", () => {
    for (const entry of APPEARANCE_ENTRIES) {
      if (entry.control !== "select") continue;
      const values = entry.options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("derives the form action from the key", () => {
    expect(actionFor("uiDensity")).toBe("?/uiDensity");
  });

  it("names a DOM binding for the options the app subtree reads", () => {
    expect(entryFor("accentColor").dom).toMatchObject({
      kind: "css-var",
      property: "--color-accent",
    });
    expect(entryFor("uiDensity").dom).toEqual({
      kind: "data-attribute",
      attribute: "data-density",
    });
    expect(entryFor("reducedMotion").dom).toEqual({
      kind: "data-attribute",
      attribute: "data-reduced-motion",
    });
  });

  it("imports no zod and no server value", async () => {
    // The page imports this module. A zod import here would put zod in
    // the client bundle for the first time; a value import from
    // $lib/server would drag drizzle in with it.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../../src/lib/appearance/registry.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']zod["']/);
    for (const match of source.matchAll(/^import\s+(type\s+)?.*from\s+["']\$lib\/server\//gm)) {
      expect(match[1], `value import from $lib/server: ${match[0]}`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/unit/appearance-registry.test.ts
```

Expected: FAIL — `Failed to resolve import "$lib/appearance/registry"`.

- [ ] **Step 3: Write the registry**

Create `src/lib/appearance/registry.ts`:

```ts
/**
 * Appearance option metadata — the one description of every option the
 * Appearance page renders.
 *
 * NO ZOD, and no *value* import from `$lib/server/*`. The page imports
 * this module to render its controls, and no `.svelte` file anywhere
 * reaches zod today (tests/unit/appearance-bundle-boundary.test.ts holds
 * that line) — so putting the validators here would pull zod into the
 * client bundle for the first time. The zod arities live in `./schema.ts`,
 * which imports this file and is imported only from server code.
 *
 * `import type` from `$lib/server` is fine and already has three
 * precedents in-tree: MedicationForm.svelte, utils/schedule.ts and
 * medications/medication-form-state.ts all type-import
 * $lib/server/schedules.ts, and the erasure is visible in the build output.
 *
 * There is deliberately NO `default` field. The value a real user gets is
 * the column default in `src/lib/server/db/schema.ts`; `@theme` is only
 * the logged-out fallback, because `(app)/+layout.svelte` writes the
 * accent as an inline style and inline beats every stylesheet rule.
 * Restating a default here would be a fourth hand-written restatement of
 * exactly the kind this PR deletes.
 */
import type { UserPreferences } from "$lib/types";

/** Every mutable column of `user_preferences`. */
export type PreferenceKey = keyof Omit<UserPreferences, "userId" | "updatedAt">;

export type AppearanceGroup = "colour" | "formatting" | "layout" | "motion";

/**
 * How the stored value reaches the DOM.
 *
 * The data-attribute bindings are set on the `(app)` wrapper div today
 * (`(app)/+layout.svelte:34-35`); 1c moves them onto the theme `<style>`
 * block. Naming them here is the seam that lets 1c move them in one place.
 *
 * `css-var` records only the property the *stored* value drives.
 * `derived` names the two tokens `readableForeground` / `readableInk`
 * compute from it (`$lib/utils/contrast.ts`) — the derivation stays code,
 * the registry only names its outputs so a reader can find them.
 */
export type DomBinding =
  | {
      readonly kind: "css-var";
      readonly property: `--${string}`;
      readonly derived: readonly `--${string}`[];
    }
  | { readonly kind: "data-attribute"; readonly attribute: `data-${string}` }
  | { readonly kind: "none" };

export type SelectOption<V extends string = string> = {
  readonly value: V;
  readonly label: string;
};

type Base = {
  readonly key: PreferenceKey;
  readonly group: AppearanceGroup;
  readonly label: string;
  /** Rendered as the control's `<Tooltip text={...} />`. */
  readonly description?: string;
  readonly dom: DomBinding;
};

export type AppearanceEntry =
  | (Base & {
      readonly control: "swatch";
      /**
       * Suggested values, NOT the value domain: all three doors accept
       * any `#RRGGBB` and that stays true (spec decision 4). Turning
       * these into a zod enum would reject every stored custom accent and
       * break the /api/v1 door.
       *
       * tests/unit/theme-tokens.test.ts asserts this list against the
       * real @theme values — every preset must pair with a legible
       * foreground, because the layout derives --color-accent-fg from
       * whichever one the user picks.
       */
      readonly presets: readonly string[];
      /** `{value}` is substituted with the hex to build each swatch's label. */
      readonly optionLabelTemplate: string;
    })
  | (Base & { readonly control: "select"; readonly options: readonly SelectOption[] })
  | (Base & { readonly control: "checkbox" });

export const APPEARANCE_ENTRIES = [
  {
    key: "accentColor",
    group: "colour",
    label: "Accent Colour",
    control: "swatch",
    presets: [
      "#4f46e5",
      "#7c3aed",
      "#ec4899",
      "#ef4444",
      "#f59e0b",
      "#10b981",
      "#06b6d4",
      "#3b82f6",
      "#f97316",
      "#64748b",
    ],
    optionLabelTemplate: "Select colour {value}",
    dom: {
      kind: "css-var",
      property: "--color-accent",
      derived: ["--color-accent-fg", "--color-accent-ink"],
    },
  },
  {
    key: "dateFormat",
    group: "formatting",
    label: "Date Format",
    control: "select",
    options: [
      { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
      { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
      { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
    ],
    dom: { kind: "none" },
  },
  {
    key: "timeFormat",
    group: "formatting",
    label: "Time Format",
    control: "select",
    options: [
      { value: "12h", label: "12-hour (2:30 PM)" },
      { value: "24h", label: "24-hour (14:30)" },
    ],
    dom: { kind: "none" },
  },
  {
    key: "uiDensity",
    group: "layout",
    label: "Display Density",
    description: "Compact mode reduces spacing throughout the app to show more content on screen.",
    control: "select",
    options: [
      { value: "comfortable", label: "Comfortable" },
      { value: "compact", label: "Compact" },
    ],
    dom: { kind: "data-attribute", attribute: "data-density" },
  },
  {
    key: "reducedMotion",
    group: "motion",
    label: "Reduce motion",
    description: "Disables animations and transitions for accessibility or personal preference.",
    control: "checkbox",
    dom: { kind: "data-attribute", attribute: "data-reduced-motion" },
  },
] as const satisfies readonly AppearanceEntry[];

export type AppearanceEntries = typeof APPEARANCE_ENTRIES;

/** "accentColor" | "dateFormat" | "timeFormat" | "uiDensity" | "reducedMotion" */
export type AppearanceKey = AppearanceEntries[number]["key"];

export const APPEARANCE_KEYS = APPEARANCE_ENTRIES.map((e) => e.key) as readonly AppearanceKey[];

/** The named form action a control posts to. Derived, never restated. */
export function actionFor(key: AppearanceKey): `?/${AppearanceKey}` {
  return `?/${key}`;
}

export function entryFor<K extends AppearanceKey>(key: K) {
  return APPEARANCE_ENTRIES.find((e) => e.key === key) as Extract<
    AppearanceEntries[number],
    { key: K }
  >;
}
```

`as const satisfies readonly AppearanceEntry[]` is the load-bearing combination. `as const` keeps the option values as literals so `schema.ts` can build `z.enum` from them; `satisfies` enforces that every `key` is a real `user_preferences` column. Both halves are needed — `as const` alone would not catch a typo'd key, and `satisfies` alone would widen the values to `string`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/appearance-registry.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Prove the `satisfies` clause by mutation**

Temporarily change `key: "uiDensity"` to `key: "uiDensty"` and run `npm run check`. Expected: a TS error naming `PreferenceKey`. Revert.

- [ ] **Step 6: Point the page and the token test at the registry**

In `src/routes/(app)/settings/appearance/+page.svelte`, delete the `presetColours` array and its comment block (lines 8-25) and replace with:

```ts
import { entryFor } from "$lib/appearance/registry";

const presetColours = entryFor("accentColor").presets;
```

Keep everything else in the page unchanged for now — the full rewrite is Task 9.

In `tests/unit/theme-tokens.test.ts`, replace `readAccentPresets()` (lines 58-75) with:

```ts
/**
 * The accent swatches offered on /settings/appearance. These are not
 * @theme tokens — they are the values written to
 * `user_preferences.accent_color` and then set inline as --color-accent,
 * where they beat every stylesheet rule. Raising the @theme accent
 * without raising these left every real user on the failing pair.
 *
 * Read from the registry rather than scraped out of the page: the
 * registry is the single description of the option and the page renders
 * from it.
 */
function readAccentPresets(): string[] {
  return [...entryFor("accentColor").presets];
}
```

and add the import at the top of that file:

```ts
import { entryFor } from "$lib/appearance/registry";
```

Remove any now-unused `readFileSync` / `fileURLToPath` imports **only if** nothing else in the file uses them — the `@theme` parser does, so check before deleting.

- [ ] **Step 7: Verify nothing regressed**

```bash
npx vitest run tests/unit/theme-tokens.test.ts tests/unit/appearance-registry.test.ts && npm run check
```

Expected: all passing, 0 errors. Then confirm the page no longer declares its own list:

```bash
grep -n "presetColours" "src/routes/(app)/settings/appearance/+page.svelte"
```

Expected: exactly one match — the `const presetColours = entryFor(...)` line.

- [ ] **Step 8: Commit**

```bash
git add src/lib/appearance/registry.ts tests/unit/appearance-registry.test.ts tests/unit/theme-tokens.test.ts "src/routes/(app)/settings/appearance/+page.svelte"
git commit -m "feat(appearance): describe every appearance option once

The page, the token contrast test and (next) the zod arities all read
the same table instead of restating labels, option lists and the preset
swatches three times. No zod here: the page imports this module, and
nothing client-side reaches zod today."
```

---

### Task 4: The schema module — three arities

**Files:**

- Create: `src/lib/appearance/schema.ts`
- Create: `tests/unit/appearance-schema.test.ts`

**Interfaces:**

- Consumes: `entryFor`, and the types `AppearanceEntries`, `AppearanceKey`, `SelectOption` from `$lib/appearance/registry`; `z` from `zod`.
- Produces: `appearanceFieldSchemas` (a `Record<AppearanceKey, ZodType>`), `appearancePayloadShape`, `appearanceImportShape`, `APPEARANCE_ACTION_KEYS`, and the type `AppearanceValues`. Tasks 5 and 8 depend on these names.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/appearance-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  APPEARANCE_ACTION_KEYS,
  appearanceFieldSchemas,
  appearanceImportShape,
  appearancePayloadShape,
} from "$lib/appearance/schema";
import { APPEARANCE_KEYS } from "$lib/appearance/registry";

describe("arity 1 — the per-field form doors", () => {
  it("defines one action schema per registry key", () => {
    expect(APPEARANCE_ACTION_KEYS.sort()).toEqual([...APPEARANCE_KEYS].sort());
  });

  it("accepts exactly its own field", () => {
    expect(appearanceFieldSchemas.uiDensity.safeParse({ uiDensity: "compact" })).toMatchObject({
      success: true,
      data: { uiDensity: "compact" },
    });
  });

  it("rejects an empty body — the field is required", () => {
    expect(appearanceFieldSchemas.uiDensity.safeParse({}).success).toBe(false);
  });

  it("rejects a mistyped field name instead of silently stripping it", () => {
    // This is the whole point of arity 1. A plain z.object strips the
    // typo and, if the schema were all-optional, would report success
    // for a save that changed nothing -- or worse, for checkboxField,
    // would write `false` over the user's setting.
    const result = appearanceFieldSchemas.uiDensity.safeParse({
      uiDensity: "compact",
      uiDensty: "comfortable",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].code).toBe("unrecognized_keys");
  });

  it("rejects a value outside the registry's option list", () => {
    expect(appearanceFieldSchemas.uiDensity.safeParse({ uiDensity: "roomy" }).success).toBe(false);
  });

  it("keeps the custom hex message on accentColor", () => {
    const result = appearanceFieldSchemas.accentColor.safeParse({ accentColor: "nope" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe("Must be a valid hex colour");
  });

  it("maps the checkbox's on/off pair to a boolean, both ways", () => {
    expect(appearanceFieldSchemas.reducedMotion.safeParse({ reducedMotion: "on" })).toMatchObject({
      success: true,
      data: { reducedMotion: true },
    });
    expect(appearanceFieldSchemas.reducedMotion.safeParse({ reducedMotion: "off" })).toMatchObject({
      success: true,
      data: { reducedMotion: false },
    });
    // An absent field must NOT parse as false: under one-field-per-action
    // that is indistinguishable from a mistyped field name.
    expect(appearanceFieldSchemas.reducedMotion.safeParse({}).success).toBe(false);
  });
});

describe("arity 2 — the /api/v1 payload shape", () => {
  const schema = z.object(appearancePayloadShape);

  it("accepts a single field", () => {
    expect(schema.safeParse({ accentColor: "#4f46e5" })).toMatchObject({
      success: true,
      data: { accentColor: "#4f46e5" },
    });
  });

  it("accepts an empty object — every field is optional", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("takes reducedMotion as a JSON boolean, not the form's on/off string", () => {
    expect(schema.safeParse({ reducedMotion: true }).success).toBe(true);
    expect(schema.safeParse({ reducedMotion: "on" }).success).toBe(false);
  });

  it("uses the registry's option values", () => {
    expect(schema.safeParse({ timeFormat: "24h" }).success).toBe(true);
    expect(schema.safeParse({ timeFormat: "36h" }).success).toBe(false);
  });
});

describe("arity 3 — the backup import shape", () => {
  const schema = z.object(appearanceImportShape);

  it("accepts every field optionally", () => {
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ uiDensity: "compact", reducedMotion: false }).success).toBe(true);
  });
});

describe("the three arities are genuinely different objects", () => {
  it("does not share one schema between the form and the API doors", () => {
    // Same field, three different accepted inputs. Collapsing these into
    // one object schema changes behaviour at whichever door loses.
    expect(appearanceFieldSchemas.reducedMotion.safeParse({ reducedMotion: "on" }).success).toBe(
      true,
    );
    expect(z.object(appearancePayloadShape).safeParse({ reducedMotion: "on" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/unit/appearance-schema.test.ts
```

Expected: FAIL — `Failed to resolve import "$lib/appearance/schema"`.

- [ ] **Step 3: Write the schema module**

Create `src/lib/appearance/schema.ts`:

```ts
/**
 * The zod arities for the appearance options. SERVER-ONLY: this module
 * imports zod, and no `.svelte` file may reach it.
 *
 * The bound belongs to the ARITY, not to the option (spec decision 7), so
 * the three doors get three shapes and never share one object schema.
 *
 * Two facts, both measured, that decide the shapes below:
 *
 *  - Making the form door all-optional does not merely turn a mistyped
 *    field name into a silent no-op. `checkboxField`'s transform still
 *    fires, so `{ acentColor: "..." }` parses as
 *    `{ reducedMotion: false }` -- a typo that WRITES over the user's
 *    setting and audits it as a real change.
 *  - A plain `z.object` strips unknown keys, so today's required schema
 *    already fails to notice a typo alongside a full valid payload.
 *    `z.strictObject` is what actually closes that, and it exists in
 *    zod 4.3.6.
 */
import { z } from "zod";
import {
  entryFor,
  type AppearanceEntries,
  type AppearanceKey,
  type SelectOption,
} from "$lib/appearance/registry";

/** Map a readonly tuple of `{ value, label }` to a tuple of its literal values. */
type OptionValues<E> = E extends { options: infer O extends readonly SelectOption[] }
  ? { -readonly [I in keyof O]: O[I] extends SelectOption<infer V> ? V : never }
  : never;

/**
 * The registry's option values as a tuple `z.enum` can consume, with the
 * literals preserved. The single `as never` is the only cast here:
 * `.map()` widens to `string[]` at the type level while producing exactly
 * the right tuple at runtime. Every use of it is re-checked by the
 * `satisfies` clauses below, so a drift is a compile error, not a silent
 * widening.
 */
function optionValues<K extends AppearanceKey>(
  key: K,
): OptionValues<Extract<AppearanceEntries[number], { key: K }>> {
  const entry = entryFor(key);
  if (!("options" in entry)) throw new Error(`${key} is not a select`);
  return entry.options.map((o) => o.value) as never;
}

/**
 * The stored value type of every appearance option, derived from the
 * registry. Narrower than `Pick<UserPreferences, AppearanceKey>`, whose
 * enum columns are all plain `string`.
 */
export type AppearanceValues = {
  [K in AppearanceKey]: Extract<AppearanceEntries[number], { key: K }> extends infer E
    ? E extends { control: "select" }
      ? OptionValues<E>[number]
      : E extends { control: "checkbox" }
        ? boolean
        : // swatch: any #RRGGBB, not just the presets -- the guard is advisory
          string
    : never;
};

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex colour");

/**
 * ARITY 1 — the appearance form. One schema per named action, each with
 * exactly one REQUIRED registry entry and `strictObject` so a mistyped
 * field name is a 400 rather than a silent no-op.
 *
 * `reducedMotion` is a required `"on" | "off"` rather than the shared
 * `checkboxField`: an unchecked box posts nothing, and under
 * one-field-per-action an absent field is indistinguishable from a typo.
 * The page emits a hidden `value="off"` immediately before the checkbox
 * so the key is always present -- `Object.fromEntries` keeps the last
 * duplicate, so "on" wins whenever the box is checked. The same
 * hidden-pair pattern is already used and commented at
 * `MedicationNotificationFields.svelte:44-59`.
 */
export const appearanceFieldSchemas = {
  accentColor: z.strictObject({ accentColor: hexColour }),
  dateFormat: z.strictObject({ dateFormat: z.enum(optionValues("dateFormat")) }),
  timeFormat: z.strictObject({ timeFormat: z.enum(optionValues("timeFormat")) }),
  uiDensity: z.strictObject({ uiDensity: z.enum(optionValues("uiDensity")) }),
  reducedMotion: z.strictObject({
    reducedMotion: z.enum(["on", "off"]).transform((v) => v === "on"),
  }),
} satisfies { [K in AppearanceKey]: z.ZodType<Pick<AppearanceValues, K>> };

/** ARITY 2 — /api/v1 `update_preferences`: all optional, JSON-native types. */
export const appearancePayloadShape = {
  accentColor: hexColour.optional(),
  dateFormat: z.enum(optionValues("dateFormat")).optional(),
  timeFormat: z.enum(optionValues("timeFormat")).optional(),
  uiDensity: z.enum(optionValues("uiDensity")).optional(),
  reducedMotion: z.boolean().optional(),
} satisfies { [K in AppearanceKey]: z.ZodType<AppearanceValues[K] | undefined> };

/**
 * ARITY 3 — backup import: all optional, bounded. Identical to arity 2
 * for these five today, because no appearance option carries a numeric
 * bound. It stays a separate object anyway: the doors are allowed to
 * diverge, and `heatmapPeriod` proved they already had.
 */
export const appearanceImportShape = {
  accentColor: hexColour.optional(),
  dateFormat: z.enum(optionValues("dateFormat")).optional(),
  timeFormat: z.enum(optionValues("timeFormat")).optional(),
  uiDensity: z.enum(optionValues("uiDensity")).optional(),
  reducedMotion: z.boolean().optional(),
} satisfies { [K in AppearanceKey]: z.ZodType<AppearanceValues[K] | undefined> };

/** The named actions the appearance page must define. */
export const APPEARANCE_ACTION_KEYS = Object.keys(appearanceFieldSchemas) as AppearanceKey[];
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/appearance-schema.test.ts
```

Expected: all passing.

- [ ] **Step 5: Prove the `satisfies` clauses by mutation**

Two mutations, run `npm run check` after each and revert:

1. Change arity 2's `timeFormat` to `z.enum(["12h", "24h", "36h"]).optional()`. Expected: `TS2322: Type '"36h"' is not assignable to type '"12h" | "24h" | undefined'`.
2. Delete `uiDensity` from `appearancePayloadShape`. Expected: `TS1360: Property 'uiDensity' is missing`.

This is what makes the compiler — not a runtime test — guarantee that both API doors cover every registry key with the registry's exact option set. That is precisely the failure the spec warns about in Testing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/appearance/schema.ts tests/unit/appearance-schema.test.ts
git commit -m "feat(appearance): derive the three door arities from the registry

The bound belongs to the arity, not the option, so the form, API and
import doors get three shapes rather than one loosened object. The form
door uses strictObject: a plain z.object strips a mistyped field name,
and an all-optional version of it would let that typo write
reducedMotion: false over the user's setting."
```

---

### Task 5: Rewire `validation.ts` onto the registry

**Files:**

- Modify: `src/lib/utils/validation.ts` — delete `appearanceSchema` (:232-238), spread the shapes into `updatePreferencesPayload` (:356-372) and `importPreferencesSchema` (:569-585), bound `heatmapPeriod`
- Create: `tests/unit/preference-door-conformance.test.ts`

**Interfaces:**

- Consumes: `appearancePayloadShape`, `appearanceImportShape` from `$lib/appearance/schema`.
- Produces: `updatePreferencesPayload` (unchanged export name and consumer), `backupEnvelopeSchema` (unchanged). `appearanceSchema` **stops being exported** — Task 8 replaces its only consumer.

- [ ] **Step 1: Write the failing conformance test**

Create `tests/unit/preference-door-conformance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { updatePreferencesPayload, backupEnvelopeSchema } from "$lib/utils/validation";
import { APPEARANCE_KEYS } from "$lib/appearance/registry";
import { userPreferences } from "$lib/server/db/schema";

const importPreferences = backupEnvelopeSchema.shape.preferences;

/** The keys a zod object schema declares, unwrapping optional/nullable/default. */
function shapeKeys(schema: z.ZodType): string[] {
  let current: unknown = schema;
  // .nullable().optional().default(null) wrap the import schema.
  while (current && typeof current === "object" && "unwrap" in current) {
    if ("shape" in (current as Record<string, unknown>)) break;
    current = (current as { unwrap: () => unknown }).unwrap();
  }
  const shape = (current as { shape?: Record<string, unknown> }).shape;
  if (!shape) throw new Error("could not reach the object shape");
  return Object.keys(shape);
}

const apiKeys = shapeKeys(updatePreferencesPayload);
const importKeys = shapeKeys(importPreferences);

describe("preference door conformance", () => {
  it("carries every registry key at the /api/v1 door", () => {
    for (const key of APPEARANCE_KEYS) expect(apiKeys).toContain(key);
  });

  it("carries every registry key at the import door", () => {
    for (const key of APPEARANCE_KEYS) expect(importKeys).toContain(key);
  });

  it("carries every mutable preference column at both doors", () => {
    // The round trip in docs/api-v1-contract.md §5 breaks silently if a
    // column is emitted on export but unreadable on import: a 200, no
    // error, no audit row, and the setting is gone.
    const columns = Object.keys(userPreferences).filter((c) => c !== "userId" && c !== "updatedAt");
    for (const column of columns) {
      expect(apiKeys, `/api/v1 door is missing ${column}`).toContain(column);
      expect(importKeys, `import door is missing ${column}`).toContain(column);
    }
  });

  it("keeps the two API doors on the same key set", () => {
    expect(apiKeys.sort()).toEqual(importKeys.sort());
  });

  it("agrees on heatmapPeriod's bound at both doors", () => {
    // These disagreed: unbounded at /api/v1, 1..3650 on import. The value
    // flows unclamped into the heatmap's per-day render loop, so an
    // out-of-range save rendered millions of DOM nodes on the owner's own
    // analytics page.
    const api = z.object({ heatmapPeriod: updatePreferencesPayload.shape.heatmapPeriod });
    const imp = z.object({
      heatmapPeriod: importPreferences.unwrap().unwrap().shape.heatmapPeriod,
    });
    for (const schema of [api, imp]) {
      expect(schema.safeParse({ heatmapPeriod: 90 }).success).toBe(true);
      expect(schema.safeParse({ heatmapPeriod: 3650 }).success).toBe(true);
      expect(schema.safeParse({ heatmapPeriod: 3651 }).success).toBe(false);
      expect(schema.safeParse({ heatmapPeriod: 0 }).success).toBe(false);
      expect(schema.safeParse({ heatmapPeriod: -1 }).success).toBe(false);
    }
  });
});
```

If `shapeKeys`'s unwrap loop does not reach the shape on the import side, replace that helper with a direct `backupEnvelopeSchema.shape.preferences.unwrap().unwrap().shape` — check the actual wrapper order at `validation.ts:593` (`.nullable().optional().default(null)`) and unwrap in the matching order. Do not guess: log the constructor names once and write what you see.

- [ ] **Step 2: Run it and confirm the heatmapPeriod case fails**

```bash
npx vitest run tests/unit/preference-door-conformance.test.ts
```

Expected: the first four cases PASS (both doors already carry all 12 keys), the `heatmapPeriod` case FAILS on `expect(schema.safeParse({ heatmapPeriod: 3651 }).success).toBe(false)` for the API door.

- [ ] **Step 3: Rewire the two API-door schemas**

In `src/lib/utils/validation.ts`, add to the import block at the top:

```ts
import { appearanceImportShape, appearancePayloadShape } from "$lib/appearance/schema";
```

Replace `updatePreferencesPayload` (:356-372) with:

```ts
export const updatePreferencesPayload = z.object({
  // The five appearance options come from the registry-derived shape, so
  // adding one there cannot leave this door behind. The compiler enforces
  // the coverage (see the `satisfies` clauses in appearance/schema.ts);
  // tests/unit/preference-door-conformance.test.ts covers the seven keys
  // the registry does not own.
  ...appearancePayloadShape,
  overdueEmailReminders: z.boolean().optional(),
  overduePushReminders: z.boolean().optional(),
  lowInventoryEmailAlerts: z.boolean().optional(),
  lowInventoryPushAlerts: z.boolean().optional(),
  doseLogPageSize: z.number().int().min(5).max(100).optional(),
  // Bounded to match the import door. It was unbounded here, and the
  // value reaches Heatmap.svelte's per-day render loop unclamped -- an
  // account owner's own API token could ask for ten million DOM nodes.
  heatmapPeriod: z.number().int().min(1).max(3650).optional(),
  exportFormat: z.enum(["pdf", "csv"]).optional(),
});
```

Replace `importPreferencesSchema` (:569-585) with:

```ts
const importPreferencesSchema = z.object({
  ...appearanceImportShape,
  overdueEmailReminders: z.boolean().optional(),
  overduePushReminders: z.boolean().optional(),
  lowInventoryEmailAlerts: z.boolean().optional(),
  lowInventoryPushAlerts: z.boolean().optional(),
  doseLogPageSize: z.number().int().min(5).max(100).optional(),
  heatmapPeriod: z.number().int().min(1).max(3650).optional(),
  exportFormat: z.enum(["pdf", "csv"]).optional(),
});
```

Delete `appearanceSchema` (:232-238) entirely. Then update the `checkboxField` comment at :225-226, which currently says "Shared across appearance and notification schemas" — it is now notifications-only:

```ts
// accepts an optional "on" string and transforms to a boolean. Used by
// the notification schema; the appearance doors take a required
// "on" | "off" pair instead, because a per-field action cannot tell an
// absent checkbox apart from a mistyped field name.
```

- [ ] **Step 4: Run the conformance test and the whole suite**

```bash
npx vitest run tests/unit/preference-door-conformance.test.ts
npx vitest run
```

Expected: conformance all green. The full suite will now FAIL to build `settings/appearance/+page.server.ts`, which still imports the deleted `appearanceSchema` — that is expected and Task 8 fixes it. If you want a green tree at this commit, do Task 8 before committing this one; otherwise note the breakage in the commit body.

**Recommended: fold Step 3 of this task and Task 8 into one commit** so no commit leaves the tree red. The tasks stay separate for review; the commit boundary is at the end of Task 8.

- [ ] **Step 5: Prove the conformance test by mutation**

Temporarily delete `uiDensity` from `appearancePayloadShape` in `schema.ts`. Expected: `npm run check` errors on the `satisfies` clause AND the conformance test's "carries every registry key at the /api/v1 door" fails. Revert. Two independent guards catching the same drift is the intent.

---

### Task 6: The bundle-boundary test

**Files:**

- Create: `tests/unit/appearance-bundle-boundary.test.ts`

**Interfaces:**

- Consumes: `typescript` (already a devDependency at `^6.0.2`) for parsing.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `tests/unit/appearance-bundle-boundary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = path.join(ROOT, "src");

// Matches the aliases in svelte.config.js.
const ALIASES: [string, string][] = [
  ["$components/", "src/lib/components/"],
  ["$server/", "src/lib/server/"],
  ["$lib/", "src/lib/"],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** `<script>` blocks for .svelte; the whole file otherwise. */
function scriptSources(file: string): string[] {
  const text = readFileSync(file, "utf8");
  if (!file.endsWith(".svelte")) return [text];
  return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/**
 * Specifiers that survive type erasure — what the bundler actually pulls
 * in.
 *
 * Erasing `import type` edges is REQUIRED, not a nicety: six .svelte
 * files reach zod today through type-only chains via
 * $lib/server/schedules.ts, and the built client bundle contains no zod
 * at all. A walk that followed those edges would fail on correct code.
 */
function runtimeImports(file: string): string[] {
  const specs: string[] = [];
  for (const src of scriptSources(file)) {
    const sf = ts.createSourceFile(
      file + ".ts",
      src,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        if (st.importClause?.isTypeOnly) continue;
        specs.push((st.moduleSpecifier as ts.StringLiteral).text);
      } else if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
        if (st.isTypeOnly) continue;
        specs.push((st.moduleSpecifier as ts.StringLiteral).text);
      }
    }
  }
  return specs;
}

type Resolved =
  | { kind: "file"; file: string }
  | { kind: "package"; spec: string }
  | { kind: "framework"; spec: string }
  | { kind: "unresolved"; spec: string };

function resolve(spec: string, fromFile: string): Resolved {
  if (spec.startsWith("$app/") || spec.startsWith("$env/")) return { kind: "framework", spec };
  let base: string | null = null;
  for (const [alias, target] of ALIASES) {
    if (spec.startsWith(alias)) {
      base = path.join(ROOT, target, spec.slice(alias.length));
      break;
    }
  }
  if (spec === "$lib") base = path.join(ROOT, "src/lib");
  if (!base && (spec.startsWith("./") || spec.startsWith("../"))) {
    base = path.resolve(path.dirname(fromFile), spec);
  }
  if (!base) return { kind: "package", spec };
  for (const candidate of [
    base,
    base + ".ts",
    base + ".js",
    base + ".svelte",
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile())
      return { kind: "file", file: candidate };
  }
  return { kind: "unresolved", spec };
}

const files = walk(SRC).filter((f) => /\.(ts|js|svelte)$/.test(f));
const graph = new Map(files.map((f) => [f, runtimeImports(f)]));

/** Every runtime-reachable package specifier from `entry`, transitively. */
function reachablePackages(entry: string): { packages: Set<string>; unresolved: string[] } {
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of graph.get(file) ?? runtimeImports(file)) {
      const r = resolve(spec, file);
      if (r.kind === "package") packages.add(r.spec);
      else if (r.kind === "file") queue.push(r.file);
      else if (r.kind === "unresolved")
        unresolved.push(`${path.relative(ROOT, file)} -> ${r.spec}`);
    }
  }
  return { packages, unresolved };
}

const clientEntrypoints = files.filter(
  (f) =>
    f.endsWith(".svelte") ||
    f.endsWith("src/service-worker.ts") ||
    /routes[/\\].*\+(page|layout)\.ts$/.test(f),
);

describe("the client bundle boundary", () => {
  it("finds client entrypoints to check", () => {
    expect(clientEntrypoints.length).toBeGreaterThan(50);
  });

  it("resolves every runtime import it walks", () => {
    // An unresolved specifier is a hole in the walk, and a hole is how a
    // zod import would slip past this test.
    const holes = clientEntrypoints.flatMap((e) => reachablePackages(e).unresolved);
    expect([...new Set(holes)]).toEqual([]);
  });

  it("never reaches zod from a .svelte file", () => {
    const offenders = clientEntrypoints
      .filter((e) => reachablePackages(e).packages.has("zod"))
      .map((e) => path.relative(ROOT, e));
    expect(offenders).toEqual([]);
  });

  it("never reaches drizzle-orm from a .svelte file", () => {
    const offenders = clientEntrypoints
      .filter((e) => reachablePackages(e).packages.has("drizzle-orm"))
      .map((e) => path.relative(ROOT, e));
    expect(offenders).toEqual([]);
  });

  it("detects a zod reach when one exists", () => {
    // Positive control. Without this, a walk that silently found nothing
    // -- wrong alias, wrong file extension, an empty entrypoint list --
    // would look identical to a clean boundary.
    const serverDoor = path.join(ROOT, "src/lib/utils/validation.ts");
    expect(reachablePackages(serverDoor).packages.has("zod")).toBe(true);
  });

  it("reaches the appearance registry from the appearance page, and zod from the schema module", () => {
    const page = path.join(ROOT, "src/routes/(app)/settings/appearance/+page.svelte");
    expect(reachablePackages(page).packages.has("zod")).toBe(false);
    const schema = path.join(ROOT, "src/lib/appearance/schema.ts");
    expect(reachablePackages(schema).packages.has("zod")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run tests/unit/appearance-bundle-boundary.test.ts
```

Expected: all passing. If "resolves every runtime import it walks" fails, the alias list is incomplete — read `svelte.config.js`'s `kit.alias` and add what is missing rather than loosening the assertion.

- [ ] **Step 3: Prove it by mutation**

Temporarily add `import { z } from "zod";` to `src/lib/appearance/registry.ts` and re-run. Expected: "never reaches zod from a .svelte file" fails, listing the appearance page. Revert and confirm green.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/appearance-bundle-boundary.test.ts
git commit -m "test(appearance): hold the line on zod staying out of the client

The registry exists so the page can describe its controls without
importing the validators. Nothing enforced that -- SvelteKit's own guard
covers \$lib/server and .server.ts but says nothing about an npm package.
Type-only edges are erased, because six .svelte files reach zod through
them today and the built bundle contains none."
```

---

### Task 7: Delete the two type restatements

**Files:**

- Modify: `src/lib/server/api/serialize.ts:141-156`
- Modify: `src/lib/server/import/types.ts:126-139`

**Interfaces:**

- Consumes: `UserPreferences` from `$lib/types` (already type-imported in `import/types.ts:13`).
- Produces: `serializePreferences(p: UserPreferences)` and `ImportPreferences` — both keep their names and their structural types.

- [ ] **Step 1: Replace the inline literal in `serialize.ts`**

Replace lines 141-156 with:

```ts
export function serializePreferences(p: UserPreferences) {
  return { ...p, updatedAt: iso(p.updatedAt) };
}
```

Add the type import at the top of the file if it is not already there:

```ts
import type { UserPreferences } from "$lib/types";
```

The literal existed only to be forgotten. Note the drift it hid: `{ ...p }` spreads unlisted columns through **at runtime** while the type omits them, so a new column was already being emitted on export before anyone declared it.

- [ ] **Step 2: Replace `ImportPreferences`**

Replace lines 126-139 of `src/lib/server/import/types.ts` with:

```ts
export type ImportPreferences = Partial<Omit<UserPreferences, "userId" | "updatedAt">>;
```

This is not a boundary violation: the module already type-imports the schema at `:13` and lives under `$lib/server/`.

- [ ] **Step 3: Verify the types are unchanged**

```bash
npm run check
```

Expected: 0 errors. The 1b spec records that both substitutions were proven type-identical by a type-level equality probe, so a new error here means you changed something else.

- [ ] **Step 4: Run the suite**

```bash
npx vitest run
```

Expected: the same set of failures as after Task 5 (the appearance page's `appearanceSchema` import), nothing new.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/api/serialize.ts src/lib/server/import/types.ts
git commit -m "refactor(preferences): drop two hand-written restatements of the row

Both were already handed a full row and both silently drifted: the
serializer spreads unlisted columns through at runtime while its type
omits them, so a new column shipped on export before anything declared
it."
```

---

### Task 8: Per-field named form actions

**Files:**

- Modify: `src/routes/(app)/settings/appearance/+page.server.ts`
- Create: `tests/unit/appearance-actions.test.ts`

**Interfaces:**

- Consumes: `appearanceFieldSchemas`, `APPEARANCE_ACTION_KEYS` from `$lib/appearance/schema`; `checkRateLimit` from `$lib/server/auth/rate-limit`; `updatePreferences`, `getOrCreatePreferences` from `$lib/server/preferences`.
- Produces: five named actions — `?/accentColor`, `?/dateFormat`, `?/timeFormat`, `?/uiDensity`, `?/reducedMotion`. Each returns `{ success: true, key }` or `fail(400, { key, errors })` / `fail(429, { key, saveError })`. Task 9 consumes those shapes.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/appearance-actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const updatePreferences = vi.fn(async () => ({}) as never);
const checkRateLimit = vi.fn(async () => ({ allowed: true, retryAfterMs: 0 }));

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/preferences", () => ({
  updatePreferences,
  getOrCreatePreferences: vi.fn(async () => ({ userId: "u1" }) as never),
}));
vi.mock("$lib/server/auth/rate-limit", () => ({ checkRateLimit }));

const { actions } = await import("../../src/routes/(app)/settings/appearance/+page.server");

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return { request: new Request("http://x/settings/appearance", { method: "POST", body }) };
}

const locals = { user: { id: "u1" } };

beforeEach(() => {
  updatePreferences.mockClear();
  checkRateLimit.mockClear();
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("the appearance page's named actions", () => {
  it("defines one action per registry key and no default", async () => {
    expect(Object.keys(actions).sort()).toEqual(
      ["accentColor", "dateFormat", "reducedMotion", "timeFormat", "uiDensity"].sort(),
    );
    // SvelteKit throws if `default` coexists with any named action.
    expect(actions).not.toHaveProperty("default");
  });

  it("saves the single field it was posted", async () => {
    const result = await actions.uiDensity({ ...post({ uiDensity: "compact" }), locals } as never);

    expect(updatePreferences).toHaveBeenCalledWith("u1", { uiDensity: "compact" });
    expect(result).toMatchObject({ success: true, key: "uiDensity" });
  });

  it("400s on a mistyped field name instead of writing nothing and reporting success", async () => {
    const result = await actions.uiDensity({
      ...post({ uiDensty: "compact" }),
      locals,
    } as never);

    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400 });
  });

  it("400s on a value outside the option list", async () => {
    const result = await actions.uiDensity({ ...post({ uiDensity: "roomy" }), locals } as never);

    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400 });
  });

  it("maps the checkbox pair to a boolean", async () => {
    await actions.reducedMotion({ ...post({ reducedMotion: "on" }), locals } as never);
    expect(updatePreferences).toHaveBeenCalledWith("u1", { reducedMotion: true });

    updatePreferences.mockClear();
    await actions.reducedMotion({ ...post({ reducedMotion: "off" }), locals } as never);
    expect(updatePreferences).toHaveBeenCalledWith("u1", { reducedMotion: false });
  });

  it("rate-limits per user before writing", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 30_000 });

    const result = await actions.uiDensity({ ...post({ uiDensity: "compact" }), locals } as never);

    expect(checkRateLimit).toHaveBeenCalledWith(
      "appearance:u1",
      expect.any(Number),
      expect.any(Number),
    );
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 429 });
  });

  it("401s an anonymous POST instead of 500ing on locals.user!", async () => {
    // Form actions run BEFORE layout load functions, so the (app) auth
    // guard has not executed here.
    await expect(
      actions.uiDensity({ ...post({ uiDensity: "compact" }), locals: {} } as never),
    ).rejects.toMatchObject({ status: 401 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/unit/appearance-actions.test.ts
```

Expected: FAIL — the module still imports the deleted `appearanceSchema`, or `actions` has a `default` key.

- [ ] **Step 3: Write the actions**

Replace `src/routes/(app)/settings/appearance/+page.server.ts` entirely with:

```ts
import { error, fail } from "@sveltejs/kit";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { appearanceFieldSchemas, APPEARANCE_ACTION_KEYS } from "$lib/appearance/schema";
import type { AppearanceKey } from "$lib/appearance/registry";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

// Instant save turns this page into an unthrottled authenticated write
// path, and audit rows have no retention policy. The client debounce is
// what keeps a normal session well inside this; the limit is here to
// bound a stuck control or a scripted client. Sized between the closest
// precedents: push-test is 5/15min, api-commands 60/60s.
const APPEARANCE_MAX = 60;
const APPEARANCE_WINDOW_MS = 60 * 1000;

export const load: PageServerLoad = async ({ locals }) => {
  const prefs = await getOrCreatePreferences(locals.user!.id);
  return { preferences: prefs };
};

/**
 * One named action per appearance option.
 *
 * Per-field rather than one loosened schema (spec decision 7): each
 * schema is a `strictObject` with exactly one REQUIRED key, so a mistyped
 * field name is a 400 rather than a save that reports success and changes
 * nothing. An all-optional shared schema would be worse still — the
 * checkbox transform fires on an empty parse and writes `false` over the
 * user's reduce-motion setting.
 *
 * There is deliberately no `default` action: SvelteKit rejects one
 * coexisting with named actions, and the page gives each control its own
 * <form action="?/key"> so the no-JS path saves exactly the field the
 * button sits next to.
 */
function fieldAction(key: AppearanceKey) {
  return async ({ request, locals }: RequestEvent) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this an
    // anonymous POST reaches locals.user!.id and 500s.
    if (!locals.user) error(401, "Unauthorized");
    const userId = locals.user.id;

    const { allowed, retryAfterMs } = await checkRateLimit(
      `appearance:${userId}`,
      APPEARANCE_MAX,
      APPEARANCE_WINDOW_MS,
    );
    if (!allowed) {
      return fail(429, {
        key,
        saveError: `Too many changes. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      });
    }

    const formData = Object.fromEntries(await request.formData());
    const parsed = appearanceFieldSchemas[key].safeParse(formData);
    if (!parsed.success) {
      return fail(400, { key, errors: parsed.error.flatten().fieldErrors });
    }

    await updatePreferences(userId, parsed.data);

    return { success: true, key };
  };
}

export const actions: Actions = Object.fromEntries(
  APPEARANCE_ACTION_KEYS.map((key) => [key, fieldAction(key)]),
) as Actions;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/appearance-actions.test.ts
```

Expected: all passing.

- [ ] **Step 5: Run the whole suite and the type check**

```bash
npx vitest run && npm run check
```

Expected: everything green, 0 errors. The `appearanceSchema` breakage from Task 5 is now resolved.

- [ ] **Step 6: Commit Tasks 5, 7 and 8 together**

Task 5 deleted `appearanceSchema` and this task replaced its only consumer, so they land as one commit to keep every commit green.

```bash
git add src/lib/utils/validation.ts "src/routes/(app)/settings/appearance/+page.server.ts" tests/unit/preference-door-conformance.test.ts tests/unit/appearance-actions.test.ts
git commit -m "feat(appearance): give each option its own save door

One form action per field, each a strictObject with one required key.
The old schema required all four selects at once, so a single-field post
failed with errors naming three fields the user never touched -- and it
still stripped a mistyped field name silently.

Both API doors now spread the registry-derived shapes, and heatmapPeriod
adopts the import door's 1..3650 bound: it was unbounded at /api/v1 and
reaches the heatmap's per-day render loop unclamped."
```

---

### Task 9: The client — instant save

**Files:**

- Modify: `src/routes/(app)/settings/appearance/+page.svelte` (full rewrite)

**Interfaces:**

- Consumes: `APPEARANCE_ENTRIES`, `entryFor`, `actionFor`, `type AppearanceKey` from `$lib/appearance/registry`; `enhance` from `$app/forms`; `showToast` from `$lib/components/ui/Toast.svelte`; the action return shapes from Task 8.
- Produces: nothing importable.

**Four traps, each measured, each of which silently breaks a naive version:**

- `update()` defaults to `reset: true`, and Svelte's hydration strips `checked`/`value` **attributes** while keeping the properties — so `defaultChecked` is `false` and `form.reset()` blanks the control you just saved. **Always `update({ reset: false })`.**
- `selected={...}` and `value={...}` are one-way. Once the user touches a `<select>`, the option's dirtiness flag makes the content attribute inert, so re-rendering the server value does **not** put it back — verified in a real Chromium; jsdom disagrees, so a jsdom test of the revert would pass while production is broken. Use `bind:`.
- On a failure, `use:enhance`'s fallback does not `invalidateAll`, so `data.preferences` is byte-identical and no effect re-runs. The explicit assignment in the callback is the **only** thing that reverts the control.
- A successful save calls `invalidateAll`, which re-runs the `(app)` layout load and returns **every** preference. Without a guard, saving the accent stamps the server's 200ms-stale density over a change the user just made.

- [ ] **Step 1: Rewrite the script block**

Replace lines 1-28 of `src/routes/(app)/settings/appearance/+page.svelte` with:

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import { onDestroy } from "svelte";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { showToast } from "$lib/components/ui/Toast.svelte";
  import { APPEARANCE_ENTRIES, actionFor, entryFor } from "$lib/appearance/registry";
  import type { AppearanceKey } from "$lib/appearance/registry";
  import type { SubmitFunction } from "@sveltejs/kit";

  let { data } = $props();

  const presetColours = entryFor("accentColor").presets;

  /**
   * One settled control produces one POST. Long enough to swallow the
   * per-option `change` events a closed <select> fires under arrow keys
   * (arrowing three options down is three change events in Chrome), short
   * enough that the blur flush is the rare path rather than the normal one.
   */
  const SAVE_DEBOUNCE_MS = 400;

  // Local two-way state seeded from the server payload. `value={...}` is
  // one-way in Svelte 5 -- settings/notifications:56-62 documents the same
  // trap -- and this is also the revert target, because on a failure
  // `data` never changes and nothing else puts the control back.
  let values = $state({
    accentColor: data.preferences.accentColor,
    dateFormat: data.preferences.dateFormat,
    timeFormat: data.preferences.timeFormat,
    uiDensity: data.preferences.uiDensity,
    reducedMotion: data.preferences.reducedMotion,
  });

  // Deliberately NOT $state: timers and in-flight bookkeeping are never
  // rendered, and making them reactive would re-run the re-seed effect on
  // every save. `acked` is the last value the SERVER confirmed.
  const timers = new Map<AppearanceKey, ReturnType<typeof setTimeout>>();
  const inFlight = new Set<AppearanceKey>();
  const queued = new Set<AppearanceKey>();
  const formEls = new Map<AppearanceKey, HTMLFormElement>();
  let acked: Record<string, unknown> = { ...data.preferences };

  let status = $state<Record<string, "saving" | "saved" | "error" | undefined>>({});
  let announcement = $state("");
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });

  // Re-seed from the server whenever a load re-runs. A successful save
  // calls invalidateAll, which re-runs the (app) layout load and returns
  // EVERY preference -- so without the guard, saving the accent would
  // stamp the server's stale density over a change made 200ms ago.
  $effect(() => {
    const prefs = data.preferences;
    for (const entry of APPEARANCE_ENTRIES) {
      acked[entry.key] = prefs[entry.key];
      if (timers.has(entry.key) || inFlight.has(entry.key) || queued.has(entry.key)) continue;
      values[entry.key] = prefs[entry.key] as never;
    }
  });

  onDestroy(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  function labelOf(key: AppearanceKey) {
    return entryFor(key).label;
  }

  function queueSave(key: AppearanceKey, event: Event) {
    const control = event.currentTarget as HTMLSelectElement | HTMLInputElement;
    if (control.form) formEls.set(key, control.form);
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        submitField(key);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  /** Tabbing away commits immediately rather than waiting out the debounce. */
  function flushSave(key: AppearanceKey) {
    const timer = timers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(key);
    submitField(key);
  }

  function submitField(key: AppearanceKey) {
    const form = formEls.get(key);
    if (!form) return;
    // Arrowing away and back lands on the value already stored: no POST,
    // so a keyboard user cannot burn a rate-limit token standing still.
    if (values[key] === acked[key]) return;
    form.requestSubmit();
  }

  function save(key: AppearanceKey): SubmitFunction {
    return ({ cancel }) => {
      // Single-flight per key. Cancelling the NEWCOMER and queueing it is
      // what actually serialises the two writes: controller.abort() stops
      // us waiting for the response, it does not stop the server writing,
      // so an aborted A -> B can still land after B -> A. Abort also skips
      // this callback entirely, which would strand `inFlight`.
      // The guard lives here rather than in submitField so it also covers
      // Enter on a control and the pre-hydration Save button.
      if (inFlight.has(key)) {
        queued.add(key);
        cancel();
        return;
      }

      const previous = acked[key];
      const attempted = values[key];
      inFlight.add(key);
      status[key] = "saving";

      return async ({ result, update }) => {
        inFlight.delete(key);

        if (result.type === "success") {
          acked[key] = attempted;
          status[key] = "saved";
          announcement = `${labelOf(key)} saved`;
        } else {
          // `data` is unchanged on a failure, so the re-seed effect above
          // does NOT run: this assignment is the only thing that puts the
          // control back. Skip it if the user already chose something newer.
          if (!queued.has(key)) values[key] = previous as never;
          status[key] = "error";
          showToast(
            result.type === "failure" && typeof result.data?.saveError === "string"
              ? result.data.saveError
              : `Could not save ${labelOf(key).toLowerCase()}.`,
            "error",
          );
        }

        // reset:false is not optional: hydration strips the checked/value
        // ATTRIBUTES while keeping the properties, so form.reset() blanks
        // the control that was just saved.
        await update({ reset: false });

        if (queued.delete(key)) submitField(key);
      };
    };
  }

  function statusText(key: AppearanceKey) {
    if (status[key] === "saving") return "Saving…";
    if (status[key] === "saved") return "Saved";
    if (status[key] === "error") return "Not saved";
    return "";
  }
</script>
```

- [ ] **Step 2: Rewrite the markup**

Replace the body (everything from `<div class="mx-auto ...">` to the end) with one form per control. Delete the `{#if form?.success}` banner at lines 40-44 — with five named actions `form` is "whichever field responded last", so a density failure would light up a success banner keyed to nothing.

```svelte
<svelte:head>
  <title>Appearance — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary transition-colors">&larr;</a>
    <h1 class="text-2xl font-bold">Appearance</h1>
  </div>

  <!-- Single polite region for every outcome, outside every form so a
       control is not re-announced when its own result changes. Mirrors
       settings/notifications:406-408. The Toast is NOT a polite channel
       despite its container -- each item carries role="alert" -- so it
       carries failures only. -->
  <p role="status" class="sr-only">{announcement}</p>

  <GlassCard>
    <div class="space-y-6">
      <form method="POST" action={actionFor("accentColor")} use:enhance={save("accentColor")}>
        <fieldset class="m-0 border-0 p-0">
          <legend class="mb-2 block text-sm font-medium">{entryFor("accentColor").label}</legend>
          <div class="flex flex-wrap gap-2">
            {#each presetColours as colour (colour)}
              <label class="cursor-pointer">
                <input
                  type="radio"
                  name="accentColor"
                  value={colour}
                  bind:group={values.accentColor}
                  onchange={(event) => queueSave("accentColor", event)}
                  class="peer sr-only"
                />
                <span
                  class="border-text-primary peer-checked:scale-110 peer-checked:border-2 peer-focus-visible:ring-accent-ink block h-8 w-8 rounded-full border-2 border-transparent transition-transform hover:scale-110 peer-focus-visible:ring-2"
                  style="background-color: {colour}"
                ></span>
                <span class="sr-only">{colour}</span>
              </label>
            {/each}
          </div>
        </fieldset>
        {#if !hydrated}
          <button
            type="submit"
            class="bg-accent text-accent-fg mt-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            Save accent colour
          </button>
        {/if}
        <p class="text-text-muted mt-1 h-4 text-xs" aria-hidden="true">
          {statusText("accentColor")}
        </p>
      </form>

      {#each APPEARANCE_ENTRIES.filter((e) => e.control === "select") as entry (entry.key)}
        <form method="POST" action={actionFor(entry.key)} use:enhance={save(entry.key)}>
          <label for={entry.key} class="mb-1 block text-sm font-medium">
            {entry.label}
            {#if entry.description}
              <Tooltip text={entry.description} />
            {/if}
          </label>
          <select
            id={entry.key}
            name={entry.key}
            bind:value={values[entry.key]}
            onchange={(event) => queueSave(entry.key, event)}
            onblur={() => flushSave(entry.key)}
            class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          >
            {#each entry.options as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          {#if !hydrated}
            <button
              type="submit"
              class="bg-accent text-accent-fg mt-2 rounded-lg px-4 py-2 text-sm font-medium"
            >
              Save {entry.label.toLowerCase()}
            </button>
          {/if}
          <p class="text-text-muted mt-1 h-4 text-xs" aria-hidden="true">
            {statusText(entry.key)}
          </p>
        </form>
      {/each}

      <form method="POST" action={actionFor("reducedMotion")} use:enhance={save("reducedMotion")}>
        <div class="flex items-center gap-3">
          <!-- The hidden "off" precedes the checkbox so the key is ALWAYS
               present: an unchecked box submits nothing, and a required
               arity cannot tell that apart from a mistyped field name.
               Object.fromEntries keeps the last duplicate, so "on" wins
               whenever the box is checked. Same pattern as
               MedicationNotificationFields.svelte:44-59. -->
          <input type="hidden" name="reducedMotion" value="off" />
          <input
            type="checkbox"
            id="reducedMotion"
            name="reducedMotion"
            value="on"
            bind:checked={values.reducedMotion}
            onchange={(event) => queueSave("reducedMotion", event)}
            class="border-border-strong bg-surface-raised text-accent-ink focus:ring-accent-ink h-4 w-4 rounded-xs"
          />
          <label for="reducedMotion" class="text-sm font-medium">
            {entryFor("reducedMotion").label}
            <Tooltip text={entryFor("reducedMotion").description!} />
          </label>
        </div>
        {#if !hydrated}
          <button
            type="submit"
            class="bg-accent text-accent-fg mt-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            Save motion setting
          </button>
        {/if}
        <p class="text-text-muted mt-1 h-4 text-xs" aria-hidden="true">
          {statusText("reducedMotion")}
        </p>
      </form>
    </div>
  </GlassCard>
</div>
```

Two notes:

- The `<option>`s carry **no `selected` attribute**. `bind:value` emits `selected=""` on the correct option during SSR, so the no-JS POST still sends the stored value, and `bind:` is what makes the failure revert actually land.
- The swatches become real radios. Today they are `<button type="button">` plus a hidden input, which means **without JS the accent cannot be changed at all**. Radios also fix the `a11y_label_has_associated_control` warning at the current `:49` and give roving arrow-key focus with "3 of 10" announcements.

- [ ] **Step 3: Type-check and lint**

```bash
npm run check && npm run lint
```

Expected: 0 errors. The `state_referenced_locally` warnings on the `data.preferences.*` seed lines are expected — `settings/notifications/+page.svelte:62-65` already produces the identical warning. The `a11y_label_has_associated_control` warning at the old `:49` must be **gone**; if it is not, the legend/fieldset did not land.

- [ ] **Step 4: Verify in the browser**

Start the dev server and drive it. This is the only way to check the four traps — none of them is visible to a unit test, and two of them behave differently in jsdom than in a real browser.

Check, in order:

1. Change the density select. Within ~400ms the page re-themes and "Display Density saved" is in the polite region. **One** POST in the network panel, not one per keypress.
2. Arrow through the date-format select with the keyboard from the closed state. Still one POST.
3. Arrow away and back to the original value. **Zero** POSTs.
4. Pick a different accent swatch. The whole app re-tints without a page load.
5. Toggle reduce-motion off and on rapidly. Two POSTs, in order, and the checkbox ends where you left it — not blanked.
6. Disable JavaScript entirely and reload. Every control has its own Save button; each one saves exactly its own field.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(app)/settings/appearance/+page.svelte"
git commit -m "feat(appearance): save each control as you change it

One form per control, debounced 400ms and single-flighted per key so a
settled control produces one POST and two rapid changes land in order.
The swatches become real radios -- as type=button they could not be
changed at all without JavaScript, and the label had no associated
control.

update({ reset: false }) is load-bearing: hydration strips the
checked/value attributes while keeping the properties, so the default
reset blanks the control that was just saved."
```

---

### Task 10: The import round-trip conformance case

**Files:**

- Modify: `tests/unit/import-round-trip.test.ts`

**Interfaces:**

- Consumes: the existing round-trip harness in that file.
- Produces: nothing.

The compiler now guarantees both API doors cover every registry key, and the conformance test covers the seven keys the registry does not own. This adds the end-to-end proof the spec asks for: a value set to a non-default survives export → import.

- [ ] **Step 1: Add the case**

In `tests/unit/import-round-trip.test.ts`, add:

```ts
it("round-trips every appearance option at a non-default value", async () => {
  // The failure this guards is silent: serializePreferences spreads the
  // whole row, so a field missing from the import schema is emitted on
  // export and dropped on the way back in -- a 200, no error, no audit
  // row, and the setting is gone. Non-default values only, or a
  // dropped field would look identical to a preserved one.
  const preferences = {
    accentColor: "#f97316",
    dateFormat: "YYYY-MM-DD" as const,
    timeFormat: "24h" as const,
    uiDensity: "compact" as const,
    reducedMotion: true,
  };

  const exported = serializePreferences({ ...BASE_PREFERENCES, ...preferences });
  const parsed = backupEnvelopeSchema.safeParse({
    version: 1,
    preferences: exported,
  });

  expect(parsed.success).toBe(true);
  expect(parsed.data!.preferences).toMatchObject(preferences);
});
```

Adapt `BASE_PREFERENCES` and the envelope construction to whatever the file already uses — read its existing preference case around `:136-151` and follow it exactly rather than introducing a second style. If the file has no preferences fixture, build one from the `BASE_ROW` shape in `tests/unit/pg/preferences.test.ts`.

- [ ] **Step 2: Run it**

```bash
npx vitest run tests/unit/import-round-trip.test.ts
```

Expected: passing.

- [ ] **Step 3: Prove it by mutation**

Temporarily delete `uiDensity` from `appearanceImportShape` in `src/lib/appearance/schema.ts`. Expected: `npm run check` errors on the `satisfies` clause, and this round-trip case fails on the `toMatchObject`. Revert.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/import-round-trip.test.ts
git commit -m "test(import): prove every appearance option survives the round trip

A field the export emits but the import schema does not declare is
dropped with a 200, no error and no audit row. Non-default values only,
or a dropped field looks identical to a preserved one."
```

---

### Task 11: Documentation

**Files:**

- Modify: `docs/api-v1-contract.md` (§3 around `:343-362`, and the `update_preferences` row at `:436`)
- Modify: `docs/database.md`
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the API contract**

At `docs/api-v1-contract.md:343-362`, the `SerializedPreferences` restatement types `dateFormat`, `timeFormat`, `uiDensity` and `exportFormat` as **unions**, while `serializePreferences` and `UserPreferences` both say `string`. Replacing the inline literal with `UserPreferences` (Task 7) widens those four, moving the doc further from the code. Add a note recording it rather than silently leaving the doc wrong:

> The four enum-valued fields are `string` in the emitted type, not unions — the column type is `text` and the doors, not the serializer, enforce the value set. `src/lib/appearance/schema.ts` exports `AppearanceValues` if a client wants the narrow type.

At `:436`, update the `update_preferences` row to record the new bound:

> `updatePreferencesPayload`: all fields optional. `heatmapPeriod` is bounded 1–3650 (it was previously unbounded here and bounded only at the import door; the value reaches the heatmap's per-day render loop unclamped).

- [ ] **Step 2: Update `docs/database.md`**

No columns changed. Add one line to the `user_preferences` section recording that `updatePreferences` is now a single locking-CTE statement and why:

> Writes go through `updatePreferences`, which reads its audit before-image inside the write (`WITH previous AS (SELECT … FOR UPDATE)`). A separate `SELECT` let two overlapping saves diff against the same row and lose an audit row.

- [ ] **Step 3: Update `CLAUDE.md`**

The "Key Patterns" paragraph on `updatePreferences` is now partly stale — it says callers "just call it", which is still true, but it describes the before-image as a prior read. Replace that paragraph's second half and add the registry rule. Insert into **Key Patterns**:

```markdown
- `updatePreferences` in `src/lib/server/preferences.ts` is the **only** audited write path for user preferences — it reads the before-image, writes, and logs the diff itself. Callers (the five appearance field actions, the notifications and data form actions, and the `/api/v1` `update_preferences` command) just call it; never re-hand-roll a `computeChanges` subset at a door, and never write `user_preferences` directly. The diff is scoped to `Object.keys(updates)` because `updatedAt` is rewritten on every save and a whole-row diff would log a change on a no-op. **The before-image comes from a locking CTE inside the write** (`WITH previous AS (SELECT … FOR UPDATE)`), not a prior `SELECT`: instant save means two requests for the same field overlap, and a separate read let both diff against the same row so the second change was never audited. Because the correctness is decided by the database, that test lives on PGlite (`tests/unit/pg/preferences-audit.test.ts`) and the whole `preferences` suite moved with it — `fake-db` has no `$with`, no update `.from()` and no select `.for()`, and per the test-seam rule it must not grow them.
- **`src/lib/appearance/` is two modules on purpose.** `registry.ts` is metadata — key, group, label, control kind, DOM binding — with **no zod** and only `import type` from `$lib/server/*`, because the appearance page imports it and nothing client-side reaches zod today (`tests/unit/appearance-bundle-boundary.test.ts` holds that line, erasing type-only edges because six `.svelte` files reach zod through them). `schema.ts` imports the registry plus zod and is imported only from server files. **The bound belongs to the arity, not the option:** the form door is a `strictObject` with one required key per action, the `/api/v1` door is all-optional and JSON-native, and the import door is all-optional and bounded. Collapsing them changes behaviour at whichever door loses — `heatmapPeriod` was the proof, and an all-optional form door is worse than a no-op, because the checkbox transform fires on an empty parse and writes `false` over the user's setting.
```

- [ ] **Step 4: Update `CHANGELOG.md`**

Under `## [Unreleased]`, add to **Changed**:

```markdown
- Appearance settings save as you change them. Each control posts its own field to its own form action rather than one bulk save, debounced so a settled control produces one request, single-flighted per field so two rapid changes land in order, and rate-limited per user. Without JavaScript each control keeps its own Save button; the accent swatches become real radios, which means the accent can be changed without JavaScript at all for the first time.
- The `/api/v1` `update_preferences` door bounds `heatmapPeriod` to 1–3650, matching the import door. It was unbounded, and the value reaches the activity heatmap's per-day render loop unclamped.
```

and to **Fixed**:

```markdown
- Preference changes can no longer lose an audit row. `updatePreferences` read its before-image in a separate query, so two overlapping saves for the same field both diffed against the same stored value and the second change went unlogged — leaving the audit log claiming a value the column did not hold. The before-image now comes from a locking read inside the write itself.
```

- [ ] **Step 5: Final verification**

```bash
npx vitest run && npm run check && npm run lint && npm run format:check && npm run build
```

Expected: all tests passing, 0 check errors, clean lint and format, successful build. The build runs with a placeholder `DATABASE_URL`, so a build failure here means something reads the database at module scope.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md CHANGELOG.md
git commit -m "docs: record the preference substrate's invariants

The registry/schema split and its no-zod-client rule, the three-arity
rule and why collapsing it changes behaviour at a door, and the locking
before-image plus why its test lives on PGlite."
```

---

## Self-review against the spec

**Spec coverage.** Every item in the "1b — Preference substrate" section maps to a task:

| Spec requirement                                                       | Task    |
| ---------------------------------------------------------------------- | ------- |
| Registry as two modules (decision 6)                                   | 3, 4    |
| Per-field actions, three arities (decision 7)                          | 4, 5, 8 |
| Audit before-image inside the write (decision 8)                       | 1, 2    |
| Client-side serialisation of in-flight saves                           | 9       |
| `serializePreferences` inline literal → `UserPreferences`              | 7       |
| `ImportPreferences` → `Partial<Omit<…>>`                               | 7       |
| Conformance test over both API-door schemas                            | 5       |
| `import-round-trip.test.ts` gains a non-default case                   | 10      |
| No `.svelte` transitively imports zod                                  | 6       |
| Rate limiting + debounce                                               | 8, 9    |
| `preferences.test.ts` extends `BASE_ROW`, diff scoping per field       | 2       |
| Audit-race test on PGlite, not `fake-db`                               | 1       |
| Docs: api-v1-contract §3 and `:436`, database.md, CLAUDE.md, CHANGELOG | 11      |

**Deliberate deviations from the spec, each argued above:**

- The spec says the fix needs "client-side serialisation that aborts an in-flight save for the same key". Task 9 **queues the newcomer and cancels it** instead. `controller.abort()` stops the client waiting; it does not stop the server writing, so an aborted A→B can still land after B→A. Abort also skips the enhance callback entirely, stranding the in-flight bookkeeping.
- The spec proposes making the form door's schema per-field but does not specify `strictObject`. Measured, a plain `z.object` still strips a mistyped field name, so the spec's stated goal ("a mistyped field name becomes a no-op instead of a 400") is not actually achieved without it.
- The spec's parenthetical that PGlite is absent from this worktree's `node_modules` is stale — it is installed, all 10 pg files pass, and the `npm run check` baseline is 0 errors rather than 3.
- Line references in the spec that 1a moved (`+page.svelte:9-18` → `:14-25`; `+layout.svelte:14-27` → extracted to `contrast.ts`; `+layout.svelte:37-38` → `:30-35`, now **three** inline vars, not two) are corrected in this plan's own references.

**No columns are added and no migration is needed.** The `theme` field the spec's Testing section discusses arrives in 1c; what 1b ships is the conformance test and the compiler-level `satisfies` coverage that will catch its omission.
