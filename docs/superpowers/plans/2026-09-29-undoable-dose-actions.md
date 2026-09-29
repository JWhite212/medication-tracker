# Undoable, Single-Fire Dose Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dose delete undoable, give the medications card's Log an Undo, and close every remaining double-fire and stock-minting path for dose writes.

**Architecture:**

- **Server.** A deleted dose moves into a new `dose_log_trash` table in the same transaction as its hard delete and tombstone. Undo moves it back by `(doseId, deletedAt)` within a 10-minute window.
- **Lock order.** Every dose write and every writer of `medications.inventory_count` locks the medication row first, then the dose or trash row. Trash purges skip rows another transaction has locked.
- **Guarded dashboard writes.** Log now, Took it at and Skip all re-derive `slotActions` under that lock.
- **Client.** One write lock is owned by the `(app)` layout. The shared primitive `createDoseWrite` (`src/lib/components/dose-writes/`) is the only path for dose writes, and it never calls enhance's `update()`. A single Undo offer lives in a module registry that Toast renders.

**Tech Stack:**

- SvelteKit 2.70 with Svelte 5 runes
- TypeScript
- Drizzle ORM on Neon Postgres, with `drizzle-kit generate` for the migration
- Tailwind v4 semantic tokens
- Zod 4
- Vitest 4: jsdom by default, `node` for SSR and PGlite files
- The `fake-db` and PGlite test seams
- Playwright e2e (not run in CI)

**Spec:** `docs/superpowers/specs/2026-09-25-undoable-dose-actions-design.md`. Read it before starting any task. Every task implements part of it, and its decisions D1–D10 are binding. Where this plan and the spec differ, the plan's **Spec deviations** section says so explicitly. Anything not listed there follows the spec.

## Global Constraints

**Code conventions**

- Svelte 5 runes only (`$props`, `$state`, `$derived`, `$effect`). No `export let`.
- Semantic tokens only:
  - `accent` is the fill, `accent-ink` is text, border or ring, and `accent-fg` is text on the fill.
  - Control boundaries use `border-strong`; `glass-border` is only for decorative hairlines.
- Import rune modules without a suffix, e.g. `$components/dose-writes/dose-write-lock.svelte`, never `.svelte.ts` or `.js`.
- `src/lib/utils/**` must not import `$lib/server/*`, except type-only imports.
- Commit messages are Conventional Commits with **no Claude/AI attribution**: no `Co-Authored-By`, no session links, no "Generated with".

**Dose controls**

- Every dose control is at least 44×44px, sized from fixed `h-11` / `min-h-11` / `size-11` classes, never from padding.
  - **The one exception** (spec Section 3) is the /log row's ✎ and ×, which keep `size-8 pointer-coarse:size-11`: 32px for a mouse, 44px on a coarse pointer.
- Dose controls signal busy with `aria-disabled`, never the `disabled` attribute, which drops keyboard focus to `<body>`.

**Server actions and failures**

- Every action under `src/routes/(app)/` opens with `if (!locals.user) error(401, "Unauthorized")`, directly or through a shared helper that does it first.
- `tests/unit/app-action-auth-guard.test.ts` gets a case for every new action.
- `actionErrorMessage` (`src/lib/utils/form-errors.ts`) is the only reader of a failed action result.
- No dose write calls enhance's `update()`. Reloads go through `reloadAfterWrite()` (Task 7).

**Server rules (D6, D7)**

- **D7 lock order:** medication rows first (ascending `id` when there are several), then dose or trash rows.
- Trash purges use `FOR UPDATE SKIP LOCKED` and never wait.
- `loggedAt` and `deletedAt` are read from `new Date()` **after** the medication lock is taken. `takenAt` keeps the action's `now`.
- **D6 restore contract:**
  - same id;
  - keyed on `(doseId, deletedAt)`;
  - refused as `logged_since` when any dose of that medication has `loggedAt > deletedAt`;
  - window `DOSE_UNDO_WINDOW_MS = 10 * 60_000`;
  - "expired" means `deleted_at <= now − DOSE_UNDO_WINDOW_MS`.
- Restore takes back `min(locked count, inventoryCredited)`, which is 0 when the count is NULL. Never `inventoryApplied`, never `quantity`.
- No audit diff may carry note text: the `delete` and `restore` audit rows have `changes` undefined or null.
- `serializeDoseLog` stays a field-by-field projection. Wire formats are additive only.

**Test seams**

- Use `fake-db` unless the behaviour is decided by the database. Anything the database decides runs on PGlite in `tests/unit/pg/`.
- PGlite files:
  - start with `// @vitest-environment node`;
  - freeze time with `vi.useFakeTimers({ toFake: ["Date"] })`, never all timers;
  - seed `seedUser` → `seedMedication` → `seedDose`/`seedTrash`/`seedTombstone`, in that order.
- PGlite serialises transactions. **No test may claim to exercise a race.** Cover a losing side by seeding the state it would see and calling it sequentially, and pin each lock's SQL through `pgDb.queryLog`.
- **Prove every new test by mutation** where a step names one: break the named production line, watch the named test fail, restore it. A test that survives its mutation does not ship.

**Copy (exact strings, from `src/lib/components/dose-writes/copy.ts`, created in Task 7)**

| Constant                 | Text                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `OFFLINE_WRITE_TOAST`    | `You're offline — nothing was saved.`                                              |
| `UNKNOWN_OUTCOME_TOAST`  | `Couldn't confirm that saved — this page will update when the connection is back.` |
| `STILL_SAVING_TOAST`     | `Still saving your last change…`                                                   |
| `UNDO_OFFLINE_MESSAGE`   | `You're offline — Undo will still be here when you're back.`                       |
| `UNDO_NETWORK_MESSAGE`   | `Couldn't reach the server. The undo may not have gone through.`                   |
| `UNDONE_TOAST`           | `Undone`                                                                           |
| `RESTORED_TOAST`         | `Dose restored`                                                                    |
| `STALE_TAP_MESSAGE`      | `The list just updated — check it and tap again` (unchanged)                       |
| `SUCCESS_FALLBACK_TOAST` | `Saved` (unchanged)                                                                |

**Server copy (`src/lib/server/dose-actions.ts`)**

- `RESTORE_GONE_MESSAGE` (410): `Too late to undo. Log it again if you need it.`
- `RESTORE_LOGGED_SINCE_MESSAGE` (409): `A newer entry exists for this medication, so Undo wasn't applied.`

**Formatting and verification**

- `formatUserTime` renders single-digit hours unpadded ("9:00"). Examples like "08:00" are illustrative: assert what `formatUserTime` produces.
- Final verification (Task 14): `npm run check`, `npm run lint`, `npm run format:check`, `npx vitest run` and `npm run build` all pass.

## Review Focus

The five failure modes most likely to reach a real person. Each one has its test in the task named.

1. **A flaky connection during a chip log.**
   - The condition: the request fails with no status while `navigator.onLine` is true.
   - Expected: the lock stays held, `/api/health` is probed, and exactly one reload runs when it answers. No retry can run against unchecked data, so no duplicate dose. (Task 9)
2. **Undo after a refill, when the dose was logged at zero stock.**
   - The sequence: log at stock 0 (applied 0), refill, delete, Undo.
   - Expected: stock is unchanged by the round trip, because `inventoryCredited` is 0. (Task 3)
3. **Undo after leaving the page, and after signing out.**
   - After navigating away: the Undo holds the layout lock the new page reads. (Task 8)
   - After signing out and in on the same device: no offer survives, because the registry is cleared when the layout unmounts. (Task 8)
4. **A keyboard user deletes the last dose of a day on /log, then presses Undo.**
   - After the delete: focus goes to the next day's first ✎, never `<body>`.
   - After the Undo: focus goes to the restored row's ✎. (Task 12)
5. **The medication changes between delete and Undo.**
   - Archived in between: the restore still succeeds.
   - Deleted in between (archived wipe or import replace): the cascade removed the trash row, so Undo reports "Too late to undo". (Task 3 and Task 5)

## Spec deviations

- **The trash owner scan lists `db/schema.ts`, `doses.ts` and `api/wipe.ts`.** `retention.ts` reaches the table only by calling `purgeExpiredTrash` from `doses.ts`. The SKIP LOCKED purge SQL therefore exists once, not twice. (Spec Section 5 listed `retention.ts` as an owner.)
- **The delete actions parse `doseDeleteSchema`, not `doseIdSchema`.** `doseDeleteSchema` is `doseIdSchema.extend({ forUndo: z.literal("1").optional() })`, which carries D8's create-Undo flag through Zod. A parse failure keeps today's `fail(400, { error: "Missing dose ID" })`.
- **A legacy `takenAt`-only Skip calls `skipDoseForSlot(…, new Date(takenAt), …)`.** The spec's acceptance rule, `rows.get(takenAt)?.skipAt === takenAt`, is exactly the condition under which that call succeeds. A pre-deploy page posts `min(slot, renderNow)`: that equals the row key only for a past slot, and a past slot's server `skipAt` is the slot itself. So no second code path exists.
- **The spec's Rollout claim needs a qualifier.** "Once version polling notices the deploy, the next 409 reloads the tab" holds only for tabs loaded **from this release onward**.
  - A tab loaded before this release runs the old client, which neither polls for a version nor checks `updated.current`.
  - It keeps getting a 409 for a Skip on a slot still ahead until it is reloaded by hand.
  - Task 14's CLAUDE.md text and the PR's Rollout section say so.
- **`buildToast` also receives the response's arrival time:** `(doseId, respondedAt: Date)`.
  - That lets the medications card's toast show when the log landed (spec Section 3), not when the reload finished.
  - The Undo offer's deadline likewise counts from `respondedAt`, as the spec's "after the response arrives" requires.
- **The unguarded skip path now locks the medication too** (Task 4). D7's "read `loggedAt` after the lock" needs a lock on every insert path, and the spec's "every per-dose write" includes the legacy skip-at-now and the Mac's `skip_dose`.

## File Structure

| File                                                                                                                                           | Responsibility                                                                                                                                                                     | Task       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `src/lib/server/db/schema.ts`                                                                                                                  | `doseLogTrash`; `InventoryEventType` + `"dose_restored"`                                                                                                                           | 1          |
| `drizzle/0021_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0021_snapshot.json`                                                          | generated migration                                                                                                                                                                | 1          |
| `src/lib/utils/dose-undo.ts` (new)                                                                                                             | `DOSE_UNDO_WINDOW_MS`                                                                                                                                                              | 1          |
| `src/lib/utils/validation.ts`                                                                                                                  | `doseIdSchema`, `doseDeleteSchema`, `doseRestoreSchema`, import enum; `doseSkipSchema.forSlot`                                                                                     | 1, 6       |
| `src/lib/server/audit.ts`                                                                                                                      | action `"restore"`                                                                                                                                                                 | 1          |
| `src/routes/(app)/medications/[id]/+page.svelte`                                                                                               | "Dose restored" history label                                                                                                                                                      | 1          |
| `tests/unit/helpers/pg-db.ts`                                                                                                                  | `seedTrash`, `seedTombstone`                                                                                                                                                       | 1          |
| `src/lib/server/doses.ts`                                                                                                                      | `deleteDose`, `purgeExpiredTrash` (2); `restoreDose`, `takeFromStock` (3); locked `updateDose`/`logDose`/skips (4); `logDoseAtSlot`, `skipDoseForSlot`, `recomputeSlotActions` (6) | 2, 3, 4, 6 |
| `src/lib/server/dose-actions.ts` (new)                                                                                                         | `deleteDoseAction`, `restoreDoseAction`, restore copy                                                                                                                              | 2, 3       |
| `src/routes/(app)/dashboard/+page.server.ts`                                                                                                   | delete/restore actions via helpers; Took it at / Skip routing                                                                                                                      | 2, 3, 6    |
| `src/routes/(app)/log/+page.server.ts`                                                                                                         | delete action via helper                                                                                                                                                           | 2          |
| `src/lib/server/api/commands.ts`                                                                                                               | `delete_dose` with `keepForUndo: false`                                                                                                                                            | 2          |
| `src/lib/server/inventory-events.ts`                                                                                                           | refill and adjust lock the medication                                                                                                                                              | 4          |
| `src/lib/server/api/wipe.ts`                                                                                                                   | `wipeDoseHistory`: lock medications → delete doses → delete trash                                                                                                                  | 5          |
| `src/lib/server/retention.ts`                                                                                                                  | `dose-log-trash` policy                                                                                                                                                            | 5          |
| `src/lib/components/dose-writes/` (new dir)                                                                                                    | `dose-write-lock.svelte.ts` (moved + `active`), `copy.ts`, `reload-after-write.ts`, `focus-after.ts` (moved + opts) (7); `undo-registry.svelte.ts` (8); `dose-write.svelte.ts` (9) | 7, 8, 9    |
| `src/lib/components/dashboard/dashboard-clock.ts`                                                                                              | seed without arming; `isExpired()`                                                                                                                                                 | 7          |
| `src/lib/components/dashboard/dose-action.ts`                                                                                                  | deleted (constants move to `dose-writes/copy.ts`)                                                                                                                                  | 7          |
| `src/routes/(app)/+layout.svelte`                                                                                                              | sets the write lock; clears the registry and toasts on destroy                                                                                                                     | 7, 8       |
| `svelte.config.js`                                                                                                                             | `kit.version.pollInterval: 300_000`                                                                                                                                                | 7          |
| `src/lib/components/ui/Toast.svelte`                                                                                                           | renders the Undo offer, Dismiss, `clearToasts`; legacy `undoAction` removed                                                                                                        | 8, 9       |
| `src/lib/components/dashboard/DoseActionForm.svelte`                                                                                           | markup over `createDoseWrite`; `undo`/`withdrawsUndoFor` props                                                                                                                     | 9          |
| `src/lib/components/dashboard/DueCard.svelte`                                                                                                  | Skip posts `forSlot` (6); `undo` focus targets (9)                                                                                                                                 | 6, 9       |
| `src/lib/components/QuickLogBar.svelte`                                                                                                        | `undo` focus target (9); `li` `box-content` (10)                                                                                                                                   | 9, 10      |
| `src/lib/components/dashboard/DoneList.svelte`, `dashboard/+page.svelte`                                                                       | "Remove skip", `data-dose-id`, restore offers; Remove's restore offer; clock seeding (7)                                                                                           | 7, 10      |
| `src/lib/components/KeyboardShortcuts.svelte`                                                                                                  | ignore `e.repeat`; ignore while `[aria-modal="true"]` is present                                                                                                                   | 10         |
| `src/lib/components/DoseEditForm.svelte`                                                                                                       | shared lock, offline gate, Undo withdrawal/clear, `reloadAfterWrite`                                                                                                               | 11         |
| `src/lib/components/TimelineEntry.svelte`, `src/routes/(app)/log/+page.svelte`                                                                 | one-tap × with a restore offer; `dayLabel`; `data-dose-id`/`data-edit`; `h1` `tabindex="-1"`                                                                                       | 12         |
| `src/lib/components/MedicationCard.svelte`, `src/routes/(app)/medications/+page.svelte`                                                        | form through the primitive; `timezone`/`timeFormat` props; reorder under the lock; `h1` `tabindex="-1"`                                                                            | 13         |
| `tests/unit/helpers/dashboard-context.ts`                                                                                                      | `doseWriteContext()`; `fixedClock` gains `isExpired`                                                                                                                               | 7          |
| `tests/e2e/dose-logging.test.ts`                                                                                                               | one-click delete, then Undo                                                                                                                                                        | 14         |
| `CLAUDE.md`, `docs/adr/0008-undoable-deletes.md` (new), `docs/adr/README.md`, `docs/database.md`, `docs/RUNBOOK.md`, `docs/api-v1-contract.md` | docs                                                                                                                                                                               | 14         |

## Execution notes

- **Ship as one PR.** Every commit stays green, but the intermediate states aren't meant to deploy on their own. For example, after Task 2 deletes write trash rows that nothing can restore until Task 3.
- **Order:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14. Tasks 1–6 are server work and 7–13 are client work. Task 7 needs no server task, but keep the order so each review sees the server contract first.
- **Anchor edits on quoted code, not line numbers.** Line numbers are from `HEAD` at planning time (`a9ad7d8`). Earlier tasks move code, so find each block by the code a step quotes.
- **This worktree has no `node_modules`.** Commands resolve packages from the parent checkout (`../../../node_modules`), which has `@electric-sql/pglite` 0.5.5 and vitest 4.1.5. PGlite suites therefore run here. If one fails to import, run `npm install --no-save @electric-sql/pglite` outside the sandbox.
- **The migration's file name is random** (`drizzle/0021_<adjective>_<noun>.sql`). Later tasks refer to it as `drizzle/0021_*.sql`.

---

### Task 1: Trash table, migration and shared definitions

This task only adds definitions. No production code path reads or writes the trash yet: Task 2 writes it and Task 3 restores from it. Every commit stays green.

**Files:**

- Create: `src/lib/utils/dose-undo.ts`
- Modify: `src/lib/server/db/schema.ts` (anchors: `  | "dose_deleted"` inside `export type InventoryEventType =`; `export type DoseLogStatus = "taken" | "skipped" | "missed";`; the comment line `    // Signed delta applied to inventory_count. dose_taken is negative,`)
- Create (generated by `npx drizzle-kit generate`, never hand-written): `drizzle/0021_<adjective>_<noun>.sql`, `drizzle/meta/0021_snapshot.json`
- Modify (generated): `drizzle/meta/_journal.json`
- Modify: `src/lib/server/audit.ts` (anchor: `  action: "create" | "update" | "delete" | "failed_login",`)
- Modify: `src/lib/utils/validation.ts` (anchors: `export const doseSkipSchema = z.object({`; `    "dose_deleted",` inside `export const importInventoryEventSchema = z.object({`)
- Modify: `src/routes/(app)/medications/[id]/+page.svelte` (anchor: `    dose_deleted: "Dose deleted",`)
- Modify: `tests/unit/helpers/pg-db.ts` (anchors: `export const pgDb = {`; the closing `}` of `export async function seedSchedule(`)
- Test (create): `tests/unit/dose-undo.test.ts`, `tests/unit/inventory-event-types.test.ts`, `tests/unit/dose-log-trash-columns.test.ts`, `tests/unit/pg/dose-log-trash-schema.test.ts`
- Test (modify): `tests/unit/validation.test.ts`, `tests/unit/import-backup.test.ts`, `tests/unit/audit.test.ts`, `tests/unit/helpers/pg-db.test.ts`

Not in this task: the fourth home of `dose_restored`, the `eventType` list in `docs/api-v1-contract.md:351`, belongs to Task 14 with the other docs.

**The migration's file name is random.** `package.json` runs drizzle-kit as `npx drizzle-kit generate` (`"db:generate": "drizzle-kit generate"`), with no `--name`, and drizzle-kit picks `0021_<adjective>_<noun>.sql` itself (0014–0020 are all such names). Do not rename the file: the journal's `tag` must equal the file's stem, and PGlite's migrator silently skips any `.sql` file with no journal entry. Later tasks refer to it as `drizzle/0021_*.sql`. `generate` reads only `schema` and `out` from `drizzle.config.ts`, so it needs no database and no `DATABASE_URL`.

**Interfaces:**

- Consumes: nothing. This is the first task.
- Produces (exactly as the contract states them; later tasks rely on these names):
  - `src/lib/utils/dose-undo.ts` (no imports): `export const DOSE_UNDO_WINDOW_MS = 10 * 60_000;`
  - `src/lib/server/db/schema.ts`:
    - `InventoryEventType` gains `| "dose_restored"`.
    - `export const doseLogTrash = pgTable("dose_log_trash", { id, userId, medicationId, quantity, inventoryApplied, inventoryCredited, takenAt, loggedAt, notes, sideEffects, status, deletedAt }, (table) => [index("dose_log_trash_user_deleted_idx").on(table.userId, table.deletedAt)])`, with the column definitions given in Step 23.
  - `src/lib/server/audit.ts`: `logAudit`'s `action` parameter is `"create" | "update" | "delete" | "failed_login" | "restore"`.
  - `src/lib/utils/validation.ts`:
    - `export const doseIdSchema = z.object({ doseId: z.string().min(1).max(64) });`
    - `export const doseDeleteSchema = doseIdSchema.extend({ forUndo: z.literal("1").optional() });`
    - `export const doseRestoreSchema = doseIdSchema.extend({ deletedAt: z.string().datetime() });`
    - `importInventoryEventSchema.shape.eventType` accepts `"dose_restored"`.
  - `src/routes/(app)/medications/[id]/+page.svelte`: `EVENT_LABELS` gains `dose_restored: "Dose restored"`.
  - `tests/unit/helpers/pg-db.ts` (both also on the `pgDb` object):
    - `seedTrash(overrides: Partial<typeof schema.doseLogTrash.$inferInsert> = {})`. Defaults: id `t${seq}`, userId `"u1"`, medicationId `"m1"`, quantity 1, inventoryApplied 1, inventoryCredited 1, takenAt `2026-08-01T08:00:00Z`, loggedAt the same, status `"taken"`, deletedAt `2026-08-01T09:00:00Z`.
    - `seedTombstone(overrides: Partial<typeof schema.syncTombstones.$inferInsert> = {})`. Defaults: id `tomb${seq}`, userId `"u1"`, entityType `"dose_log"`, entityId `"d1"`, deletedAt `2026-08-01T09:00:00Z`.
  - Migration `drizzle/0021_*.sql`: creates `dose_log_trash`, both foreign keys `ON DELETE cascade`, and the index.

**How type-level tests work here.** Several tests below use `expectTypeOf` from `vitest`. Vitest strips types and runs them as no-ops, so **only `npm run check` can fail them**: `svelte-check` type-checks `tests/**/*.ts` (see `.svelte-kit/tsconfig.json`'s `include`). Where a step's red or mutation is type-level, it names `npm run check`, not vitest.

- [ ] **Step 0: Record the baselines**

Run each and write the numbers down; later steps compare against them.

```bash
npx vitest run
npm run check
npm run lint
```

Expected at `a9ad7d8` (measured while writing this plan): vitest `162 passed` files and `2499 passed` tests; `svelte-check found 0 errors and 28 warnings`; eslint `0 errors, 115 warnings`. If yours differ, the counts in Step 36 shift by the same amount.

---

#### Cycle 1: the shared Undo window

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dose-undo.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";

/**
 * The Undo window is one number read on both sides of the wire. The server
 * refuses a restore and purges the trash on it; the client sizes its Undo
 * offer from it. It can be shared only because its module imports nothing, so
 * a client bundle can take it without pulling anything else in.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/lib/utils/dose-undo.ts", import.meta.url)),
  "utf8",
);

describe("DOSE_UNDO_WINDOW_MS", () => {
  it("is ten minutes (spec D6)", () => {
    expect(DOSE_UNDO_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("lives in a module that imports and re-exports nothing", () => {
    expect(SOURCE).not.toMatch(/^\s*import\b/m);
    expect(SOURCE).not.toMatch(/\bimport\s*\(/);
    expect(SOURCE).not.toMatch(/^\s*export\s[^;]*\bfrom\s/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dose-undo.test.ts`
Expected: FAIL. The file cannot load, because `$lib/utils/dose-undo` does not resolve (Vite reports that it failed to resolve or load the import).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/utils/dose-undo.ts`:

```ts
/**
 * How long a deleted dose can be put back: ten minutes from the delete.
 *
 * One constant, read by both sides of the wire. The server refuses a restore
 * once `deleted_at <= now - DOSE_UNDO_WINDOW_MS`, and purges trash rows that
 * old. The client sizes its Undo offer from the same number: a create's Undo
 * lasts this long, and a delete's Undo ends 30s before the server's window
 * does, so a press near the end still arrives in time.
 *
 * This module has no imports, on purpose. `src/lib/utils/` is reachable from
 * the browser, so anything this file pulled in would ship to the client too.
 * `tests/unit/dose-undo.test.ts` holds that line.
 */
export const DOSE_UNDO_WINDOW_MS = 10 * 60_000;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dose-undo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Prove by mutation**

1. In `src/lib/utils/dose-undo.ts`, change `10 * 60_000` to `5 * 60_000`. Run `npx vitest run tests/unit/dose-undo.test.ts`. Expected: FAIL in `is ten minutes (spec D6)`. Restore the line.
2. Add `import { browser } from "$app/environment";` as the file's first line. Run the same command. Expected: FAIL in `lives in a module that imports and re-exports nothing`. Remove the line.
3. Re-run. Expected: PASS.

---

#### Cycle 2: the delete and restore schemas

- [ ] **Step 6: Write the failing test**

In `tests/unit/validation.test.ts`, replace the import block at the top:

```ts
import {
  registerSchema,
  loginSchema,
  medicationSchema,
  doseLogSchema,
  doseEditSchema,
  doseSkipSchema,
  settingsSchema,
} from "$lib/utils/validation";
```

with:

```ts
import {
  registerSchema,
  loginSchema,
  medicationSchema,
  doseLogSchema,
  doseEditSchema,
  doseSkipSchema,
  doseIdSchema,
  doseDeleteSchema,
  doseRestoreSchema,
  settingsSchema,
} from "$lib/utils/validation";
```

Then insert these three blocks immediately before the line `describe("settingsSchema", () => {`:

```ts
describe("doseIdSchema", () => {
  it("accepts a dose id", () => {
    const result = doseIdSchema.safeParse({ doseId: "d1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ doseId: "d1" });
  });

  it("rejects a missing or empty id, so the action answers 400 rather than 404", () => {
    for (const input of [{}, { doseId: "" }]) {
      const result = doseIdSchema.safeParse(input);
      expect(result.success, JSON.stringify(input)).toBe(false);
      if (!result.success) expect(result.error.flatten().fieldErrors.doseId).toBeDefined();
    }
  });

  it("accepts a 64-character id and rejects a 65-character one", () => {
    expect(doseIdSchema.safeParse({ doseId: "x".repeat(64) }).success).toBe(true);
    expect(doseIdSchema.safeParse({ doseId: "x".repeat(65) }).success).toBe(false);
  });
});

describe("doseDeleteSchema", () => {
  it("leaves forUndo undefined when it is absent: an ordinary delete, kept for its Undo", () => {
    const result = doseDeleteSchema.safeParse({ doseId: "d1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.forUndo).toBeUndefined();
  });

  it("accepts forUndo=1: the delete behind a create's Undo, which skips the trash (D8)", () => {
    const result = doseDeleteSchema.safeParse({ doseId: "d1", forUndo: "1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.forUndo).toBe("1");
  });

  it("rejects any other forUndo value rather than guessing which delete was meant", () => {
    for (const forUndo of ["0", "true", "", "yes"]) {
      expect(doseDeleteSchema.safeParse({ doseId: "d1", forUndo }).success, forUndo).toBe(false);
    }
  });

  it("still requires the dose id", () => {
    expect(doseDeleteSchema.safeParse({ forUndo: "1" }).success).toBe(false);
  });
});

describe("doseRestoreSchema", () => {
  it("accepts the delete's ISO instant and keeps it verbatim", () => {
    // The restore matches the trash row on (doseId, deletedAt) to the
    // millisecond, so the string must reach the server exactly as it was sent.
    const result = doseRestoreSchema.safeParse({
      doseId: "d1",
      deletedAt: "2026-08-01T09:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ doseId: "d1", deletedAt: "2026-08-01T09:00:00.000Z" });
    }
  });

  it("rejects a missing deletedAt", () => {
    const result = doseRestoreSchema.safeParse({ doseId: "d1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.deletedAt).toBeDefined();
  });

  it("rejects a datetime-local deletedAt, which names no instant", () => {
    const result = doseRestoreSchema.safeParse({ doseId: "d1", deletedAt: "2026-08-01T09:00" });
    expect(result.success).toBe(false);
  });

  it("still requires the dose id", () => {
    const result = doseRestoreSchema.safeParse({
      doseId: "",
      deletedAt: "2026-08-01T09:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/unit/validation.test.ts`
Expected: FAIL. The 11 new tests fail with `TypeError: Cannot read properties of undefined (reading 'safeParse')`, because the three schemas are not exported yet. Every existing test in the file still passes.

- [ ] **Step 8: Write minimal implementation**

In `src/lib/utils/validation.ts`, find this block:

```ts
export const doseSkipSchema = z.object({
  medicationId: z.string().min(1),
  takenAt: z.string().datetime().optional(),
});
```

Leave it unchanged (Task 6 edits it), and insert directly after it:

```ts
/**
 * Every dose delete and restore names its dose by id. `max(64)` bounds a
 * hand-edited field the same way the import door bounds ids. Real ids are
 * 24-character cuid2s.
 */
export const doseIdSchema = z.object({ doseId: z.string().min(1).max(64) });

/**
 * The dashboard's and /log's delete. `forUndo=1` marks the delete behind a
 * CREATE's Undo. Nobody can undo that one in turn, so it skips the trash and
 * answers without a restore handle (spec D8). Only the literal "1" is
 * accepted, so a stray value is a 400 rather than a silent choice between the
 * two kinds of delete.
 */
export const doseDeleteSchema = doseIdSchema.extend({ forUndo: z.literal("1").optional() });

/**
 * A delete's Undo. `deletedAt` is the ISO instant the delete returned, posted
 * back verbatim. The restore matches the trash row on `(doseId, deletedAt)` to
 * the millisecond, so an out-of-date Undo can never reverse a newer delete of
 * the same dose (spec D6).
 */
export const doseRestoreSchema = doseIdSchema.extend({ deletedAt: z.string().datetime() });
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/unit/validation.test.ts`
Expected: PASS (all tests, including the 11 new ones).

- [ ] **Step 10: Prove by mutation**

Run `npx vitest run tests/unit/validation.test.ts` after each change, check the named test fails, then restore the line:

1. `doseIdSchema`: change `z.string().min(1).max(64)` to `z.string().min(1)`. Expected: FAIL in `accepts a 64-character id and rejects a 65-character one`.
2. `doseIdSchema`: change `z.string().min(1).max(64)` to `z.string().max(64)`. Expected: FAIL in `rejects a missing or empty id, so the action answers 400 rather than 404` (the empty case) and in `doseRestoreSchema > still requires the dose id`.
3. `doseDeleteSchema`: change `z.literal("1").optional()` to `z.string().optional()`. Expected: FAIL in `rejects any other forUndo value rather than guessing which delete was meant`.
4. `doseRestoreSchema`: change `z.string().datetime()` to `z.string()`. Expected: FAIL in `rejects a datetime-local deletedAt, which names no instant`.

After restoring all four, re-run. Expected: PASS.

---

#### Cycle 3: the `dose_restored` event type, in all three code homes

- [ ] **Step 11: Write the failing tests**

(a) Create `tests/unit/inventory-event-types.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, expectTypeOf } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import type { InventoryEventType } from "$lib/server/db/schema";
import { importInventoryEventSchema } from "$lib/utils/validation";

/**
 * An inventory event type has four homes, and they drift independently:
 *
 *  - the `InventoryEventType` union in schema.ts, which types every writer;
 *  - the import enum in validation.ts. Missing there, re-importing a backup
 *    skips every event of that type as "could not be read";
 *  - the history labels on the medication page. Missing there, the page shows
 *    the raw type string;
 *  - the `eventType` list in docs/api-v1-contract.md, which is prose.
 *
 * This file holds the first three together. `dose_restored` (a delete's Undo
 * taking back what that delete credited) is the value that prompted it.
 */

const PAGE = readFileSync(
  fileURLToPath(new URL("../../src/routes/(app)/medications/[id]/+page.svelte", import.meta.url)),
  "utf8",
);

/** The `EVENT_LABELS` object literal, from its declaration to its closing brace. */
function labelBlock(): string {
  const start = PAGE.indexOf("const EVENT_LABELS");
  expect(start, "EVENT_LABELS moved or was renamed: update this test").toBeGreaterThan(-1);
  return PAGE.slice(start, PAGE.indexOf("};", start));
}

const IMPORTABLE = importInventoryEventSchema.shape.eventType.options;

describe("inventory event types", () => {
  it("names the same set in the import enum and the InventoryEventType union", () => {
    // Type-level: `npm run check` enforces this line, vitest does not.
    expectTypeOf<
      z.infer<typeof importInventoryEventSchema>["eventType"]
    >().toEqualTypeOf<InventoryEventType>();
    expect(IMPORTABLE).toContain("dose_restored");
  });

  it("gives every importable event type a history label", () => {
    const block = labelBlock();
    const unlabelled = IMPORTABLE.filter((type) => !new RegExp(`\\b${type}:\\s*"`).test(block));
    expect(unlabelled).toEqual([]);
  });

  it("labels a restore 'Dose restored'", () => {
    expect(labelBlock()).toContain('dose_restored: "Dose restored",');
  });
});
```

(b) In `tests/unit/validation.test.ts`, add `importInventoryEventSchema,` to the import list (after `doseRestoreSchema,`), and insert this block immediately before `describe("settingsSchema", () => {`:

```ts
describe("importInventoryEventSchema", () => {
  it("accepts a dose_restored event", () => {
    const result = importInventoryEventSchema.safeParse({
      medicationId: "med_1",
      eventType: "dose_restored",
      quantityChange: -1,
      createdAt: "2026-08-01T09:05:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});
```

(c) Append to the end of `tests/unit/import-backup.test.ts`:

```ts
describe("parseBackup — restored doses", () => {
  it("keeps a dose_restored inventory event instead of skipping it as unreadable", () => {
    // A delete's Undo writes a `dose_restored` event. A backup taken after one
    // must re-import it, or the ledger it restores no longer adds up.
    const raw = backup();
    (raw.inventoryEvents as Json[]).push({
      id: "evt_2",
      userId: "user_source",
      medicationId: "med_1",
      eventType: "dose_restored",
      quantityChange: -1,
      previousCount: 30,
      newCount: 29,
      note: null,
      createdAt: "2026-04-02T00:00:00.000Z",
    });
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.inventoryEvents.map((e) => e.eventType)).toEqual([
      "refill",
      "dose_restored",
    ]);
    expect(result.bundle.warnings).toEqual([]);
  });
});
```

- [ ] **Step 12: Run tests to verify they fail**

Run: `npx vitest run tests/unit/inventory-event-types.test.ts tests/unit/validation.test.ts tests/unit/import-backup.test.ts`
Expected: FAIL in exactly these four:

- `names the same set in the import enum and the InventoryEventType union` (the options array does not include `'dose_restored'`);
- `labels a restore 'Dose restored'`;
- `importInventoryEventSchema > accepts a dose_restored event`;
- `parseBackup — restored doses > keeps a dose_restored inventory event…` (received `["refill"]`, and a warning that 1 inventory event could not be read).

`gives every importable event type a history label` PASSES at this point: all six existing types already have labels. It is the guard for the next type anyone adds.

- [ ] **Step 13: Write minimal implementation**

(a) `src/lib/server/db/schema.ts`. Replace:

```ts
export type InventoryEventType = "dose_taken" | "dose_deleted" | "dose_quantity_updated";
```

with:

```ts
// `dose_restored` is a delete's Undo taking back what that delete credited,
// and never more (see `doseLogTrash.inventoryCredited`). A type here has four
// homes that must move together: this union, the import enum in
// validation.ts, the history labels on the medication page, and the eventType
// list in docs/api-v1-contract.md. tests/unit/inventory-event-types.test.ts
// holds the first three.
export type InventoryEventType =
  | "dose_taken"
  | "dose_deleted"
  | "dose_restored"
  | "dose_quantity_updated";
```

In the same file, inside `inventoryEvents`, replace:

```ts
// Signed delta applied to inventory_count. dose_taken is negative,
// refill / dose_deleted (taken) are positive, manual_adjustment
// and correction can be either.
```

with:

```ts
// Signed delta applied to inventory_count. dose_taken and
// dose_restored are negative, refill / dose_deleted (taken) are
// positive, manual_adjustment and correction can be either.
```

(b) `src/lib/utils/validation.ts`, inside `importInventoryEventSchema`. Replace:

```ts
    "dose_deleted",
    "dose_quantity_updated",
```

with:

```ts
    "dose_deleted",
    "dose_restored",
    "dose_quantity_updated",
```

(c) `src/routes/(app)/medications/[id]/+page.svelte`, inside `EVENT_LABELS`. Replace:

```ts
    dose_deleted: "Dose deleted",
```

with:

```ts
    dose_deleted: "Dose deleted",
    dose_restored: "Dose restored",
```

- [ ] **Step 14: Run tests to verify they pass**

Run: `npx vitest run tests/unit/inventory-event-types.test.ts tests/unit/validation.test.ts tests/unit/import-backup.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: 0 errors (warnings unchanged from Step 0).

- [ ] **Step 15: Prove by mutation**

1. Remove `"dose_restored",` from the import enum in `validation.ts`. Run the Step 14 vitest command. Expected: FAIL in `names the same set…`, `accepts a dose_restored event` and `keeps a dose_restored inventory event…`. Restore.
2. Remove `| "dose_restored"` from `InventoryEventType` in `schema.ts`. Run the Step 14 vitest command. Expected: PASS, because vitest cannot see types. Now run `npm run check`. Expected: FAIL, with at least one error in `tests/unit/inventory-event-types.test.ts` on the `toEqualTypeOf<InventoryEventType>()` line. Restore.
3. Remove `dose_restored: "Dose restored",` from `EVENT_LABELS`. Run the Step 14 vitest command. Expected: FAIL in `gives every importable event type a history label` (received `["dose_restored"]`) and in `labels a restore 'Dose restored'`. Restore.
4. Re-run the Step 14 vitest command and `npm run check`. Expected: PASS and 0 errors.

---

#### Cycle 4: the `restore` audit action

- [ ] **Step 16: Write the failing test**

In `tests/unit/audit.test.ts`, change the first line:

```ts
import { describe, it, expect, vi } from "vitest";
```

to:

```ts
import { describe, it, expect, expectTypeOf, vi } from "vitest";
```

Change:

```ts
import { computeChanges } from "$lib/server/audit";
```

to:

```ts
import { computeChanges, logAudit } from "$lib/server/audit";
import type { auditLogs } from "$lib/server/db/schema";
```

Append to the end of the file:

```ts
describe("logAudit", () => {
  it("records a restore, with no diff", async () => {
    // A deleted dose put back by its Undo is audited as "restore". Like the
    // delete before it, the row carries no diff: a diff of a dose would carry
    // its note text into the synced, never-purged audit log.
    // Type-level: `npm run check` enforces the next line, vitest does not.
    expectTypeOf<Parameters<typeof logAudit>[3]>().toEqualTypeOf<
      "create" | "update" | "delete" | "failed_login" | "restore"
    >();

    const inserted: Array<typeof auditLogs.$inferInsert> = [];
    const client = {
      insert: () => ({
        values: async (values: typeof auditLogs.$inferInsert) => {
          inserted.push(values);
        },
      }),
    };

    await logAudit("u1", "dose_log", "d1", "restore", undefined, client);

    expect(inserted).toEqual([
      expect.objectContaining({
        userId: "u1",
        entityType: "dose_log",
        entityId: "d1",
        action: "restore",
        changes: undefined,
      }),
    ]);
  });
});
```

The explicit `client` means the default `db` is never evaluated, so the file's existing `unusedDb` mock stays correct.

- [ ] **Step 17: Run the test to verify it fails**

Run: `npx vitest run tests/unit/audit.test.ts`
Expected: PASS. Vitest strips types, and at runtime `logAudit` writes whatever action it is given. The red for this cycle is the type check.

Run: `npm run check`
Expected: FAIL, with errors in `tests/unit/audit.test.ts`: `Argument of type '"restore"' is not assignable to parameter of type '"create" | "update" | "delete" | "failed_login"'` on the `logAudit(...)` call, plus a mismatch on the `toEqualTypeOf` line.

- [ ] **Step 18: Write minimal implementation**

In `src/lib/server/audit.ts`, replace:

```ts
  action: "create" | "update" | "delete" | "failed_login",
```

with:

```ts
  // "restore" is a deleted dose put back by its Undo (`restoreDose`). Like
  // "delete", it is written with no diff: a dose's diff would carry its note
  // text, and audit rows are synced and never purged.
  action: "create" | "update" | "delete" | "failed_login" | "restore",
```

- [ ] **Step 19: Run to verify it passes**

Run: `npx vitest run tests/unit/audit.test.ts`
Expected: PASS (4 tests).

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 20: Prove by mutation**

Remove ` | "restore"` from the `action` union in `src/lib/server/audit.ts`. Run `npm run check`. Expected: FAIL in `tests/unit/audit.test.ts` (both lines named in Step 17). Restore it, then re-run `npm run check`. Expected: 0 errors.

---

#### Cycle 5: `doseLogTrash` in the schema

- [ ] **Step 21: Write the failing test**

Create `tests/unit/dose-log-trash-columns.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, expectTypeOf } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { doseLogs, doseLogTrash } from "$lib/server/db/schema";

/**
 * `dose_log_trash` holds a copy of a deleted `dose_logs` row, and a restore
 * puts that copy back under the same id. A `dose_logs` column the trash lacks
 * is therefore silently lost by a delete-then-Undo: the restored row gets NULL
 * or the column default, and nothing downstream can tell. This file makes
 * adding a column to `dose_logs` alone fail.
 *
 * `updatedAt` is the one exemption. It is the sync cursor, and a restore writes
 * it fresh so a delta sync carries the dose back.
 *
 * The keys and cascades are checked here as well as on PGlite, because the two
 * guard different deploy paths. PGlite applies the migration SQL in
 * `drizzle/`. Production runs `drizzle-kit push`, which diffs THIS file
 * (`scripts/vercel-build.mjs`). A cascade missing from either one is a bug.
 */

type ColumnLike = { name: string; notNull: boolean; getSQLType(): string };
type Shape = { name: string; sqlType: string; notNull: boolean };

function shapes(columns: Record<string, ColumnLike>, omit: readonly string[]) {
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !omit.includes(key))
      .map(([key, col]): [string, Shape] => [
        key,
        { name: col.name, sqlType: col.getSQLType(), notNull: col.notNull },
      ]),
  );
}

/** The live row's only column the trash leaves out. */
const LIVE_ONLY = ["updatedAt"] as const;
/** The trash row's only columns the live table does not have. */
const TRASH_ONLY = ["inventoryCredited", "deletedAt"] as const;

describe("dose_log_trash mirrors dose_logs", () => {
  it("has every dose_logs column but updatedAt, with the same SQL name, type and nullability, and nothing else but its own two", () => {
    expect(shapes(getTableColumns(doseLogTrash), TRASH_ONLY)).toEqual(
      shapes(getTableColumns(doseLogs), LIVE_ONLY),
    );
  });

  it("adds exactly inventoryCredited and deletedAt, both NOT NULL", () => {
    const trash = shapes(getTableColumns(doseLogTrash), []);
    expect({ inventoryCredited: trash.inventoryCredited, deletedAt: trash.deletedAt }).toEqual({
      inventoryCredited: { name: "inventory_credited", sqlType: "integer", notNull: true },
      deletedAt: { name: "deleted_at", sqlType: "timestamp with time zone", notNull: true },
    });
  });

  it("is keyed on the dose's own id, cascades from both owners and indexes the purge", () => {
    const config = getTableConfig(doseLogTrash);
    expect(config.name).toBe("dose_log_trash");
    expect(config.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(["id"]);

    const keys = config.foreignKeys
      .map((fk) => {
        const ref = fk.reference();
        return {
          column: ref.columns.map((c) => c.name).join(","),
          references: getTableConfig(ref.foreignTable).name,
          onDelete: fk.onDelete,
        };
      })
      .sort((a, b) => a.column.localeCompare(b.column));
    expect(keys).toEqual([
      { column: "medication_id", references: "medications", onDelete: "cascade" },
      { column: "user_id", references: "users", onDelete: "cascade" },
    ]);

    expect(
      config.indexes.map((i) => ({
        name: i.config.name,
        columns: i.config.columns.map((c) => (c as { name: string }).name),
      })),
    ).toEqual([{ name: "dose_log_trash_user_deleted_idx", columns: ["user_id", "deleted_at"] }]);
  });

  it("types a live row (minus updatedAt) as a trash insert, and a trash row (plus updatedAt) as a live insert", () => {
    // Type-level: `npm run check` enforces these lines, vitest does not. They
    // are the compile-time half of the copy in both directions (the delete
    // writes the trash, the restore writes it back), including the `$type`
    // narrowings on status and side effects, which the column shapes above
    // cannot see.
    type LiveRow = typeof doseLogs.$inferSelect;
    type TrashRow = typeof doseLogTrash.$inferSelect;
    expectTypeOf<TrashRow["status"]>().toEqualTypeOf<LiveRow["status"]>();
    expectTypeOf<TrashRow["sideEffects"]>().toEqualTypeOf<LiveRow["sideEffects"]>();
    expectTypeOf<
      Omit<LiveRow, "updatedAt"> & Pick<TrashRow, "inventoryCredited" | "deletedAt">
    >().toExtend<typeof doseLogTrash.$inferInsert>();
    expectTypeOf<
      Omit<TrashRow, "inventoryCredited" | "deletedAt"> & Pick<LiveRow, "updatedAt">
    >().toExtend<typeof doseLogs.$inferInsert>();
  });
});
```

- [ ] **Step 22: Run test to verify it fails**

Run: `npx vitest run tests/unit/dose-log-trash-columns.test.ts`
Expected: FAIL. The first three tests throw a `TypeError` (`getTableColumns` / `getTableConfig` read a property of `undefined`), because `doseLogTrash` is not exported yet. The fourth passes at runtime (its assertions are type-level).

- [ ] **Step 23: Write minimal implementation**

In `src/lib/server/db/schema.ts`, find:

```ts
export type DoseLogStatus = "taken" | "skipped" | "missed";
```

and insert directly after it (before `export type ScheduleKind`):

```ts
/**
 * A deleted dose, kept so its Undo can put it back (spec D4, D6).
 *
 * A restore (`restoreDose`) moves the row back into `dose_logs` under the SAME
 * id. It matches on `(id, deletedAt)` to the millisecond, so an out-of-date
 * Undo can never reverse a newer delete, and only within
 * `DOSE_UNDO_WINDOW_MS` (`$lib/utils/dose-undo`). Expired rows are purged with
 * `FOR UPDATE SKIP LOCKED`, so a purge never waits on a restore (D7).
 *
 * Every `dose_logs` column except `updatedAt` is mirrored here, with the same
 * name, type and nullability. A column the trash lacks is silently lost by a
 * delete-then-Undo, so `tests/unit/dose-log-trash-columns.test.ts` fails when
 * one is added to `dose_logs` alone. `updatedAt` is left out on purpose: it is
 * the sync cursor, and a restore writes it fresh so a delta sync carries the
 * dose back to the Mac app. No column has a default. The row is a copy, and a
 * NOT NULL field the copy forgot must fail the insert, not be invented.
 *
 * `inventoryCredited` is what the delete ACTUALLY gave back to
 * `medications.inventory_count`, and a restore takes back at most that. Never
 * `inventoryApplied`, never `quantity`. It is not a copy of
 * `inventoryApplied`: a delete credits nothing while tracking is off (count
 * NULL), so it is 0 then. Without it, a dose deleted while tracking was off
 * and restored after tracking came back on would take stock that was never
 * given back.
 *
 * `deletedAt` comes from the app clock, read after the medication row lock,
 * so it orders correctly against `dose_logs.loggedAt` for the restore's
 * "logged since the delete" guard.
 *
 * Owners: `src/lib/server/doses.ts` (delete, restore, purge) and
 * `src/lib/server/api/wipe.ts` (Delete dose history). Retention reaches the
 * table only through `purgeExpiredTrash` in `doses.ts`. Both foreign keys
 * cascade, so the archived-medication wipe, import replace mode and account
 * deletion clean it up with no code of their own. Nothing exports it:
 * re-importing a trashed dose would undo its delete.
 */
export const doseLogTrash = pgTable(
  "dose_log_trash",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    inventoryApplied: integer("inventory_applied"),
    inventoryCredited: integer("inventory_credited").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    sideEffects:
      jsonb("side_effects").$type<
        Array<{ name: string; severity: "mild" | "moderate" | "severe" }>
      >(),
    status: text("status").notNull().$type<DoseLogStatus>(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("dose_log_trash_user_deleted_idx").on(table.userId, table.deletedAt)],
);
```

Every name it uses (`pgTable`, `text`, `integer`, `timestamp`, `jsonb`, `index`, `users`, `medications`, `DoseLogStatus`) is already imported or defined in `schema.ts`. Keep the column order exactly as written: the generated SQL follows it, and Step 26's test asserts it.

- [ ] **Step 24: Run test to verify it passes**

Run: `npx vitest run tests/unit/dose-log-trash-columns.test.ts`
Expected: PASS (4 tests).

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 25: Prove by mutation**

1. In `doseLogs` (not the trash), add `probe: text("probe"),` after `status: …`. Run `npx vitest run tests/unit/dose-log-trash-columns.test.ts`. Expected: FAIL in `has every dose_logs column but updatedAt…`, with `probe` in the diff. Remove the line.
2. In `doseLogTrash`, change `inventoryApplied: integer("inventory_applied"),` to `inventoryApplied: integer("inventory_applied").notNull(),`. Run the same command. Expected: FAIL in the same test (`notNull: true` against `false`). Restore.
3. In `doseLogTrash`, delete `, { onDelete: "cascade" }` from `medicationId`'s `.references(…)`. Run the same command. Expected: FAIL in `is keyed on the dose's own id, cascades from both owners and indexes the purge` (`onDelete: "no action"`). Restore.
4. In `doseLogTrash`, delete `.$type<DoseLogStatus>()` from `status`. Run the same command. Expected: PASS, because vitest cannot see types. Run `npm run check`. Expected: FAIL in `tests/unit/dose-log-trash-columns.test.ts` on the `TrashRow["status"]` line (`string` is not `DoseLogStatus`). Restore.
5. Re-run the test and `npm run check`. Expected: PASS and 0 errors.

---

#### Cycle 6: the migration

- [ ] **Step 26: Write the failing test**

Create `tests/unit/pg/dose-log-trash-schema.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";

/**
 * Migration 0021 creates `dose_log_trash` wherever tests or `drizzle-kit
 * migrate` run: PGlite applies the SQL in `drizzle/` in journal order and
 * silently skips a file with no journal entry. `schema.ts` cannot prove any of
 * this. These cases pin what the generated SQL must contain: the columns in
 * order with their types and nullability, the primary key, both `ON DELETE
 * cascade`s and the purge index.
 *
 * The cascades are load-bearing. Three paths delete a medication or a user
 * without knowing the trash exists: the archived-medication wipe, import
 * replace mode and account deletion. Each relies on the database to take the
 * trash rows with it.
 *
 * No `vi.mock("$lib/server/db")` here: this file calls no production module,
 * only the PGlite instance itself.
 */

import { pgDb } from "../helpers/pg-db";

beforeEach(async () => {
  await pgDb.reset();
});

describe("migration 0021: dose_log_trash", () => {
  it("creates the table with the schema's columns, in order, and no defaults", async () => {
    // No defaults, on purpose. A trash row is a copy, so a NOT NULL field the
    // copy forgot must fail the insert rather than be invented.
    const res = await pgDb.client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'dose_log_trash'
       order by ordinal_position`,
    );
    const col = (column_name: string, data_type: string, nullable: boolean) => ({
      column_name,
      data_type,
      is_nullable: nullable ? "YES" : "NO",
      column_default: null,
    });
    expect(res.rows).toEqual([
      col("id", "text", false),
      col("user_id", "text", false),
      col("medication_id", "text", false),
      col("quantity", "integer", false),
      col("inventory_applied", "integer", true),
      col("inventory_credited", "integer", false),
      col("taken_at", "timestamp with time zone", false),
      col("logged_at", "timestamp with time zone", false),
      col("notes", "text", true),
      col("side_effects", "jsonb", true),
      col("status", "text", false),
      col("deleted_at", "timestamp with time zone", false),
    ]);
  });

  it("keys the table on the dose's own id", async () => {
    const res = await pgDb.client.query<{ attname: string }>(
      `select a.attname
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = 'dose_log_trash'::regclass and i.indisprimary`,
    );
    expect(res.rows).toEqual([{ attname: "id" }]);
  });

  it("cascades both foreign keys on delete", async () => {
    const res = await pgDb.client.query<{
      conname: string;
      confdeltype: string;
      references_table: string;
    }>(
      `select conname, confdeltype, confrelid::regclass::text as references_table
       from pg_constraint
       where conrelid = 'dose_log_trash'::regclass and contype = 'f'
       order by conname`,
    );
    // confdeltype 'c' is CASCADE. 'a' is NO ACTION, the default when the
    // clause is missing.
    expect(res.rows).toEqual([
      {
        conname: "dose_log_trash_medication_id_medications_id_fk",
        confdeltype: "c",
        references_table: "medications",
      },
      {
        conname: "dose_log_trash_user_id_users_id_fk",
        confdeltype: "c",
        references_table: "users",
      },
    ]);
  });

  it("indexes (user_id, deleted_at) for the purges", async () => {
    const res = await pgDb.client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef
       from pg_indexes
       where schemaname = 'public' and tablename = 'dose_log_trash'
       order by indexname`,
    );
    expect(res.rows).toEqual([
      {
        indexname: "dose_log_trash_pkey",
        indexdef:
          "CREATE UNIQUE INDEX dose_log_trash_pkey ON public.dose_log_trash USING btree (id)",
      },
      {
        indexname: "dose_log_trash_user_deleted_idx",
        indexdef:
          "CREATE INDEX dose_log_trash_user_deleted_idx ON public.dose_log_trash USING btree (user_id, deleted_at)",
      },
    ]);
  });
});
```

- [ ] **Step 27: Run test to verify it fails**

Run: `npx vitest run tests/unit/pg/dose-log-trash-schema.test.ts`
Expected: FAIL in all four. The first receives `[]`; the other three throw `relation "dose_log_trash" does not exist`. The schema has the table, but no migration creates it yet.

- [ ] **Step 28: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: drizzle-kit reads `drizzle.config.ts`, reports 1 new table, and prints `Your SQL migration file ➜ drizzle/0021_<adjective>_<noun>.sql`. It must not prompt: nothing was removed or renamed. If it lists any change other than `dose_log_trash`, stop. The snapshot in `drizzle/meta/0020_snapshot.json` matched `schema.ts` exactly when this plan was written, so any other change means `schema.ts` differs from the steps above.

Check what it wrote. Do not hand-edit any of these files.

```bash
ls drizzle/0021_*.sql drizzle/meta/0021_snapshot.json
node -e "const e=require('./drizzle/meta/_journal.json').entries.at(-1);console.log(e.idx,e.tag)"
grep -c "ON DELETE cascade" drizzle/0021_*.sql
cat drizzle/0021_*.sql
```

Expected:

- both files are listed;
- the journal line prints `21 0021_<the same name as the .sql file>`;
- the grep prints `2`;
- the SQL is exactly this (verified against `drizzle-kit`'s generator while writing this plan):

```sql
CREATE TABLE "dose_log_trash" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"medication_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"inventory_applied" integer,
	"inventory_credited" integer NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"notes" text,
	"side_effects" jsonb,
	"status" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dose_log_trash" ADD CONSTRAINT "dose_log_trash_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_log_trash" ADD CONSTRAINT "dose_log_trash_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dose_log_trash_user_deleted_idx" ON "dose_log_trash" USING btree ("user_id","deleted_at");
```

Nothing destructive and no backfill, so production's build-time `drizzle-kit push` only adds a table, two foreign keys and an index.

- [ ] **Step 29: Run test to verify it passes**

Run: `npx vitest run tests/unit/pg/dose-log-trash-schema.test.ts tests/unit/helpers/pg-db.test.ts`
Expected: PASS (4 tests, and the helper's existing 7). The helper's `reset()` truncates every table that `pg_tables` lists, so it empties the new table between tests with no change.

---

#### Cycle 7: the fixtures and the cascades

- [ ] **Step 30: Write the failing tests**

(a) In `tests/unit/pg/dose-log-trash-schema.test.ts`, replace:

```ts
import { pgDb } from "../helpers/pg-db";
```

with:

```ts
import { asc, eq } from "drizzle-orm";
import { pgDb } from "../helpers/pg-db";
import { doseLogTrash, medications, users } from "../../../src/lib/server/db/schema";

async function trashIds(): Promise<string[]> {
  const rows = await pgDb.db
    .select({ id: doseLogTrash.id })
    .from(doseLogTrash)
    .orderBy(asc(doseLogTrash.id));
  return rows.map((r) => r.id);
}
```

and append to the end of the file:

```ts
describe("dose_log_trash cascades", () => {
  it("deleting a medication removes its trash rows and no others (archived wipe, import replace)", async () => {
    await pgDb.seedUser();
    await pgDb.seedMedication({ id: "m1", name: "Paracetamol" });
    await pgDb.seedMedication({ id: "m2", name: "Ibuprofen" });
    await pgDb.seedTrash({ id: "d1", medicationId: "m1" });
    await pgDb.seedTrash({ id: "d2", medicationId: "m2" });

    await pgDb.db.delete(medications).where(eq(medications.id, "m1"));

    expect(await trashIds()).toEqual(["d2"]);
  });

  it("deleting a user removes all of their trash rows and no one else's (account deletion)", async () => {
    await pgDb.seedUser({ id: "u1" });
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m1", userId: "u1" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedTrash({ id: "d1", userId: "u1", medicationId: "m1" });
    await pgDb.seedTrash({ id: "d2", userId: "u2", medicationId: "m2" });

    // What `settings/data`'s account deletion runs.
    await pgDb.db.delete(users).where(eq(users.id, "u1"));

    expect(await trashIds()).toEqual(["d2"]);
  });
});
```

(b) In `tests/unit/helpers/pg-db.test.ts`, replace:

```ts
import { users, doseLogs } from "../../../src/lib/server/db/schema";
```

with:

```ts
import { users, doseLogs, doseLogTrash, syncTombstones } from "../../../src/lib/server/db/schema";
```

Then, inside `describe("pg-db fixtures", …)`, insert these two tests directly after the closing `});` of `it("reset() empties every table between tests", …)`:

```ts
it("seeds a trash row and a tombstone with every NOT NULL column filled", async () => {
  await pgDb.seedUser();
  await pgDb.seedMedication();
  await pgDb.seedTrash({ id: "d1" });
  const tombstone = await pgDb.seedTombstone({ entityId: "d1" });

  expect(await pgDb.db.select().from(doseLogTrash)).toEqual([
    {
      id: "d1",
      userId: "u1",
      medicationId: "m1",
      quantity: 1,
      inventoryApplied: 1,
      inventoryCredited: 1,
      takenAt: new Date("2026-08-01T08:00:00Z"),
      loggedAt: new Date("2026-08-01T08:00:00Z"),
      notes: null,
      sideEffects: null,
      status: "taken",
      deletedAt: new Date("2026-08-01T09:00:00Z"),
    },
  ]);
  expect(await pgDb.db.select().from(syncTombstones)).toEqual([
    {
      id: tombstone.id,
      userId: "u1",
      entityType: "dose_log",
      entityId: "d1",
      deletedAt: new Date("2026-08-01T09:00:00Z"),
    },
  ]);
});

it("rejects a trash row whose medication does not exist", async () => {
  await pgDb.seedUser();
  // Assert on the constraint's name, not just "it threw": a NOT NULL
  // violation from a broken default would satisfy a bare `rejects.toThrow()`.
  // Drizzle wraps the driver error, so the Postgres message is on `cause`.
  const error = await pgDb.seedTrash({ medicationId: "nope" }).then(
    () => null,
    (e: unknown) => e as { cause?: { message?: string } },
  );
  expect(error?.cause?.message).toContain("dose_log_trash_medication_id_medications_id_fk");
});
```

- [ ] **Step 31: Run tests to verify they fail**

Run: `npx vitest run tests/unit/pg/dose-log-trash-schema.test.ts tests/unit/helpers/pg-db.test.ts`
Expected: FAIL in the four new tests with `TypeError: pgDb.seedTrash is not a function`. The four structural tests and the helper's seven existing tests still pass.

- [ ] **Step 32: Write minimal implementation**

In `tests/unit/helpers/pg-db.ts`, insert after the closing `}` of `export async function seedSchedule(…)` and before `export const pgDb = {`:

```ts
let trashSeq = 0;

/** A deleted dose waiting for its Undo. Seed after the user AND the
    medication it names: both foreign keys are real here (migration 0021).
    The defaults describe a taken dose of 1 that took 1 from stock, logged at
    08:00 UTC on 1 Aug 2026 and deleted at 09:00, crediting 1 back. Pass `id`
    equal to the dose it stands for when a test restores it. */
export async function seedTrash(overrides: Partial<typeof schema.doseLogTrash.$inferInsert> = {}) {
  trashSeq += 1;
  const row: typeof schema.doseLogTrash.$inferInsert = {
    id: `t${trashSeq}`,
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    inventoryApplied: 1,
    inventoryCredited: 1,
    takenAt: new Date("2026-08-01T08:00:00Z"),
    loggedAt: new Date("2026-08-01T08:00:00Z"),
    status: "taken",
    deletedAt: new Date("2026-08-01T09:00:00Z"),
    ...overrides,
  };
  await database.insert(schema.doseLogTrash).values(row);
  return row;
}

let tombstoneSeq = 0;

/** A sync tombstone. Seed after the user. `sync_tombstones` has no
    uniqueness, so a test can seed the duplicate a restore must still clear. */
export async function seedTombstone(
  overrides: Partial<typeof schema.syncTombstones.$inferInsert> = {},
) {
  tombstoneSeq += 1;
  const row: typeof schema.syncTombstones.$inferInsert = {
    id: `tomb${tombstoneSeq}`,
    userId: "u1",
    entityType: "dose_log",
    entityId: "d1",
    deletedAt: new Date("2026-08-01T09:00:00Z"),
    ...overrides,
  };
  await database.insert(schema.syncTombstones).values(row);
  return row;
}
```

Then replace the export object:

```ts
export const pgDb = {
  client,
  db: database,
  queryLog,
  reset,
  seedUser,
  seedMedication,
  seedDose,
  seedPreferences,
  seedSchedule,
};
```

with:

```ts
export const pgDb = {
  client,
  db: database,
  queryLog,
  reset,
  seedUser,
  seedMedication,
  seedDose,
  seedPreferences,
  seedSchedule,
  seedTrash,
  seedTombstone,
};
```

`reset()` needs no change: it truncates every table in `pg_tables` with `CASCADE`, which now includes `dose_log_trash`.

- [ ] **Step 33: Run tests to verify they pass**

Run: `npx vitest run tests/unit/pg/dose-log-trash-schema.test.ts tests/unit/helpers/pg-db.test.ts`
Expected: PASS (6 tests in the schema file, 9 in the helper's file).

- [ ] **Step 34: Prove by mutation**

PGlite builds a fresh database from `drizzle/` for every test file, so editing the generated SQL takes effect on the next run. After each change run `npx vitest run tests/unit/pg/dose-log-trash-schema.test.ts`, check the named tests fail, then restore the file exactly: `cat drizzle/0021_*.sql` must match Step 28's SQL again.

1. In `drizzle/0021_*.sql`, on the `dose_log_trash_user_id_users_id_fk` line, change `ON DELETE cascade` to `ON DELETE no action`. Expected: FAIL in `cascades both foreign keys on delete` (`confdeltype: "a"`) and in `deleting a user removes all of their trash rows…` (`update or delete on table "users" violates foreign key constraint "dose_log_trash_user_id_users_id_fk" on table "dose_log_trash"`). Postgres checks that key before the medications cascade reaches the trash row. This was confirmed against the real migrations while writing this plan, so the behavioural test kills this mutation on its own, not only the catalog test. Restore.
2. On the `dose_log_trash_medication_id_medications_id_fk` line, make the same change. Expected: FAIL in `cascades both foreign keys on delete` and in `deleting a medication removes its trash rows and no others…` (a foreign-key violation on `medications`). Restore.
3. Delete the whole `ALTER TABLE "dose_log_trash" ADD CONSTRAINT "dose_log_trash_medication_id_medications_id_fk" …;--> statement-breakpoint` line from `drizzle/0021_*.sql`. Run `npx vitest run tests/unit/helpers/pg-db.test.ts tests/unit/pg/dose-log-trash-schema.test.ts`. Expected: FAIL in `rejects a trash row whose medication does not exist` (the insert succeeds, so there is no `cause`), in `cascades both foreign keys on delete` and in `deleting a medication removes its trash rows and no others…`. Restore.
4. In `tests/unit/helpers/pg-db.ts`'s `seedTrash`, delete the default line `inventoryCredited: 1,`. Run `npx vitest run tests/unit/helpers/pg-db.test.ts`. Expected: FAIL in `seeds a trash row and a tombstone with every NOT NULL column filled` (a NOT NULL violation on `inventory_credited`), and also in `rejects a trash row whose medication does not exist`. Postgres checks NOT NULL before the foreign key, so that error names `inventory_credited` instead of the constraint. A bare `rejects.toThrow()` would have passed here, which is why the test asserts the constraint's name. Restore.
5. Re-run both files, and confirm `cat drizzle/0021_*.sql` matches Step 28's SQL. Expected: PASS.

---

- [ ] **Step 35: Update existing tests this change breaks**

None. This task adds a table, a union member, an audit action, three schemas and a label, and changes no existing behaviour. Checked while writing this plan:

- no test enumerates every table: `tests/unit/helpers/pg-db.test.ts` checks a representative slice with `arrayContaining`;
- no test enumerates `InventoryEventType`, the audit actions or `validation.ts`'s exports: the only exhaustive readers are the new tests;
- `tests/unit/api/login.test.ts` asserts `logAudit` calls with `"failed_login"`, which is unchanged;
- no fake-db suite touches `doseLogTrash`, because no production code uses it yet.

If the full run in Step 36 shows a failure outside this task's files, it is not from this list. Read it before changing anything.

- [ ] **Step 36: Run the task's full suite**

```bash
npx vitest run tests/unit/dose-undo.test.ts tests/unit/validation.test.ts tests/unit/import-backup.test.ts tests/unit/inventory-event-types.test.ts tests/unit/audit.test.ts tests/unit/dose-log-trash-columns.test.ts tests/unit/pg/dose-log-trash-schema.test.ts tests/unit/helpers/pg-db.test.ts
npx vitest run
npm run check
npm run lint
npx prettier --check src/lib/utils/dose-undo.ts src/lib/server/db/schema.ts src/lib/server/audit.ts src/lib/utils/validation.ts "src/routes/(app)/medications/[id]/+page.svelte" tests/unit/helpers/pg-db.ts tests/unit/helpers/pg-db.test.ts tests/unit/dose-undo.test.ts tests/unit/validation.test.ts tests/unit/import-backup.test.ts tests/unit/inventory-event-types.test.ts tests/unit/audit.test.ts tests/unit/dose-log-trash-columns.test.ts tests/unit/pg/dose-log-trash-schema.test.ts
```

Expected:

- the task's 8 files: PASS;
- the whole suite: PASS, with 4 more files and 31 more tests than Step 0. From the measured baseline that is `166 passed` files and `2530 passed` tests. The 31 are: dose-undo 2, validation 12, import-backup 1, inventory-event-types 3, audit 1, dose-log-trash-columns 4, pg/dose-log-trash-schema 6, pg-db 2;
- `npm run check`: 0 errors, and the same warning count as Step 0 (28);
- `npm run lint`: `0 errors`, and the same warning count as Step 0 (115);
- prettier: `All matched files use Prettier code style!`. If it flags a file, run `npx prettier --write` on that file and re-run. `drizzle/` is in `.prettierignore` and in `eslint.config.js`'s ignores, so the generated files are never reformatted. Do not use `npm run format:check` as this task's gate: at `a9ad7d8` it already fails on the untracked plan document under `docs/superpowers/plans/`, which is not this task's file.

- [ ] **Step 37: Commit**

```bash
git add src/lib/utils/dose-undo.ts src/lib/server/db/schema.ts src/lib/server/audit.ts src/lib/utils/validation.ts "src/routes/(app)/medications/[id]/+page.svelte" drizzle/0021_*.sql drizzle/meta/0021_snapshot.json drizzle/meta/_journal.json tests/unit/helpers/pg-db.ts tests/unit/helpers/pg-db.test.ts tests/unit/dose-undo.test.ts tests/unit/validation.test.ts tests/unit/import-backup.test.ts tests/unit/inventory-event-types.test.ts tests/unit/audit.test.ts tests/unit/dose-log-trash-columns.test.ts tests/unit/pg/dose-log-trash-schema.test.ts
git status --short
git commit -m "feat(doses): add the dose_log_trash table and shared undo definitions" -m "Adds dose_log_trash (migration 0021) with inventoryCredited and deletedAt, both foreign keys ON DELETE cascade, and a (user_id, deleted_at) index. Adds DOSE_UNDO_WINDOW_MS, the dose_restored inventory event type in the union, the import enum and the history labels, the restore audit action, and the doseId/doseDelete/doseRestore schemas. Nothing reads or writes the trash yet."
```

Before committing, `git status --short` must show no other modified or untracked files from this task. The untracked plan document under `docs/superpowers/plans/` is not part of this commit. The message carries no Claude or AI attribution, no `Co-Authored-By` trailer and no session link.

---

### Task 2: Delete moves the dose to the trash

A delete now runs in one transaction in D7's lock order: the medication row first, then the dose. It credits stock only when its own `DELETE … RETURNING` found the row. When the caller will offer an Undo, it copies the row into `dose_log_trash` (added in Task 1) with what it actually credited. Both delete actions go through one shared helper, which returns the restore handle. `/api/v1 delete_dose` keeps no trash row, and its wire shape is unchanged.

**Prerequisite:** Task 1 is committed. `doseLogTrash`, `DOSE_UNDO_WINDOW_MS`, `doseDeleteSchema` and `pgDb.seedTrash` must exist, and the `0021` migration must be in `drizzle/`.

**Files:**

- Create: `src/lib/server/dose-actions.ts`
- Create: `tests/unit/pg/dose-delete-trash.test.ts`
- Modify: `src/lib/server/doses.ts`. Anchors:
  - `import { eq, and, gte, lt, asc, desc, sql, isNotNull, max } from "drizzle-orm";`
  - `import { doseLogs, medications, medicationSchedules, syncTombstones } from "$lib/server/db/schema";`
  - the whole function starting `export async function deleteDose(userId: string, doseId: string) {`
- Modify: `src/routes/(app)/dashboard/+page.server.ts`. Anchors:
  - `  deleteDose,` in the `$lib/server/doses` import;
  - the `deleteDose: async ({ request, locals }) => {` action.
- Modify: `src/routes/(app)/log/+page.server.ts`. Anchors:
  - `import { updateDose, deleteDose } from "$lib/server/doses";`
  - the `deleteDose: async ({ request, locals }) => {` action.
- Modify: `src/lib/server/api/commands.ts`. Anchor: `    return { deleted: await deleteDose(userId, p.doseId) };`
- Test (modify): `tests/unit/pg/dose-inventory-symmetry.test.ts`, `tests/unit/doses-inventory.test.ts`, `tests/unit/dashboard-dose-actions.test.ts`, `tests/unit/log-dose-actions.test.ts`, `tests/unit/api/commands.test.ts`
- Test (verify only, no edit): `tests/unit/app-action-auth-guard.test.ts`

**Interfaces:**

- Consumes (from Task 1, copied from the contract):
  - `export const doseLogTrash = pgTable("dose_log_trash", { id, userId, medicationId, quantity, inventoryApplied, inventoryCredited, takenAt, loggedAt, notes, sideEffects, status, deletedAt }, …)` in `src/lib/server/db/schema.ts`
  - `export const DOSE_UNDO_WINDOW_MS = 10 * 60_000;` in `src/lib/utils/dose-undo.ts`
  - `export const doseDeleteSchema = doseIdSchema.extend({ forUndo: z.literal("1").optional() });` in `src/lib/utils/validation.ts`
  - `pgDb.seedTrash(overrides: Partial<typeof schema.doseLogTrash.$inferInsert> = {})`. Its defaults are: id `t${seq}`, userId `"u1"`, medicationId `"m1"`, quantity 1, inventoryApplied 1, inventoryCredited 1, takenAt/loggedAt `2026-08-01T08:00:00Z`, status `"taken"`, deletedAt `2026-08-01T09:00:00Z`.
- Produces (later tasks rely on these exactly):
  - `src/lib/server/doses.ts`:
    ```ts
    export interface DeletedDose {
      doseId: string;
      medicationId: string;
      deletedAt: Date;
    }
    export async function deleteDose(
      userId: string,
      doseId: string,
      opts: { keepForUndo: boolean; now?: Date },
    ): Promise<DeletedDose | null>;
    type DbExecutor = typeof db | DbTransaction;
    export async function purgeExpiredTrash(
      executor: DbExecutor,
      opts: { now: Date; userId?: string },
    ): Promise<void>;
    ```
  - `src/lib/server/dose-actions.ts`:
    ```ts
    export async function deleteDoseAction(event: {
      locals: App.Locals;
      request: Request;
    }): Promise<
      | ActionFailure<{ error: string }>
      | { success: true; doseId: string; restore?: { deletedAt: string; expiresInMs: number } }
    >;
    ```
    Task 3 adds `restoreDoseAction` and the two `RESTORE_*` messages to this same module.

---

- [ ] **Step 0: Record the baselines**

This worktree has no `node_modules`, so every command resolves packages from `../../../node_modules`.

Run: `npm run check 2>&1 | tail -3`
Expected: note the `svelte-check found N errors and M warnings` line. This task must not add to either count.

Run: `npx vitest run tests/unit/pg/dose-inventory-symmetry.test.ts`
Expected: PASS (11 tests). If the file fails to import `@electric-sql/pglite`, run `npm install --no-save @electric-sql/pglite` outside the sandbox and retry.

---

#### Cycle A — `deleteDose` and `purgeExpiredTrash` (PGlite)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pg/dose-delete-trash.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `deleteDose` moves a dose into `dose_log_trash` (spec Section 1, "Deleting
 * a dose"; decisions D7 and D8).
 *
 * The database decides the outcome. Whether `DELETE … RETURNING` came back
 * with a row is what stops a second, overlapping delete from crediting stock
 * again, and the purge's `FOR UPDATE SKIP LOCKED` is SQL. `fake-db` evaluates
 * neither and has no select `.for()`, so these tests live on PGlite
 * (CLAUDE.md, test-seam rule).
 *
 * PGlite is one backend and serialises transactions. Nothing here runs two
 * deletes at once, and no test claims a race. Instead, the LOSING side of a
 * race is staged: `beforeMedicationLock` runs SQL inside the delete's own
 * transaction just before its medication `FOR UPDATE`. That is exactly the
 * state the loser reads once the winner has committed and released the lock.
 * The lock itself is pinned by its SQL in `queryLog`.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { db } from "$lib/server/db";
import { pgDb, queryLog } from "../helpers/pg-db";
import {
  auditLogs,
  doseLogs,
  doseLogTrash,
  inventoryEvents,
  medications,
  syncTombstones,
} from "../../../src/lib/server/db/schema";
import { DOSE_UNDO_WINDOW_MS } from "../../../src/lib/utils/dose-undo";
import { asc, eq } from "drizzle-orm";

const { deleteDose, purgeExpiredTrash } = await import("../../../src/lib/server/doses");

/** The frozen clock. `deletedAt` reads it unless a test moves it. */
const NOW = new Date("2026-08-01T12:00:00.000Z");
/** Where the clock-after-lock test moves the clock, at the lock. */
const LATER = new Date("2026-08-01T12:00:05.000Z");
/** A trash row with `deleted_at <= CUTOFF` has expired. `restoreDose` uses the same rule. */
const CUTOFF = new Date(NOW.getTime() - DOSE_UNDO_WINDOW_MS);

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
}

async function ledger() {
  return pgDb.db
    .select({
      eventType: inventoryEvents.eventType,
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
    })
    .from(inventoryEvents)
    .orderBy(asc(inventoryEvents.createdAt));
}

async function trashRows() {
  return pgDb.db.select().from(doseLogTrash).orderBy(asc(doseLogTrash.id));
}

async function trashIds(): Promise<string[]> {
  return (await trashRows()).map((r) => r.id);
}

async function tombstones() {
  return pgDb.db
    .select({ entityType: syncTombstones.entityType, entityId: syncTombstones.entityId })
    .from(syncTombstones);
}

async function auditRows() {
  return pgDb.db
    .select({ entityId: auditLogs.entityId, action: auditLogs.action, changes: auditLogs.changes })
    .from(auditLogs);
}

async function doseExists(id: string): Promise<boolean> {
  const rows = await pgDb.db.select({ id: doseLogs.id }).from(doseLogs).where(eq(doseLogs.id, id));
  return rows.length > 0;
}

function isMedicationLock(q: string): boolean {
  return /from "medications"/i.test(q) && /for update/i.test(q);
}

/** A medication `m1` holding `stockCount`, and one dose `d1` of it: taken ×1, applied 1. */
async function seedTakenDose(
  stockCount: number | null,
  dose: Partial<typeof doseLogs.$inferInsert> = {},
) {
  await pgDb.seedMedication({ id: "m1", inventoryCount: stockCount });
  await pgDb.seedDose({
    id: "d1",
    medicationId: "m1",
    status: "taken",
    quantity: 1,
    inventoryApplied: 1,
    ...dose,
  });
}

type RawTx = {
  query: (sql: string, params?: unknown[], options?: unknown) => Promise<unknown>;
};

/**
 * Runs `stage` inside the NEXT transaction, immediately before that
 * transaction's first medications `FOR UPDATE`.
 *
 * Drizzle's PGlite session opens every transaction through
 * `pgDb.client.transaction` and runs each statement through the transaction
 * object's `query`. Wrapping that `query` lets the test write through the
 * same transaction at the moment the lock is requested. A delete that
 * started when the dose existed, then waited for the lock while another
 * request deleted or edited the dose and committed, sees the same thing.
 */
function beforeMedicationLock(stage: (tx: RawTx) => unknown) {
  const original = pgDb.client.transaction.bind(pgDb.client);
  return vi.spyOn(pgDb.client, "transaction").mockImplementationOnce(((
    callback: (tx: unknown) => Promise<unknown>,
  ) =>
    original(async (tx) => {
      const raw = tx as unknown as RawTx;
      const query = raw.query;
      let staged = false;
      raw.query = async (sql, params, options) => {
        if (!staged && isMedicationLock(sql)) {
          staged = true;
          await stage({ query });
        }
        return query(sql, params, options);
      };
      return callback(tx);
    })) as never);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  // Date only: faking every timer stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  queryLog.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("deleteDose — the delete, its credit and its trash row", () => {
  it("copies every dose_logs column but updatedAt into the trash, with what it credited", async () => {
    const takenAt = new Date("2026-08-01T08:00:00.000Z");
    const loggedAt = new Date("2026-08-01T08:02:00.000Z");
    await seedTakenDose(5, {
      quantity: 3,
      inventoryApplied: 2,
      takenAt,
      loggedAt,
      notes: "After breakfast",
      sideEffects: [{ name: "Nausea", severity: "mild" }],
    });

    const result = await deleteDose("u1", "d1", { keepForUndo: true });

    expect(result).toEqual({ doseId: "d1", medicationId: "m1", deletedAt: NOW });
    expect(await doseExists("d1")).toBe(false);
    expect(await trashRows()).toEqual([
      {
        id: "d1",
        userId: "u1",
        medicationId: "m1",
        quantity: 3,
        inventoryApplied: 2,
        inventoryCredited: 2,
        takenAt,
        loggedAt,
        notes: "After breakfast",
        sideEffects: [{ name: "Nausea", severity: "mild" }],
        status: "taken",
        deletedAt: NOW,
      },
    ]);
    // It gives back what the dose took (2), not what it says it took (3).
    expect(await stock()).toBe(7);
    expect(await ledger()).toEqual([
      { eventType: "dose_deleted", quantityChange: 2, previousCount: 5, newCount: 7 },
    ]);
  });

  it("records inventoryCredited 0, and no event, while the medication is not tracking stock", async () => {
    // Logged while tracking was on (it took 2), then tracking was switched
    // off. The delete gives nothing back, so a restore must take nothing.
    await seedTakenDose(null, { quantity: 2, inventoryApplied: 2 });

    await deleteDose("u1", "d1", { keepForUndo: true });

    expect(await stock()).toBeNull();
    expect(await ledger()).toEqual([]);
    expect(await trashRows()).toMatchObject([
      { id: "d1", inventoryApplied: 2, inventoryCredited: 0 },
    ]);
  });

  it.each(["skipped", "missed"] as const)(
    "gives nothing back for a %s dose and trashes it with inventoryCredited 0",
    async (status) => {
      await seedTakenDose(10, { status, inventoryApplied: null });

      await deleteDose("u1", "d1", { keepForUndo: true });

      expect(await stock()).toBe(10);
      expect(await ledger()).toEqual([]);
      expect(await trashRows()).toMatchObject([
        { id: "d1", status, inventoryApplied: null, inventoryCredited: 0 },
      ]);
    },
  );

  it("keepForUndo: false still deletes, credits, tombstones and audits, but keeps no trash row", async () => {
    // D8: the Mac app's delete_dose and a create's Undo. Nobody can undo them.
    await seedTakenDose(9);

    const result = await deleteDose("u1", "d1", { keepForUndo: false });

    expect(result).toEqual({ doseId: "d1", medicationId: "m1", deletedAt: NOW });
    expect(await doseExists("d1")).toBe(false);
    expect(await stock()).toBe(10);
    expect(await trashRows()).toEqual([]);
    expect(await tombstones()).toEqual([{ entityType: "dose_log", entityId: "d1" }]);
    expect(await auditRows()).toEqual([{ entityId: "d1", action: "delete", changes: null }]);
  });

  it("writes one tombstone and one delete audit row whose diff carries no note text", async () => {
    await seedTakenDose(9, { notes: "Private: felt dizzy" });

    await deleteDose("u1", "d1", { keepForUndo: true });

    expect(await tombstones()).toEqual([{ entityType: "dose_log", entityId: "d1" }]);
    const audit = await auditRows();
    expect(audit).toEqual([{ entityId: "d1", action: "delete", changes: null }]);
    expect(JSON.stringify(audit)).not.toContain("felt dizzy");
  });

  it("returns null and writes nothing for a missing dose or another user's", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", inventoryCount: 10 });
    await pgDb.seedDose({
      id: "theirs",
      userId: "u2",
      medicationId: "m2",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
    });

    expect(await deleteDose("u1", "missing", { keepForUndo: true })).toBeNull();
    expect(await deleteDose("u1", "theirs", { keepForUndo: true })).toBeNull();

    expect(await doseExists("theirs")).toBe(true);
    expect(await stock("m2")).toBe(10);
    expect(await trashRows()).toEqual([]);
    expect(await tombstones()).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });
});

describe("two deletes of one dose credit stock once", () => {
  it("a second, sequential delete returns null — one credit, one event, one tombstone, one trash row", async () => {
    await seedTakenDose(9);

    expect(await deleteDose("u1", "d1", { keepForUndo: true })).not.toBeNull();
    expect(await deleteDose("u1", "d1", { keepForUndo: true })).toBeNull();

    expect(await stock()).toBe(10);
    expect(await ledger()).toEqual([
      { eventType: "dose_deleted", quantityChange: 1, previousCount: 9, newCount: 10 },
    ]);
    expect(await tombstones()).toHaveLength(1);
    expect(await trashIds()).toEqual(["d1"]);
    expect(await auditRows()).toHaveLength(1);
  });

  it("the losing side — its dose gone once it holds the lock — returns null and writes nothing", async () => {
    // The loser read d1 (step 1), then waited on the medication lock while
    // the winner deleted d1 and committed. Remove racing the toast's Undo, a
    // second tab and the Mac app all get here.
    await seedTakenDose(9);
    beforeMedicationLock(({ query }) => query('delete from "dose_logs" where "id" = $1', ["d1"]));

    expect(await deleteDose("u1", "d1", { keepForUndo: true })).toBeNull();

    expect(await stock()).toBe(9);
    expect(await ledger()).toEqual([]);
    expect(await trashRows()).toEqual([]);
    expect(await tombstones()).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });

  it("credits what the row holds once the lock is taken — an edit that committed first counts", async () => {
    // Save raised the dose from 1 to 3 and committed (stock 5 → 3) while this
    // delete waited on the medication lock (spec item 4).
    await seedTakenDose(5);
    beforeMedicationLock(async ({ query }) => {
      await query(
        'update "dose_logs" set "quantity" = 3, "inventory_applied" = 3 where "id" = $1',
        ["d1"],
      );
      await query('update "medications" set "inventory_count" = 3 where "id" = $1', ["m1"]);
    });

    await deleteDose("u1", "d1", { keepForUndo: true });

    expect(await stock()).toBe(6);
    expect(await ledger()).toEqual([
      { eventType: "dose_deleted", quantityChange: 3, previousCount: 3, newCount: 6 },
    ]);
    expect(await trashRows()).toMatchObject([
      { id: "d1", quantity: 3, inventoryApplied: 3, inventoryCredited: 3 },
    ]);
  });
});

describe("deleteDose — lock order and the clock (D7)", () => {
  it("locks the medication before any write, and reads dose_logs before it only without a lock", async () => {
    await seedTakenDose(9);
    queryLog.length = 0;

    await deleteDose("u1", "d1", { keepForUndo: true });

    const lock = queryLog.findIndex(isMedicationLock);
    const doseDelete = queryLog.findIndex((q) => /^delete from "dose_logs"/i.test(q));
    const purge = queryLog.findIndex((q) => /^delete from "dose_log_trash"/i.test(q));
    const trashInsert = queryLog.findIndex((q) => /^insert into "dose_log_trash"/i.test(q));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(doseDelete).toBeGreaterThan(lock);
    expect(purge).toBeGreaterThan(lock);
    expect(trashInsert).toBeGreaterThan(lock);
    // Step 1's read is the only statement on dose_logs before the lock, and
    // it takes no lock itself.
    const beforeLock = queryLog.slice(0, lock).filter((q) => /"dose_logs"/i.test(q));
    expect(beforeLock).toHaveLength(1);
    expect(beforeLock[0]).toMatch(/^select/i);
    expect(beforeLock[0]).not.toMatch(/for update/i);
  });

  it("stamps deletedAt from a clock read after the medication lock", async () => {
    await seedTakenDose(9);
    beforeMedicationLock(() => vi.setSystemTime(LATER));

    const result = await deleteDose("u1", "d1", { keepForUndo: true });

    expect(result?.deletedAt).toEqual(LATER);
    expect(await trashRows()).toMatchObject([{ id: "d1", deletedAt: LATER }]);
  });
});

describe("purgeExpiredTrash", () => {
  it("an on-write purge removes this user's expired rows only", async () => {
    await seedTakenDose(9);
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedTrash({ id: "at-cutoff", deletedAt: CUTOFF });
    await pgDb.seedTrash({ id: "just-inside", deletedAt: new Date(CUTOFF.getTime() + 1) });
    await pgDb.seedTrash({
      id: "other-user",
      userId: "u2",
      medicationId: "m2",
      deletedAt: new Date(CUTOFF.getTime() - 60_000),
    });

    await deleteDose("u1", "d1", { keepForUndo: true, now: NOW });

    expect(await trashIds()).toEqual(["d1", "just-inside", "other-user"]);
  });

  it("never waits: its row locks skip rows another transaction holds", async () => {
    await seedTakenDose(9);
    queryLog.length = 0;

    await deleteDose("u1", "d1", { keepForUndo: true });

    const purges = queryLog.filter((q) => /^delete from "dose_log_trash"/i.test(q));
    expect(purges).toHaveLength(1);
    expect(purges[0]).toMatch(/for update skip locked/i);
  });

  it("without a userId it purges every user's expired rows — the retention sweep's call", async () => {
    await pgDb.seedMedication({ id: "m1" });
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedTrash({ id: "u1-expired", deletedAt: CUTOFF });
    await pgDb.seedTrash({ id: "u2-expired", userId: "u2", medicationId: "m2", deletedAt: CUTOFF });
    await pgDb.seedTrash({ id: "u1-live", deletedAt: new Date(CUTOFF.getTime() + 1) });

    await purgeExpiredTrash(db, { now: NOW });

    expect(await trashIds()).toEqual(["u1-live"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/pg/dose-delete-trash.test.ts`
Expected: FAIL, 15 tests in all.

- The old `deleteDose` ignores its third argument and returns `true`/`false`, so most cases fail with messages like `expected true to deeply equal { doseId: 'd1', … }`, `expected true to be null` or `expected false to be null`.
- The lock-order case fails on `expected -1 to be greater than or equal to 0`, because the old code locks nothing.
- `purgeExpiredTrash` fails with `TypeError: purgeExpiredTrash is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/server/doses.ts`, make three edits.

**(a) Imports.** Replace

```ts
import { eq, and, gte, lt, asc, desc, sql, isNotNull, max } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import { doseLogs, medications, medicationSchedules, syncTombstones } from "$lib/server/db/schema";
```

with

```ts
import { eq, and, gte, lt, lte, asc, desc, sql, isNotNull, max, inArray } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import {
  doseLogs,
  doseLogTrash,
  medications,
  medicationSchedules,
  syncTombstones,
} from "$lib/server/db/schema";
```

**(b)** After `import type { DoseLogWithMedication, SideEffect } from "$lib/types";`, add

```ts
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
```

**(c) Replace the whole old `deleteDose`.** That is everything from `export async function deleteDose(userId: string, doseId: string) {` down to and including its closing `}`, the one after `  return true;` and just before `export async function updateDose(`. Replace it with:

```ts
/** What `deleteDose` reports: enough for a toast to name the dose and for Undo to key its restore. */
export interface DeletedDose {
  doseId: string;
  medicationId: string;
  deletedAt: Date;
}

/** The global `db` (autocommit: the retention sweep) or a transaction. */
type DbExecutor = typeof db | DbTransaction;

/**
 * Delete trash rows whose undo window has closed:
 * `deleted_at <= now − DOSE_UNDO_WINDOW_MS`, the same rule `restoreDose`
 * uses for "expired".
 *
 * - With a `userId` it purges only that user's rows. The on-write purges in
 *   `deleteDose` and `restoreDose` use this form.
 * - Without one it purges everyone's. The retention sweep uses this form.
 *
 * It never waits. The ids come from a `FOR UPDATE SKIP LOCKED` subquery, so a
 * row that a restore, a wipe or a cascade has locked is left for a later
 * purge instead of being queued behind. A purge that never waits cannot close
 * a lock cycle with any of those (spec D7). This is the only copy of the purge
 * SQL; the retention policy calls this function as well.
 */
export async function purgeExpiredTrash(
  executor: DbExecutor,
  opts: { now: Date; userId?: string },
): Promise<void> {
  const cutoff = new Date(opts.now.getTime() - DOSE_UNDO_WINDOW_MS);
  const expired = executor
    .select({ id: doseLogTrash.id })
    .from(doseLogTrash)
    .where(
      and(
        opts.userId ? eq(doseLogTrash.userId, opts.userId) : undefined,
        lte(doseLogTrash.deletedAt, cutoff),
      ),
    )
    .for("update", { skipLocked: true });

  await executor.delete(doseLogTrash).where(inArray(doseLogTrash.id, expired));
}

/**
 * Delete one dose and give back what it took from stock. When the caller will
 * offer an Undo, also keep the dose in `dose_log_trash`, so that `restoreDose`
 * can put the same row back.
 *
 * Everything runs in one transaction, in D7's lock order: the medication row
 * first, then the dose.
 *
 * **Double delete.** Two overlapping deletes of one dose serialise on the
 * medication lock. The second one's `DELETE … RETURNING` then finds nothing,
 * so it writes nothing: no second credit, event, trash row, tombstone or
 * audit row. The code this replaces read the dose outside its transaction,
 * deleted without checking the row count and always credited. So the losing
 * delete minted a second dose's worth of stock, and the ledger reconciled
 * with the mint.
 *
 * **Edit, then delete.** The credit comes from RETURNING's after-image, not
 * an earlier read. An edit that committed first is therefore credited at its
 * edited applied amount.
 *
 * **What the trash row records.** `inventoryCredited` is what this delete
 * actually gave back, which is not always `inventoryApplied`: nothing is
 * credited while tracking is off. A restore takes back only
 * `inventoryCredited`. So a dose deleted while tracking was off, then
 * restored after tracking came back on, takes nothing it never gave.
 *
 * **When to keep nothing.** `keepForUndo: false` is for deletes nobody can
 * undo (D8): the Mac app's `delete_dose`, and the delete behind a create's
 * Undo.
 *
 * **The clock.** `deletedAt` is read from the app clock AFTER the medication
 * lock (D7), so it orders correctly against every `loggedAt` written under
 * the same lock. `opts.now` overrides it for tests.
 */
export async function deleteDose(
  userId: string,
  doseId: string,
  opts: { keepForUndo: boolean; now?: Date },
): Promise<DeletedDose | null> {
  return dbTx.transaction(async (tx): Promise<DeletedDose | null> => {
    // 1. Find which medication to lock. This read needs no lock, because a
    //    dose's medicationId never changes.
    const [found] = await tx
      .select({ medicationId: doseLogs.medicationId })
      .from(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .limit(1);
    if (!found) return null;
    const { medicationId } = found;

    // 2. Lock the medication (D7), which also makes this count read exact.
    //    Only then read the clock.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    const previousCount = med?.inventoryCount ?? null;
    const now = opts.now ?? new Date();

    // 3. The delete. A second delete of this dose waited on the lock above
    //    and finds nothing here, so it stops before writing anything.
    const [deleted] = await tx
      .delete(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .returning();
    if (!deleted) return null;

    // 4. Give the stock back. Skipped and missed rows never took any.
    let credited = 0;
    if (deleted.status === "taken") {
      // NULL means the row predates the column, or a `drizzle-kit push`
      // skipped its backfill. Falling back to `quantity` keeps the
      // historical behaviour; giving back nothing would be the same bug in
      // the other direction.
      const applied = deleted.inventoryApplied ?? deleted.quantity;

      await tx
        .update(medications)
        .set({ inventoryCount: sql`${medications.inventoryCount} + ${applied}` })
        .where(
          and(
            eq(medications.id, medicationId),
            eq(medications.userId, userId),
            isNotNull(medications.inventoryCount),
          ),
        );

      if (previousCount !== null) {
        credited = applied;
        await recordInventoryEvent(tx, {
          userId,
          medicationId,
          eventType: "dose_deleted",
          quantityChange: applied,
          previousCount,
          newCount: previousCount + applied,
        });
      }
    }

    // 5. Keep the dose for Undo: every stored column except `updatedAt`,
    //    which a restore rewrites. Purge first, so the trash stays bounded.
    if (opts.keepForUndo) {
      await purgeExpiredTrash(tx, { now, userId });
      const { updatedAt: _updatedAt, ...kept } = deleted;
      await tx
        .insert(doseLogTrash)
        .values({ ...kept, inventoryCredited: credited, deletedAt: now });
    }

    // 6. The sync tombstone and the audit row. The audit row carries no diff,
    //    so no note text reaches the audit log, which is synced and never
    //    purged.
    await tx.insert(syncTombstones).values({
      id: createId(),
      userId,
      entityType: "dose_log",
      entityId: doseId,
    });
    await logAudit(userId, "dose_log", doseId, "delete", undefined, tx);

    return { doseId, medicationId, deletedAt: now };
  });
}
```

`DbTransaction` is already declared higher up the file (`type DbTransaction = Parameters<Parameters<typeof dbTx.transaction>[0]>[0];`). `createId`, `logAudit` and `recordInventoryEvent` are already imported.

- [ ] **Step 4: Update the existing tests this change breaks, so the cycle runs green**

Two files break. `pg/dose-inventory-symmetry.test.ts` calls the old two-argument `deleteDose`, which now throws on `opts.keepForUndo`. And `doses-inventory.test.ts`'s fake-db cannot run the new `.for("update")`.

**`tests/unit/pg/dose-inventory-symmetry.test.ts`:**

1. Replace

   ```ts
   const { logDose, deleteDose, updateDose } = await import("../../../src/lib/server/doses");
   ```

   with

   ```ts
   // Every delete below passes keepForUndo: false. These cases are about the
   // stock arithmetic; the trash row is covered by dose-delete-trash.test.ts.
   const { logDose, deleteDose, updateDose } = await import("../../../src/lib/server/doses");
   ```

2. Replace all six occurrences (at `:74`, `:89`, `:122`, `:153`, `:177` and `:207`) of

   ```ts
   await deleteDose("u1", dose.id);
   ```

   with

   ```ts
   await deleteDose("u1", dose.id, { keepForUndo: false });
   ```

3. Replace these four lines one for one:

   | Old                                                        | New                                                                                |
   | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
   | `    await deleteDose("u1", first.id);`                    | `    await deleteDose("u1", first.id, { keepForUndo: false });`                    |
   | `    await deleteDose("u1", second.id);`                   | `    await deleteDose("u1", second.id, { keepForUndo: false });`                   |
   | `    for (const d of doses) await deleteDose("u1", d.id);` | `    for (const d of doses) await deleteDose("u1", d.id, { keepForUndo: false });` |
   | `    await deleteDose("u1", "legacy");`                    | `    await deleteDose("u1", "legacy", { keepForUndo: false });`                    |

**`tests/unit/doses-inventory.test.ts`.** The `deleteDose` cases move to the PGlite file above, which covers each one:

| Removed fake-db case | Covered in `dose-delete-trash.test.ts` by |
| -------------------- | ----------------------------------------- |
| taken restore        | "copies every dose_logs column…"          |
| skipped and missed   | the `it.each` case                        |
| missing dose         | "returns null and writes nothing…"        |
| `dose_deleted` event | the copy test's ledger assertion          |
| skipped: no event    | the `it.each` ledger assertion            |
| tombstone            | "writes one tombstone…"                   |

1. Replace

   ```ts
   const updates = () => opsOf("update");
   const deletes = () => opsOf("delete");
   const inserts = () => opsOf("insert");
   ```

   with

   ```ts
   const updates = () => opsOf("update");
   const inserts = () => opsOf("insert");
   ```

2. Replace

   ```ts
   const { logDose, deleteDose, updateDose } = await import("../../src/lib/server/doses");
   ```

   with

   ```ts
   const { logDose, updateDose } = await import("../../src/lib/server/doses");
   ```

3. Delete the whole `describe("deleteDose — status-aware inventory restore", () => { … });` block: from that line through the `});` that closes it, just above `describe("updateDose — status-aware inventory diff", () => {`. Put this comment in its place:

   ```ts
   // deleteDose's cases moved to tests/unit/pg/dose-delete-trash.test.ts.
   // Whether its DELETE … RETURNING found a row decides everything it writes,
   // and it locks the medication with a select `.for()`, which this fake does
   // not have and must not grow (CLAUDE.md, test-seam rule).
   ```

4. Inside `describe("inventory event recording", …)`, delete these two tests whole:
   - `it("logs a dose_deleted event when a TAKEN dose is removed", async () => { … });`
   - `it("does NOT record an event when a SKIPPED dose is removed", async () => { … });`
5. Inside `describe("sync-aware mutations (Task 2)", …)`, delete `it("deleteDose writes a tombstone", async () => { … });` whole.

`skippedDose`, `takenDose` and `syncTombstones` remain in use: the `updateDose` tests and the `tableByName` map use them.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/pg/dose-delete-trash.test.ts tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/doses-inventory.test.ts`
Expected: PASS. `dose-delete-trash`: 15 passed. `dose-inventory-symmetry`: 11 passed. `doses-inventory`: 10 passed (the 17 existing tests minus the 7 removed: 4 in the `deleteDose` describe, 2 event tests, 1 tombstone test).

- [ ] **Step 6: Prove by mutation**

For each mutation:

1. Make the edit in `src/lib/server/doses.ts`.
2. Run `npx vitest run tests/unit/pg/dose-delete-trash.test.ts -t "<test name>"`.
3. Watch the named test FAIL.
4. Restore the line, then re-run the whole file and confirm it is green.

In the table, `\|` inside code is a Markdown-escaped `|`: type `||`.

| #   | Mutation (exact line to break)                                                                                                                                                                                                                  | Test that must fail                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | In the trash insert, `{ ...kept, inventoryCredited: credited, deletedAt: now }` → `{ ...kept, notes: null, inventoryCredited: credited, deletedAt: now }`                                                                                       | `copies every dose_logs column but updatedAt into the trash`                                                                   |
| 2   | Move `credited = applied;` from inside `if (previousCount !== null) {` to the line after `const applied = deleted.inventoryApplied ?? deleted.quantity;`                                                                                        | `records inventoryCredited 0, and no event, while the medication is not tracking stock`                                        |
| 3   | `inventoryCredited: credited` → `inventoryCredited: deleted.inventoryApplied ?? deleted.quantity`                                                                                                                                               | `records inventoryCredited 0, and no event, while the medication is not tracking stock`                                        |
| 4   | `if (deleted.status === "taken") {` → `if (deleted.status === "taken" \|\| true) {`                                                                                                                                                             | `gives nothing back for a skipped dose` and `… for a missed dose` (stock 11, not 10)                                           |
| 5   | `if (opts.keepForUndo) {` → `if (opts.keepForUndo \|\| true) {`                                                                                                                                                                                 | `keepForUndo: false still deletes, credits, tombstones and audits, but keeps no trash row`                                     |
| 6   | `await logAudit(userId, "dose_log", doseId, "delete", undefined, tx);` → `await logAudit(userId, "dose_log", doseId, "delete", computeChanges({}, deleted), tx);`                                                                               | `writes one tombstone and one delete audit row whose diff carries no note text`                                                |
| 7   | Delete the line `if (!deleted) return null;`                                                                                                                                                                                                    | `the losing side — its dose gone once it holds the lock — returns null and writes nothing` (it now throws on `deleted.status`) |
| 8   | Restore the pre-fix read. In step 1, `.select({ medicationId: doseLogs.medicationId })` → `.select()`. In step 4, `const applied = deleted.inventoryApplied ?? deleted.quantity;` → `const applied = found.inventoryApplied ?? found.quantity;` | `credits what the row holds once the lock is taken — an edit that committed first counts` (stock 4, credited 1)                |
| 9   | Delete `.for("update")` from the step-2 medications read                                                                                                                                                                                        | `locks the medication before any write…` (and `the losing side …`: its stage never fires, so the dose is deleted normally)     |
| 10  | Remove `const now = opts.now ?? new Date();` from step 2, and add it as the first line of `deleteDose`, above `return dbTx.transaction(`                                                                                                        | `stamps deletedAt from a clock read after the medication lock`                                                                 |
| 11  | In `purgeExpiredTrash`, `lte(doseLogTrash.deletedAt, cutoff)` → `lt(doseLogTrash.deletedAt, cutoff)` (`lt` is already imported)                                                                                                                 | `an on-write purge removes this user's expired rows only` (`at-cutoff` survives)                                               |
| 12  | `opts.userId ? eq(doseLogTrash.userId, opts.userId) : undefined` → `undefined`                                                                                                                                                                  | `an on-write purge removes this user's expired rows only` (`other-user` is purged)                                             |
| 13  | `.for("update", { skipLocked: true })` → `.for("update")`                                                                                                                                                                                       | `never waits: its row locks skip rows another transaction holds`                                                               |
| 14  | `opts.userId ? eq(doseLogTrash.userId, opts.userId) : undefined` → `eq(doseLogTrash.userId, opts.userId ?? "")`                                                                                                                                 | `without a userId it purges every user's expired rows`                                                                         |
| 15  | Drop `eq(doseLogs.userId, userId)` from BOTH the step-1 read and the step-3 delete (leave `eq(doseLogs.id, doseId)`)                                                                                                                            | `returns null and writes nothing for a missing dose or another user's`                                                         |

**Why the sequential double-delete test carries no mutation.** The spec names "ignore RETURNING's row count" for the sequential double-delete test. That test cannot kill it: a second, sequential call stops at step 1's `if (!found) return null`, before it reaches RETURNING. The staged losing-side test carries that mutation instead (#7). The sequential test stays as the plain behavioural pin (stock credited once, one event, one tombstone).

---

#### Cycle B — the shared delete action

- [ ] **Step 7: Write the failing tests**

**`tests/unit/dashboard-dose-actions.test.ts`:**

1. Replace

   ```ts
   // Verifies the dashboard's dose mutations don't report success when the
   // underlying row no longer exists (deleted in another tab or via native
   // -app sync). deleteDose() returns false and updateDose() returns null
   // in that case — the actions must surface a failure, not `success`.
   ```

   with

   ```ts
   // Verifies the dashboard's dose mutations don't report success when the
   // underlying row no longer exists (deleted in another tab or via native
   // -app sync). deleteDose() and updateDose() return null in that case —
   // the actions must surface a failure, not `success`.
   ```

2. Replace

   ```ts
   const state = {
     deleteResult: true as boolean,
     updateResult: { id: "d1" } as object | null,
   };

   const deleteDose = vi.fn(async () => state.deleteResult);
   ```

   with

   ```ts
   const DELETED_AT = new Date("2026-04-16T19:05:00.000Z");
   /** What deleteDose returns for a dose it removed. */
   const deletedDose = () => ({ doseId: "d1", medicationId: "m1", deletedAt: DELETED_AT });

   const state = {
     deleteResult: deletedDose() as ReturnType<typeof deletedDose> | null,
     updateResult: { id: "d1" } as object | null,
   };

   const deleteDose = vi.fn(async (..._args: unknown[]) => state.deleteResult);
   ```

3. In the `vi.mock("$lib/server/doses", …)` factory, replace

   ```ts
     deleteDose: (...args: unknown[]) => deleteDose(...(args as [])),
   ```

   with

   ```ts
     deleteDose: (...args: unknown[]) => deleteDose(...args),
   ```

4. In `beforeEach`, replace `  state.deleteResult = true;` with `  state.deleteResult = deletedDose();`.
5. Replace the whole `describe("dashboard deleteDose action", () => { … });` block with:

   ```ts
   describe("dashboard deleteDose action", () => {
     const postDelete = (fields: Record<string, string>) =>
       actions.deleteDose({ request: formRequest(fields), locals } as never);

     it("returns 404 when the dose no longer exists instead of success", async () => {
       state.deleteResult = null;

       const res = await postDelete({ doseId: "gone" });

       expect(res).toMatchObject({ status: 404, data: { error: "Dose not found" } });
     });

     it("keeps the dose for Undo and hands back its restore handle", async () => {
       const res = await postDelete({ doseId: "d1" });

       expect(deleteDose).toHaveBeenCalledWith("u1", "d1", { keepForUndo: true });
       // D6: the server keeps the row for ten minutes; deletedAt round-trips exactly.
       expect(res).toEqual({
         success: true,
         doseId: "d1",
         restore: { deletedAt: "2026-04-16T19:05:00.000Z", expiresInMs: 600_000 },
       });
     });

     it("keeps no trash row and offers no restore for a create's Undo (forUndo=1)", async () => {
       const res = await postDelete({ doseId: "d1", forUndo: "1" });

       expect(deleteDose).toHaveBeenCalledWith("u1", "d1", { keepForUndo: false });
       expect(res).toEqual({ success: true, doseId: "d1" });
     });

     it("answers 400 with the existing copy when doseId is missing, deleting nothing", async () => {
       const res = await postDelete({});

       expect(res).toMatchObject({ status: 400, data: { error: "Missing dose ID" } });
       expect(deleteDose).not.toHaveBeenCalled();
     });

     it('refuses a forUndo flag other than "1" rather than guessing, deleting nothing', async () => {
       const res = await postDelete({ doseId: "d1", forUndo: "true" });

       expect(res).toMatchObject({ status: 400 });
       expect(deleteDose).not.toHaveBeenCalled();
     });
   });
   ```

**`tests/unit/log-dose-actions.test.ts`:**

1. Replace

   ```ts
   // Same contract as tests/unit/dashboard-dose-actions.test.ts, for the
   // Log page: a stale dose row (removed in another tab/session) must not
   // produce `{ success: true }` and a "Dose updated" toast.
   const state = {
     deleteResult: true as boolean,
     updateResult: { id: "d1" } as object | null,
   };

   const deleteDose = vi.fn(async () => state.deleteResult);
   ```

   with

   ```ts
   // Same contract as tests/unit/dashboard-dose-actions.test.ts, for the
   // Log page: a stale dose row (removed in another tab/session) must not
   // produce `{ success: true }` and a "Dose updated" toast. The delete is
   // the shared deleteDoseAction, so /log answers exactly as the dashboard.
   const DELETED_AT = new Date("2026-08-04T10:00:00.000Z");
   /** What deleteDose returns for a dose it removed. */
   const deletedDose = () => ({ doseId: "d1", medicationId: "m1", deletedAt: DELETED_AT });

   const state = {
     deleteResult: deletedDose() as ReturnType<typeof deletedDose> | null,
     updateResult: { id: "d1" } as object | null,
   };

   const deleteDose = vi.fn(async (..._args: unknown[]) => state.deleteResult);
   ```

2. In the `vi.mock("$lib/server/doses", …)` factory, replace `  deleteDose: (...args: unknown[]) => deleteDose(...(args as [])),` with `  deleteDose: (...args: unknown[]) => deleteDose(...args),`.
3. In `beforeEach`, replace `  state.deleteResult = true;` with `  state.deleteResult = deletedDose();`.
4. Replace the whole `describe("log deleteDose action (regression — already correct)", () => { … });` block with:

   ```ts
   describe("log deleteDose action", () => {
     const postDelete = (fields: Record<string, string>) =>
       actions.deleteDose({ request: formRequest(fields), locals } as never);

     it("returns 404 when the dose no longer exists", async () => {
       state.deleteResult = null;

       const res = await postDelete({ doseId: "gone" });

       expect(res).toMatchObject({ status: 404, data: { error: "Dose not found" } });
     });

     it("keeps the dose for Undo and hands back its restore handle", async () => {
       const res = await postDelete({ doseId: "d1" });

       expect(deleteDose).toHaveBeenCalledWith("u1", "d1", { keepForUndo: true });
       expect(res).toEqual({
         success: true,
         doseId: "d1",
         restore: { deletedAt: "2026-08-04T10:00:00.000Z", expiresInMs: 600_000 },
       });
     });

     it("keeps no trash row and offers no restore for a create's Undo (forUndo=1)", async () => {
       const res = await postDelete({ doseId: "d1", forUndo: "1" });

       expect(deleteDose).toHaveBeenCalledWith("u1", "d1", { keepForUndo: false });
       expect(res).toEqual({ success: true, doseId: "d1" });
     });

     it("answers 400 with the existing copy when doseId is missing, deleting nothing", async () => {
       const res = await postDelete({});

       expect(res).toMatchObject({ status: 400, data: { error: "Missing dose ID" } });
       expect(deleteDose).not.toHaveBeenCalled();
     });
   });
   ```

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts`
Expected: FAIL.

- `keeps the dose for Undo…` fails in both files. The old actions call `deleteDose("u1", "d1")` with no options and return `{ success: true }`.
- `…create's Undo (forUndo=1)` fails for the same reason.
- `refuses a forUndo flag other than "1"…` fails: the old action never reads `forUndo`, so it deletes.
- The 404 and missing-id cases already pass.

- [ ] **Step 9: Write minimal implementation**

Create `src/lib/server/dose-actions.ts`:

```ts
import { error, fail, type ActionFailure } from "@sveltejs/kit";
import { deleteDose } from "$lib/server/doses";
import { doseDeleteSchema } from "$lib/utils/validation";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";

/**
 * Dose-write form actions that more than one route serves.
 *
 * The dashboard and /log both expose `?/deleteDose`, and each used to spell
 * the action out for itself. They now share one body, so the 401 guard, the
 * parse, D8's create-Undo flag and the restore handle cannot drift apart
 * between the two routes. (Task 3 adds `restoreDoseAction` here.)
 */

/**
 * `?/deleteDose`, for the dashboard and /log.
 *
 * - **401 first.** A request with no signed-in user is refused before
 *   anything else runs, because form actions execute before the `(app)`
 *   layout's guard.
 * - **Bad input.** A body that fails `doseDeleteSchema` keeps the old copy,
 *   "Missing dose ID". That includes a `forUndo` other than `"1"`: a
 *   malformed flag never falls through to a delete that keeps a trash row.
 * - **A create's Undo.** `forUndo=1` marks the delete behind a create's
 *   Undo. Nobody can undo that one, so it keeps no trash row and returns no
 *   `restore` (D8).
 * - **An ordinary delete** returns the handle its Undo posts back:
 *   `deletedAt`, exactly as stamped, and how long the server keeps the row.
 * - **Already gone.** A dose removed in another tab, by the Mac app or by a
 *   double tap gets a 404, never a success the toast would misreport.
 */
export async function deleteDoseAction(event: {
  locals: App.Locals;
  request: Request;
}): Promise<
  | ActionFailure<{ error: string }>
  | { success: true; doseId: string; restore?: { deletedAt: string; expiresInMs: number } }
> {
  const { locals, request } = event;
  if (!locals.user) error(401, "Unauthorized");
  const user = locals.user;

  const parsed = doseDeleteSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return fail(400, { error: "Missing dose ID" });

  const { doseId, forUndo } = parsed.data;
  const keepForUndo = forUndo !== "1";
  const deleted = await deleteDose(user.id, doseId, { keepForUndo });
  if (!deleted) return fail(404, { error: "Dose not found" });

  if (!keepForUndo) return { success: true, doseId };
  return {
    success: true,
    doseId,
    restore: { deletedAt: deleted.deletedAt.toISOString(), expiresInMs: DOSE_UNDO_WINDOW_MS },
  };
}
```

In `src/routes/(app)/dashboard/+page.server.ts`, make two edits.

1. Replace

   ```ts
   import {
     logDose,
     logDoseForSlot,
     logSkippedDose,
     deleteDose,
     updateDose,
     MedicationNotFoundError,
     SlotAlreadyTakenError,
     SlotTargetChangedError,
   } from "$lib/server/doses";
   ```

   with

   ```ts
   import {
     logDose,
     logDoseForSlot,
     logSkippedDose,
     updateDose,
     MedicationNotFoundError,
     SlotAlreadyTakenError,
     SlotTargetChangedError,
   } from "$lib/server/doses";
   import { deleteDoseAction } from "$lib/server/dose-actions";
   ```

2. Replace the whole action

   ```ts
     deleteDose: async ({ request, locals }) => {
       if (!locals.user) error(401, "Unauthorized");

       const formData = await request.formData();
       const doseId = formData.get("doseId") as string;

       if (!doseId) return fail(400, { error: "Missing dose ID" });
       // deleteDose returns false for a stale/unowned row (removed in
       // another tab or via sync) — surface it instead of a false toast.
       const deleted = await deleteDose(locals.user!.id, doseId);
       if (!deleted) return fail(404, { error: "Dose not found" });
       return { success: true };
     },
   ```

   with

   ```ts
     // Shared with /log. The 401 guard, the parse, D8's `forUndo` and the
     // restore handle all live in `deleteDoseAction`.
     deleteDose: (event) => deleteDoseAction(event),
   ```

In `src/routes/(app)/log/+page.server.ts`, make two edits.

1. Replace

   ```ts
   import { updateDose, deleteDose } from "$lib/server/doses";
   ```

   with

   ```ts
   import { updateDose } from "$lib/server/doses";
   import { deleteDoseAction } from "$lib/server/dose-actions";
   ```

2. Replace the whole action

   ```ts
     deleteDose: async ({ request, locals }) => {
       if (!locals.user) error(401, "Unauthorized");

       const formData = await request.formData();
       const doseId = formData.get("doseId") as string;
       if (!doseId) return fail(400, { error: "Missing dose ID" });
       const deleted = await deleteDose(locals.user!.id, doseId);
       if (!deleted) return fail(404, { error: "Dose not found" });
       return { success: true };
     },
   ```

   with

   ```ts
     // Shared with the dashboard; see `deleteDoseAction`.
     deleteDose: (event) => deleteDoseAction(event),
   ```

`error` and `fail` stay imported in both route files, because `editDose` (and the dashboard's log and skip actions) still use them.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts tests/unit/app-action-auth-guard.test.ts`
Expected: PASS.

- `dashboard-dose-actions`: 25 passed. It had 22 before this task; its 2 deleteDose tests are replaced by 5.
- `log-dose-actions`: 6 passed (2 editDose + 4 deleteDose).
- `app-action-auth-guard`: unchanged count, all passed. Its `{ doseId: "d1" }` body passes `doseDeleteSchema`, so the dashboard and /log `?/deleteDose` cases still reach the guard.

- [ ] **Step 11: Prove by mutation**

For each mutation:

1. Break the line in `src/lib/server/dose-actions.ts`.
2. Run the command shown.
3. Watch the named test(s) FAIL.
4. Restore the line and re-run green.

| #   | Mutation                                                                                                       | Command                                                                                                            | Test(s) that must fail                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `const keepForUndo = forUndo !== "1";` → `const keepForUndo = true;`                                           | `npx vitest run tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts -t "forUndo=1"`      | `keeps no trash row and offers no restore for a create's Undo (forUndo=1)`, in both files                                                        |
| A2  | Replace the final `return { success: true, doseId, restore: { … } };` with `return { success: true, doseId };` | `npx vitest run tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts -t "restore handle"` | `keeps the dose for Undo and hands back its restore handle`, in both files                                                                       |
| A3  | Delete the line `if (!locals.user) error(401, "Unauthorized");`                                                | `npx vitest run tests/unit/app-action-auth-guard.test.ts -t "deleteDose"`                                          | `dashboard ?/deleteDose 401s an anonymous POST…` and `log ?/deleteDose 401s an anonymous POST…` (each now rejects with a `TypeError`, not a 401) |
| A4  | Delete the line `if (!deleted) return fail(404, { error: "Dose not found" });`                                 | `npx vitest run tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts -t "404"`            | `returns 404 when the dose no longer exists…`, in both files                                                                                     |

---

#### Cycle C — `/api/v1 delete_dose`

- [ ] **Step 12: Write the failing test**

In `tests/unit/api/commands.test.ts`, make three edits.

1. Replace

   ```ts
   const deleteDose = vi.fn(async (_userId: string, _doseId: string): Promise<boolean> => true);
   ```

   with

   ```ts
   type DeletedDose = { doseId: string; medicationId: string; deletedAt: Date };
   const deleteDose = vi.fn(
     async (
       _userId: string,
       _doseId: string,
       _opts: { keepForUndo: boolean },
     ): Promise<DeletedDose | null> => ({
       doseId: "dose-1",
       medicationId: "med-1",
       deletedAt: new Date("2026-01-06T00:00:00Z"),
     }),
   );
   ```

2. In the `vi.mock("$lib/server/doses", …)` factory, replace

   ```ts
     deleteDose: (userId: string, doseId: string) => deleteDose(userId, doseId),
   ```

   with

   ```ts
     deleteDose: (userId: string, doseId: string, opts: { keepForUndo: boolean }) =>
       deleteDose(userId, doseId, opts),
   ```

3. Replace the whole test

   ```ts
   it("delete_dose calls deleteDose with the mapped doseId and returns {deleted: boolean}", async () => {
     deleteDose.mockResolvedValueOnce(true);

     const result = await dispatchCommand("u1", "delete_dose", { doseId: "dose-1" });

     expect(deleteDose).toHaveBeenCalledTimes(1);
     expect(deleteDose).toHaveBeenCalledWith("u1", "dose-1");
     expect(result).toEqual({ deleted: true });
   });
   ```

   with

   ```ts
   it("delete_dose keeps no trash row (the Mac app has no Undo) and returns {deleted: true}", async () => {
     const result = await dispatchCommand("u1", "delete_dose", { doseId: "dose-1" });

     expect(deleteDose).toHaveBeenCalledTimes(1);
     expect(deleteDose).toHaveBeenCalledWith("u1", "dose-1", { keepForUndo: false });
     // The frozen wire shape: a boolean, never the DeletedDose object.
     expect(result).toEqual({ deleted: true });
   });

   it("delete_dose returns {deleted: false} when deleteDose finds nothing", async () => {
     deleteDose.mockResolvedValueOnce(null);

     const result = await dispatchCommand("u1", "delete_dose", { doseId: "missing" });

     expect(result).toEqual({ deleted: false });
   });
   ```

- [ ] **Step 13: Run the test to verify it fails**

Run: `npx vitest run tests/unit/api/commands.test.ts -t "delete_dose"`
Expected: FAIL.

- The first test fails: `deleteDose` was called with `("u1", "dose-1")`, missing `{ keepForUndo: false }`. The result is also `{ deleted: { doseId: … } }`, not `{ deleted: true }`.
- The second test fails with `expected { deleted: null } to deeply equal { deleted: false }`.

- [ ] **Step 14: Write minimal implementation**

In `src/lib/server/api/commands.ts`, replace

```ts
  delete_dose: async (userId, payload) => {
    const p = deleteDosePayload.parse(payload);
    return { deleted: await deleteDose(userId, p.doseId) };
  },
```

with

```ts
  delete_dose: async (userId, payload) => {
    const p = deleteDosePayload.parse(payload);
    // The Mac app has no Undo, so a trash row would only linger (spec D8).
    // The wire shape stays `{ deleted: boolean }`.
    return { deleted: (await deleteDose(userId, p.doseId, { keepForUndo: false })) !== null };
  },
```

- [ ] **Step 15: Run the test to verify it passes**

Run: `npx vitest run tests/unit/api/commands.test.ts`
Expected: PASS, 30 tests (29 before this task, plus the new `{deleted: false}` case).

- [ ] **Step 16: Prove by mutation**

For each mutation, break the line in `src/lib/server/api/commands.ts`, run `npx vitest run tests/unit/api/commands.test.ts -t "delete_dose"`, watch the named test fail, then restore and re-run green.

| #   | Mutation                                                                                                                               | Test(s) that must fail                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| C1  | `{ keepForUndo: false }` → `{ keepForUndo: true }`                                                                                     | `delete_dose keeps no trash row (the Mac app has no Undo) and returns {deleted: true}` |
| C2  | `(await deleteDose(userId, p.doseId, { keepForUndo: false })) !== null` → `await deleteDose(userId, p.doseId, { keepForUndo: false })` | both `delete_dose` tests (the wire leaks the object or `null`)                         |

---

- [ ] **Step 17: Update existing tests this change breaks**

Every file this change breaks has already been updated in Steps 4, 7 and 12:

- `tests/unit/pg/dose-inventory-symmetry.test.ts`
- `tests/unit/doses-inventory.test.ts`
- `tests/unit/dashboard-dose-actions.test.ts`
- `tests/unit/log-dose-actions.test.ts`
- `tests/unit/api/commands.test.ts`

`tests/unit/app-action-auth-guard.test.ts` needs no edit. Its `deleteDose: never("deleteDose")` mock and its Zod-valid `{ doseId: "d1" }` bodies still hold, and mutation A3 proved it still guards the shared helper. The later tasks change the other `deleteDose` mentions that grep finds, which are client tests of form `action` attributes (`timeline-entry-delete-confirm`, `done-list-ssr`, `dose-action-form`). They assert markup, not the server response, so this task does not break them.

Confirm no production code still calls the old signature:

Run: `grep -rn "deleteDose(" src | grep -v "keepForUndo" | grep -v "^src/lib/server/doses.ts"`
Expected: no output. The only production callers are `dose-actions.ts` and `api/commands.ts`, and both pass `{ keepForUndo }`.

- [ ] **Step 18: Run the task's full suite**

Run: `npx prettier --write src/lib/server/doses.ts src/lib/server/dose-actions.ts "src/routes/(app)/dashboard/+page.server.ts" "src/routes/(app)/log/+page.server.ts" src/lib/server/api/commands.ts tests/unit/pg/dose-delete-trash.test.ts tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/doses-inventory.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts tests/unit/api/commands.test.ts`
Expected: the files are rewritten in place, and the only changes are line wrapping.

Run: `npx vitest run tests/unit/pg/dose-delete-trash.test.ts tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/doses-inventory.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts tests/unit/api/commands.test.ts tests/unit/app-action-auth-guard.test.ts tests/unit/pg/dose-edit-round-trip.test.ts`
Expected: PASS. `dose-edit-round-trip` imports the /log actions, which now import `dose-actions`, so it is included here as the import-graph check.

Run: `npx vitest run`
Expected: PASS, with the whole unit suite green.

Run: `npm run check 2>&1 | tail -3`
Expected: the same error and warning counts as the Step 0 baseline.

At planning time, `purgeExpiredTrash`'s calls on the `typeof db | DbTransaction` union were typechecked against drizzle-orm 0.45.2 (neon-http plus neon-serverless) and compiled clean; `recordInventoryEvent`'s `InventoryClient` union already relies on the same thing. If a future drizzle upgrade makes svelte-check report "This expression is not callable" on `executor.select`, build the subquery without the executor, which renders identical SQL:

1. Add `import { QueryBuilder } from "drizzle-orm/pg-core";`.
2. Replace `const expired = executor` with `const expired = new QueryBuilder()`.
3. Keep `executor.delete(...)`.

Run: `npm run lint`
Expected: 0 errors. `_updatedAt` matches the `varsIgnorePattern: "^_"` rule, so it adds no warning.

Run: `npx prettier --check src tests`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 19: Commit**

```bash
git add src/lib/server/doses.ts src/lib/server/dose-actions.ts "src/routes/(app)/dashboard/+page.server.ts" "src/routes/(app)/log/+page.server.ts" src/lib/server/api/commands.ts tests/unit/pg/dose-delete-trash.test.ts tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/doses-inventory.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts tests/unit/api/commands.test.ts
git commit -m "feat(doses): move deleted doses to the trash under the medication lock

deleteDose now runs in one transaction, locking the medication before the
dose. It credits stock only when its own DELETE ... RETURNING found the
row, so an overlapping second delete writes nothing instead of minting
stock. When the caller will offer an Undo, the row is kept in
dose_log_trash with the amount it actually credited, and expired trash is
purged with FOR UPDATE SKIP LOCKED.

The dashboard and /log delete actions share deleteDoseAction, which
returns the restore handle and honours forUndo=1 for a create's Undo.
/api/v1 delete_dose keeps no trash row; its wire shape is unchanged."
```

**Notes for the executor:**

- **The existing Undo leaves a trash row behind until Task 9.** Until Task 9 switches a create's Undo to post `forUndo=1`, the existing Toast Undo posts `/dashboard?/deleteDose` with only `doseId`. So it keeps a trash row. The row is harmless: nothing restores it before Task 3, and it is purged on that user's next delete (and, from Task 5, by retention). The plan ships as one PR, so this intermediate state never deploys.
- **Do not add `restoreDose` to any mock yet.** Task 3 adds `restoreDose: never("restoreDose")` to `app-action-auth-guard.test.ts`'s doses mock, together with the action that needs it.

---

### Task 3: Restore a deleted dose

A delete's Undo puts the trashed dose back under the **same id**, keyed on the `(doseId, deletedAt)` token that Task 2's `deleteDoseAction` returned. It follows spec Section 1 "Restoring a dose", steps 1–10, and D6/D7:

- It locks the medication first, then the trash row, and reads the clock after the medication lock.
- It refuses once the 10-minute window has closed (`gone`), or when that medication has had a dose **logged** since the delete (`logged_since`).
- It takes back `min(locked count, inventoryCredited)`: what the delete actually credited, and never `inventoryApplied` or `quantity`.
- It deletes **every** sync tombstone for the dose.
- It writes a `restore` audit row with no diff.

The stock clamp that `insertTakenDose` owns today moves into one private helper, `takeFromStock`, which both writers call.

**Prerequisite:** Tasks 1 and 2 are committed. That means `doseLogTrash`, `DOSE_UNDO_WINDOW_MS`, `doseRestoreSchema`, audit action `"restore"`, `InventoryEventType` `"dose_restored"`, `pgDb.seedTrash` and `pgDb.seedTombstone` exist, and so do `deleteDose(userId, doseId, { keepForUndo })`, `purgeExpiredTrash` and `src/lib/server/dose-actions.ts`.

**Files:**

- Modify: `src/lib/server/doses.ts`. Anchors:
  - the drizzle import as Task 2 left it: `import { eq, and, gte, lt, lte, asc, desc, sql, isNotNull, max, inArray } from "drizzle-orm";`
  - `insertTakenDose`, from its doc comment's first text line ` * The one taken-dose write: the row, the stock decrement, the inventory` down to its closing `}` just above `export async function logDose(`
  - `export async function updateDose(` (`restoreDose` goes directly above it)
- Modify: `src/lib/server/dose-actions.ts` (created in Task 2). Anchors:
  - `import { deleteDose } from "$lib/server/doses";`
  - `import { doseDeleteSchema } from "$lib/utils/validation";`
  - the module doc comment's last line, the one containing `(Task 3 adds`
  - the end of the file (after `deleteDoseAction`'s closing `}`)
- Modify: `src/routes/(app)/dashboard/+page.server.ts`. Anchors:
  - `import { deleteDoseAction } from "$lib/server/dose-actions";`
  - `  deleteDose: (event) => deleteDoseAction(event),`
- Modify: `tests/unit/app-action-auth-guard.test.ts`. Anchors:
  - `  deleteDose: never("deleteDose"),`
  - the dashboard `deleteDose` case, the multi-line object with `action: "deleteDose",` and `actions: dashboard.actions,`
- Modify: `tests/unit/dashboard-dose-actions.test.ts`. Anchors:
  - `const logSkippedDose = vi.fn(async (..._args: unknown[]) => "dose-skipped");`
  - `  logSkippedDose: (...args: unknown[]) => logSkippedDose(...args),`
  - `  logSkippedDose.mockClear();`
  - `describe("dashboard editDose action", () => {`
- Create: `tests/unit/pg/dose-restore.test.ts`
- Create: `tests/unit/dose-actions.test.ts`

**Interfaces:**

- Consumes (from Tasks 1 and 2, copied from the contract):
  - `src/lib/server/db/schema.ts`: `doseLogTrash` (`id`, `userId`, `medicationId`, `quantity`, `inventoryApplied`, `inventoryCredited` NOT NULL, `takenAt`, `loggedAt`, `notes`, `sideEffects`, `status`, `deletedAt`); `InventoryEventType` includes `"dose_restored"`.
  - `src/lib/utils/dose-undo.ts`: `export const DOSE_UNDO_WINDOW_MS = 10 * 60_000;`
  - `src/lib/utils/validation.ts`: `export const doseRestoreSchema = doseIdSchema.extend({ deletedAt: z.string().datetime() });`
  - `src/lib/server/audit.ts`: `logAudit`'s action union includes `"restore"`.
  - `src/lib/server/doses.ts`:
    ```ts
    export interface DeletedDose {
      doseId: string;
      medicationId: string;
      deletedAt: Date;
    }
    export async function deleteDose(
      userId: string,
      doseId: string,
      opts: { keepForUndo: boolean; now?: Date },
    ): Promise<DeletedDose | null>;
    type DbExecutor = typeof db | DbTransaction;
    export async function purgeExpiredTrash(
      executor: DbExecutor,
      opts: { now: Date; userId?: string },
    ): Promise<void>;
    ```
  - `src/lib/server/dose-actions.ts`: `deleteDoseAction(event)`, returning `restore: { deletedAt: <iso>, expiresInMs }`.
  - `tests/unit/helpers/pg-db.ts`: `pgDb.seedTrash(overrides)` and `pgDb.seedTombstone(overrides)`.
- Produces (later tasks rely on these exactly):
  - `src/lib/server/doses.ts`:
    ```ts
    export type RestoreOutcome = "restored" | "already_restored" | "gone" | "logged_since";
    export async function restoreDose(
      userId: string,
      doseId: string,
      deletedAt: Date,
      now?: Date,
    ): Promise<RestoreOutcome>;
    // private, shared with insertTakenDose so the clamp exists once:
    async function takeFromStock(
      tx: DbTransaction,
      i: {
        userId: string;
        medicationId: string;
        previousCount: number | null;
        amount: number;
        eventType: "dose_taken" | "dose_restored";
      },
    ): Promise<number /* applied = previousCount === null ? 0 : Math.min(previousCount, amount) */>;
    ```
  - `src/lib/server/dose-actions.ts`:
    ```ts
    export const RESTORE_GONE_MESSAGE = "Too late to undo. Log it again if you need it.";
    export const RESTORE_LOGGED_SINCE_MESSAGE =
      "A newer entry exists for this medication, so Undo wasn't applied.";
    export async function restoreDoseAction(event: {
      locals: App.Locals;
      request: Request;
    }): Promise<ActionFailure<{ error: string }> | { success: true; doseId: string }>;
    ```
  - `src/routes/(app)/dashboard/+page.server.ts`: the action `restoreDose: (event) => restoreDoseAction(event)`, reached at `/dashboard?/restoreDose` with form fields `doseId` and `deletedAt` (ISO). It answers:
    - `{ success: true, doseId }` for `restored` or `already_restored`;
    - `fail(410, { error: RESTORE_GONE_MESSAGE })`;
    - `fail(409, { error: RESTORE_LOGGED_SINCE_MESSAGE })`;
    - `fail(400, { error: "Invalid undo request" })`.

---

#### Cycle A — one clamp: extract `takeFromStock`

This is a pure refactor. Existing suites already pin every observable effect of the clamp, so there is no new test. Instead the suites run green before and after, and a mutation proves they still watch the extracted line.

- [ ] **Step 1: Record the baseline and pin current behaviour**

Run: `npm run check 2>&1 | tail -3`
Expected: note the `svelte-check found N errors and M warnings` line. This task must not add to either count.

Run: `npx vitest run tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/pg/dose-slot-writes.test.ts tests/unit/pg/low-inventory-episode.test.ts tests/unit/pg/dose-delete-trash.test.ts tests/unit/doses-inventory.test.ts`
Expected: PASS. These are the suites that exercise `insertTakenDose` through `logDose` and `logDoseForSlot`, on PGlite and on fake-db. If a PGlite file fails to import `@electric-sql/pglite`, run `npm install --no-save @electric-sql/pglite` outside the sandbox and retry.

- [ ] **Step 2: Extract the helper**

In `src/lib/server/doses.ts`, replace the whole of `insertTakenDose`, from its doc comment's opening `/**` down to its closing `}` just above `export async function logDose(`. The doc comment's first text line is ` * The one taken-dose write: the row, the stock decrement, the inventory`. Replace it with:

```ts
/**
 * Take `amount` doses from stock, never below zero, and return how many
 * actually left the bottle.
 *
 * This is the only copy of the clamp. A taken dose (`insertTakenDose`) and a
 * restored one (`restoreDose`) both come through here, so the
 * `inventoryApplied` a row records is always what this UPDATE removed. A dose
 * of 3 logged against a stock of 1 removes 1, and a delete that later gave
 * back 3 would invent the other two.
 *
 * `previousCount` is the caller's read of `medications.inventoryCount` inside
 * the same transaction. NULL means inventory is not tracked: nothing is
 * taken, no event is written, and 0 is returned.
 *
 * The UPDATE subtracts `amount`, not the result. The two give the same count
 * whenever `previousCount` is still the live value, which it is when the
 * caller read it under the medication lock (D7). The `GREATEST` keeps the
 * column non-negative even when it is not.
 */
async function takeFromStock(
  tx: DbTransaction,
  i: {
    userId: string;
    medicationId: string;
    previousCount: number | null;
    amount: number;
    eventType: "dose_taken" | "dose_restored";
  },
): Promise<number> {
  const applied = i.previousCount === null ? 0 : Math.min(i.previousCount, i.amount);

  await tx
    .update(medications)
    .set({
      inventoryCount: sql`GREATEST(0, ${medications.inventoryCount} - ${i.amount})`,
    })
    .where(
      and(
        eq(medications.id, i.medicationId),
        eq(medications.userId, i.userId),
        isNotNull(medications.inventoryCount),
      ),
    );

  // An event only when inventory was actually tracked, recording what really
  // left the bottle after the clamp.
  if (i.previousCount !== null) {
    await recordInventoryEvent(tx, {
      userId: i.userId,
      medicationId: i.medicationId,
      eventType: i.eventType,
      quantityChange: -applied,
      previousCount: i.previousCount,
      newCount: i.previousCount - applied,
    });
  }

  return applied;
}

/**
 * The one taken-dose write: the stock decrement, the inventory event, the
 * row and the audit entry, all inside the caller's transaction.
 *
 * `logDose` and `logDoseForSlot` both end here, so a Log-now dose and a chip
 * dose cannot drift apart on `inventoryApplied`, the column `deleteDose`
 * gives back. `previousCount` is the caller's own read of
 * `medications.inventoryCount`, taken inside the same transaction before
 * this insert. The caller decides whether that read locks.
 */
async function insertTakenDose(
  tx: DbTransaction,
  input: {
    userId: string;
    medicationId: string;
    quantity: number;
    takenAt: Date;
    loggedAt: Date;
    notes: string | null;
    sideEffects: SideEffect[] | null;
    previousCount: number | null;
  },
) {
  const { userId, medicationId, quantity, previousCount } = input;
  const id = createId();

  // What will really leave the bottle: not `quantity` whenever the clamp
  // engages. The stock moves first, because the row records the result.
  const inventoryApplied = await takeFromStock(tx, {
    userId,
    medicationId,
    previousCount,
    amount: quantity,
    eventType: "dose_taken",
  });

  const [inserted] = await tx
    .insert(doseLogs)
    .values({
      id,
      userId,
      medicationId,
      quantity,
      inventoryApplied,
      takenAt: input.takenAt,
      loggedAt: input.loggedAt,
      notes: input.notes,
      sideEffects: input.sideEffects,
      status: "taken",
    })
    .returning();

  await logAudit(userId, "dose_log", id, "create", undefined, tx);

  return inserted;
}
```

`inventoryApplied` is unchanged for every input: the old `previousCount - Math.max(0, previousCount - quantity)` equals `Math.min(previousCount, quantity)` for all integers. The UPDATE and the event are also unchanged. The one visible difference is statement order inside the transaction: the stock UPDATE and the event INSERT now come before the dose INSERT. No test pins that order. `grep -rn "queryLog" tests/unit` finds no assertion about `insert into "dose_logs"`, and the fake-db rollback test still sees the medications UPDATE fail before `logAudit`.

- [ ] **Step 3: Run the same suites to verify they still pass**

Run: `npx vitest run tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/pg/dose-slot-writes.test.ts tests/unit/pg/low-inventory-episode.test.ts tests/unit/pg/dose-delete-trash.test.ts tests/unit/doses-inventory.test.ts`
Expected: PASS, with the same test count as Step 1.

- [ ] **Step 4: Prove by mutation**

For each row:

1. Break the line in `takeFromStock`.
2. Run the command.
3. Watch the named test FAIL.
4. Restore the line and re-run green.

| #   | Mutation                                                                                                | Command                                                                             | Test that must fail                                                                         |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A1  | `Math.min(i.previousCount, i.amount)` → `i.amount`                                                      | `npx vitest run tests/unit/pg/dose-inventory-symmetry.test.ts`                      | `restores only what was taken when the clamp engaged` (expected 3 to be 1)                  |
| A2  | `eventType: i.eventType,` → `eventType: "dose_restored",`                                               | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "stock bookkeeping"`      | `writes one taken dose at now, with logDose's stock bookkeeping` (the ledger's `eventType`) |
| A3  | Remove the `if (i.previousCount !== null) {` guard (and its closing `}`) so the event is always written | `npx vitest run tests/unit/pg/dose-inventory-symmetry.test.ts -t "applies nothing"` | `applies nothing, records nothing, and stays null`                                          |

- [ ] **Step 5: Commit the refactor**

```bash
npx prettier --write src/lib/server/doses.ts
git add src/lib/server/doses.ts
git commit -m "refactor(doses): take stock through one clamp

insertTakenDose's GREATEST(0, count - quantity) decrement, its applied
amount and its inventory event move into takeFromStock, so the restore
added next reuses the same clamp instead of restating it. Behaviour is
unchanged; the stock update now runs before the dose insert because the
row records the helper's result."
```

---

#### Cycle B — `restoreDose`: the round trip, stock, lifecycle, audit, sync, locks

- [ ] **Step 6: Write the failing test**

Create `tests/unit/pg/dose-restore.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * A delete's Undo: `restoreDose` moves a trashed dose back into `dose_logs`.
 *
 * The database decides every rule here: the `(id, deletedAt)` token match,
 * the window, the since-delete guard, the `GREATEST` clamp, the tombstone
 * cleanup and the cascade from a deleted medication. `fake-db` answers reads
 * from its seed and never evaluates a predicate, so these tests run on
 * PGlite (CLAUDE.md, test-seam rule).
 *
 * PGlite is one backend and serialises transactions, so nothing here is a
 * race. A losing side is covered by seeding the state it would see and
 * calling it sequentially. The lock order is pinned by its SQL.
 *
 * `dose_logs.updatedAt` on insert, `inventory_events.createdAt` and
 * `sync_tombstones.deletedAt` default to Postgres `now()`, the REAL clock,
 * not the faked one. No assertion below depends on how those compare with a
 * faked instant.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";
import {
  auditLogs,
  doseLogs,
  doseLogTrash,
  inventoryEvents,
  medications,
  syncTombstones,
} from "../../../src/lib/server/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { DOSE_UNDO_WINDOW_MS } from "../../../src/lib/utils/dose-undo";
import type { SideEffect } from "../../../src/lib/types";

const { logDose, deleteDose, restoreDose } = await import("../../../src/lib/server/doses");
const { refillMedication, adjustInventory } =
  await import("../../../src/lib/server/inventory-events");
const { buildSyncResponse } = await import("../../../src/lib/server/api/sync");

/** The dose is logged. */
const LOGGED = new Date("2026-04-16T08:00:00.000Z");
/** It is removed. This is the Undo token's `deletedAt`. */
const DELETED = new Date("2026-04-16T08:05:00.000Z");
/** Something else happens to the medication before the Undo. */
const BETWEEN = new Date("2026-04-16T08:05:30.000Z");
/** The Undo arrives, one minute after the delete. */
const RESTORE = new Date("2026-04-16T08:06:00.000Z");

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
}

async function doseRow(id: string) {
  const [row] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.id, id));
  return row;
}

async function trashRows() {
  return pgDb.db.select().from(doseLogTrash).orderBy(asc(doseLogTrash.id));
}

async function restoredEvents() {
  return pgDb.db
    .select({
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
    })
    .from(inventoryEvents)
    .where(eq(inventoryEvents.eventType, "dose_restored"));
}

async function tombstonesFor(entityId: string) {
  return pgDb.db
    .select()
    .from(syncTombstones)
    .where(and(eq(syncTombstones.entityType, "dose_log"), eq(syncTombstones.entityId, entityId)));
}

async function seedStock(count: number | null) {
  await pgDb.seedMedication({ id: "m1", name: "Metformin", inventoryCount: count });
}

/**
 * Log a dose at LOGGED and remove it at DELETED, keeping it for Undo.
 * Returns its id, its Undo token and the row as it stood before the delete.
 */
async function logThenDelete(
  opts: { quantity?: number; notes?: string; sideEffects?: SideEffect[] } = {},
) {
  vi.setSystemTime(LOGGED);
  const dose = await logDose(
    "u1",
    "m1",
    opts.quantity ?? 1,
    undefined,
    opts.notes,
    opts.sideEffects,
  );
  const before = await doseRow(dose.id);
  if (!before) throw new Error("fixture: the log wrote nothing");

  vi.setSystemTime(DELETED);
  const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
  if (!deleted) throw new Error("fixture: the delete found nothing");

  return { id: dose.id, token: deleted.deletedAt, before };
}

/** Remove an existing dose at `at`, keeping it for Undo. Returns the token. */
async function deleteAt(id: string, at: Date): Promise<Date> {
  vi.setSystemTime(at);
  const deleted = await deleteDose("u1", id, { keepForUndo: true });
  if (!deleted) throw new Error(`fixture: nothing to delete for ${id}`);
  return deleted.deletedAt;
}

/** A statement that reads the medications table under a row lock. */
const isMedicationLock = (q: string) => /from "medications"/i.test(q) && /for update/i.test(q);

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  // Date only: faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LOGGED);
  queryLog.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("restoreDose — the round trip", () => {
  it("puts back the same id with every column, and takes the stock again", async () => {
    await seedStock(10);
    const { id, token, before } = await logThenDelete({
      quantity: 2,
      notes: "after food",
      sideEffects: [{ name: "nausea", severity: "mild" }],
    });
    expect(before).toMatchObject({ notes: "after food", loggedAt: LOGGED, inventoryApplied: 2 });
    expect(await stock()).toBe(10);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    // Every stored field, loggedAt included. Only the sync cursor moves, so a
    // client that already pulled the tombstone pulls the dose back.
    expect(await doseRow(id)).toEqual({ ...before, updatedAt: RESTORE });
    expect(await stock()).toBe(8);
    expect(await restoredEvents()).toEqual([
      { quantityChange: -2, previousCount: 10, newCount: 8 },
    ]);
    expect(await trashRows()).toEqual([]);
  });

  it.each(["skipped", "missed"] as const)(
    "puts back a %s entry with every column and no stock change",
    async (status) => {
      await seedStock(10);
      await pgDb.seedDose({
        id: "entry",
        medicationId: "m1",
        status,
        quantity: 1,
        takenAt: LOGGED,
        loggedAt: LOGGED,
      });
      const before = await doseRow("entry");
      const token = await deleteAt("entry", DELETED);

      vi.setSystemTime(RESTORE);
      expect(await restoreDose("u1", "entry", token)).toBe("restored");

      expect(await doseRow("entry")).toEqual({ ...before, updatedAt: RESTORE });
      expect(await stock()).toBe(10);
      expect(await restoredEvents()).toEqual([]);
    },
  );

  it("answers already_restored to a second restore, and takes stock once", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");
    // A retried Undo whose first attempt landed.
    expect(await restoreDose("u1", id, token)).toBe("already_restored");

    expect(await stock()).toBe(9);
    expect(await restoredEvents()).toHaveLength(1);
  });

  it("refuses an older token after a newer delete of the same dose, writing nothing", async () => {
    await seedStock(10);
    const { id, token: first } = await logThenDelete();
    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, first)).toBe("restored");
    const second = await deleteAt(id, new Date("2026-04-16T08:07:00.000Z"));

    // The first toast's Undo, replayed after the second delete.
    vi.setSystemTime(new Date("2026-04-16T08:08:00.000Z"));
    expect(await restoreDose("u1", id, first)).toBe("gone");

    expect(await doseRow(id)).toBeUndefined();
    expect(await stock()).toBe(10);
    expect((await trashRows()).map((t) => t.deletedAt)).toEqual([second]);
  });

  it("refuses another user's restore of the token, writing nothing", async () => {
    await seedStock(10);
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    const { id, token } = await logThenDelete();

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u2", id, token)).toBe("gone");
    expect(await doseRow(id)).toBeUndefined();
    expect(await trashRows()).toHaveLength(1);
    expect(await stock()).toBe(10);

    expect(await restoreDose("u1", id, token)).toBe("restored");
  });
});

describe("restoreDose — stock", () => {
  it("clamps the re-take at what is left (stock 1, log 3, delete, adjust to 0)", async () => {
    await seedStock(1);
    const { id, token } = await logThenDelete({ quantity: 3 });
    // The log took the only 1 there was, and the delete gave that 1 back.
    expect(await stock()).toBe(1);
    expect((await trashRows())[0]).toMatchObject({ inventoryApplied: 1, inventoryCredited: 1 });

    vi.setSystemTime(BETWEEN);
    await adjustInventory("u1", "m1", 0);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    expect(await stock()).toBe(0);
    expect((await doseRow(id))?.inventoryApplied).toBe(0);
    expect(await restoredEvents()).toEqual([{ quantityChange: 0, previousCount: 0, newCount: 0 }]);
  });

  it("takes nothing when tracking is off at the restore", async () => {
    await seedStock(5);
    const { id, token } = await logThenDelete();
    expect(await stock()).toBe(5);

    vi.setSystemTime(BETWEEN);
    await pgDb.db.update(medications).set({ inventoryCount: null }).where(eq(medications.id, "m1"));

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    expect(await stock()).toBeNull();
    expect((await doseRow(id))?.inventoryApplied).toBe(0);
    expect(await restoredEvents()).toEqual([]);
  });

  it("takes nothing when tracking was off at the delete, even once it is back on", async () => {
    // Logged while tracking was on (it took 2), then tracking was switched off.
    await seedStock(null);
    await pgDb.seedDose({
      id: "d-off",
      medicationId: "m1",
      status: "taken",
      quantity: 2,
      inventoryApplied: 2,
      takenAt: LOGGED,
      loggedAt: LOGGED,
    });
    const token = await deleteAt("d-off", DELETED);
    // Nothing was given back, so nothing may be taken.
    expect((await trashRows())[0]).toMatchObject({ inventoryApplied: 2, inventoryCredited: 0 });

    vi.setSystemTime(BETWEEN);
    await refillMedication("u1", "m1", 10);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", "d-off", token)).toBe("restored");

    expect(await stock()).toBe(10);
    expect((await doseRow("d-off"))?.inventoryApplied).toBe(0);
    expect(await restoredEvents()).toEqual([
      { quantityChange: 0, previousCount: 10, newCount: 10 },
    ]);
  });

  it("leaves a refill intact when the dose was logged at zero stock (Review Focus #2)", async () => {
    await seedStock(0);
    vi.setSystemTime(LOGGED);
    const dose = await logDose("u1", "m1", 1);
    expect(dose.inventoryApplied).toBe(0);

    vi.setSystemTime(new Date("2026-04-16T08:02:00.000Z"));
    await refillMedication("u1", "m1", 30);
    const token = await deleteAt(dose.id, DELETED);
    expect(await stock()).toBe(30);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", dose.id, token)).toBe("restored");

    // The delete credited 0, so the Undo takes 0: the round trip changes nothing.
    expect(await stock()).toBe(30);
  });
});

describe("restoreDose — the medication changes between delete and Undo (Review Focus #5)", () => {
  it("still restores onto an archived medication", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    vi.setSystemTime(BETWEEN);
    await pgDb.db
      .update(medications)
      .set({ isArchived: true, archivedAt: BETWEEN })
      .where(eq(medications.id, "m1"));

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");
    expect(await stock()).toBe(9);
  });

  it("is gone once the medication is deleted, because the cascade took the trash row", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    // What the archived-medication wipe and import's replace mode do.
    vi.setSystemTime(BETWEEN);
    await pgDb.db.delete(medications).where(eq(medications.id, "m1"));
    expect(await trashRows()).toEqual([]);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("gone");
    expect(await doseRow(id)).toBeUndefined();
  });
});

describe("restoreDose — what else it writes", () => {
  it("writes one restore audit row, and no audit row carries the dose's note", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete({ notes: "private-note-xyzzy" });

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    // The audit log is synced to the Mac app and never purged.
    const audits = await pgDb.db.select().from(auditLogs).where(eq(auditLogs.userId, "u1"));
    expect(JSON.stringify(audits)).not.toContain("xyzzy");
    expect(audits.filter((a) => a.action === "restore")).toEqual([
      expect.objectContaining({ entityType: "dose_log", entityId: id, changes: null }),
    ]);
  });

  it("returns the dose and no tombstone to a client whose cursor predates the delete or sits between delete and restore", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();
    // A second tombstone for the same dose, as an earlier delete of it would leave.
    await pgDb.seedTombstone({ entityId: id, deletedAt: DELETED });

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    // Every one, not just the latest. The Mac app applies upserts before
    // tombstones within one delta, so a survivor would delete the restored
    // dose there for good.
    expect(await tombstonesFor(id)).toEqual([]);

    const beforeTheDelete = new Date("2026-04-16T08:04:00.000Z");
    for (const since of [beforeTheDelete, BETWEEN]) {
      const res = await buildSyncResponse("u1", since.toISOString(), 0);
      expect(res.fullResync).toBe(false);
      expect(res.doseLogs.map((d) => d.id)).toContain(id);
      expect(res.tombstones.filter((t) => t.entityId === id)).toEqual([]);
    }
  });

  it("purges this user's expired trash, and nobody else's", async () => {
    await seedStock(10);
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    const { id, token } = await logThenDelete();
    // Seeded after the delete, so the delete's own on-write purge cannot reach them.
    const expired = new Date(RESTORE.getTime() - DOSE_UNDO_WINDOW_MS - 60_000);
    await pgDb.seedTrash({ id: "old-u1", userId: "u1", medicationId: "m1", deletedAt: expired });
    await pgDb.seedTrash({ id: "fresh-u1", userId: "u1", medicationId: "m1", deletedAt: BETWEEN });
    await pgDb.seedTrash({ id: "old-u2", userId: "u2", medicationId: "m2", deletedAt: expired });

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    expect((await trashRows()).map((t) => t.id)).toEqual(["fresh-u1", "old-u2"]);
  });
});

describe("restoreDose — lock order and clock (D7)", () => {
  it("locks the medication before the trash row, with only unlocked reads before it", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();
    queryLog.length = 0;

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    const medicationLock = queryLog.findIndex(isMedicationLock);
    const trashLock = queryLog.findIndex(
      (q) =>
        /^select/i.test(q) &&
        /from "dose_log_trash"/i.test(q) &&
        /for update/i.test(q) &&
        !/skip locked/i.test(q),
    );
    expect(medicationLock).toBeGreaterThanOrEqual(0);
    expect(trashLock).toBeGreaterThan(medicationLock);
    // Before the medication lock there are only step 1's unlocked reads: no lock, no write.
    expect(
      queryLog.slice(0, medicationLock).filter((q) => !/^select/i.test(q) || /for update/i.test(q)),
    ).toEqual([]);
  });

  it("reads its clock after the medication lock", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    // The Undo arrives at RESTORE and is granted the medication lock a minute later.
    vi.setSystemTime(RESTORE);
    const granted = new Date(RESTORE.getTime() + 60_000);
    // The query logger records each statement just before it runs, so this
    // moves the clock at the moment the lock is taken.
    const push = queryLog.push.bind(queryLog);
    const spy = vi.spyOn(queryLog, "push").mockImplementation((...items: string[]) => {
      if (items.some(isMedicationLock)) vi.setSystemTime(granted);
      return push(...items);
    });
    try {
      expect(await restoreDose("u1", id, token)).toBe("restored");
    } finally {
      spy.mockRestore();
    }

    expect((await doseRow(id))?.updatedAt).toEqual(granted);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/unit/pg/dose-restore.test.ts`
Expected: FAIL. Every test fails with `TypeError: restoreDose is not a function`, because `doses.ts` does not export it yet. The fixtures before the first `restoreDose` call succeed, which confirms that Task 1's `seedTrash`/`seedTombstone` and Task 2's `deleteDose` are in place.

- [ ] **Step 8: Write minimal implementation**

**(a) Imports.** Confirm what Task 2 left in `src/lib/server/doses.ts`:

Run: `grep -n 'from "drizzle-orm"\|doseLogTrash,\|syncTombstones,\|dose-undo' src/lib/server/doses.ts | head`
Expected:

- the drizzle import `import { eq, and, gte, lt, lte, asc, desc, sql, isNotNull, max, inArray } from "drizzle-orm";`;
- `doseLogTrash,` and `syncTombstones,` in the multi-line schema import;
- `import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";`.

Nothing is added to the imports in this step. `gt` is added in Cycle D, the first step that uses it.

**(b) `restoreDose`.** Insert the following directly above the line `export async function updateDose(`. That puts it after Task 2's `deleteDose`.

```ts
export type RestoreOutcome = "restored" | "already_restored" | "gone" | "logged_since";

/**
 * A delete's Undo: move the trashed dose back into `dose_logs` under the SAME
 * id, and take its stock again.
 *
 * The token is `(doseId, deletedAt)`, exactly what `deleteDose` returned, so
 * an out-of-date Undo cannot reverse a newer delete of the same dose (D6).
 * The outcomes:
 *
 * - `restored`: the dose is back.
 * - `already_restored`: there is no trash row for the token, but the dose is
 *   live. This is a retried Undo whose first attempt landed, and the action
 *   answers it as success.
 * - `gone`: there is no trash row and no live dose (it was purged, wiped, or
 *   its medication was deleted), or the 10-minute window has closed.
 * - `logged_since`: a dose of this medication was LOGGED after the delete.
 *   Restoring then would record two doses for one slot and take stock twice
 *   (Remove 08:00, Log now at 08:40, Undo). The trash row stays.
 *
 * **Lock order (D7).** The medication row is locked first, then the trash
 * row. The clock is read after the medication lock, so it orders correctly
 * against every `loggedAt` and `deletedAt` written under that lock.
 *
 * **Stock.** It takes back what the delete CREDITED (`inventoryCredited`),
 * clamped at what is there now. It never uses `inventoryApplied` or
 * `quantity`. A dose deleted while tracking was off credited nothing, so
 * restoring it once tracking is back takes nothing. Using `inventoryApplied`
 * there would take stock that was never given back.
 *
 * **Tombstones.** Every tombstone for the dose is deleted, not just the
 * latest. The Mac app applies upserts before tombstones within one delta,
 * so a survivor would delete the restored dose there for good.
 *
 * **Audit.** The audit row carries no diff, so the dose's notes never reach
 * the synced, never-purged audit log.
 *
 * `now` is for tests. Production callers omit it, and the clock is read after
 * the lock.
 */
export async function restoreDose(
  userId: string,
  doseId: string,
  deletedAt: Date,
  now?: Date,
): Promise<RestoreOutcome> {
  return dbTx.transaction(async (tx): Promise<RestoreOutcome> => {
    const trashKey = and(
      eq(doseLogTrash.id, doseId),
      eq(doseLogTrash.userId, userId),
      eq(doseLogTrash.deletedAt, deletedAt),
    );

    // No trash row under this token. If the dose is live, an earlier restore
    // of it landed; otherwise it is gone for good.
    const noTrashRow = async (): Promise<RestoreOutcome> => {
      const [live] = await tx
        .select({ id: doseLogs.id })
        .from(doseLogs)
        .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
        .limit(1);
      return live ? "already_restored" : "gone";
    };

    // 1. Find which medication to lock. This read needs no lock, because a
    //    dose's medication never changes.
    const [found] = await tx
      .select({ medicationId: doseLogTrash.medicationId })
      .from(doseLogTrash)
      .where(trashKey)
      .limit(1);
    if (!found) return noTrashRow();

    // 2. Lock the medication first (D7), then read the clock.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, found.medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    const at = now ?? new Date();

    // 3. Then lock the trash row. If it has gone, a concurrent restore or a
    //    cascade took it while this one waited.
    const [trash] = await tx.select().from(doseLogTrash).where(trashKey).limit(1).for("update");
    if (!trash) return noTrashRow();

    // 6. Take it out of the trash.
    await tx.delete(doseLogTrash).where(trashKey);

    // 7. Take the stock again: what the delete credited, clamped at what is
    //    there now. Skipped and missed entries never took any.
    const inventoryApplied =
      trash.status === "taken"
        ? await takeFromStock(tx, {
            userId,
            medicationId: trash.medicationId,
            previousCount: med?.inventoryCount ?? null,
            amount: trash.inventoryCredited,
            eventType: "dose_restored",
          })
        : trash.inventoryApplied;

    // 8. Re-insert the same id with every stored field, the original
    //    loggedAt included, so that a later restore's since-delete guard does
    //    not mistake this row for a new log. `updatedAt` moves, so delta sync
    //    sends the dose again.
    await tx.insert(doseLogs).values({
      id: trash.id,
      userId,
      medicationId: trash.medicationId,
      quantity: trash.quantity,
      inventoryApplied,
      takenAt: trash.takenAt,
      loggedAt: trash.loggedAt,
      notes: trash.notes,
      sideEffects: trash.sideEffects,
      status: trash.status,
      updatedAt: at,
    });

    // 9. Delete every tombstone for it. The table has no uniqueness, so
    //    there can be more than one.
    await tx
      .delete(syncTombstones)
      .where(
        and(
          eq(syncTombstones.userId, userId),
          eq(syncTombstones.entityType, "dose_log"),
          eq(syncTombstones.entityId, doseId),
        ),
      );

    // 10. Purge this user's expired trash, then audit with no diff.
    await purgeExpiredTrash(tx, { now: at, userId });
    await logAudit(userId, "dose_log", doseId, "restore", undefined, tx);

    return "restored";
  });
}
```

Steps 4 (the window) and 5 (the since-delete guard) are added in Cycles C and D, each after a test that fails without it.

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/unit/pg/dose-restore.test.ts`
Expected: PASS: 17 tests. The round trip `describe` has 6, because its `it.each` expands to two; stock has 4, the medication-change block 2, "what else it writes" 3, and lock order and clock 2.

- [ ] **Step 10: Prove by mutation**

For each row:

1. Break the line in `src/lib/server/doses.ts`.
2. Run `npx vitest run tests/unit/pg/dose-restore.test.ts -t "<filter>"`.
3. Watch the named test FAIL.
4. Restore the line and re-run the whole file green.

| #   | Mutation (in `restoreDose` unless noted)                                                                                                                                       | `-t` filter                      | Test that must fail                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Delete `      notes: trash.notes,` from the step-8 insert                                                                                                                      | `every column, and takes`        | `puts back the same id with every column, and takes the stock again`                                                                               |
| B2  | `      loggedAt: trash.loggedAt,` → `      loggedAt: at,`                                                                                                                      | `every column, and takes`        | `puts back the same id with every column, and takes the stock again`                                                                               |
| B3  | Delete `      updatedAt: at,` from the step-8 insert (the column then takes Postgres's real-clock default)                                                                     | `every column, and takes`        | `puts back the same id with every column, and takes the stock again`                                                                               |
| B4  | `      updatedAt: at,` → `      updatedAt: trash.loggedAt,`                                                                                                                    | `no tombstone to a client`       | `returns the dose and no tombstone to a client whose cursor predates the delete or sits between delete and restore` (neither cursor gets the dose) |
| B5  | Delete the step-6 line `    await tx.delete(doseLogTrash).where(trashKey);`                                                                                                    | `already_restored`               | `answers already_restored to a second restore, and takes stock once` (the second restore hits a duplicate primary key)                             |
| B6  | In `noTrashRow`, `live ? "already_restored" : "gone"` → `live ? "gone" : "already_restored"`                                                                                   | none: run the whole file         | `answers already_restored to a second restore…` and `is gone once the medication is deleted, because the cascade took the trash row`               |
| B7  | Delete `      eq(doseLogTrash.deletedAt, deletedAt),` from `trashKey`                                                                                                          | `older token`                    | `refuses an older token after a newer delete of the same dose, writing nothing`                                                                    |
| B8  | Delete `      eq(doseLogTrash.userId, userId),` from `trashKey`                                                                                                                | `another user`                   | `refuses another user's restore of the token, writing nothing`                                                                                     |
| B9  | `      trash.status === "taken"` → `      true`                                                                                                                                | `entry with every column`        | both `puts back a skipped entry…` and `puts back a missed entry…`                                                                                  |
| B10 | `            amount: trash.inventoryCredited,` → `            amount: trash.quantity,`                                                                                         | `Review Focus #2`                | `leaves a refill intact when the dose was logged at zero stock (Review Focus #2)` (stock 29)                                                       |
| B11 | `            amount: trash.inventoryCredited,` → `            amount: trash.inventoryApplied ?? trash.quantity,`                                                               | `tracking was off at the delete` | `takes nothing when tracking was off at the delete, even once it is back on` (stock 8)                                                             |
| B12 | In `takeFromStock`, `Math.min(i.previousCount, i.amount)` → `i.amount`                                                                                                         | `clamps the re-take`             | `clamps the re-take at what is left (stock 1, log 3, delete, adjust to 0)` (applied 1)                                                             |
| B13 | In `takeFromStock`, `const applied = i.previousCount === null ? 0 : Math.min(i.previousCount, i.amount);` → `const applied = Math.min(i.previousCount ?? i.amount, i.amount);` | `tracking is off at the restore` | `takes nothing when tracking is off at the restore` (applied 1)                                                                                    |
| B14 | Delete the whole step-9 `await tx.delete(syncTombstones)…;` statement                                                                                                          | `no tombstone to a client`       | `returns the dose and no tombstone to a client…`                                                                                                   |
| B15 | In the step-10 `logAudit`, `undefined` → `computeChanges({}, { notes: trash.notes })`                                                                                          | `audit row`                      | `writes one restore audit row, and no audit row carries the dose's note`                                                                           |
| B16 | Delete `    await purgeExpiredTrash(tx, { now: at, userId });`                                                                                                                 | `purges this user`               | `purges this user's expired trash, and nobody else's`                                                                                              |
| B17 | Delete `      .for("update");` from the step-2 medications read (and move its `;` to `.limit(1)`)                                                                              | `locks the medication`           | `locks the medication before the trash row, with only unlocked reads before it`                                                                    |
| B18 | Add `.for("update")` to the step-1 read (`.limit(1)` → `.limit(1).for("update")` under `if (!found)`'s query)                                                                  | `locks the medication`           | `locks the medication before the trash row, with only unlocked reads before it`                                                                    |
| B19 | Move `const at = now ?? new Date();` from after the lock to the first line of `restoreDose`'s body, above `return dbTx.transaction(`                                           | `clock after`                    | `reads its clock after the medication lock`                                                                                                        |
| B20 | Add `isArchived: medications.isArchived` to the step-2 select, and `if (med?.isArchived) return "gone";` after it                                                              | `archived`                       | `still restores onto an archived medication`                                                                                                       |

---

#### Cycle C — step 4: the ten-minute window

- [ ] **Step 11: Write the failing test**

Append to `tests/unit/pg/dose-restore.test.ts`:

```ts
describe("restoreDose — the ten-minute window", () => {
  it("restores one millisecond inside the window", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    const inside = new Date(DELETED.getTime() + DOSE_UNDO_WINDOW_MS - 1);
    expect(await restoreDose("u1", id, token, inside)).toBe("restored");
  });

  it("is gone exactly at the window, and the expired row goes with it", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    const edge = new Date(DELETED.getTime() + DOSE_UNDO_WINDOW_MS);
    expect(await restoreDose("u1", id, token, edge)).toBe("gone");

    expect(await trashRows()).toEqual([]);
    expect(await doseRow(id)).toBeUndefined();
    // The delete's credit stands: nothing was taken back.
    expect(await stock()).toBe(10);
  });
});
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `npx vitest run tests/unit/pg/dose-restore.test.ts -t "ten-minute window"`
Expected: FAIL.

- `is gone exactly at the window, and the expired row goes with it` fails with `expected 'restored' to be 'gone'`. There is no window check yet.
- `restores one millisecond inside the window` already passes. It pins the other side of the boundary for the mutation below.

- [ ] **Step 13: Write minimal implementation**

In `restoreDose`, insert the following directly after the line `    if (!trash) return noTrashRow();`. That is the step-3 check; step 1's check is `if (!found) return noTrashRow();` and stays unchanged.

```ts
// 4. The window. "Expired" is `deleted_at <= now − window`, the same
//    rule `purgeExpiredTrash` uses. This call already holds the row's
//    lock, so it deletes the expired row itself instead of leaving it
//    for a purge.
if (trash.deletedAt.getTime() <= at.getTime() - DOSE_UNDO_WINDOW_MS) {
  await tx.delete(doseLogTrash).where(trashKey);
  return "gone";
}
```

`trash.deletedAt` equals the `deletedAt` argument, because `trashKey` matched on it.

- [ ] **Step 14: Run the test to verify it passes**

Run: `npx vitest run tests/unit/pg/dose-restore.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 15: Prove by mutation**

| #   | Mutation                                                                              | Command                                                                    | Test that must fail                                                               |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| C1  | `<= at.getTime() - DOSE_UNDO_WINDOW_MS` → `< at.getTime() - DOSE_UNDO_WINDOW_MS`      | `npx vitest run tests/unit/pg/dose-restore.test.ts -t "ten-minute window"` | `is gone exactly at the window, and the expired row goes with it`                 |
| C2  | `<= at.getTime() - DOSE_UNDO_WINDOW_MS` → `<= at.getTime() - DOSE_UNDO_WINDOW_MS + 1` | same                                                                       | `restores one millisecond inside the window`                                      |
| C3  | Delete `      await tx.delete(doseLogTrash).where(trashKey);` inside the window block | same                                                                       | `is gone exactly at the window, and the expired row goes with it` (the row stays) |

Restore each line and re-run the file green.

---

#### Cycle D — step 5: the since-delete guard

- [ ] **Step 16: Write the failing test**

Append to `tests/unit/pg/dose-restore.test.ts`:

```ts
describe("restoreDose — the since-delete guard", () => {
  it("refuses when the same medication was logged after the delete, and keeps the trash row", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    // Remove, then Log now. Restoring would record two doses for one slot
    // and take stock twice.
    vi.setSystemTime(BETWEEN);
    await logDose("u1", "m1", 1);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("logged_since");

    expect(await doseRow(id)).toBeUndefined();
    expect(await trashRows()).toHaveLength(1);
    expect(await stock()).toBe(9);
  });

  it("is not refused by another medication's later log", async () => {
    await seedStock(10);
    await pgDb.seedMedication({ id: "m2", name: "Lisinopril", inventoryCount: 10 });
    const { id, token } = await logThenDelete();

    vi.setSystemTime(BETWEEN);
    await logDose("u1", "m2", 1);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");
  });

  it("restores two deletes undone newest-first", async () => {
    // A restored row keeps its original loggedAt, so putting B back is not a
    // log after A's delete.
    await seedStock(10);
    vi.setSystemTime(LOGGED);
    const a = await logDose("u1", "m1", 1);
    vi.setSystemTime(new Date("2026-04-16T08:01:00.000Z"));
    const b = await logDose("u1", "m1", 1);
    const tokenA = await deleteAt(a.id, DELETED);
    const tokenB = await deleteAt(b.id, BETWEEN);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", b.id, tokenB)).toBe("restored");
    vi.setSystemTime(new Date("2026-04-16T08:06:30.000Z"));
    expect(await restoreDose("u1", a.id, tokenA)).toBe("restored");

    expect(await stock()).toBe(8);
  });
});
```

- [ ] **Step 17: Run the test to verify it fails**

Run: `npx vitest run tests/unit/pg/dose-restore.test.ts -t "since-delete guard"`
Expected: FAIL.

- `refuses when the same medication was logged after the delete, and keeps the trash row` fails with `expected 'restored' to be 'logged_since'`.
- The other two already pass. They pin how narrow the guard is, for the mutations below.

- [ ] **Step 18: Write minimal implementation**

**(a)** In `src/lib/server/doses.ts`, replace

```ts
import { eq, and, gte, lt, lte, asc, desc, sql, isNotNull, max, inArray } from "drizzle-orm";
```

with

```ts
import { eq, and, gt, gte, lt, lte, asc, desc, sql, isNotNull, max, inArray } from "drizzle-orm";
```

**(b)** In `restoreDose`, insert the following directly above the line `    // 6. Take it out of the trash.`:

```ts
// 5. The since-delete guard. Both clocks are the app's, and both were
//    read under this medication's lock, so for one medication `loggedAt`
//    order is commit order. The trash row stays: another Undo of it is
//    refused the same way.
const [loggedSince] = await tx
  .select({ id: doseLogs.id })
  .from(doseLogs)
  .where(
    and(
      eq(doseLogs.userId, userId),
      eq(doseLogs.medicationId, trash.medicationId),
      gt(doseLogs.loggedAt, trash.deletedAt),
    ),
  )
  .limit(1);
if (loggedSince) return "logged_since";
```

- [ ] **Step 19: Run the test to verify it passes**

Run: `npx vitest run tests/unit/pg/dose-restore.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 20: Prove by mutation**

For each row, break the line, run `npx vitest run tests/unit/pg/dose-restore.test.ts -t "since-delete guard"`, watch the named test FAIL, then restore and re-run the whole file green.

| #   | Mutation                                                                                | Test that must fail                                                                             |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D1  | Delete the whole step-5 block (the query and `if (loggedSince) return "logged_since";`) | `refuses when the same medication was logged after the delete, and keeps the trash row`         |
| D2  | Delete `          eq(doseLogs.medicationId, trash.medicationId),` from the guard        | `is not refused by another medication's later log`                                              |
| D3  | `gt(doseLogs.loggedAt, trash.deletedAt)` → `gt(doseLogs.updatedAt, trash.deletedAt)`    | `restores two deletes undone newest-first` (B's restore bumped its `updatedAt` past A's delete) |
| D4  | In step 8, `      loggedAt: trash.loggedAt,` → `      loggedAt: at,`                    | `restores two deletes undone newest-first`                                                      |

---

#### Cycle E — `restoreDoseAction`

- [ ] **Step 21: Write the failing test**

Create `tests/unit/dose-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { actionErrorMessage } from "$lib/utils/form-errors";

/**
 * `restoreDoseAction` is a delete's Undo. Every page posts it to the absolute
 * `/dashboard?/restoreDose`. What `restoreDose` does to the database is proven
 * on PGlite in pg/dose-restore.test.ts, and the 401 guard in
 * app-action-auth-guard.test.ts. This file pins the door itself: the parse,
 * the token passed on, and the status and copy each outcome becomes.
 */

const restoreDose = vi.fn(async (..._args: unknown[]): Promise<string> => "restored");

// dose-actions.ts never reaches `db`. unusedDb THROWS on any access, so an
// accidental query fails loudly instead of returning [].
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/doses", () => ({
  restoreDose: (...args: unknown[]) => restoreDose(...args),
}));

const { restoreDoseAction, RESTORE_GONE_MESSAGE, RESTORE_LOGGED_SINCE_MESSAGE } =
  await import("../../src/lib/server/dose-actions");

const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } };
/** The `deletedAt` a delete's response carried, posted back exactly as sent. */
const TOKEN = "2026-04-16T08:05:00.000Z";

function formRequest(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x", { method: "POST", body: fd });
}

const restore = (fields: Record<string, string>) =>
  restoreDoseAction({ request: formRequest(fields), locals } as never);

/** What the client will toast. It reads every failure through actionErrorMessage. */
function toastFor(res: unknown): string {
  const { status, data } = res as { status: number; data: Record<string, unknown> };
  return actionErrorMessage({ type: "failure", status, data });
}

beforeEach(() => {
  restoreDose.mockReset();
  restoreDose.mockResolvedValue("restored");
});

describe("restoreDoseAction", () => {
  it("hands the posted token to restoreDose as an instant and answers success", async () => {
    const res = await restore({ doseId: "d1", deletedAt: TOKEN });

    expect(res).toEqual({ success: true, doseId: "d1" });
    expect(restoreDose).toHaveBeenCalledWith("u1", "d1", new Date(TOKEN));
  });

  it("answers success to already_restored, a retried Undo whose first attempt landed", async () => {
    restoreDose.mockResolvedValueOnce("already_restored");

    const res = await restore({ doseId: "d1", deletedAt: TOKEN });

    expect(res).toEqual({ success: true, doseId: "d1" });
  });

  it("answers 410 with the too-late copy when the dose is gone", async () => {
    restoreDose.mockResolvedValueOnce("gone");

    const res = await restore({ doseId: "d1", deletedAt: TOKEN });

    expect(res).toMatchObject({ status: 410 });
    expect(toastFor(res)).toBe("Too late to undo. Log it again if you need it.");
  });

  it("answers 409 with the newer-entry copy when the medication was logged since", async () => {
    restoreDose.mockResolvedValueOnce("logged_since");

    const res = await restore({ doseId: "d1", deletedAt: TOKEN });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("A newer entry exists for this medication, so Undo wasn't applied.");
  });

  it.each([
    ["no fields", {}],
    ["no deletedAt", { doseId: "d1" }],
    ["no doseId", { deletedAt: TOKEN }],
    ["an empty doseId", { doseId: "", deletedAt: TOKEN }],
    ["a deletedAt that is not an ISO instant", { doseId: "d1", deletedAt: "2026-04-16T08:05" }],
  ])("answers 400 to %s, restoring nothing", async (_label, fields) => {
    const res = await restore(fields as Record<string, string>);

    expect(res).toMatchObject({ status: 400, data: { error: "Invalid undo request" } });
    expect(restoreDose).not.toHaveBeenCalled();
  });

  it("exports the two refusals' copy exactly", () => {
    expect(RESTORE_GONE_MESSAGE).toBe("Too late to undo. Log it again if you need it.");
    expect(RESTORE_LOGGED_SINCE_MESSAGE).toBe(
      "A newer entry exists for this medication, so Undo wasn't applied.",
    );
  });
});
```

- [ ] **Step 22: Run the test to verify it fails**

Run: `npx vitest run tests/unit/dose-actions.test.ts`
Expected: FAIL.

- Every action test fails with `TypeError: restoreDoseAction is not a function`.
- `exports the two refusals' copy exactly` fails with `expected undefined to be 'Too late to undo. Log it again if you need it.'`.

- [ ] **Step 23: Write minimal implementation**

In `src/lib/server/dose-actions.ts`, make three edits.

**(a)** Replace

```ts
import { deleteDose } from "$lib/server/doses";
import { doseDeleteSchema } from "$lib/utils/validation";
```

with

```ts
import { deleteDose, restoreDose } from "$lib/server/doses";
import { doseDeleteSchema, doseRestoreSchema } from "$lib/utils/validation";
```

**(b)** In the module doc comment, replace the line

```ts
 * between the two routes. (Task 3 adds `restoreDoseAction` here.)
```

with

```ts
 * between the two routes. `restoreDoseAction`, a delete's Undo, lives here
 * too, beside the handle it consumes.
```

**(c)** Append to the end of the file, after `deleteDoseAction`'s closing `}`:

```ts
/** 410: the Undo window has closed, or the dose is gone for good. */
export const RESTORE_GONE_MESSAGE = "Too late to undo. Log it again if you need it.";

/** 409: a dose of this medication was logged after the delete (D6). */
export const RESTORE_LOGGED_SINCE_MESSAGE =
  "A newer entry exists for this medication, so Undo wasn't applied.";

/**
 * `?/restoreDose`, a delete's Undo. The client posts it to the absolute
 * `/dashboard?/restoreDose` from any page, including after navigating away.
 *
 * - **401 first**, for the same reason as `deleteDoseAction`.
 * - **The token** is the `restore.deletedAt` that `deleteDoseAction`
 *   returned, posted back as it was sent. A body that fails
 *   `doseRestoreSchema` restores nothing.
 * - **`already_restored` is success.** A retried Undo whose first attempt
 *   landed finds the dose already back, which is what the user asked for.
 * - **`gone`** (window closed, purged, wiped, medication deleted) is a 410.
 *   **`logged_since`** is a 409. `actionErrorMessage` reads either `error`
 *   string as it stands.
 */
export async function restoreDoseAction(event: {
  locals: App.Locals;
  request: Request;
}): Promise<ActionFailure<{ error: string }> | { success: true; doseId: string }> {
  const { locals, request } = event;
  if (!locals.user) error(401, "Unauthorized");
  const user = locals.user;

  const parsed = doseRestoreSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return fail(400, { error: "Invalid undo request" });

  const { doseId, deletedAt } = parsed.data;
  const outcome = await restoreDose(user.id, doseId, new Date(deletedAt));
  switch (outcome) {
    case "restored":
    case "already_restored":
      return { success: true, doseId };
    case "gone":
      return fail(410, { error: RESTORE_GONE_MESSAGE });
    case "logged_since":
      return fail(409, { error: RESTORE_LOGGED_SINCE_MESSAGE });
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unhandled restore outcome: ${String(unhandled)}`);
    }
  }
}
```

- [ ] **Step 24: Run the test to verify it passes**

Run: `npx vitest run tests/unit/dose-actions.test.ts`
Expected: PASS (10 tests; the `it.each` expands to five).

- [ ] **Step 25: Prove by mutation**

For each row, break the line in `restoreDoseAction`, run `npx vitest run tests/unit/dose-actions.test.ts`, watch the named test FAIL, then restore and re-run green.

| #   | Mutation                                                                                                                | Test that must fail                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| E1  | `return fail(410, { error: RESTORE_GONE_MESSAGE });` → `return fail(409, { error: RESTORE_GONE_MESSAGE });`             | `answers 410 with the too-late copy when the dose is gone`                                |
| E2  | Delete the line `    case "already_restored":` and add `    case "already_restored":` directly above `    case "gone":` | `answers success to already_restored, a retried Undo whose first attempt landed`          |
| E3  | `new Date(deletedAt)` → `new Date()`                                                                                    | `hands the posted token to restoreDose as an instant and answers success`                 |
| E4  | Delete `  if (!parsed.success) return fail(400, { error: "Invalid undo request" });`                                    | every `answers 400 to …` case (each now rejects with a `TypeError` reading `parsed.data`) |

---

#### Cycle F — the dashboard route and its auth guard

- [ ] **Step 26: Write the failing tests**

**`tests/unit/app-action-auth-guard.test.ts`**, two edits:

1. In the `vi.mock("$lib/server/doses", …)` factory, replace

   ```ts
     deleteDose: never("deleteDose"),
   ```

   with

   ```ts
     deleteDose: never("deleteDose"),
     restoreDose: never("restoreDose"),
   ```

2. In `CASES`, replace

   ```ts
     {
       route: "dashboard",
       action: "deleteDose",
       actions: dashboard.actions,
       fields: { doseId: "d1" },
     },
   ```

   with

   ```ts
     {
       route: "dashboard",
       action: "deleteDose",
       actions: dashboard.actions,
       fields: { doseId: "d1" },
     },
     // A Zod-valid token, so a guardless action would reach `locals.user`
     // rather than stop at the 400.
     {
       route: "dashboard",
       action: "restoreDose",
       actions: dashboard.actions,
       fields: { doseId: "d1", deletedAt: "2026-08-01T09:00:00.000Z" },
     },
   ```

**`tests/unit/dashboard-dose-actions.test.ts`**, four edits:

1. Replace

   ```ts
   const logSkippedDose = vi.fn(async (..._args: unknown[]) => "dose-skipped");
   ```

   with

   ```ts
   const logSkippedDose = vi.fn(async (..._args: unknown[]) => "dose-skipped");
   const restoreDose = vi.fn(async (..._args: unknown[]) => "restored");
   ```

2. In the `vi.mock("$lib/server/doses", …)` factory, replace

   ```ts
     logSkippedDose: (...args: unknown[]) => logSkippedDose(...args),
   ```

   with

   ```ts
     logSkippedDose: (...args: unknown[]) => logSkippedDose(...args),
     restoreDose: (...args: unknown[]) => restoreDose(...args),
   ```

3. In `beforeEach`, replace

   ```ts
   logSkippedDose.mockClear();
   ```

   with

   ```ts
   logSkippedDose.mockClear();
   restoreDose.mockClear();
   ```

4. Insert the following directly above `describe("dashboard editDose action", () => {`:

   ```ts
   describe("dashboard restoreDose action", () => {
     // The outcome mapping is pinned in dose-actions.test.ts; this proves the
     // route serves the shared helper.
     it("hands the posted Undo token to restoreDose and answers success", async () => {
       const res = await actions.restoreDose({
         request: formRequest({ doseId: "d1", deletedAt: "2026-04-16T19:00:00.000Z" }),
         locals,
       } as never);

       expect(res).toEqual({ success: true, doseId: "d1" });
       expect(restoreDose).toHaveBeenCalledWith("u1", "d1", new Date("2026-04-16T19:00:00.000Z"));
     });
   });
   ```

- [ ] **Step 27: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/app-action-auth-guard.test.ts tests/unit/dashboard-dose-actions.test.ts`
Expected: FAIL.

- `dashboard ?/restoreDose 401s an anonymous POST instead of 500ing on locals.user!` fails with `dashboard has no ?/restoreDose action: expected undefined to be type of 'function'`.
- `hands the posted Undo token to restoreDose and answers success` fails with `TypeError: actions.restoreDose is not a function`.
- Everything else still passes.

- [ ] **Step 28: Write minimal implementation**

In `src/routes/(app)/dashboard/+page.server.ts`, make two edits.

1. Replace

   ```ts
   import { deleteDoseAction } from "$lib/server/dose-actions";
   ```

   with

   ```ts
   import { deleteDoseAction, restoreDoseAction } from "$lib/server/dose-actions";
   ```

2. Replace

   ```ts
     deleteDose: (event) => deleteDoseAction(event),
   ```

   with

   ```ts
     deleteDose: (event) => deleteDoseAction(event),
     // A delete's Undo. Every page posts it to the absolute
     // `/dashboard?/restoreDose`, so it still works after navigating away.
     restoreDose: (event) => restoreDoseAction(event),
   ```

- [ ] **Step 29: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/app-action-auth-guard.test.ts tests/unit/dashboard-dose-actions.test.ts`
Expected: PASS.

- `app-action-auth-guard`: one more test than before this cycle. The `covers every action defined under (app)` test also passes, because the new action has its case.
- `dashboard-dose-actions`: one more test than after Task 2.

- [ ] **Step 30: Prove by mutation**

| #   | Mutation                                                                                                                         | Command                                                                            | Test that must fail                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | In `restoreDoseAction`, delete `  if (!locals.user) error(401, "Unauthorized");`                                                 | `npx vitest run tests/unit/app-action-auth-guard.test.ts -t "restoreDose"`         | `dashboard ?/restoreDose 401s an anonymous POST instead of 500ing on locals.user!` (it now rejects with a `TypeError` on `user.id`, not a 401) |
| F2  | In the dashboard route, `restoreDose: (event) => restoreDoseAction(event),` → `restoreDose: (event) => deleteDoseAction(event),` | `npx vitest run tests/unit/dashboard-dose-actions.test.ts -t "restoreDose"`        | `hands the posted Undo token to restoreDose and answers success`                                                                               |
| F3  | In `app-action-auth-guard.test.ts`, delete the new `restoreDose` case from `CASES`                                               | `npx vitest run tests/unit/app-action-auth-guard.test.ts -t "covers every action"` | `covers every action defined under (app)` (reports `dashboard ?/restoreDose` missing)                                                          |

Restore each change and re-run green.

- [ ] **Step 31: Update existing tests this change breaks**

Step 26 already covers both files this task affects: `app-action-auth-guard.test.ts` (its coverage test fails for any action without a case) and `dashboard-dose-actions.test.ts` (whose doses mock gains `restoreDose`, as the spec asks).

No other mock needs `restoreDose`. A vitest factory mock throws only when a missing export is **used**, not when it is imported. So `log-dose-actions.test.ts` and `api/commands.test.ts`, whose modules now import `dose-actions.ts` directly or transitively, stay green without it.

The `insertTakenDose` refactor changes no observable result (Cycle A). Confirm nothing else references the moved code or the new names:

Run: `grep -rn -e takeFromStock -e restoreDose -e RESTORE_GONE_MESSAGE -e RESTORE_LOGGED_SINCE_MESSAGE src tests | grep -v -e '^src/lib/server/doses.ts' -e '^src/lib/server/dose-actions.ts' -e '^tests/unit/pg/dose-restore.test.ts' -e '^tests/unit/dose-actions.test.ts' -e '^src/lib/server/db/schema.ts' -e '^src/lib/server/audit.ts' -e '^tests/unit/pg/dose-delete-trash.test.ts'`
Expected: only the dashboard route's `restoreDoseAction` import, action and comment, the auth-guard mock and case, and the dashboard-dose-actions mock and test. The last three exclusions are files that Tasks 1 and 2 already wrote, each of which names `restoreDose` in a comment only: the `doseLogTrash` doc comment in `schema.ts` and the `"restore"` action comment in `audit.ts` (Task 1), and the `CUTOFF` comment in `pg/dose-delete-trash.test.ts` (Task 2).

- [ ] **Step 32: Run the task's full suite**

Run: `npx prettier --write src/lib/server/doses.ts src/lib/server/dose-actions.ts "src/routes/(app)/dashboard/+page.server.ts" tests/unit/pg/dose-restore.test.ts tests/unit/dose-actions.test.ts tests/unit/app-action-auth-guard.test.ts tests/unit/dashboard-dose-actions.test.ts`
Expected: the files are rewritten in place, and the only changes are line wrapping.

Run: `npx vitest run tests/unit/pg/dose-restore.test.ts tests/unit/dose-actions.test.ts tests/unit/app-action-auth-guard.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/log-dose-actions.test.ts tests/unit/pg/dose-delete-trash.test.ts tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/pg/dose-slot-writes.test.ts tests/unit/pg/low-inventory-episode.test.ts tests/unit/doses-inventory.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS, with the whole unit suite green.

Run: `npm run check 2>&1 | tail -3`
Expected: the same error and warning counts as the Step 1 baseline. `tests/` is typechecked too, so the new test files must add nothing.

Run: `npm run lint`
Expected: 0 errors and no new warnings. The `_label` and `_args` parameters match the `^_` ignore pattern.

Run: `npx prettier --check src tests`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 33: Commit**

```bash
git add src/lib/server/doses.ts src/lib/server/dose-actions.ts "src/routes/(app)/dashboard/+page.server.ts" tests/unit/pg/dose-restore.test.ts tests/unit/dose-actions.test.ts tests/unit/app-action-auth-guard.test.ts tests/unit/dashboard-dose-actions.test.ts
git commit -m "feat(doses): restore a deleted dose from its undo token

restoreDose puts a trashed dose back under the same id, keyed on
(doseId, deletedAt) so an out-of-date Undo cannot reverse a newer delete.
It locks the medication before the trash row and reads the clock after
the lock. It refuses once the ten-minute window has closed, or when that
medication has had a dose logged since the delete. It takes back only
what the delete credited, clamped at current stock, so a dose logged at
zero stock and then refilled round-trips without a change. Every sync
tombstone for the dose is removed and the restore audit row carries no
diff.

The dashboard's ?/restoreDose action maps the outcomes to success, 410
and 409 with fixed copy."
```

**Notes for the executor:**

- **Nothing calls the new action from the client yet.** Task 8's Undo registry posts `doseId` and `deletedAt` to `RESTORE_ACTION` (`/dashboard?/restoreDose`). Until then the action can only be reached by hand.
- **`restoreDose`'s `now` parameter is for tests.** No production caller passes it, so the clock is always read after the medication lock.
- **Task 4 relies on `restoreDose` as written here.** Its "after a delete and restore, `updateDose` computes from the locked re-read" test restores a row whose `inventoryApplied` is recomputed by `takeFromStock`.

---

### Task 4: Lock order for every other dose and stock writer

Every writer of a dose or of `medications.inventory_count` that is not a delete or a restore now takes the medication row lock first (D7), reads `loggedAt` from a clock read after that lock, and — for `updateDose` — computes from a dose row it re-read under the lock. This closes spec items 4 (edit Save racing Remove), 5 (the chip's unlocked stock read) and 13 (refill and adjust overwriting a concurrent change).

Before Step 1, run `npm run check` once and write down its error and warning counts. Step 15 compares against them.

**Files:**

- Modify: `src/lib/server/doses.ts`
  - delete `assertMedicationBelongsToUser` (anchor: `async function assertMedicationBelongsToUser(userId: string, medicationId: string): Promise<void> {`)
  - `insertTakenDose`'s doc comment (anchor: `this insert. The caller decides whether that read locks.`)
  - replace `logDose` and `logSkippedDose` (anchor: from `export async function logDose(` up to, not including, the `/**` line of the doc comment that begins ` * Log now's write.`)
  - `logDoseForSlot`'s `loggedAt` (anchors: its `if (med.isArchived) {` block, and the `loggedAt: now,` line of the `insertTakenDose` call that ends it)
  - replace `updateDose` (anchor: from `export async function updateDose(` up to, not including, `export async function getLastDosePerMedication(`)
- Modify: `src/lib/server/inventory-events.ts` (anchors: `    const newCount = (previousCount ?? 0) + quantity;` in `refillMedication`, `    const quantityChange = newCount - (previousCount ?? 0);` in `adjustInventory`)
- Modify: `tests/unit/pg/dose-slot-writes.test.ts` (anchors quoted in Step 6)
- Modify: `tests/unit/inventory-events.test.ts` (rewritten to the four cases that never reach the database)
- Modify: `tests/unit/helpers/fake-db.ts` (two comments that name the deleted file)
- Delete: `tests/unit/doses-inventory.test.ts`
- Create: `tests/unit/pg/doses-inventory.test.ts`
- Create: `tests/unit/pg/inventory-events.test.ts`
- Create: `tests/unit/pg/dose-writer-locks.test.ts`
- Test: `tests/unit/pg/dose-writer-locks.test.ts`, `tests/unit/pg/doses-inventory.test.ts`, `tests/unit/pg/inventory-events.test.ts`, `tests/unit/inventory-events.test.ts`, `tests/unit/pg/dose-slot-writes.test.ts`

**Interfaces:**

- Consumes:
  - Task 2: `export interface DeletedDose { doseId: string; medicationId: string; deletedAt: Date }` and `export async function deleteDose(userId: string, doseId: string, opts: { keepForUndo: boolean; now?: Date }): Promise<DeletedDose | null>` from `src/lib/server/doses.ts`.
  - Task 3: `export type RestoreOutcome = "restored" | "already_restored" | "gone" | "logged_since";` and `export async function restoreDose(userId: string, doseId: string, deletedAt: Date, now?: Date): Promise<RestoreOutcome>`. After Task 3, `insertTakenDose(tx, { userId, medicationId, quantity, takenAt, loggedAt, notes, sideEffects, previousCount })` keeps that input shape (it now calls the private `takeFromStock`); this task only changes what callers pass as `loggedAt`.
- Produces (later tasks rely on these):
  - `updateDose(userId, doseId, updates)` — signature unchanged; returns `null` (never throws) when the dose is gone at the locked re-read, before any write.
  - `logDose(userId, medicationId, quantity, takenAt?, notes?, sideEffects?, opts: { exactInstantGuard?: boolean } = {})` — keeps `opts` (Task 6 removes it); always reads the medication `FOR UPDATE`; throws `MedicationNotFoundError` from under that lock; `loggedAt` read after it; `takenAt` defaults to the pre-transaction `now`.
  - `logSkippedDose(userId, medicationId, takenAt?, opts = {})` — both paths lock the medication `FOR UPDATE`; a missing or foreign medication throws `MedicationNotFoundError`; `loggedAt` read after the lock.
  - `logDoseForSlot(...)` — unchanged signature; `takenAt` is still the `now` parameter, `loggedAt` is `new Date()` read after the lock.
  - `refillMedication` / `adjustInventory` — unchanged signatures; the medication read is `FOR UPDATE`.
  - The private `assertMedicationBelongsToUser` no longer exists. Task 6's `logDoseAtSlot` / `skipDoseForSlot` must do their ownership check with the locked read, the same way.
  - The test helpers `advanceClockOnMedicationLock` and `beforeNextTransaction` in `tests/unit/pg/dose-writer-locks.test.ts` are the pattern for Task 6's clock-after-lock tests.

- [ ] **Step 1: Move the `logDose` / `updateDose` cases off fake-db**

After Task 2, every case left in `tests/unit/doses-inventory.test.ts` calls `logDose` or `updateDose`. Both are about to read the medication row with `.for("update")`, which fake-db does not have and must not grow (CLAUDE.md, test-seam rule), so they move to PGlite first, green to green. Create `tests/unit/pg/doses-inventory.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `logDose` and `updateDose`: status-aware stock bookkeeping, the ledger,
 * the sync cursor, and all-or-nothing commits.
 *
 * Moved from the fake-db file `tests/unit/doses-inventory.test.ts` when both
 * functions began reading the medication row `FOR UPDATE` (D7): the fake has
 * no select `.for()` and must not grow one (CLAUDE.md, test-seam rule). The
 * move also makes every assertion stronger. The fake answered each read from
 * one seed and recorded payloads, so "restores inventory" meant "an UPDATE
 * was attempted". Here it means the count the database holds afterwards,
 * and "rolled back" means Postgres rolled it back.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import {
  medications,
  doseLogs,
  inventoryEvents,
  auditLogs,
} from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const { logDose, updateDose } = await import("../../../src/lib/server/doses");

/** The frozen clock. `updatedAt` and `loggedAt` read it. */
const NOW = new Date("2026-05-01T09:00:00.000Z");

async function stock(): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, "m1"));
  return row?.n ?? null;
}

async function doseRow(id: string) {
  const [row] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.id, id));
  return row;
}

async function ledger() {
  return pgDb.db
    .select({
      eventType: inventoryEvents.eventType,
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
    })
    .from(inventoryEvents)
    .orderBy(asc(inventoryEvents.createdAt));
}

async function auditActions(): Promise<string[]> {
  const rows = await pgDb.db.select({ action: auditLogs.action }).from(auditLogs);
  return rows.map((r) => r.action);
}

/**
 * Make every INSERT into `audit_logs` raise. The audit row is the LAST write
 * of both functions, so a failure there proves the writes before it roll
 * back with it: a real failure inside the real transaction, judged by what
 * Postgres still holds afterwards. `afterEach` drops it.
 */
async function failAuditInserts(): Promise<void> {
  await pgDb.client.exec(`
    CREATE OR REPLACE FUNCTION test_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
    CREATE TRIGGER test_fail_write BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_write();
  `);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  await pgDb.client.exec(`DROP TRIGGER IF EXISTS test_fail_write ON "audit_logs";`);
});

describe("updateDose — status-aware inventory diff", () => {
  it("moves stock by the change in what a TAKEN dose applies", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({ id: "d1", status: "taken", quantity: 1, inventoryApplied: 1 });

    await updateDose("u1", "d1", { quantity: 2 });

    expect(await stock()).toBe(9);
    expect(await doseRow("d1")).toMatchObject({ quantity: 2, inventoryApplied: 2 });
  });

  it("leaves stock alone when a SKIPPED dose's quantity is edited", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({ id: "d1", status: "skipped", quantity: 1 });

    await updateDose("u1", "d1", { quantity: 2 });

    expect(await stock()).toBe(10);
    expect((await doseRow("d1")).quantity).toBe(2);
    expect(await ledger()).toEqual([]);
  });

  it("leaves stock alone when a TAKEN dose's quantity is unchanged", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({ id: "d1", status: "taken", quantity: 2, inventoryApplied: 2 });

    await updateDose("u1", "d1", { quantity: 2, notes: "edited note" });

    expect(await stock()).toBe(10);
    expect((await doseRow("d1")).notes).toBe("edited note");
    expect(await ledger()).toEqual([]);
  });

  it("returns null and writes nothing when the dose does not exist", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });

    await expect(updateDose("u1", "missing", { quantity: 5 })).resolves.toBeNull();

    expect(await stock()).toBe(10);
    expect(await auditActions()).toEqual([]);
  });
});

describe("transactional atomicity", () => {
  it("logDose commits nothing when its last write fails", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await failAuditInserts();

    await expect(logDose("u1", "m1", 1)).rejects.toThrow(/insert into "audit_logs"/);

    // The dose row, the decrement and the ledger event were all written
    // before the audit insert failed, and none of them survived it.
    expect(await pgDb.db.select().from(doseLogs)).toEqual([]);
    expect(await stock()).toBe(10);
    expect(await ledger()).toEqual([]);
  });

  it("updateDose commits nothing when its last write fails", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({ id: "d1", status: "taken", quantity: 1, inventoryApplied: 1 });
    await failAuditInserts();

    await expect(updateDose("u1", "d1", { quantity: 2 })).rejects.toThrow(
      /insert into "audit_logs"/,
    );

    expect(await doseRow("d1")).toMatchObject({ quantity: 1, inventoryApplied: 1 });
    expect(await stock()).toBe(10);
    expect(await ledger()).toEqual([]);
  });
});

describe("inventory event recording", () => {
  it("records dose_taken when a TAKEN dose is logged against tracked stock", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 30 });

    await logDose("u1", "m1", 1);

    expect(await ledger()).toEqual([
      { eventType: "dose_taken", quantityChange: -1, previousCount: 30, newCount: 29 },
    ]);
  });

  it("records no event when the medication does not track stock", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: null });

    await logDose("u1", "m1", 1);

    expect(await ledger()).toEqual([]);
    expect(await stock()).toBeNull();
  });

  it("records dose_quantity_updated when a TAKEN dose's quantity changes", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 30 });
    await pgDb.seedDose({ id: "d1", status: "taken", quantity: 1, inventoryApplied: 1 });

    await updateDose("u1", "d1", { quantity: 2 });

    expect(await ledger()).toEqual([
      { eventType: "dose_quantity_updated", quantityChange: -1, previousCount: 30, newCount: 29 },
    ]);
  });
});

describe("sync-aware mutations", () => {
  it("updateDose bumps updatedAt", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({
      id: "d1",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    await updateDose("u1", "d1", { quantity: 2 });

    expect((await doseRow("d1")).updatedAt).toEqual(NOW);
  });
});
```

- [ ] **Step 2: Run it against today's code**

Run: `npx vitest run tests/unit/pg/doses-inventory.test.ts`
Expected: PASS, 10 tests. This is a move: the cases pin behaviour that already holds and must keep holding through Steps 8–11.

- [ ] **Step 3: Delete the fake-db file**

```bash
git rm tests/unit/doses-inventory.test.ts
```

Where each case went (names as at `a9ad7d8`; Task 2 already removed the `deleteDose` ones):

| Old case (fake-db)                                                              | New case (`tests/unit/pg/doses-inventory.test.ts`)                   |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| applies inventory diff when editing TAKEN dose quantity                         | moves stock by the change in what a TAKEN dose applies               |
| does NOT apply inventory diff when editing SKIPPED dose quantity                | leaves stock alone when a SKIPPED dose's quantity is edited          |
| no inventory diff when quantity is unchanged on a TAKEN dose                    | leaves stock alone when a TAKEN dose's quantity is unchanged         |
| returns null when the dose does not exist                                       | returns null and writes nothing when the dose does not exist         |
| logDose rolls back: a failed inventory decrement skips the audit log entirely   | logDose commits nothing when its last write fails                    |
| updateDose rolls back: an inventory diff failure skips the audit log            | updateDose commits nothing when its last write fails                 |
| logs a dose_taken event when a TAKEN dose is recorded against tracked inventory | records dose_taken when a TAKEN dose is logged against tracked stock |
| does NOT record an event when the medication has no inventory tracking          | records no event when the medication does not track stock            |
| logs a dose_quantity_updated event when a TAKEN dose's quantity changes         | records dose_quantity_updated when a TAKEN dose's quantity changes   |
| updateDose bumps updatedAt                                                      | updateDose bumps updatedAt                                           |

If Task 2 left any other case in the file, it calls `deleteDose` and belongs in Task 2's PGlite file; move it there before deleting.

- [ ] **Step 4: Prove the two atomicity cases by mutation**

They changed mechanism (a real trigger failure instead of `failNext`), so prove them again.

1. `logDose`: in `insertTakenDose` in `src/lib/server/doses.ts`, delete the line `await logAudit(userId, "dose_log", id, "create", undefined, tx);` (the one in `insertTakenDose`, not the identical call in `logSkippedDose`). Then, in `logDose`, insert `await logAudit(userId, "dose_log", dose.id, "create");` on its own line just above its last line, `return dose;`.
   Run: `npx vitest run tests/unit/pg/doses-inventory.test.ts`
   Expected: FAIL — `transactional atomicity > logDose commits nothing when its last write fails` (the dose row, the decrement and the event committed before the audit insert failed). Restore both lines; re-run: PASS.
2. `updateDose` (still today's form, where `existing` is read before the transaction): replace

   ```ts
       const changes = computeChanges(existing, u);
       if (changes) await logAudit(userId, "dose_log", doseId, "update", changes, tx);

       return u;
     });

     return updated;
   ```

   with

   ```ts
       return u;
     });

     const changes = computeChanges(existing, updated);
     if (changes) await logAudit(userId, "dose_log", doseId, "update", changes);
     return updated;
   ```

   Run the same command.
   Expected: FAIL — `transactional atomicity > updateDose commits nothing when its last write fails` (the row and the stock change committed before the audit insert failed). Restore; re-run: PASS.

Do NOT "mutate" by swapping `tx` for `db` inside a transaction: PGlite serialises on one connection, so a top-level query issued inside an open transaction waits for it forever and the test only times out.

- [ ] **Step 5: Move the refill and adjust cases off fake-db**

Create `tests/unit/pg/inventory-events.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `refillMedication` and `adjustInventory` against real Postgres.
 *
 * Moved from the fake-db file `tests/unit/inventory-events.test.ts` when both
 * began reading the medication row `FOR UPDATE` (D7, spec item 13): the fake
 * has no select `.for()` and must not grow one. The input-validation cases
 * that throw before any query stay in the fake file. Here each result is
 * checked against the count and the ledger row the database holds.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import { medications, inventoryEvents } from "../../../src/lib/server/db/schema";
import { eq } from "drizzle-orm";

const { refillMedication, adjustInventory, MedicationNotFoundError, InvalidAdjustmentError } =
  await import("../../../src/lib/server/inventory-events");

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
}

async function events() {
  return pgDb.db
    .select({
      eventType: inventoryEvents.eventType,
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
      note: inventoryEvents.note,
    })
    .from(inventoryEvents);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
});

/** Another user's medication, for the ownership cases. */
async function seedOtherUsersMedication() {
  await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
  await pgDb.seedMedication({ id: "m2", userId: "u2", inventoryCount: 5 });
}

describe("refillMedication", () => {
  it("throws MedicationNotFoundError for a medication the user does not own, and writes nothing", async () => {
    await seedOtherUsersMedication();

    await expect(refillMedication("u1", "m2", 30)).rejects.toBeInstanceOf(MedicationNotFoundError);
    expect(await stock("m2")).toBe(5);
    expect(await events()).toEqual([]);
  });

  it("adds the refill and records previous and new counts", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 5 });

    const result = await refillMedication("u1", "m1", 30, "pharmacy run");

    expect(result).toEqual({ previousCount: 5, newCount: 35 });
    expect(await stock()).toBe(35);
    expect(await events()).toEqual([
      {
        eventType: "refill",
        quantityChange: 30,
        previousCount: 5,
        newCount: 35,
        note: "pharmacy run",
      },
    ]);
  });

  it("seeds the count from null when inventory tracking was never enabled", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: null });

    const result = await refillMedication("u1", "m1", 30);

    expect(result).toEqual({ previousCount: null, newCount: 30 });
    expect(await stock()).toBe(30);
    expect(await events()).toEqual([
      { eventType: "refill", quantityChange: 30, previousCount: null, newCount: 30, note: null },
    ]);
  });
});

describe("adjustInventory", () => {
  it("throws MedicationNotFoundError for a medication the user does not own, and writes nothing", async () => {
    await seedOtherUsersMedication();

    await expect(adjustInventory("u1", "m2", 10)).rejects.toBeInstanceOf(MedicationNotFoundError);
    expect(await stock("m2")).toBe(5);
    expect(await events()).toEqual([]);
  });

  it("rejects an adjustment that equals the current count, and writes nothing", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 12 });

    await expect(adjustInventory("u1", "m1", 12)).rejects.toBeInstanceOf(InvalidAdjustmentError);
    expect(await events()).toEqual([]);
  });

  it("records the signed delta when the count decreases", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 30 });

    const result = await adjustInventory("u1", "m1", 26, "spilled 4 pills");

    expect(result).toEqual({ previousCount: 30, newCount: 26, quantityChange: -4 });
    expect(await stock()).toBe(26);
    expect(await events()).toEqual([
      {
        eventType: "manual_adjustment",
        quantityChange: -4,
        previousCount: 30,
        newCount: 26,
        note: "spilled 4 pills",
      },
    ]);
  });

  it("records a positive delta when the count increases", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 5 });

    const result = await adjustInventory("u1", "m1", 12);

    expect(result.quantityChange).toBe(7);
    expect(await stock()).toBe(12);
    expect(await events()).toEqual([
      {
        eventType: "manual_adjustment",
        quantityChange: 7,
        previousCount: 5,
        newCount: 12,
        note: null,
      },
    ]);
  });

  it("treats a null previous count as 0 when computing the delta", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: null });

    const result = await adjustInventory("u1", "m1", 30);

    expect(result).toEqual({ previousCount: null, newCount: 30, quantityChange: 30 });
    expect(await stock()).toBe(30);
  });
});
```

Replace the whole of `tests/unit/inventory-events.test.ts` with the four cases that never reach a database read (`recordInventoryEvent` takes its client as an argument; the two input checks throw before the transaction opens):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// The database comes from the shared seam, which dispatches on real table
// identity — so this file mocks no schema and binds to the real tables.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

import { fakeDb } from "./helpers/fake-db";
import { medications } from "$lib/server/db/schema";

type Insert = { table: string; values: unknown };

// `attempted`, not `committed`: this module's transaction is a pass-through
// and nothing here simulates a mid-transaction failure, so the two views
// agree — attempted is the one that matches the old fake exactly.
function inserts(): Insert[] {
  return fakeDb.attempted
    .filter((c) => c.op === "insert")
    .map((c) => ({ table: c.table, values: c.payload }));
}

const {
  recordInventoryEvent,
  refillMedication,
  adjustInventory,
  InvalidRefillQuantityError,
  InvalidAdjustmentError,
} = await import("../../src/lib/server/inventory-events");

beforeEach(() => {
  fakeDb.reset();
});

// What stays here is what never reaches the database: `recordInventoryEvent`
// takes its client as an argument, and the input checks throw before the
// transaction opens. Every case that reads the medication moved to
// `tests/unit/pg/inventory-events.test.ts` when that read became
// `FOR UPDATE` (D7): this fake has no select `.for()` and must not grow one.

describe("recordInventoryEvent", () => {
  it("inserts a row with the supplied event payload", async () => {
    const client = fakeDb.db as unknown as Parameters<typeof recordInventoryEvent>[0];
    await recordInventoryEvent(client, {
      userId: "u1",
      medicationId: "med-A",
      eventType: "dose_taken",
      quantityChange: -1,
      previousCount: 30,
      newCount: 29,
    });

    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].table).toBe("inventory_events");
    const row = inserts()[0].values as Record<string, unknown>;
    expect(row.userId).toBe("u1");
    expect(row.eventType).toBe("dose_taken");
    expect(row.quantityChange).toBe(-1);
    expect(row.previousCount).toBe(30);
    expect(row.newCount).toBe(29);
    expect(row.note).toBeNull();
  });

  it("preserves the supplied note when present", async () => {
    const client = fakeDb.db as unknown as Parameters<typeof recordInventoryEvent>[0];
    await recordInventoryEvent(client, {
      userId: "u1",
      medicationId: "med-A",
      eventType: "refill",
      quantityChange: 30,
      previousCount: 5,
      newCount: 35,
      note: "picked up at pharmacy",
    });
    const row = inserts()[0].values as Record<string, unknown>;
    expect(row.note).toBe("picked up at pharmacy");
  });
});

describe("refillMedication", () => {
  it("rejects non-positive integer quantities", async () => {
    await expect(refillMedication("u1", "med-A", 0)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
    await expect(refillMedication("u1", "med-A", -3)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
    await expect(refillMedication("u1", "med-A", 1.5)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
  });
});

describe("adjustInventory", () => {
  it("rejects negative or non-integer new counts", async () => {
    fakeDb.seed(medications, [{ inventoryCount: 5 }]);
    await expect(adjustInventory("u1", "med-A", -1)).rejects.toBeInstanceOf(InvalidAdjustmentError);
    await expect(adjustInventory("u1", "med-A", 4.2)).rejects.toBeInstanceOf(
      InvalidAdjustmentError,
    );
  });
});
```

Moved: refill "throws MedicationNotFoundError…", "records a refill event…", "seeds the count from null…"; adjust "throws MedicationNotFoundError…", "rejects an adjustment that equals the current count (no-op)", "records a manual_adjustment event…", "records a positive delta…", "treats a null previousCount as 0…". The fake file no longer imports `MedicationNotFoundError`.

Run: `npx vitest run tests/unit/pg/inventory-events.test.ts tests/unit/inventory-events.test.ts`
Expected: PASS, 8 + 4 tests.

- [ ] **Step 6: Write the failing lock, clock and re-read tests**

Create `tests/unit/pg/dose-writer-locks.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * D7 for every dose and stock writer that is not a delete or a restore
 * (those have their own files):
 *
 *   - the medication row is locked FIRST, before any statement that locks or
 *     writes `dose_logs` (or, for refill and adjust, writes the count);
 *   - `loggedAt` comes from a clock read AFTER that lock, so for one
 *     medication clock order is commit order, which restore's since-delete
 *     guard relies on;
 *   - `updateDose` computes from a dose row it re-read under the lock, so a
 *     Remove, or a Remove and its Undo, that committed first is seen;
 *   - the locked read is also the ownership check.
 *
 * None of this is a race test. PGlite is one backend and serialises
 * transactions, so two calls never overlap. A lock is pinned by its SQL in
 * `queryLog`. The losing side of a race is reproduced by committing the
 * other side's write at the moment the function under test opens its
 * transaction (`beforeNextTransaction`): anything it read BEFORE opening it
 * is then stale, exactly as it would be in production.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";
import {
  medications,
  doseLogs,
  inventoryEvents,
  auditLogs,
} from "../../../src/lib/server/db/schema";
import { and, eq } from "drizzle-orm";

const {
  logDose,
  logSkippedDose,
  logDoseForSlot,
  updateDose,
  deleteDose,
  restoreDose,
  MedicationNotFoundError,
} = await import("../../../src/lib/server/doses");
const { refillMedication, adjustInventory } =
  await import("../../../src/lib/server/inventory-events");

/** The action's clock: frozen here, and what `takenAt` defaults to. */
const TAP = new Date("2026-04-16T13:31:00.000Z");
/** Where the clock jumps the moment the medication lock is sent. */
const AFTER_LOCK = new Date("2026-04-16T13:31:07.000Z");
/**
 * Before every window in this file. The database defaults `startedAt` and
 * `effectiveFrom` to Postgres `now()`, the REAL clock, which would clip
 * every slot here.
 */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
}

async function doseRow(id: string) {
  const [row] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.id, id));
  return row;
}

async function auditRows(action: string) {
  return pgDb.db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

/** Index of the first statement that reads `medications` under a row lock. */
function medicationLockIndex(): number {
  return queryLog.findIndex((q) => /from "medications"/.test(q) && /for update/.test(q));
}

/**
 * Index of the first statement that locks or writes `table`. A plain read
 * is neither: `updateDose`'s unlocked read of the dose's medication id is
 * exempt by design, because `medicationId` never changes (spec Section 5,
 * "Locks").
 */
function firstLockOrWriteOn(table: string): number {
  const t = `"${table}"`;
  return queryLog.findIndex(
    (q) =>
      q.startsWith(`insert into ${t}`) ||
      q.startsWith(`update ${t}`) ||
      q.startsWith(`delete from ${t}`) ||
      (q.includes(`from ${t}`) && /for update/.test(q)),
  );
}

/** Index of the first statement that writes `table`. */
function firstWriteOn(table: string): number {
  const t = `"${table}"`;
  return queryLog.findIndex(
    (q) =>
      q.startsWith(`insert into ${t}`) ||
      q.startsWith(`update ${t}`) ||
      q.startsWith(`delete from ${t}`),
  );
}

/**
 * Jump the fake clock to `to` the moment the medication lock is SENT.
 * drizzle logs each statement just before executing it, so a clock read
 * before the lock sees TAP and one read after it sees `to`.
 */
function advanceClockOnMedicationLock(to: Date) {
  return vi.spyOn(queryLog, "push").mockImplementation((...queries: string[]) => {
    const length = Array.prototype.push.apply(queryLog, queries);
    if (queries.some((q) => /from "medications"/.test(q) && /for update/.test(q))) {
      vi.setSystemTime(to);
    }
    return length;
  });
}

/**
 * Commit `concurrent` at the moment the NEXT transaction opens, before its
 * first statement. `dbTx` and `db` are the same PGlite database here, so
 * spying on its `transaction` catches the function under test; the writes
 * `concurrent` makes open transactions of their own, which reach the real
 * method because the override is used once.
 */
function beforeNextTransaction(concurrent: () => Promise<unknown>) {
  const original = pgDb.db.transaction.bind(pgDb.db);
  return vi.spyOn(pgDb.db, "transaction").mockImplementationOnce((async (
    callback: never,
    config: never,
  ) => {
    await concurrent();
    return original(callback, config);
  }) as never);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  await pgDb.seedMedication({ id: "m1", inventoryCount: 10, startedAt: LONG_AGO });
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
  queryLog.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the medication row is locked before dose_logs is locked or written", () => {
  const writers: Array<[string, () => Promise<unknown>]> = [
    ["logDose (a chip, or /api/v1 log_dose)", () => logDose("u1", "m1", 1)],
    ["logSkippedDose at now (legacy Skip, /api/v1 skip_dose)", () => logSkippedDose("u1", "m1")],
    [
      "logDoseForSlot (Log now)",
      async () => {
        await pgDb.seedSchedule({ timeOfDay: "08:00", effectiveFrom: LONG_AGO });
        queryLog.length = 0;
        return logDoseForSlot(
          "u1",
          "m1",
          new Date("2026-04-16T08:00:00.000Z"),
          new Date("2026-04-16T08:10:00.000Z"),
          "UTC",
        );
      },
    ],
    [
      "updateDose (edit Save, /api/v1 edit_dose)",
      async () => {
        await pgDb.seedDose({ id: "d-edit", quantity: 1, inventoryApplied: 1 });
        queryLog.length = 0;
        return updateDose("u1", "d-edit", { quantity: 2 });
      },
    ],
  ];

  it.each(writers)("%s", async (_label, write) => {
    await write();

    const lock = medicationLockIndex();
    const first = firstLockOrWriteOn("dose_logs");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(first);
  });

  it("updateDose also locks the dose row it re-reads", async () => {
    await pgDb.seedDose({ id: "d-edit", quantity: 1, inventoryApplied: 1 });
    queryLog.length = 0;

    await updateDose("u1", "d-edit", { quantity: 2 });

    expect(queryLog.some((q) => /from "dose_logs"/.test(q) && /for update/.test(q))).toBe(true);
  });
});

describe("refill and adjust lock the count before overwriting it", () => {
  // Both write an ABSOLUTE count. Unlocked, a log, delete or restore that
  // committed between their read and their write was simply overwritten:
  // a refill that read 6 while a restore took 1 wrote 16 (spec item 13).
  const writers: Array<[string, () => Promise<unknown>]> = [
    ["refillMedication", () => refillMedication("u1", "m1", 5)],
    ["adjustInventory", () => adjustInventory("u1", "m1", 3)],
  ];

  it.each(writers)("%s", async (_label, run) => {
    await run();

    const lock = medicationLockIndex();
    const write = firstWriteOn("medications");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(write);
  });
});

describe("loggedAt is read after the medication lock; takenAt is the action's now", () => {
  it("logDose", async () => {
    advanceClockOnMedicationLock(AFTER_LOCK);

    const dose = await logDose("u1", "m1", 1);

    expect(dose.takenAt).toEqual(TAP);
    expect(dose.loggedAt).toEqual(AFTER_LOCK);
  });

  it("logSkippedDose at now", async () => {
    advanceClockOnMedicationLock(AFTER_LOCK);

    const id = await logSkippedDose("u1", "m1");

    const row = await doseRow(id);
    expect(row.takenAt).toEqual(TAP);
    expect(row.loggedAt).toEqual(AFTER_LOCK);
  });

  it("logDoseForSlot", async () => {
    const at = new Date("2026-04-16T08:10:00.000Z");
    await pgDb.seedSchedule({ timeOfDay: "08:00", effectiveFrom: LONG_AGO });
    advanceClockOnMedicationLock(AFTER_LOCK);

    const dose = await logDoseForSlot("u1", "m1", new Date("2026-04-16T08:00:00.000Z"), at, "UTC");

    expect(dose.takenAt).toEqual(at);
    expect(dose.loggedAt).toEqual(AFTER_LOCK);
  });
});

describe("updateDose re-reads the dose under the lock", () => {
  it("returns null for a dose that is already gone, and writes nothing", async () => {
    const dose = await logDose("u1", "m1", 2);
    await deleteDose("u1", dose.id, { keepForUndo: false });
    expect(await stock()).toBe(10);
    queryLog.length = 0;

    await expect(updateDose("u1", dose.id, { quantity: 5 })).resolves.toBeNull();

    expect(await stock()).toBe(10);
    expect(queryLog.some((q) => q.startsWith(`update "medications"`))).toBe(false);
    expect(await auditRows("update")).toEqual([]);
  });

  it("returns null, not a 500, when a Remove commits while the edit waits for its locks", async () => {
    // The old order: read the dose, THEN open the transaction. A Remove that
    // committed in between left the UPDATE with no row, and
    // `computeChanges(existing, undefined)` threw.
    const dose = await logDose("u1", "m1", 2);
    beforeNextTransaction(() => deleteDose("u1", dose.id, { keepForUndo: false }));

    await expect(updateDose("u1", dose.id, { quantity: 5 })).resolves.toBeNull();

    expect(await stock()).toBe(10);
    expect(
      await pgDb.db
        .select()
        .from(inventoryEvents)
        .where(eq(inventoryEvents.eventType, "dose_quantity_updated")),
    ).toEqual([]);
    expect(await auditRows("update")).toEqual([]);
  });

  it("computes from the restored row after a Remove and its Undo, not the pre-delete one", async () => {
    // The ABA case same-id restore opens. The edit's caller saw the dose
    // applying 3. Before its transaction opens, the dose is removed (stock
    // back to 10), the count is adjusted to 1, and Undo restores it, which
    // can take back only 1: the restored row applies 1, stock 0.
    const dose = await logDose("u1", "m1", 3);
    expect(await stock()).toBe(7);
    let outcome: string | undefined;
    beforeNextTransaction(async () => {
      const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
      await adjustInventory("u1", "m1", 1);
      outcome = await restoreDose("u1", dose.id, deleted!.deletedAt);
    });

    await updateDose("u1", dose.id, { quantity: 2 });

    expect(outcome).toBe("restored");
    // From the locked re-read (applies 1, count 0): 2 cannot be afforded
    // beyond the 1 it holds, so nothing moves. Diffed against the stale
    // read (applies 3) it would have handed one dose back: stock 1.
    expect(await stock()).toBe(0);
    expect(await doseRow(dose.id)).toMatchObject({ quantity: 2, inventoryApplied: 1 });
  });
});

describe("the locked read is the ownership check", () => {
  beforeEach(async () => {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", inventoryCount: 5, startedAt: LONG_AGO });
  });

  it("logDose refuses another user's medication and writes nothing", async () => {
    await expect(logDose("u1", "m2", 1)).rejects.toBeInstanceOf(MedicationNotFoundError);

    expect(await pgDb.db.select().from(doseLogs)).toEqual([]);
    expect(await stock("m2")).toBe(5);
  });

  it("logSkippedDose refuses another user's medication on the legacy path too", async () => {
    await expect(logSkippedDose("u1", "m2")).rejects.toBeInstanceOf(MedicationNotFoundError);

    expect(
      await pgDb.db
        .select()
        .from(doseLogs)
        .where(and(eq(doseLogs.userId, "u1"), eq(doseLogs.medicationId, "m2"))),
    ).toEqual([]);
  });
});
```

This file deliberately never passes `{ exactInstantGuard: true }`: Task 6 removes that parameter and replaces the guarded paths with `logDoseAtSlot` / `skipDoseForSlot`, which pin their own locks and clocks. The guarded paths already lock first; `tests/unit/pg/dose-slot-writes.test.ts` "Took it at reads the medication row FOR UPDATE" and "Skip reads the medication row FOR UPDATE" keep pinning them until Task 6.

Then edit `tests/unit/pg/dose-slot-writes.test.ts`, which this change breaks in two places:

1. The docblock. Replace
   ```ts
    * The `FOR UPDATE` is pinned by its SQL: the query log shows that each
    * slot-anchored write reads the medication row with a lock, and a chip's
    * write does not. Its runtime effect is still unprovable here. PGlite is one
   ```
   with
   ```ts
    * The `FOR UPDATE` is pinned by its SQL: the query log shows that each
    * slot-anchored write reads the medication row with a lock, and so does a
    * chip's write (D7: every stock writer locks the medication first). Its
    * runtime effect is still unprovable here. PGlite is one
   ```
2. In `it("writes one taken dose at now, with logDose's stock bookkeeping", …)`, replace
   ```ts
   expect(row.takenAt).toEqual(AT_0810);
   expect(row.loggedAt).toEqual(AT_0810);
   ```
   with
   ```ts
   // `takenAt` is the action's `now`. `loggedAt` is the server clock, read
   // after the medication lock (D7); the frozen clock holds it at TAP.
   expect(row.takenAt).toEqual(AT_0810);
   expect(row.loggedAt).toEqual(TAP);
   ```
3. Invert the chip case. Replace

   ```ts
   it("a chip's dose takes no lock — it names no slot to protect", async () => {
     await seedTrackedMed();
     queryLog.length = 0;

     await logDose("u1", "m1", 1);

     expect(queryLog.some((q) => /from "medications"/i.test(q))).toBe(true);
     expect(medicationLocks()).toEqual([]);
   });
   ```

   with

   ```ts
   it("a chip's dose reads the medication row FOR UPDATE too", async () => {
     // It used to take no lock, because it names no slot to protect. But its
     // count read decides `inventoryApplied`: a refill, adjust, delete or
     // restore committing between that read and the decrement made the dose
     // record more than left the bottle, and a later delete minted the
     // difference (spec item 5). D7: every stock writer locks first.
     await seedTrackedMed();
     queryLog.length = 0;

     await logDose("u1", "m1", 1);

     expect(medicationLocks()).toHaveLength(1);
   });
   ```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/pg/dose-writer-locks.test.ts tests/unit/pg/dose-slot-writes.test.ts`
Expected: FAIL, 13 tests:

- `the medication row is locked before dose_logs is locked or written > logDose (a chip, or /api/v1 log_dose)`, `… > logSkippedDose at now (legacy Skip, /api/v1 skip_dose)`, `… > updateDose (edit Save, /api/v1 edit_dose)`, `… > updateDose also locks the dose row it re-reads` — `expected -1 to be greater than or equal to 0` or `expected N to be less than M`
- `refill and adjust lock the count before overwriting it > refillMedication`, `… > adjustInventory` — `expected -1 to be greater than or equal to 0`
- `loggedAt is read after the medication lock; takenAt is the action's now > logDose`, `… > logSkippedDose at now`, `… > logDoseForSlot` — `expected 2026-04-16T13:31:00.000Z to deeply equal 2026-04-16T13:31:07.000Z` (or the 08:10 instant for `logDoseForSlot`)
- `updateDose re-reads the dose under the lock > returns null, not a 500, …` — rejects with `TypeError` from `computeChanges(existing, undefined)`
- `… > computes from the restored row after a Remove and its Undo, …` — `expected 1 to be +0` (the stale diff handed a dose back)
- dose-slot-writes `writes one taken dose at now, with logDose's stock bookkeeping` and `a chip's dose reads the medication row FOR UPDATE too`.

These 4 already pass and must keep passing: `logDoseForSlot (Log now)` (lock order), `returns null for a dose that is already gone, and writes nothing`, and both `the locked read is the ownership check` cases (today's `assertMedicationBelongsToUser` answers them; Step 8 moves that answer under the lock).

- [ ] **Step 8: Lock the medication in `logDose` and `logSkippedDose`**

In `src/lib/server/doses.ts`, delete `assertMedicationBelongsToUser` entirely — its ownership check moves under the lock, and nothing else calls it:

```ts
async function assertMedicationBelongsToUser(userId: string, medicationId: string): Promise<void> {
  const [row] = await db
    .select({ id: medications.id })
    .from(medications)
    .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
    .limit(1);

  if (!row) throw new MedicationNotFoundError(medicationId);
}
```

Then replace everything from `export async function logDose(` up to (not including) the `/**` that opens the ` * Log now's write.` doc comment — that is, both `logDose` and `logSkippedDose` — with:

```ts
export async function logDose(
  userId: string,
  medicationId: string,
  quantity: number,
  takenAt?: Date,
  notes?: string,
  sideEffects?: SideEffect[],
  opts: { exactInstantGuard?: boolean } = {},
) {
  // The action's clock. A dose posted without a `takenAt` is recorded at the
  // moment the request arrived, so this is read before any lock wait.
  const now = new Date();
  const at = takenAt ?? now;
  const guard = opts.exactInstantGuard === true;

  // Insert + inventory decrement + audit log all happen inside a single
  // transaction so logDose is all-or-nothing: on any throw, nothing —
  // including the audit row — is durably committed. This is required by
  // runCommands' reserve-first idempotency (see commands.ts), which relies
  // on "handler threw" meaning "safe to retry" for every command handler.
  const dose = await dbTx.transaction(async (tx) => {
    // D7: the medication row first, locked, on EVERY path. The count read
    // here is what `inventoryApplied` is computed from. Unlocked, a
    // concurrent stock writer (a refill, an adjust, a delete, a restore)
    // could commit between this read and the decrement below, and the dose
    // would record an `inventoryApplied` larger than what really left the
    // bottle, which a later delete then minted back. The lock also makes two
    // "Took it at 09:00" posts serialise, so the second one's lookup below
    // sees the first one's row instead of both inserting.
    //
    // The read is scoped by user, so it is also the ownership check: another
    // user's medication is simply not there.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    if (!med) throw new MedicationNotFoundError(medicationId);
    const previousCount = med.inventoryCount;

    // `loggedAt` orders writes to this medication: restore's since-delete
    // guard compares it with a trash row's `deletedAt`. Read after the lock,
    // clock order is commit order (D7).
    const loggedAt = new Date();

    if (guard) {
      // "Took it at" names the slot's own instant to the millisecond. A fresh
      // page never offers it on an instant that already holds a taken dose,
      // because pass 0 resolves that slot, so a taken row here means the page
      // is stale: a double tap, a second device, or a row that arrived by
      // import, `/api/v1` or an edit. Refuse, so a double tap still writes
      // and decrements once, and the caller never reports someone else's row
      // as this tap's (its Undo would delete that record). A SKIP there does
      // not count: taken beats skip, and pass 0 then gives the slot to the
      // taken dose.
      const [existing] = await tx
        .select()
        .from(doseLogs)
        .where(
          and(
            eq(doseLogs.userId, userId),
            eq(doseLogs.medicationId, medicationId),
            eq(doseLogs.takenAt, at),
            eq(doseLogs.status, "taken"),
          ),
        )
        .orderBy(asc(doseLogs.id))
        .limit(1);
      if (existing) {
        throw new SlotAlreadyTakenError(
          `Medication ${medicationId} already has a taken dose at ${at.toISOString()}`,
        );
      }
    }

    return insertTakenDose(tx, {
      userId,
      medicationId,
      quantity,
      takenAt: at,
      loggedAt,
      notes: notes ?? null,
      sideEffects: sideEffects ?? null,
      previousCount,
    });
  });

  return dose;
}

export async function logSkippedDose(
  userId: string,
  medicationId: string,
  takenAt?: Date,
  opts: { exactInstantGuard?: boolean } = {},
): Promise<string> {
  // The action's clock, read before any lock wait: a skip posted without a
  // `takenAt` is recorded at the moment the request arrived.
  const now = new Date();
  const at = takenAt ?? now;

  // Insert + audit log in a single transaction so logSkippedDose is
  // all-or-nothing (see logDose above for why this matters for
  // runCommands' reserve-first idempotency).
  return dbTx.transaction(async (tx) => {
    // D7 on BOTH paths. A skip is a per-dose write like any other, and its
    // `loggedAt` must be read after the medication lock for the restore's
    // since-delete guard to see commit order. Under the guard the lock also
    // makes two Skip taps, or a Skip racing "Took it at" on another device,
    // serialise. The read is scoped by user, so it is the ownership check
    // on both paths too.
    const [locked] = await tx
      .select({ id: medications.id })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    if (!locked) throw new MedicationNotFoundError(medicationId);

    const loggedAt = new Date();

    if (opts.exactInstantGuard) {
      // The dashboard's Skip posts the slot's own instant. Look at what that
      // instant already holds.
      const atInstant = await tx
        .select({ id: doseLogs.id, status: doseLogs.status })
        .from(doseLogs)
        .where(
          and(
            eq(doseLogs.userId, userId),
            eq(doseLogs.medicationId, medicationId),
            eq(doseLogs.takenAt, at),
          ),
        )
        .orderBy(asc(doseLogs.id));

      // Taken beats skip: a skip written here could never show.
      if (atInstant.some((d) => d.status === "taken")) {
        throw new SlotAlreadyTakenError(
          `Medication ${medicationId} already has a taken dose at ${at.toISOString()}`,
        );
      }
      // A fresh page never offers Skip on an instant that already holds a
      // skip: that skip resolves the slot. So this is a stale page, and
      // returning the existing id would hand its Undo someone else's row.
      if (atInstant.some((d) => d.status === "skipped")) {
        throw new SlotTargetChangedError(
          `Medication ${medicationId} already has a skip at ${at.toISOString()}`,
        );
      }
    }

    const id = createId();
    await tx.insert(doseLogs).values({
      id,
      userId,
      medicationId,
      quantity: 1,
      takenAt: at,
      loggedAt,
      notes: null,
      sideEffects: null,
      status: "skipped",
    });
    await logAudit(userId, "dose_log", id, "create", undefined, tx);
    return id;
  });
}
```

`db` stays imported: `getDosesInRange`, `getLastDosePerMedication` and Task 2's `DbExecutor` still use it.

Run: `npx vitest run tests/unit/pg/dose-writer-locks.test.ts tests/unit/pg/dose-slot-writes.test.ts`
Expected: FAIL, 8 left — the four `updateDose` cases, `refillMedication`, `adjustInventory`, the `logDoseForSlot` clock case, and dose-slot-writes `writes one taken dose at now…`. The `logDose` and `logSkippedDose` lock, clock and ownership cases, and the inverted chip case, now PASS.

- [ ] **Step 9: Read `logDoseForSlot`'s `loggedAt` after the lock**

In `logDoseForSlot`, replace

```ts
if (med.isArchived) {
  throw new SlotTargetChangedError(`Medication ${medicationId} is archived`);
}
```

with

```ts
if (med.isArchived) {
  throw new SlotTargetChangedError(`Medication ${medicationId} is archived`);
}

// `takenAt` is the action's `now`: the instant the tap names. `loggedAt`
// orders writes to this medication, so it is read after the lock (D7).
const loggedAt = new Date();
```

and, in its `insertTakenDose` call at the end, replace

```ts
      quantity: 1,
      takenAt: now,
      loggedAt: now,
```

with

```ts
      quantity: 1,
      takenAt: now,
      loggedAt,
```

Run: `npx vitest run tests/unit/pg/dose-writer-locks.test.ts tests/unit/pg/dose-slot-writes.test.ts`
Expected: FAIL, 6 left — the four `updateDose` cases, `refillMedication`, `adjustInventory`.

- [ ] **Step 10: Re-read the dose under the lock in `updateDose`**

Replace everything from `export async function updateDose(` up to (not including) `export async function getLastDosePerMedication(` with:

```ts
export async function updateDose(
  userId: string,
  doseId: string,
  updates: {
    takenAt?: Date;
    quantity?: number;
    notes?: string;
    sideEffects?: SideEffect[] | null;
  },
) {
  // Everything in one transaction, in D7 order: the medication row, then the
  // dose row. The dose used to be read BEFORE the transaction, without a
  // lock, and two things got through that gap. A Remove that committed
  // there left the UPDATE below with no row, and
  // `computeChanges(existing, undefined)` threw: a 500 on Save. A Remove
  // followed by its Undo re-inserted the dose with a recomputed
  // `inventoryApplied`, and the edit then moved stock by the stale amount.
  // Every value this edit computes from is now read under both locks.
  return dbTx.transaction(async (tx) => {
    // Which medication to lock. `medicationId` never changes, so this read
    // needs no lock of its own.
    const [ref] = await tx
      .select({ medicationId: doseLogs.medicationId })
      .from(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .limit(1);
    if (!ref) return null;

    // The count as it stands before this edit, under the lock that every
    // other stock writer also takes first.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, ref.medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    const previousCount = med?.inventoryCount ?? null;

    // Re-read the dose under its own lock. A delete may have committed while
    // this transaction waited for the medication, and that has to end here,
    // before anything is written.
    const [existing] = await tx
      .select()
      .from(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .limit(1)
      .for("update");
    if (!existing) return null;

    // Only taken doses ever decremented inventory, so only taken doses
    // get a quantity-diff adjustment. Editing a skipped dose's quantity
    // is bookkeeping only.
    const inventoryAffectingChange =
      existing.status === "taken" &&
      updates.quantity !== undefined &&
      updates.quantity !== existing.quantity;

    // The inventory arm is computed first: it decides the `inventoryApplied`
    // the row is written with. Its write runs after the row's, once the row
    // is known to still be there.
    let nextApplied: number | undefined;
    let inventoryWrite: (() => Promise<void>) | undefined;

    if (inventoryAffectingChange) {
      // What this dose took, and what it will take instead. Editing moves
      // the APPLIED amount, never the difference of the two quantities: a
      // dose of 3 logged against a stock of 1 only ever removed 1, so
      // lowering it to 1 must change nothing, where `count - (1 - 3)`
      // credited two doses that had never left the bottle.
      //
      // The new amount cannot exceed what the bottle would hold once this
      // dose gives back what it took, hence `previousCount + applied`.
      const applied = existing.inventoryApplied ?? existing.quantity;
      nextApplied =
        previousCount === null
          ? 0
          : Math.max(0, Math.min(updates.quantity!, previousCount + applied));
      const delta = applied - nextApplied;

      inventoryWrite = async () => {
        await tx
          .update(medications)
          .set({
            // GREATEST is belt-and-braces: `nextApplied <= previousCount +
            // applied` already makes the result non-negative.
            inventoryCount: sql`GREATEST(0, ${medications.inventoryCount} + ${delta})`,
          })
          .where(
            and(
              eq(medications.id, existing.medicationId),
              eq(medications.userId, userId),
              isNotNull(medications.inventoryCount),
            ),
          );

        if (previousCount !== null) {
          await recordInventoryEvent(tx, {
            userId,
            medicationId: existing.medicationId,
            eventType: "dose_quantity_updated",
            quantityChange: delta,
            previousCount,
            newCount: previousCount + delta,
          });
        }
      };
    }

    const [u] = await tx
      .update(doseLogs)
      .set({
        ...(updates.takenAt !== undefined && { takenAt: updates.takenAt }),
        // `!== undefined`, matching the gate at `inventoryAffectingChange`
        // above. A truthiness test here let a quantity of 0 pass that gate,
        // adjust the inventory, and never write the row — the two guards
        // must agree. Unreachable today only because all four doors bound
        // quantity at `min(1)`.
        ...(updates.quantity !== undefined && { quantity: updates.quantity }),
        ...(nextApplied !== undefined && { inventoryApplied: nextApplied }),
        ...(updates.notes !== undefined && { notes: updates.notes || null }),
        ...(updates.sideEffects !== undefined && {
          sideEffects: updates.sideEffects ?? null,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .returning();

    // Unreachable while the row is locked above. Kept so that a later change
    // to that read cannot turn a vanished row back into a stock write for a
    // dose that no longer exists, or into `computeChanges(existing,
    // undefined)`, which throws.
    if (!u) return null;

    if (inventoryWrite) await inventoryWrite();

    const changes = computeChanges(existing, u);
    if (changes) await logAudit(userId, "dose_log", doseId, "update", changes, tx);

    return u;
  });
}
```

Run: `npx vitest run tests/unit/pg/dose-writer-locks.test.ts tests/unit/pg/doses-inventory.test.ts`
Expected: FAIL, 2 left — `refillMedication`, `adjustInventory`. `tests/unit/pg/doses-inventory.test.ts` still PASS (10).

- [ ] **Step 11: Lock the medication in `refillMedication` and `adjustInventory`**

In `src/lib/server/inventory-events.ts`, in `refillMedication`, replace

```ts
const [med] = await tx
  .select({ inventoryCount: medications.inventoryCount })
  .from(medications)
  .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
  .limit(1);

if (!med) throw new MedicationNotFoundError();

const previousCount = med.inventoryCount;
const newCount = (previousCount ?? 0) + quantity;
```

with

```ts
// Locked (D7): the count written below is ABSOLUTE, so a log, delete or
// restore that committed between an unlocked read and this write would
// simply be overwritten. A refill that read 6 while a restore took 1
// wrote 16, minting a dose.
const [med] = await tx
  .select({ inventoryCount: medications.inventoryCount })
  .from(medications)
  .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
  .limit(1)
  .for("update");

if (!med) throw new MedicationNotFoundError();

const previousCount = med.inventoryCount;
const newCount = (previousCount ?? 0) + quantity;
```

and in `adjustInventory`, replace

```ts
const [med] = await tx
  .select({ inventoryCount: medications.inventoryCount })
  .from(medications)
  .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
  .limit(1);

if (!med) throw new MedicationNotFoundError();

const previousCount = med.inventoryCount;
const quantityChange = newCount - (previousCount ?? 0);
```

with

```ts
// Locked for the same reason as `refillMedication`'s read: the count
// written below is absolute, so an unlocked read lets it overwrite a
// concurrent log, delete or restore (D7).
const [med] = await tx
  .select({ inventoryCount: medications.inventoryCount })
  .from(medications)
  .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
  .limit(1)
  .for("update");

if (!med) throw new MedicationNotFoundError();

const previousCount = med.inventoryCount;
const quantityChange = newCount - (previousCount ?? 0);
```

Run: `npx vitest run tests/unit/pg/dose-writer-locks.test.ts tests/unit/pg/dose-slot-writes.test.ts tests/unit/pg/inventory-events.test.ts tests/unit/inventory-events.test.ts`
Expected: PASS — 15, 25, 8 and 4 tests.

- [ ] **Step 12: Correct `insertTakenDose`'s doc comment**

In `insertTakenDose`'s doc comment, replace the sentence

```ts
 * this insert. The caller decides whether that read locks.
```

with

```ts
 * this insert, under the medication row lock every caller takes first (D7),
 * so no other stock writer can commit between that read and this decrement.
```

If Task 3 reworded this doc comment, apply the same correction to its current wording: the statement that a caller may read unlocked is no longer true.

- [ ] **Step 13: Prove by mutation**

Break each line, run the command, watch the named test fail, restore, re-run green. All commands are `npx vitest run tests/unit/pg/dose-writer-locks.test.ts tests/unit/pg/dose-slot-writes.test.ts` unless stated.

| #   | Break this line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Test(s) that must fail                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `logDose`: delete `.for("update")` from the medication read                                                                                                                                                                                                                                                                                                                                                                                                                                               | `…locked or written > logDose (a chip, or /api/v1 log_dose)`, `loggedAt is read after… > logDose`, dose-slot-writes `a chip's dose reads the medication row FOR UPDATE too`                                                                                                                   |
| 2   | `logDose`: in the `insertTakenDose` call, `loggedAt,` → `loggedAt: now,`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `loggedAt is read after… > logDose`                                                                                                                                                                                                                                                           |
| 3   | `logDose`: delete `if (!med) throw new MedicationNotFoundError(medicationId);`                                                                                                                                                                                                                                                                                                                                                                                                                            | `the locked read is the ownership check > logDose refuses another user's medication and writes nothing` (a `TypeError` instead)                                                                                                                                                               |
| 4   | `logSkippedDose`: delete `.for("update")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `…locked or written > logSkippedDose at now (legacy Skip, /api/v1 skip_dose)`, `loggedAt is read after… > logSkippedDose at now`                                                                                                                                                              |
| 5   | `logSkippedDose`: in the insert, `loggedAt,` → `loggedAt: now,`                                                                                                                                                                                                                                                                                                                                                                                                                                           | `loggedAt is read after… > logSkippedDose at now`                                                                                                                                                                                                                                             |
| 6   | `logSkippedDose`: delete `if (!locked) throw new MedicationNotFoundError(medicationId);`                                                                                                                                                                                                                                                                                                                                                                                                                  | `the locked read is the ownership check > logSkippedDose refuses another user's medication on the legacy path too` (a u1 skip is written against u2's medication)                                                                                                                             |
| 7   | `logDoseForSlot`: `loggedAt,` → `loggedAt: now,`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `loggedAt is read after… > logDoseForSlot`, dose-slot-writes `writes one taken dose at now, with logDose's stock bookkeeping`                                                                                                                                                                 |
| 8   | `updateDose`: move the `const [existing] = … .for("update"); if (!existing) return null;` block above the medication lock                                                                                                                                                                                                                                                                                                                                                                                 | `…locked or written > updateDose (edit Save, /api/v1 edit_dose)`                                                                                                                                                                                                                              |
| 9   | `updateDose`: delete `.for("update")` from the dose re-read                                                                                                                                                                                                                                                                                                                                                                                                                                               | `…locked or written > updateDose also locks the dose row it re-reads`                                                                                                                                                                                                                         |
| 10  | `updateDose`: restore the pre-read outside the transaction — before `return dbTx.transaction(`, add `const [existing] = await db.select().from(doseLogs).where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId))).limit(1); if (!existing) return null;`, and delete the locked re-read and its `if (!existing) return null;` inside                                                                                                                                                              | `updateDose re-reads the dose under the lock > computes from the restored row after a Remove and its Undo, not the pre-delete one` (`expected 1 to be +0`). Row 9's `…locked or written > updateDose also locks the dose row it re-reads` fails too, because no dose read is locked any more. |
| 10b | `updateDose`: move the dose-to-medication read out of the transaction and drop the re-read's guard — before `return dbTx.transaction(`, add `const [ref] = await db.select({ medicationId: doseLogs.medicationId }).from(doseLogs).where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId))).limit(1); if (!ref) return null;`; inside, delete the `const [ref] = await tx…limit(1);` read and its `if (!ref) return null;`; and delete the `if (!existing) return null;` after the locked re-read | `updateDose re-reads the dose under the lock > returns null, not a 500, when a Remove commits while the edit waits for its locks` (rejects with `TypeError: Cannot read properties of undefined (reading 'status')`)                                                                          |
| 11  | `refillMedication`: delete `.for("update")`                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `refill and adjust lock the count before overwriting it > refillMedication`                                                                                                                                                                                                                   |
| 12  | `adjustInventory`: delete `.for("update")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `refill and adjust lock the count before overwriting it > adjustInventory`                                                                                                                                                                                                                    |

Why row 10 does not kill `returns null, not a 500, …` and 10b does: `beforeNextTransaction` commits the Remove before the edit's first in-transaction statement, so under row 10 the in-transaction `ref` read already finds nothing and returns null, and that test passes. The locked re-read's `if (!existing) return null;` is what answers a Remove that lands after `ref` and before the locks, which is the production race (the Remove holds the medication lock the edit is waiting for). PGlite runs one transaction at a time and cannot commit inside that gap, so 10b moves `ref` in front of the transaction to put the Remove there.

`updateDose`'s `if (!u) return null;` is unreachable while the dose row is locked, so no test can kill its removal; it stays as a guard against a later change to the re-read (its comment says so). Do not write a test that claims to cover it.

- [ ] **Step 14: Update the rest of what this change touches**

1. `tests/unit/helpers/fake-db.ts` names the file Step 3 deleted, twice. Replace
   ```ts
   /** Two views of the same traffic, because the existing tests need both.
         `attempted` is append-only — how far execution got before a throw, which
         is what `doses-inventory.test.ts` asserts on. `committed` is reverted
         when a transaction callback throws — what a database would show
         afterwards, which is what `createMedicationWithSchedules.test.ts`
         asserts on. */
   ```
   with
   ```ts
   /** Two views of the same traffic, because the existing tests need both.
         `attempted` is append-only — how far execution got before a throw.
         `committed` is reverted when a transaction callback throws — what a
         database would show afterwards, which is what
         `createMedicationWithSchedules.test.ts` asserts on. */
   ```
   and replace
   ```ts
   // The write was tried, so it is always `attempted` — that is what
   // `doses-inventory.test.ts` asserts after a simulated failure.
   ```
   with
   ```ts
   // The write was tried, so it is always `attempted`.
   ```
2. Checked and unaffected (no edit): `tests/unit/pg/dose-inventory-symmetry.test.ts`, `tests/unit/pg/low-inventory-episode.test.ts` and `tests/unit/pg/doses-in-range.test.ts` call these functions on PGlite and still pass; `tests/unit/dashboard-dose-actions.test.ts`, `tests/unit/log-dose-actions.test.ts`, `tests/unit/api/commands.test.ts` and `tests/unit/app-action-auth-guard.test.ts` mock `$lib/server/doses` and `$lib/server/inventory-events`.
3. CLAUDE.md's fake-db bullet still says "`doses-inventory` asserts on the first". Leave it for Task 14, which rewrites that bullet (note it in the Task 14 checklist).

- [ ] **Step 15: Run the task's full suite**

Run: `npx vitest run tests/unit/pg/dose-writer-locks.test.ts tests/unit/pg/doses-inventory.test.ts tests/unit/pg/inventory-events.test.ts tests/unit/inventory-events.test.ts tests/unit/pg/dose-slot-writes.test.ts tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/pg/low-inventory-episode.test.ts`
Expected: PASS, all files.

Run: `npx vitest run`
Expected: PASS, whole unit suite (one file fewer than before: `tests/unit/doses-inventory.test.ts` is gone; three PGlite files new).

Run: `npm run check`
Expected: the same error and warning counts you recorded before Step 1 — no new errors. (`.ts` signatures are unchanged; the test files type-check against Task 2's `deleteDose` and Task 3's `restoreDose`.)

Run: `npm run lint` and `npx prettier --check src/lib/server/doses.ts src/lib/server/inventory-events.ts tests/unit/pg tests/unit/inventory-events.test.ts tests/unit/helpers/fake-db.ts`
Expected: no new lint errors; Prettier clean.

- [ ] **Step 16: Commit**

```bash
git add src/lib/server/doses.ts src/lib/server/inventory-events.ts \
  tests/unit/pg/dose-writer-locks.test.ts tests/unit/pg/doses-inventory.test.ts \
  tests/unit/pg/inventory-events.test.ts tests/unit/inventory-events.test.ts \
  tests/unit/pg/dose-slot-writes.test.ts tests/unit/helpers/fake-db.ts
git commit -m "fix(doses): lock the medication row before every dose and stock write

logDose (chips and /api/v1), both skip paths, updateDose, refill and
adjust now read the medication FOR UPDATE before any statement that locks
or writes a dose or the count (D7). loggedAt is read after that lock, so
for one medication clock order is commit order. updateDose re-reads the
dose under the lock: a Remove that commits first returns null instead of a
500, and a Remove plus its Undo is diffed from the restored row, not a
stale one. Refill and adjust can no longer overwrite a concurrent change.

The fake-db cases for these paths move to PGlite, because the fake has no
select .for() and must not grow one."
```

`git rm` in Step 3 already staged the deletion of `tests/unit/doses-inventory.test.ts`.

---

### Task 5: Wipe, retention and the trash owner scan

"Delete dose history" empties the trash under D7, retention purges expired trash for every user without ever waiting on a lock, and a scan pins the only three modules allowed to name the table. The archived-medication wipe and account deletion need no code: migration `0021`'s `ON DELETE CASCADE` does the work, and this task proves it (Review Focus #5).

Before Step 1, run `npm run check` once and write down its error and warning counts. Step 13 compares against them.

**Files:**

- Modify: `src/lib/server/api/wipe.ts` (anchors: `import { doseLogs, medications, users } from "$lib/server/db/schema";`, `import { and, eq, sql } from "drizzle-orm";`, and the opening of `wipeDoseHistory` quoted in Step 5)
- Modify: `src/lib/server/retention.ts` (anchors: `import { purgeExpiredReminderEvents } from "$lib/server/reminders/retention";` and the `name: "reminder-events",` policy entry)
- Modify: `tests/unit/api/wipe.test.ts` (rewritten: `wipeArchivedMedications` only)
- Modify: `tests/unit/pg/retention.test.ts` (anchors quoted in Step 7)
- Create: `tests/unit/pg/dose-trash-wipe.test.ts`
- Create: `tests/unit/dose-log-trash-owners.test.ts`
- Test: `tests/unit/pg/dose-trash-wipe.test.ts`, `tests/unit/dose-log-trash-owners.test.ts`, `tests/unit/api/wipe.test.ts`, `tests/unit/pg/retention.test.ts`

**Interfaces:**

- Consumes:
  - Task 1: `export const doseLogTrash = pgTable("dose_log_trash", { … })` from `src/lib/server/db/schema.ts`; `DOSE_UNDO_WINDOW_MS = 10 * 60_000` from `src/lib/utils/dose-undo.ts`; `pgDb.seedTrash(overrides: Partial<typeof schema.doseLogTrash.$inferInsert> = {})` (defaults: id `t${seq}`, userId `"u1"`, medicationId `"m1"`, quantity 1, inventoryApplied 1, inventoryCredited 1, takenAt/loggedAt `2026-08-01T08:00:00Z`, status `"taken"`, deletedAt `2026-08-01T09:00:00Z`); migration `drizzle/0021_*.sql` with the constraints `dose_log_trash_user_id_users_id_fk` and `dose_log_trash_medication_id_medications_id_fk`, both `ON DELETE cascade`.
  - Task 2: `deleteDose(userId: string, doseId: string, opts: { keepForUndo: boolean; now?: Date }): Promise<DeletedDose | null>`; `export async function purgeExpiredTrash(executor: DbExecutor, opts: { now: Date; userId?: string }): Promise<void>` where `type DbExecutor = typeof db | DbTransaction` — expired means `deleted_at <= now − DOSE_UNDO_WINDOW_MS`, and its SQL contains `for update skip locked`.
  - Task 3: `restoreDose(userId: string, doseId: string, deletedAt: Date, now?: Date): Promise<RestoreOutcome>`; `restoreDoseAction(event: { locals: App.Locals; request: Request })` and `RESTORE_GONE_MESSAGE = "Too late to undo. Log it again if you need it."` from `src/lib/server/dose-actions.ts`.
  - Task 4: `logDose(userId, medicationId, quantity)` (locks the medication).
- Produces:
  - `wipeDoseHistory(userId: string): Promise<{ deleted: number }>` — signature and result unchanged; now locks the user's medications (`ORDER BY id FOR UPDATE`), deletes `dose_logs`, then deletes the user's `dose_log_trash` rows, all in one transaction. `deleted` counts doses only.
  - `RETENTION_POLICIES` gains `{ name: "dose-log-trash", purge: (now) => purgeExpiredTrash(db, { now }) }`.
  - `tests/unit/dose-log-trash-owners.test.ts`: `doseLogTrash` may be named only in `src/lib/server/db/schema.ts`, `src/lib/server/doses.ts` and `src/lib/server/api/wipe.ts`, comments included. Every later task must keep it that way.

- [ ] **Step 1: Write the owner scan**

Create `tests/unit/dose-log-trash-owners.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `dose_log_trash` holds the full content of every deleted dose, notes
 * included, for up to ten minutes. Exactly three modules may name it:
 *
 *   - `db/schema.ts` defines it;
 *   - `doses.ts` writes it (delete), reads and removes it (restore), and
 *     purges it (`purgeExpiredTrash`, which retention calls);
 *   - `api/wipe.ts` empties it for "Delete dose history".
 *
 * Retention is deliberately NOT an owner. It calls `purgeExpiredTrash`, so
 * the non-blocking `SKIP LOCKED` purge exists once. A reader anywhere else
 * would be the first path by which deleted notes could reach an export or a
 * page, and a writer anywhere else would be one that skips the medication
 * lock (D7).
 *
 * Checked in both directions, like `server-log.test.ts`: no other file names
 * the table, and every owner still does, so the list cannot rot into a
 * licence. A comment naming `doseLogTrash` counts too; write "the trash".
 */

const OWNERS = new Set([
  "src/lib/server/db/schema.ts",
  "src/lib/server/doses.ts",
  "src/lib/server/api/wipe.ts",
]);

const NAMES_THE_TRASH = /\bdoseLogTrash\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|svelte)$/.test(entry)) out.push(full.split(/[\\/]/).join("/"));
  }
  return out;
}

describe("dose_log_trash has exactly three owners", () => {
  it("no module outside the owners names doseLogTrash", () => {
    const outsiders = walk("src")
      .filter((file) => !OWNERS.has(file))
      .filter((file) => NAMES_THE_TRASH.test(readFileSync(file, "utf8")));

    expect(outsiders).toEqual([]);
  });

  it("every owner still names it, so the list cannot rot", () => {
    const stillOwning = [...OWNERS].filter((file) =>
      NAMES_THE_TRASH.test(readFileSync(file, "utf8")),
    );

    expect(stillOwning.sort()).toEqual([...OWNERS].sort());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/dose-log-trash-owners.test.ts`
Expected: FAIL — `dose_log_trash has exactly three owners > every owner still names it, so the list cannot rot`: received `["src/lib/server/db/schema.ts", "src/lib/server/doses.ts"]`, `api/wipe.ts` missing.
The other case, `no module outside the owners names doseLogTrash`, must PASS. If it fails, Tasks 1–3 named the table somewhere else (a comment counts): reword it to "the trash" or route the access through `doses.ts`, then re-run.

- [ ] **Step 3: Write the failing wipe tests, and move `wipeDoseHistory` off fake-db**

`wipeDoseHistory` is about to lock the medications with a select `.for("update")`. `tests/unit/api/wipe.test.ts` drives it on fake-db, which has no select `.for()` and must not grow one, so its three `wipeDoseHistory` cases move to PGlite (as `returns the dose count…`, `returns {deleted: 0}…` and `rolls back…` below), where the order is pinned by the SQL it sends and the rollback by what Postgres still holds.

Create `tests/unit/pg/dose-trash-wipe.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The Undo trash under the three bulk deletes.
 *
 * - "Delete dose history" (`wipeDoseHistory`) locks every one of the user's
 *   medications in ascending id order, deletes the doses, then deletes the
 *   trash (D7). PGlite serialises transactions and cannot race one, so the
 *   order is pinned by its SQL in `queryLog`.
 * - "Delete archived medications" (`wipeArchivedMedications`) and account
 *   deletion reach the trash only through `ON DELETE CASCADE` on its two
 *   foreign keys, from migration 0021. No application code is involved,
 *   which is why it needs a test: dropping a cascade from the SQL would be
 *   invisible everywhere else. PGlite applies the real migrations.
 * - After any of them, an Undo offered earlier is "Too late to undo".
 *
 * The `wipeDoseHistory` cases moved here from the fake-db file
 * `tests/unit/api/wipe.test.ts`, because its medication lock is a select
 * `.for()`, which that fake does not have and must not grow (CLAUDE.md,
 * test-seam rule).
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
// Account deletion re-checks the password and ends the sessions before its
// one DELETE. Neither is what this file tests, so both succeed.
vi.mock("$lib/server/auth/reauth", () => ({
  confirmReauth: async () => ({ ok: true }),
  reauthMessage: () => "Incorrect password.",
}));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: {
    invalidateUserSessions: async () => {},
    createBlankSessionCookie: () => ({ name: "auth_session", value: "", attributes: {} }),
  },
}));

import { pgDb, queryLog } from "../helpers/pg-db";
import {
  medications,
  doseLogs,
  doseLogTrash,
  users,
  auditLogs,
} from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const { wipeDoseHistory, wipeArchivedMedications } =
  await import("../../../src/lib/server/api/wipe");
const { logDose, deleteDose, restoreDose } = await import("../../../src/lib/server/doses");
const { restoreDoseAction, RESTORE_GONE_MESSAGE } =
  await import("../../../src/lib/server/dose-actions");
const { actions: dataActions } =
  await import("../../../src/routes/(app)/settings/data/+page.server");

/** Five minutes after `seedTrash`'s default `deletedAt`: its rows are live. */
const NOW = new Date("2026-08-01T09:05:00.000Z");

async function trashIds(): Promise<string[]> {
  const rows = await pgDb.db
    .select({ id: doseLogTrash.id })
    .from(doseLogTrash)
    .orderBy(asc(doseLogTrash.id));
  return rows.map((r) => r.id);
}

async function doseIds(): Promise<string[]> {
  const rows = await pgDb.db.select({ id: doseLogs.id }).from(doseLogs).orderBy(asc(doseLogs.id));
  return rows.map((r) => r.id);
}

async function syncEpoch(userId = "u1"): Promise<number> {
  const [row] = await pgDb.db
    .select({ syncEpoch: users.syncEpoch })
    .from(users)
    .where(eq(users.id, userId));
  return row.syncEpoch;
}

/** Another user with a medication and a trash row, for the scope checks. */
async function seedOtherUser() {
  await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
  await pgDb.seedMedication({ id: "m2", userId: "u2" });
  await pgDb.seedTrash({ id: "t-u2", userId: "u2", medicationId: "m2" });
}

/**
 * Make every INSERT into `audit_logs` raise. Each wipe's audit row is its
 * last write, so this proves everything before it rolls back too. Dropped in
 * `afterEach`.
 */
async function failAuditInserts(): Promise<void> {
  await pgDb.client.exec(`
    CREATE OR REPLACE FUNCTION test_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
    CREATE TRIGGER test_fail_write BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_write();
  `);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  queryLog.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await pgDb.client.exec(`DROP TRIGGER IF EXISTS test_fail_write ON "audit_logs";`);
});

describe("wipeDoseHistory", () => {
  it("locks the user's medications in id order, then deletes the doses, then the trash", async () => {
    await pgDb.seedMedication();
    await pgDb.seedDose({ id: "d-a" });
    await pgDb.seedTrash({ id: "t-a" });
    queryLog.length = 0;

    await wipeDoseHistory("u1");

    const lock = queryLog.findIndex((q) => /from "medications"/.test(q) && /for update/.test(q));
    const doses = queryLog.findIndex((q) => q.startsWith(`delete from "dose_logs"`));
    const trash = queryLog.findIndex((q) => q.startsWith(`delete from "dose_log_trash"`));
    const epoch = queryLog.findIndex((q) => q.startsWith(`update "users"`));
    expect([lock, doses, trash, epoch].every((index) => index >= 0)).toBe(true);
    // Ascending id when there is more than one, like every multi-row lock (D7).
    expect(queryLog[lock]).toMatch(/order by "medications"\."id" asc for update/);
    expect(lock).toBeLessThan(doses);
    expect(doses).toBeLessThan(trash);
    expect(trash).toBeLessThan(epoch);
  });

  it("returns the dose count, bumps the sync epoch once and audits the count", async () => {
    await pgDb.seedMedication();
    for (const id of ["d-a", "d-b", "d-c"]) await pgDb.seedDose({ id });
    // A trash row is not part of the history the user could see, so it is
    // deleted but not counted.
    await pgDb.seedTrash({ id: "t-a" });

    await expect(wipeDoseHistory("u1")).resolves.toEqual({ deleted: 3 });

    expect(await doseIds()).toEqual([]);
    expect(await trashIds()).toEqual([]);
    expect(await syncEpoch()).toBe(1);
    const audits = await pgDb.db.select().from(auditLogs);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      userId: "u1",
      entityType: "dose_log",
      entityId: "*",
      action: "delete",
      changes: { deleted: { from: 3, to: 0 } },
    });
  });

  it("returns {deleted: 0} when there is nothing to wipe", async () => {
    await expect(wipeDoseHistory("u1")).resolves.toEqual({ deleted: 0 });

    const [audit] = await pgDb.db.select().from(auditLogs);
    expect(audit.changes).toEqual({ deleted: { from: 0, to: 0 } });
  });

  it("empties this user's trash and no one else's", async () => {
    await pgDb.seedMedication();
    await pgDb.seedTrash({ id: "t-u1" });
    await seedOtherUser();
    await pgDb.seedDose({ id: "d-u2", userId: "u2", medicationId: "m2" });

    await wipeDoseHistory("u1");

    expect(await trashIds()).toEqual(["t-u2"]);
    expect(await doseIds()).toEqual(["d-u2"]);
  });

  it("rolls back the doses, the trash and the epoch when its audit insert fails", async () => {
    await pgDb.seedMedication();
    await pgDb.seedDose({ id: "d-a" });
    await pgDb.seedTrash({ id: "t-a" });
    await failAuditInserts();

    await expect(wipeDoseHistory("u1")).rejects.toThrow(/insert into "audit_logs"/);

    expect(await doseIds()).toEqual(["d-a"]);
    expect(await trashIds()).toEqual(["t-a"]);
    expect(await syncEpoch()).toBe(0);
  });

  it("turns an Undo offered before it into Too late to undo", async () => {
    await pgDb.seedMedication({ inventoryCount: 10 });
    const dose = await logDose("u1", "m1", 1);
    const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
    expect(deleted).not.toBeNull();

    await wipeDoseHistory("u1");

    await expect(restoreDose("u1", dose.id, deleted!.deletedAt)).resolves.toBe("gone");
    expect(await doseIds()).toEqual([]);
  });
});

describe("wipeArchivedMedications", () => {
  it("cascades to the archived medication's trash rows and leaves an active one's", async () => {
    await pgDb.seedMedication({ id: "m-archived", isArchived: true, archivedAt: NOW });
    await pgDb.seedMedication({ id: "m-active" });
    await pgDb.seedTrash({ id: "t-archived", medicationId: "m-archived" });
    await pgDb.seedTrash({ id: "t-active", medicationId: "m-active" });

    await expect(wipeArchivedMedications("u1")).resolves.toEqual({ deleted: 1 });

    expect(await trashIds()).toEqual(["t-active"]);
  });

  it("Review Focus #5: a dose deleted before its medication is archived and wiped cannot be restored", async () => {
    await pgDb.seedMedication({ inventoryCount: 10 });
    const dose = await logDose("u1", "m1", 1);
    const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
    await pgDb.db
      .update(medications)
      .set({ isArchived: true, archivedAt: NOW })
      .where(eq(medications.id, "m1"));
    await wipeArchivedMedications("u1");

    // Through the real action, so the person sees the real copy.
    const result = await restoreDoseAction({
      locals: { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } },
      request: new Request("http://localhost/dashboard?/restoreDose", {
        method: "POST",
        body: new URLSearchParams({
          doseId: dose.id,
          deletedAt: deleted!.deletedAt.toISOString(),
        }),
      }),
    } as never);

    expect(result).toMatchObject({ status: 410, data: { error: RESTORE_GONE_MESSAGE } });
    expect(RESTORE_GONE_MESSAGE).toBe("Too late to undo. Log it again if you need it.");
    expect(await doseIds()).toEqual([]);
    expect(await trashIds()).toEqual([]);
  });
});

describe("account deletion", () => {
  it("removes every one of the user's trash rows, and no one else's", async () => {
    await pgDb.seedMedication({ id: "m1" });
    await pgDb.seedMedication({ id: "m1b" });
    await pgDb.seedTrash({ id: "t-a", medicationId: "m1" });
    await pgDb.seedTrash({ id: "t-b", medicationId: "m1b" });
    await seedOtherUser();
    const cookies = { set: vi.fn() };

    // The real action: its one statement is `db.delete(users)`, and
    // everything else hangs off the cascades.
    await expect(
      dataActions.deleteAccount({
        request: new Request("http://localhost/settings/data?/deleteAccount", {
          method: "POST",
          body: new URLSearchParams({ password: "correct horse battery staple" }),
        }),
        locals: { user: { id: "u1" }, session: { id: "s1" } },
        cookies,
      } as never),
    ).rejects.toMatchObject({ status: 302, location: "/" });

    expect(await pgDb.db.select().from(users).where(eq(users.id, "u1"))).toEqual([]);
    expect(await trashIds()).toEqual(["t-u2"]);
  });
});
```

Replace the whole of `tests/unit/api/wipe.test.ts` with the `wipeArchivedMedications` cases, unchanged, under a header that says where the rest went:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

import { fakeDb } from "../helpers/fake-db";
import { medications } from "$lib/server/db/schema";

/**
 * `wipeArchivedMedications` on the fake seam.
 *
 * `wipeDoseHistory`'s cases live in `tests/unit/pg/dose-trash-wipe.test.ts`.
 * It now locks the user's medications with a select `.for("update")` before
 * it deletes anything (D7), and this fake has no select `.for()` and must not
 * grow one (CLAUDE.md, test-seam rule). On PGlite its order is pinned by the
 * SQL it sends, and its rollback by what Postgres still holds afterwards.
 */

type Op = { kind: "delete"; table: string } | { kind: "update"; table: string; values: unknown };

// The durable view: what a database would still show after the transaction
// resolved. fakeDb.committed is truncated when the callback throws, so a
// rolled-back run reports [] exactly as the hand-rolled snapshot did.
function ops(): Op[] {
  return fakeDb.committed.map((c) =>
    c.op === "delete"
      ? { kind: "delete", table: c.table }
      : { kind: c.op as "update", table: c.table, values: c.payload },
  );
}

const auditCalls: Array<{
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  changes?: unknown;
  client: unknown;
}> = [];

// logAudit is mocked to record which client (db vs tx) it was invoked
// with, so the tests can assert it ran INSIDE the transaction rather
// than after it committed.
const logAudit = vi.fn(
  async (
    userId: string,
    entityType: string,
    entityId: string,
    action: string,
    changes: unknown,
    client: unknown,
  ) => {
    auditCalls.push({ userId, entityType, entityId, action, changes, client });
  },
);
vi.mock("$lib/server/audit", () => ({
  logAudit: (
    userId: string,
    entityType: string,
    entityId: string,
    action: string,
    changes: unknown,
    client: unknown,
  ) => logAudit(userId, entityType, entityId, action, changes, client),
}));

// Database traffic rolls back through the shared seam's `committed` view.
// `auditCalls` does NOT: logAudit is mocked at module level, so its calls are
// not database traffic and `committed` structurally cannot see them. That one
// array keeps a local snapshot here rather than teaching the shared fake about
// arbitrary mocked modules.
vi.mock("$lib/server/db", async () => {
  const { fakeDb: fake } = await import("../helpers/fake-db");
  return {
    db: fake.db,
    dbTx: {
      async transaction<T>(cb: (tx: typeof fake.db) => Promise<T>): Promise<T> {
        const auditSnapshot = auditCalls.slice();
        try {
          return await fake.dbTx.transaction(cb);
        } catch (err) {
          auditCalls.length = 0;
          for (const a of auditSnapshot) auditCalls.push(a);
          throw err;
        }
      },
    },
  };
});

const { wipeArchivedMedications } = await import("../../../src/lib/server/api/wipe");

beforeEach(() => {
  fakeDb.reset();
  auditCalls.length = 0;
  logAudit.mockClear();
});

describe("wipeArchivedMedications", () => {
  it("deletes archived medications, bumps syncEpoch, and audits — all inside one transaction — returning the deleted count", async () => {
    fakeDb.seed(medications, [{ id: "m1" }, { id: "m2" }]);

    const result = await wipeArchivedMedications("u1");

    expect(result).toEqual({ deleted: 2 });
    expect(ops()).toEqual([
      { kind: "delete", table: "medications" },
      {
        kind: "update",
        table: "users",
        values: expect.objectContaining({ syncEpoch: expect.anything() }),
      },
    ]);

    expect(logAudit).toHaveBeenCalledTimes(1);
    const [call] = auditCalls;
    expect(call.userId).toBe("u1");
    expect(call.entityType).toBe("medication");
    expect(call.entityId).toBe("*");
    expect(call.action).toBe("delete");
    expect(call.changes).toEqual({
      deleted: { from: 2, to: 0 },
      filter: { from: null, to: "archived" },
    });
  });

  it("rolls back the epoch bump and audit when the delete throws — nothing durably committed", async () => {
    fakeDb.failNext("delete", { error: new Error("connection reset") });

    await expect(wipeArchivedMedications("u1")).rejects.toThrow("connection reset");

    expect(ops()).toEqual([]);
    expect(auditCalls).toEqual([]);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/unit/pg/dose-trash-wipe.test.ts tests/unit/api/wipe.test.ts`
Expected: FAIL, 4 tests in `dose-trash-wipe.test.ts`:

- `wipeDoseHistory > locks the user's medications in id order, then deletes the doses, then the trash` — `expected false to be true` (no lock, no trash delete)
- `wipeDoseHistory > returns the dose count, bumps the sync epoch once and audits the count` — `trashIds()` is `["t-a"]`, expected `[]`
- `wipeDoseHistory > empties this user's trash and no one else's` — `["t-u1", "t-u2"]`, expected `["t-u2"]`
- `wipeDoseHistory > turns an Undo offered before it into Too late to undo` — `"restored"`, expected `"gone"`

These PASS already and must keep passing: `returns {deleted: 0} when there is nothing to wipe`; `rolls back the doses, the trash and the epoch when its audit insert fails`; both `wipeArchivedMedications` cases and `account deletion` (they pin Task 1's cascades); and both cases in `tests/unit/api/wipe.test.ts`.

- [ ] **Step 5: Implement the wipe**

In `src/lib/server/api/wipe.ts`, replace the two import lines

```ts
import { doseLogs, medications, users } from "$lib/server/db/schema";
import { and, eq, sql } from "drizzle-orm";
```

with

```ts
import { doseLogTrash, doseLogs, medications, users } from "$lib/server/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
```

and replace the opening of `wipeDoseHistory`

```ts
export async function wipeDoseHistory(userId: string): Promise<{ deleted: number }> {
  return dbTx.transaction(async (tx) => {
    const rows = await tx
      .delete(doseLogs)
      .where(eq(doseLogs.userId, userId))
      .returning({ id: doseLogs.id });
    const deleted = rows.length;
```

with

```ts
export async function wipeDoseHistory(userId: string): Promise<{ deleted: number }> {
  return dbTx.transaction(async (tx) => {
    // D7: every medication row first, in ascending id order like any
    // multi-row lock. Each delete and restore locks its medication before it
    // touches a dose or a trash row, so holding all of them makes this wipe
    // wait for any in flight and shuts out any that would start. Without it
    // a restore could commit after the DELETE below had taken its snapshot,
    // and bring a dose back into a history the user had just wiped.
    await tx
      .select({ id: medications.id })
      .from(medications)
      .where(eq(medications.userId, userId))
      .orderBy(asc(medications.id))
      .for("update");

    const rows = await tx
      .delete(doseLogs)
      .where(eq(doseLogs.userId, userId))
      .returning({ id: doseLogs.id });
    const deleted = rows.length;

    // The Undo copies go too. A wiped history must not be restorable, and
    // the trash would otherwise keep the deleted doses' notes on the server
    // until the retention sweep. Not counted in `deleted`, which is the
    // history the user could see.
    await tx.delete(doseLogTrash).where(eq(doseLogTrash.userId, userId));
```

The epoch bump, the audit row and `return { deleted };` below it are unchanged. `wipeArchivedMedications` is unchanged: deleting the medication rows locks them before the cascade reaches `dose_logs` and the trash.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/pg/dose-trash-wipe.test.ts tests/unit/api/wipe.test.ts tests/unit/dose-log-trash-owners.test.ts`
Expected: PASS — 9, 2 and 2 tests.

- [ ] **Step 7: Write the failing retention tests**

In `tests/unit/pg/retention.test.ts`:

1. Replace
   ```ts
   import { rateLimits, passwordResetTokens } from "../../../src/lib/server/db/schema";
   ```
   with
   ```ts
   import { asc } from "drizzle-orm";
   import {
     rateLimits,
     passwordResetTokens,
     doseLogTrash,
   } from "../../../src/lib/server/db/schema";
   import { DOSE_UNDO_WINDOW_MS } from "../../../src/lib/utils/dose-undo";
   ```
2. Replace `import { pgDb } from "../helpers/pg-db";` with `import { pgDb, queryLog } from "../helpers/pg-db";`.
3. In the file's docblock, replace ` * Retention is three DELETE predicates, so it belongs on real Postgres —` with ` * Retention is four DELETE predicates, so it belongs on real Postgres —`.
4. Insert this block immediately above `describe("one failing policy does not cancel the others", () => {`:

```ts
describe("the dose-log-trash policy", () => {
  /** "Expired" is `deleted_at <= now − window`: the cutoff itself is expired. */
  const cutoff = NOW.getTime() - DOSE_UNDO_WINDOW_MS;

  async function seedTrashForTwoUsers() {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m1", userId: "u1" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedTrash({ id: "u1-at-cutoff", userId: "u1", deletedAt: new Date(cutoff) });
    await pgDb.seedTrash({ id: "u1-live", userId: "u1", deletedAt: new Date(cutoff + 1) });
    await pgDb.seedTrash({
      id: "u2-old",
      userId: "u2",
      medicationId: "m2",
      deletedAt: new Date(cutoff - HOUR),
    });
    await pgDb.seedTrash({
      id: "u2-live",
      userId: "u2",
      medicationId: "m2",
      deletedAt: new Date(NOW.getTime() - 60_000),
    });
  }

  it("is registered", () => {
    expect(RETENTION_POLICIES.map((p) => p.name)).toContain("dose-log-trash");
  });

  it("purges every user's expired rows, the cutoff included, and keeps live ones", async () => {
    await seedTrashForTwoUsers();

    const results = await runRetention(NOW);

    expect(results.find((r) => r.policy === "dose-log-trash")?.ok).toBe(true);
    const remaining = await pgDb.db
      .select({ id: doseLogTrash.id })
      .from(doseLogTrash)
      .orderBy(asc(doseLogTrash.id));
    expect(remaining.map((row) => row.id)).toEqual(["u1-live", "u2-live"]);
  });

  it("never waits on a row another transaction holds, and is scoped by time alone", async () => {
    // A purge that waited could close a lock cycle with a restore, a wipe or
    // a cascade. One that skips a locked row only purges it on a later tick.
    queryLog.length = 0;

    await RETENTION_POLICIES.find((p) => p.name === "dose-log-trash")!.purge(NOW);

    const purge = queryLog.filter((q) => q.includes(`"dose_log_trash"`));
    expect(purge.length).toBeGreaterThan(0);
    expect(purge.some((q) => /for update skip locked/.test(q))).toBe(true);
    expect(purge.some((q) => q.includes(`"user_id"`))).toBe(false);
  });
});
```

`beforeEach` already resets the database and seeds user `u1`, and `beforeAll` freezes `Date` at `NOW` (`2026-04-15T12:00:00Z`).

- [ ] **Step 8: Run them to verify they fail**

Run: `npx vitest run tests/unit/pg/retention.test.ts`
Expected: FAIL, 3 tests:

- `the dose-log-trash policy > is registered` — `expected [ 'password-reset-tokens', … ] to include 'dose-log-trash'`
- `… > purges every user's expired rows, the cutoff included, and keeps live ones` — `expected undefined to be true`
- `… > never waits on a row another transaction holds, and is scoped by time alone` — `TypeError: Cannot read properties of undefined (reading 'purge')`

The existing cases, including `reports every policy it ran`, still PASS.

- [ ] **Step 9: Implement the retention policy**

In `src/lib/server/retention.ts`, replace

```ts
import { purgeExpiredReminderEvents } from "$lib/server/reminders/retention";
```

with

```ts
import { purgeExpiredReminderEvents } from "$lib/server/reminders/retention";
import { purgeExpiredTrash } from "$lib/server/doses";
```

and replace

```ts
  {
    name: "reminder-events",
    purge: (now) => purgeExpiredReminderEvents(now),
  },
];
```

with

```ts
  {
    name: "reminder-events",
    purge: (now) => purgeExpiredReminderEvents(now),
  },
  {
    // Deleted doses kept for Undo, past their ten-minute window. Every
    // delete and restore already purges its own user's expired rows; this
    // reaches everyone else's, such as a user who deleted a dose and never
    // came back. It goes through `purgeExpiredTrash` so the non-blocking
    // `SKIP LOCKED` purge exists once and `doses.ts` stays the table's owner
    // (tests/unit/dose-log-trash-owners.test.ts).
    name: "dose-log-trash",
    purge: (now) => purgeExpiredTrash(db, { now }),
  },
];
```

`db` is already imported there. Do not import the table here: `retention.ts` is not an owner (plan, Spec deviations).

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/pg/retention.test.ts tests/unit/dose-log-trash-owners.test.ts`
Expected: PASS — 10 and 2 tests.

- [ ] **Step 11: Prove by mutation**

Break each line, run the command, watch the named test(s) fail, restore, re-run green. Restore a migration edit with `git checkout -- drizzle/`; PGlite applies the migrations when each test file loads, so the next run sees the restored SQL.

| #   | Break this                                                                                                                                                                                                                                                          | Command                                                   | Test(s) that must fail                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `wipe.ts`: delete `.for("update")` from the medications select                                                                                                                                                                                                      | `npx vitest run tests/unit/pg/dose-trash-wipe.test.ts`    | `wipeDoseHistory > locks the user's medications in id order, then deletes the doses, then the trash`                                                                                           |
| 2   | `wipe.ts`: delete `.orderBy(asc(medications.id))`                                                                                                                                                                                                                   | same                                                      | same                                                                                                                                                                                           |
| 3   | `wipe.ts`: `tx.delete(doseLogTrash).where(eq(doseLogTrash.userId, userId))` → `tx.delete(doseLogTrash)`                                                                                                                                                             | same                                                      | `wipeDoseHistory > empties this user's trash and no one else's`                                                                                                                                |
| 4   | `wipe.ts`: delete the `await tx.delete(doseLogTrash)…` statement                                                                                                                                                                                                    | same                                                      | `locks the user's medications…`, `returns the dose count…`, `empties this user's trash…`, `turns an Undo offered before it into Too late to undo`                                              |
| 5   | `wipe.ts`: move the trash delete out of the transaction — delete it inside, import `db` alongside `dbTx`, and put `await db.delete(doseLogTrash).where(eq(doseLogTrash.userId, userId));` as the first line of `wipeDoseHistory`, before `return dbTx.transaction(` | same                                                      | `rolls back the doses, the trash and the epoch when its audit insert fails` (and the order case)                                                                                               |
| 6   | `drizzle/0021_*.sql`: in the `dose_log_trash_medication_id_medications_id_fk` line, `ON DELETE cascade` → `ON DELETE no action`                                                                                                                                     | same                                                      | `wipeArchivedMedications > cascades to the archived medication's trash rows…`, `wipeArchivedMedications > Review Focus #5: …`                                                                  |
| 7   | `drizzle/0021_*.sql`: `ON DELETE cascade` → `ON DELETE no action` on BOTH constraint lines                                                                                                                                                                          | same                                                      | the two above, plus `account deletion > removes every one of the user's trash rows, and no one else's` (with one cascade left, the other still clears the trash, which is why this takes both) |
| 8   | `retention.ts`: remove the `dose-log-trash` entry                                                                                                                                                                                                                   | `npx vitest run tests/unit/pg/retention.test.ts`          | all three `the dose-log-trash policy` cases                                                                                                                                                    |
| 9   | `doses.ts` `purgeExpiredTrash`: `lte(doseLogTrash.deletedAt, cutoff)` → `lt(…)`                                                                                                                                                                                     | same                                                      | `… > purges every user's expired rows, the cutoff included, and keeps live ones` (`u1-at-cutoff` survives)                                                                                     |
| 10  | `doses.ts` `purgeExpiredTrash`: `.for("update", { skipLocked: true })` → `.for("update")`                                                                                                                                                                           | same                                                      | `… > never waits on a row another transaction holds, and is scoped by time alone`                                                                                                              |
| 11  | `retention.ts`: pass a user, `purgeExpiredTrash(db, { now, userId: "u1" })`                                                                                                                                                                                         | same                                                      | `… > purges every user's expired rows…` (`u2-old` survives) and `… > never waits…` (`"user_id"` appears)                                                                                       |
| 12  | `retention.ts`: add the line `// doseLogTrash` anywhere                                                                                                                                                                                                             | `npx vitest run tests/unit/dose-log-trash-owners.test.ts` | `no module outside the owners names doseLogTrash` (lists `src/lib/server/retention.ts`)                                                                                                        |
| 13  | `wipe.ts`: delete the trash delete AND `doseLogTrash` from its schema import                                                                                                                                                                                        | same                                                      | `every owner still names it, so the list cannot rot`                                                                                                                                           |

- [ ] **Step 12: Update existing tests this change breaks**

- `tests/unit/api/wipe.test.ts` — rewritten in Step 3 (its `wipeDoseHistory` cases are in `tests/unit/pg/dose-trash-wipe.test.ts`, one to one: "deletes dose logs, bumps syncEpoch, and audits…" → "returns the dose count, bumps the sync epoch once and audits the count"; "returns {deleted: 0}…" → same name; "rolls back the epoch bump and audit when the delete throws…" → "rolls back the doses, the trash and the epoch when its audit insert fails").
- `tests/unit/pg/retention.test.ts` — extended in Step 7. `reports every policy it ran` compares against `RETENTION_POLICIES` itself, so it covers the new entry without an edit.
- Checked and unaffected (no edit): `tests/unit/app-action-auth-guard.test.ts` and `tests/unit/api/commands.test.ts` mock `$lib/server/api/wipe`; no test imports the cron route that calls `runRetentionForTick`.

- [ ] **Step 13: Run the task's full suite**

Run: `npx vitest run tests/unit/pg/dose-trash-wipe.test.ts tests/unit/api/wipe.test.ts tests/unit/pg/retention.test.ts tests/unit/dose-log-trash-owners.test.ts`
Expected: PASS — 9, 2, 10 and 2 tests.

Run: `npx vitest run`
Expected: PASS, whole unit suite.

Run: `npm run check`
Expected: the counts recorded before Step 1 — no new errors.

Run: `npm run lint` and `npx prettier --check src/lib/server/api/wipe.ts src/lib/server/retention.ts tests/unit/pg/dose-trash-wipe.test.ts tests/unit/pg/retention.test.ts tests/unit/api/wipe.test.ts tests/unit/dose-log-trash-owners.test.ts`
Expected: no new lint errors; Prettier clean.

- [ ] **Step 14: Commit**

```bash
git add src/lib/server/api/wipe.ts src/lib/server/retention.ts \
  tests/unit/pg/dose-trash-wipe.test.ts tests/unit/api/wipe.test.ts \
  tests/unit/pg/retention.test.ts tests/unit/dose-log-trash-owners.test.ts
git commit -m "feat(trash): empty it on wipe, purge it on retention, pin its owners

Delete dose history now locks the user's medications in id order, deletes
the doses, then deletes the Undo trash, in one transaction (D7), so a
wiped history cannot be restored and no restore can slip in between.
Retention gains a dose-log-trash policy that purges every user's expired
rows through purgeExpiredTrash, which never waits on a locked row.

The archived-medication wipe and account deletion clear the trash through
the migration's ON DELETE CASCADE; PGlite tests pin both, including an
Undo after the archived wipe reporting Too late to undo. A scan pins
doseLogTrash to schema.ts, doses.ts and api/wipe.ts, in both directions.

wipeDoseHistory's tests move from fake-db to PGlite: the fake has no
select .for() and must not grow one."
```

---

### Task 6: Took it at and Skip, re-derived under the lock

Log now already re-derives its target under the medication lock. This task gives Took it at and Skip the same treatment. It closes spec item 6, the stale second device:

- Phone A presses Log now at 08:40 for the 08:00 slot.
- Laptop B's page still offers "Took it at 08:00" or "Skip". Today, B's tap inserts a second row, and a second decrement for Took it at.

After this task:

- Log now, Took it at and Skip all run `recomputeSlotActions` under the medication lock. Each writes only if its button is still offered there.
- Took it at is always ×1.
- Skip posts `forSlot`, and the server decides the instant it lands at.
- `exactInstantGuard` is removed from `logDose` and `logSkippedDose`.

**Files:**

- Modify: `src/lib/utils/validation.ts` (anchor: `export const doseSkipSchema = z.object({`)
- Modify: `src/lib/server/doses.ts` (anchors: `import { dashboardWindow, projectFixedTimes, segmentsFor, slotActions } from "$lib/utils/schedule";`, ` * Log now's write.`, `export async function logDose(`, `export async function logSkippedDose(`, `export class SlotAlreadyTakenError extends Error {`, `export class SlotTargetChangedError extends Error {`, the doc comment above `async function insertTakenDose(`)
- Modify: `src/routes/(app)/dashboard/+page.server.ts` (anchors: `  logDoseForSlot,` and `  logSkippedDose,` inside the `$lib/server/doses` import, `      } else if (at) {`, `    const { medicationId, takenAt } = parsed.data;`)
- Modify: `src/lib/components/dashboard/DueCard.svelte` (anchor: `          fields={{ medicationId: card.medicationId, takenAt: row.skipAt }}`)
- Modify: `src/lib/types.ts` (anchor: ` * One outstanding slot on a Due card. \`tookItAt\` / \`skipAt\` are the exact`)
- Test (rewrite): `tests/unit/pg/dose-slot-writes.test.ts`
- Test (modify): `tests/unit/validation.test.ts`, `tests/unit/dashboard-dose-actions.test.ts`, `tests/unit/due-card-ssr.test.ts`, `tests/unit/app-action-auth-guard.test.ts`
- Test (modify, only if Task 4 left guarded calls in it): `tests/unit/pg/dose-writer-locks.test.ts`

**Interfaces:**

- Consumes:
  - From Task 3 (`src/lib/server/doses.ts`): `insertTakenDose(tx, { userId, medicationId, quantity, takenAt, loggedAt, notes, sideEffects, previousCount })` is private. It now calls `takeFromStock` and behaves exactly as before.
  - From Task 4: `logDose` always locks the medication `FOR UPDATE` and reads `loggedAt` after the lock. Both `logSkippedDose` paths lock. `logDoseForSlot` reads `loggedAt` after the lock. Both functions still take the trailing `opts: { exactInstantGuard?: boolean }` parameter, and this task removes it.
  - Existing (`src/lib/utils/schedule.ts`):
    - `dashboardWindow(now: Date, tz: string): DashboardWindow`
    - `segmentsFor(window: DashboardWindow): Segments`
    - `projectFixedTimes(schedules: MedicationSchedule[], segments: Segments, tz: string): Date[]`
    - `slotActions(input: SlotActionInput): SlotActions`
    - `interface SlotActions { logNowTarget: string | null; rows: Map<string, RowActions> }`
    - `interface RowActions { tookItAt: string | null; skipAt: string | null }`
    - `checkSlotActionTime(at: Date, now: Date, tz: string): SlotActionTimeProblem | null`
- Produces (contract T6):

  ```ts
  // src/lib/server/doses.ts
  async function recomputeSlotActions(tx: DbTransaction, med: typeof medications.$inferSelect, userId: string, now: Date, timezone: string): Promise<SlotActions>   // private; logDoseForSlot now calls it
  export async function logDoseAtSlot(userId: string, medicationId: string, slot: Date, notes: string | undefined, sideEffects: SideEffect[] | undefined, now: Date, timezone: string): Promise<typeof doseLogs.$inferSelect>
  export async function skipDoseForSlot(userId: string, medicationId: string, forSlot: Date, now: Date, timezone: string): Promise<string /* doseId */>
  logDose(userId, medicationId, quantity, takenAt?, notes?, sideEffects?)        // opts REMOVED
  logSkippedDose(userId, medicationId, takenAt?)                                 // opts REMOVED
  ```

  - `doseSkipSchema` takes `{ medicationId, takenAt?, forSlot? }`, with a refine that rejects both instants together on the `forSlot` path.
  - `DueCard` Skip posts `{ medicationId: card.medicationId, forSlot: row.expectedTime }`. It still renders only when `row.skipAt !== null`, and still passes `undoable` (Task 9 replaces that).
  - One private helper is added and is not in the contract: `lockSlotMedication(tx, userId, medicationId)`. It is the lock plus the not-found and archived rules that all three guarded writes share.

---

#### Cycle A: `doseSkipSchema` accepts `forSlot`

- [ ] **Step 1: Write the failing test**

In `tests/unit/validation.test.ts`, insert this block immediately above the line `describe("settingsSchema", () => {`. It needs no new import: `doseSkipSchema` is already imported.

```ts
describe("doseSkipSchema forSlot (Skip re-derived on the server)", () => {
  it("accepts a millisecond-exact forSlot on its own and keeps it verbatim", () => {
    // The server looks the row up by this exact ISO key in slotActions' map.
    const result = doseSkipSchema.safeParse({
      medicationId: "m1",
      forSlot: "2026-04-16T09:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forSlot).toBe("2026-04-16T09:00:00.000Z");
      expect(result.data.takenAt).toBeUndefined();
    }
  });

  it("rejects takenAt and forSlot together, on the forSlot field the action returns", () => {
    // The dashboard action answers with `fieldErrors` only, so a root-level
    // refine would reach the client as `{}` and a generic toast.
    const result = doseSkipSchema.safeParse({
      medicationId: "m1",
      takenAt: "2026-04-16T09:00:00.000Z",
      forSlot: "2026-04-16T09:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.forSlot).toEqual([
        "Send takenAt or forSlot, not both",
      ]);
    }
  });

  it("rejects a forSlot with no UTC designator — it names no instant", () => {
    const result = doseSkipSchema.safeParse({ medicationId: "m1", forSlot: "2026-04-16T09:00" });
    expect(result.success).toBe(false);
  });

  it("still accepts takenAt on its own — a page loaded before forSlot shipped", () => {
    const result = doseSkipSchema.safeParse({
      medicationId: "m1",
      takenAt: "2026-04-16T09:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.forSlot).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/validation.test.ts -t "doseSkipSchema forSlot"`

Expected: FAIL. Three of the four tests fail, because `z.object` strips the unknown `forSlot` key:

- "accepts a millisecond-exact forSlot…": `expected undefined to be '2026-04-16T09:00:00.000Z'`.
- "rejects takenAt and forSlot together…": `expected true to be false`.
- "rejects a forSlot with no UTC designator…": `expected true to be false`.

"still accepts takenAt on its own" passes.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/utils/validation.ts`, replace

```ts
/**
 * The dashboard's Skip. `takenAt` is the row's `skipAt` — the slot's own
 * instant for a past slot, now for a due-now slot still ahead — posted
 * verbatim. Absent, the skip is recorded at now (the legacy door).
 */
export const doseSkipSchema = z.object({
  medicationId: z.string().min(1),
  takenAt: z.string().datetime().optional(),
});
```

with

```ts
/**
 * The dashboard's Skip.
 *
 * - `forSlot`: the row's own slot instant (`expectedTime`), posted verbatim.
 *   The server re-derives the row's Skip under the medication lock and writes
 *   the skip at ITS `min(slot, now)` (`skipDoseForSlot`). The page no longer
 *   chooses the instant.
 * - `takenAt` alone: a page loaded before `forSlot` shipped, which posted the
 *   row's render-time `skipAt`. Accepted for one release, and only where that
 *   instant is still a slot whose row offers Skip (spec D9).
 * - Neither: skip at now, the legacy door.
 */
export const doseSkipSchema = z
  .object({
    medicationId: z.string().min(1),
    takenAt: z.string().datetime().optional(),
    forSlot: z.string().datetime().optional(),
  })
  // Mirrors doseLogSchema: two different requests, never both. The path puts
  // the message in `fieldErrors`, which is all the dashboard action returns.
  .refine((d) => !(d.takenAt && d.forSlot), {
    message: "Send takenAt or forSlot, not both",
    path: ["forSlot"],
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/validation.test.ts`

Expected: PASS. That includes the four new tests, the existing `doseSkipSchema` tests, and the schema tests Task 1 added.

- [ ] **Step 5: Prove by mutation**

| #   | Break this line in `src/lib/utils/validation.ts`                                                             | Command                                                                    | Test that must fail                                                             |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A1  | Delete the `.refine((d) => !(d.takenAt && d.forSlot), { … })` call from `doseSkipSchema`, so it ends at `})` | `npx vitest run tests/unit/validation.test.ts -t "doseSkipSchema forSlot"` | `rejects takenAt and forSlot together, on the forSlot field the action returns` |
| A2  | Delete the line `    forSlot: z.string().datetime().optional(),` from `doseSkipSchema`                       | same                                                                       | `accepts a millisecond-exact forSlot on its own and keeps it verbatim`          |

Restore each mutation, then re-run the command. Expected: PASS.

---

#### Cycle B: `logDoseAtSlot`, `skipDoseForSlot` and the shared recompute (PGlite)

- [ ] **Step 6: Write the failing test: replace `tests/unit/pg/dose-slot-writes.test.ts`**

This replaces the whole file. Before overwriting it, run

```bash
git log --oneline a9ad7d8..HEAD -- tests/unit/pg/dose-slot-writes.test.ts
```

Task 4 changed exactly two things in this file:

- the chip case "a chip's dose takes no lock", which it inverted to assert one medication lock;
- the Log-now `loggedAt` expectation, which moved from `AT_0810` to `TAP` because `loggedAt` is now read from the clock after the lock.

The listing below carries both. If the log shows a commit that added any **other** case, carry that case over unchanged, unless it passes `GUARD`: every `GUARD` case is rewritten below.

Changes from the previous file, case by case:

- Every `GUARD` case is rewritten against `logDoseAtSlot` / `skipDoseForSlot`, with a fixed-time schedule seeded.
- "matches to the millisecond" becomes the stale-device case, plus a 1ms-off refusal.
- "inserts over a skip at the same instant — taken beats skip" becomes "Took it at over a slot a skip already resolved is refused".
- The Skip cases gain:
  - a stale Skip;
  - a Skip ahead of its slot, which lands at the server's `min(slot, now)`;
  - legacy `takenAt`-only Skips, accepted for a past slot and refused for a slot still ahead.
- The lock pins are kept. Each also asserts that the lock precedes every `dose_logs` statement.
- A clock-after-lock case is added for each guarded write.

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The dashboard's guarded writes: Log now, "Took it at HH:MM" and Skip.
 *
 * Each one locks the medication row, re-derives that medication's buttons
 * (`slotActions`) from rows read inside its own transaction, and writes only
 * if the button it was posted from is still offered there. Every outcome is
 * therefore decided by the database: `fake-db` answers every read from its
 * seed and never evaluates a predicate, so it cannot tell a refusal from an
 * insert. These tests belong on PGlite (CLAUDE.md, test-seam rule).
 *
 * The `FOR UPDATE` is pinned by its SQL: the query log shows each write
 * reading the medication row with a lock, before any statement touches
 * `dose_logs` (spec D7). Its runtime effect is still unprovable here. PGlite
 * is one backend and serialises transactions with its own mutex, so
 * "concurrent" calls run one after the other with or without the lock. A
 * losing side is covered by seeding what it would see and calling it
 * second: the stale second device below is exactly that.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";
import { medications, doseLogs, inventoryEvents } from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const {
  logDose,
  logSkippedDose,
  logDoseForSlot,
  logDoseAtSlot,
  skipDoseForSlot,
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
} = await import("../../../src/lib/server/doses");

/** The frozen moment of the tap. `loggedAt` reads it. */
const TAP = new Date("2026-04-16T13:31:00.000Z");
/** A slot instant, millisecond-exact, as the page posts it. */
const SLOT = new Date("2026-04-16T09:00:00.000Z");
const SLOT_0800 = new Date("2026-04-16T08:00:00.000Z");
const AT_0810 = new Date("2026-04-16T08:10:00.000Z");
/** Phone A's Log now, and laptop B's tap from a page drawn before it. */
const AT_0840 = new Date("2026-04-16T08:40:00.000Z");
const AT_0845 = new Date("2026-04-16T08:45:00.000Z");
/**
 * Before every window in this file. Required: the database defaults
 * `startedAt` and `effectiveFrom` to Postgres `now()`, which is the REAL
 * clock, not the faked one. Left to default, the lifecycle and
 * schedule-edit clips would drop every slot in this file.
 */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
}

/** The statements that read the medications table under a row lock. */
function medicationLocks(): string[] {
  return queryLog.filter((q) => /from "medications"/i.test(q) && /for update/i.test(q));
}

/** D7: the medication lock is sent before any statement that touches `dose_logs`. */
function expectLockBeforeDoseLogs(): void {
  const lock = queryLog.findIndex((q) => /from "medications"/i.test(q) && /for update/i.test(q));
  const firstDoseLogs = queryLog.findIndex((q) => /"dose_logs"/i.test(q));
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(firstDoseLogs).toBeGreaterThan(lock);
}

async function rows() {
  return pgDb.db
    .select({
      id: doseLogs.id,
      status: doseLogs.status,
      quantity: doseLogs.quantity,
      inventoryApplied: doseLogs.inventoryApplied,
      takenAt: doseLogs.takenAt,
      loggedAt: doseLogs.loggedAt,
    })
    .from(doseLogs)
    .where(eq(doseLogs.medicationId, "m1"))
    .orderBy(asc(doseLogs.takenAt), asc(doseLogs.id));
}

async function ledger() {
  return pgDb.db
    .select({
      eventType: inventoryEvents.eventType,
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
    })
    .from(inventoryEvents)
    .orderBy(asc(inventoryEvents.createdAt));
}

async function seedTrackedMed(overrides: Partial<typeof medications.$inferInsert> = {}) {
  await pgDb.seedMedication({
    id: "m1",
    name: "Metformin",
    inventoryCount: 10,
    startedAt: LONG_AGO,
    ...overrides,
  });
}

/** A daily fixed-time schedule, in force long before every window here. */
async function seedDaily(timeOfDay: string, medicationId = "m1", userId = "u1") {
  await pgDb.seedSchedule({ medicationId, userId, timeOfDay, effectiveFrom: LONG_AGO });
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
  queryLog.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Took it at — logDoseAtSlot", () => {
  it("writes one ×1 taken dose at the slot's instant, logged at the tap, with the stock bookkeeping", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");

    const dose = await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    expect(dose).toMatchObject({
      medicationId: "m1",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
    });
    expect(dose.takenAt).toEqual(SLOT);
    expect(dose.loggedAt).toEqual(TAP);
    expect(await stock()).toBe(9);
    expect(await ledger()).toEqual([
      { eventType: "dose_taken", quantityChange: -1, previousCount: 10, newCount: 9 },
    ]);
  });

  it("keeps the notes and side effects the row was posted with", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");

    const dose = await logDoseAtSlot(
      "u1",
      "m1",
      SLOT,
      "with food",
      [{ name: "Nausea", severity: "mild" }],
      TAP,
      "UTC",
    );

    expect(dose.notes).toBe("with food");
    expect(dose.sideEffects).toEqual([{ name: "Nausea", severity: "mild" }]);
  });

  it("refuses a second post at one slot as already taken, so a double tap writes and decrements once", async () => {
    // Checked before the re-derivation, which would refuse it too, so that a
    // double tap gets the specific "already logged" answer.
    await seedTrackedMed();
    await seedDaily("09:00");
    await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    await expect(
      logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(SlotAlreadyTakenError);
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
    expect(await ledger()).toHaveLength(1);
  });

  it("refuses a stale second device: once Log now at 08:40 resolved 08:00, Took it at 08:00 writes nothing", async () => {
    // Phone A presses Log now at 08:40. Laptop B's page, drawn before that,
    // still offers "Took it at 08:00". The exact-instant check cannot see A's
    // dose (it sits at 08:40); only the re-derivation can.
    await seedTrackedMed();
    await seedDaily("08:00");
    vi.setSystemTime(AT_0840);
    await logDoseForSlot("u1", "m1", SLOT_0800, AT_0840, "UTC");

    vi.setSystemTime(AT_0845);
    await expect(
      logDoseAtSlot("u1", "m1", SLOT_0800, undefined, undefined, AT_0845, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
    expect(await ledger()).toHaveLength(1);
  });

  it("refuses Took it at over a slot a skip already resolved — remove the skip first", async () => {
    // This used to insert, because taken beats skip in the matcher. A slot
    // the skip resolved is no longer a row, so it offers no Took it at.
    await seedTrackedMed();
    await seedDaily("09:00");
    await pgDb.seedDose({
      id: "skip-0900",
      medicationId: "m1",
      status: "skipped",
      quantity: 1,
      takenAt: SLOT,
    });

    await expect(
      logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect((await rows()).map((r) => r.status)).toEqual(["skipped"]);
    expect(await stock()).toBe(10);
  });

  it("names the slot to the millisecond — 1ms off is no row, and nothing is written", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");

    await expect(
      logDoseAtSlot("u1", "m1", new Date(SLOT.getTime() + 1), undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
    expect(await stock()).toBe(10);
  });

  it("is MedicationNotFoundError for an unknown medication or another user's", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });
    await seedDaily("09:00", "m2", "u2");

    await expect(
      logDoseAtSlot("u1", "nope", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(MedicationNotFoundError);
    await expect(
      logDoseAtSlot("u1", "m2", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(MedicationNotFoundError);
  });

  it("finds nothing to honour on an archived medication — the load never lists one", async () => {
    await seedTrackedMed({ isArchived: true });
    await seedDaily("09:00");

    await expect(
      logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
  });
});

describe("Skip — skipDoseForSlot", () => {
  it("skips a past slot at the slot's own instant, logged at the tap, leaving stock alone", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");

    const id = await skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC");

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id, status: "skipped", quantity: 1 });
    expect(all[0].takenAt).toEqual(SLOT);
    expect(all[0].loggedAt).toEqual(TAP);
    expect(await stock()).toBe(10);
    expect(await ledger()).toEqual([]);
  });

  it("skips a slot still ahead at the server's min(slot, now), not an instant the page chose", async () => {
    // A due-now row's slot can be up to an hour ahead. The page used to post
    // its own render-time skipAt. It now posts the slot, and the server
    // writes the instant its own simulation proved.
    await seedTrackedMed();
    await seedDaily("09:00");
    vi.setSystemTime(AT_0840);

    await skipDoseForSlot("u1", "m1", SLOT, AT_0840, "UTC");

    const [row] = await rows();
    expect(row.status).toBe("skipped");
    expect(row.takenAt).toEqual(AT_0840);
  });

  it("refuses a second Skip at one slot, so a double tap writes one skip", async () => {
    // The first skip resolves the slot, so its row no longer offers Skip.
    await seedTrackedMed();
    await seedDaily("09:00");
    const first = await skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC");

    await expect(skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: first, status: "skipped", quantity: 1 });
    expect(await stock()).toBe(10);
  });

  it("refuses a stale Skip once another device's Log now resolved the slot", async () => {
    await seedTrackedMed();
    await seedDaily("08:00");
    vi.setSystemTime(AT_0840);
    await logDoseForSlot("u1", "m1", SLOT_0800, AT_0840, "UTC");

    vi.setSystemTime(AT_0845);
    await expect(skipDoseForSlot("u1", "m1", SLOT_0800, AT_0845, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect((await rows()).map((r) => r.status)).toEqual(["taken"]);
    expect(await stock()).toBe(9);
  });

  it("refuses to skip a slot Took it at already resolved", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    await expect(skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect((await rows()).map((r) => r.status)).toEqual(["taken"]);
  });

  it("accepts a pre-deploy page's takenAt-only Skip on a past slot — its skipAt was the slot itself", async () => {
    // The action hands a legacy `takenAt` to skipDoseForSlot as the slot
    // (spec D9). For a past slot, the old page's skipAt WAS the slot instant.
    await seedTrackedMed();
    await seedDaily("09:00");
    const legacyTakenAt = new Date("2026-04-16T09:00:00.000Z");

    await skipDoseForSlot("u1", "m1", legacyTakenAt, TAP, "UTC");

    const [row] = await rows();
    expect(row.status).toBe("skipped");
    expect(row.takenAt).toEqual(SLOT);
  });

  it("refuses a pre-deploy page's takenAt-only Skip on a slot still ahead — its render-time instant names no slot", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    vi.setSystemTime(AT_0840);
    // Drawn at 08:30, that page's skipAt was min(09:00, 08:30).
    const renderedSkipAt = new Date("2026-04-16T08:30:00.000Z");

    await expect(
      skipDoseForSlot("u1", "m1", renderedSkipAt, AT_0840, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
  });

  it("is MedicationNotFoundError for another user's medication", async () => {
    await seedTrackedMed();
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });
    await seedDaily("09:00", "m2", "u2");

    await expect(skipDoseForSlot("u1", "m2", SLOT, TAP, "UTC")).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });

  it("finds nothing to honour on an archived medication", async () => {
    await seedTrackedMed({ isArchived: true });
    await seedDaily("09:00");

    await expect(skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect(await rows()).toEqual([]);
  });
});

describe("logSkippedDose — the /api/v1 and legacy skip-at-now door", () => {
  it("still skips at now when no instant is given", async () => {
    await seedTrackedMed();
    const id = await logSkippedDose("u1", "m1");

    const [row] = await rows();
    expect(row).toMatchObject({ id, status: "skipped" });
    expect(row.takenAt).toEqual(TAP);
  });
});

describe("logDose — a dose with no slot to prove", () => {
  it("still inserts at an instant that already holds a taken dose — only Took it at refuses", async () => {
    // The chips, the 1–9 keys, the medications card and /api/v1 log_dose
    // name no slot, so there is nothing to re-derive and nothing to refuse.
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT);
    await logDose("u1", "m1", 1, SLOT);

    expect(await rows()).toHaveLength(2);
    expect(await stock()).toBe(8);
  });
});

describe("Log now — logDoseForSlot", () => {
  async function seedDaily0800() {
    await seedTrackedMed();
    await seedDaily("08:00");
  }

  it("writes one taken dose at now, with logDose's stock bookkeeping", async () => {
    await seedDaily0800();

    const row = await logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC");

    expect(row).toMatchObject({
      medicationId: "m1",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
    });
    expect(row.takenAt).toEqual(AT_0810);
    // The clock read after the lock (D7), not the action's `now`.
    expect(row.loggedAt).toEqual(TAP);
    expect(await stock()).toBe(9);
    expect(await ledger()).toEqual([
      { eventType: "dose_taken", quantityChange: -1, previousCount: 10, newCount: 9 },
    ]);
  });

  it("refuses a forSlot a dose logged now would not resolve, and writes nothing", async () => {
    await seedDaily0800();

    await expect(
      logDoseForSlot("u1", "m1", new Date("2026-04-16T09:00:00.000Z"), AT_0810, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
    expect(await stock()).toBe(10);
  });

  describe("render-to-tap drift (fixed 14:00 and 20:00)", () => {
    const SLOT_1400 = new Date("2026-04-16T14:00:00.000Z");

    async function seedTwoSlots() {
      await seedTrackedMed();
      await pgDb.seedSchedule({ timeOfDay: "14:00", effectiveFrom: LONG_AGO, sortOrder: 0 });
      await pgDb.seedSchedule({ timeOfDay: "20:00", effectiveFrom: LONG_AGO, sortOrder: 1 });
    }

    it("accepts 14:00 at 18:50, when a dose logged now would count for it", async () => {
      // 20:00 is 70 minutes ahead, beyond pass 1's hour, so pass 2 walks
      // back to 14:00.
      await seedTwoSlots();

      const row = await logDoseForSlot(
        "u1",
        "m1",
        SLOT_1400,
        new Date("2026-04-16T18:50:00.000Z"),
        "UTC",
      );

      expect(row.status).toBe("taken");
    });

    it("refuses the same 14:00 at 19:05, once 20:00 is within the hour", async () => {
      // Pass 1 now gives a dose logged at 19:05 to 20:00, so the page's
      // 14:00 button is stale.
      await seedTwoSlots();

      await expect(
        logDoseForSlot("u1", "m1", SLOT_1400, new Date("2026-04-16T19:05:00.000Z"), "UTC"),
      ).rejects.toBeInstanceOf(SlotTargetChangedError);
      expect(await rows()).toEqual([]);
    });
  });

  it("two concurrent posts for one medication write one dose; the other is told the target changed", async () => {
    await seedDaily0800();

    const results = await Promise.allSettled([
      logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC"),
      logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC"),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
  });

  it("is MedicationNotFoundError for an unknown medication or another user's", async () => {
    await seedDaily0800();
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });
    await pgDb.seedSchedule({
      medicationId: "m2",
      userId: "u2",
      timeOfDay: "08:00",
      effectiveFrom: LONG_AGO,
    });

    await expect(logDoseForSlot("u1", "nope", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
    await expect(logDoseForSlot("u1", "m2", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });

  it("finds no target on an archived medication — the load never lists one", async () => {
    await seedTrackedMed({ isArchived: true });
    await pgDb.seedSchedule({ timeOfDay: "08:00", effectiveFrom: LONG_AGO });

    await expect(logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect(await rows()).toEqual([]);
  });
});

describe("slot-anchored reads belong to one medication", () => {
  it("Log now on an interval medication anchors on its own last TAKEN dose", async () => {
    // Every 8 hours, last taken 01:00, so the load draws the row at 09:00.
    // The load projects from `lastTakenAt`, so the write must too: a skip at
    // 03:00 and another medication's dose at 05:00 are not that anchor. Were
    // either read as it, the write would project another grid and refuse
    // every Log now on an interval medication.
    await seedTrackedMed();
    await pgDb.seedSchedule({
      scheduleKind: "interval",
      intervalHours: "8",
      timeOfDay: null,
      effectiveFrom: LONG_AGO,
    });
    await pgDb.seedMedication({ id: "m2", name: "Other", startedAt: LONG_AGO });
    await pgDb.seedDose({
      medicationId: "m1",
      status: "taken",
      takenAt: new Date("2026-04-16T01:00:00.000Z"),
    });
    await pgDb.seedDose({
      medicationId: "m1",
      status: "skipped",
      takenAt: new Date("2026-04-16T03:00:00.000Z"),
    });
    await pgDb.seedDose({
      medicationId: "m2",
      status: "taken",
      takenAt: new Date("2026-04-16T05:00:00.000Z"),
    });

    const row = await logDoseForSlot(
      "u1",
      "m1",
      new Date("2026-04-16T09:00:00.000Z"),
      new Date("2026-04-16T09:10:00.000Z"),
      "UTC",
    );

    expect(row).toMatchObject({ medicationId: "m1", status: "taken" });
  });

  describe("two medications due at the same 08:00", () => {
    async function seedTwoMedsAt0800() {
      await seedTrackedMed();
      await pgDb.seedMedication({
        id: "m2",
        name: "Lisinopril",
        inventoryCount: 10,
        startedAt: LONG_AGO,
      });
      await pgDb.seedSchedule({ medicationId: "m1", timeOfDay: "08:00", effectiveFrom: LONG_AGO });
      await pgDb.seedSchedule({ medicationId: "m2", timeOfDay: "08:00", effectiveFrom: LONG_AGO });
    }

    it("Took it at for one does not find the other's dose at that instant", async () => {
      await seedTwoMedsAt0800();
      await logDoseAtSlot("u1", "m1", SLOT_0800, undefined, undefined, TAP, "UTC");

      const second = await logDoseAtSlot("u1", "m2", SLOT_0800, undefined, undefined, TAP, "UTC");

      expect(second).toMatchObject({ medicationId: "m2", status: "taken" });
      expect(await stock("m1")).toBe(9);
      expect(await stock("m2")).toBe(9);
    });

    it("Skip for one is not refused by the other's taken dose at that instant", async () => {
      await seedTwoMedsAt0800();
      await pgDb.seedDose({ medicationId: "m1", status: "taken", takenAt: SLOT_0800 });

      const id = await skipDoseForSlot("u1", "m2", SLOT_0800, TAP, "UTC");

      const [row] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.id, id));
      expect(row).toMatchObject({ medicationId: "m2", status: "skipped" });
    });

    it("Log now for one is not cooled down by the other's dose", async () => {
      await seedTwoMedsAt0800();
      await logDoseForSlot("u1", "m1", SLOT_0800, new Date("2026-04-16T08:05:00.000Z"), "UTC");

      const row = await logDoseForSlot(
        "u1",
        "m2",
        SLOT_0800,
        new Date("2026-04-16T08:10:00.000Z"),
        "UTC",
      );

      expect(row).toMatchObject({ medicationId: "m2", status: "taken" });
    });
  });
});

describe("the medication row lock", () => {
  // Two devices tapping together, or a retry after an unknown outcome, must
  // serialise on the medication row, or both read "no dose" and both write.
  it("Log now locks the medication once, before any dose_logs statement", async () => {
    await seedTrackedMed();
    await seedDaily("08:00");
    queryLog.length = 0;

    await logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC");

    expect(medicationLocks()).toHaveLength(1);
    expectLockBeforeDoseLogs();
  });

  it("Took it at locks the medication once, before any dose_logs statement", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    queryLog.length = 0;

    await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    expect(medicationLocks()).toHaveLength(1);
    expectLockBeforeDoseLogs();
  });

  it("Skip locks the medication once, before any dose_logs statement", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    queryLog.length = 0;

    await skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC");

    expect(medicationLocks()).toHaveLength(1);
    expectLockBeforeDoseLogs();
  });

  it("a chip's dose locks the medication too — every dose insert does (D7)", async () => {
    await seedTrackedMed();
    queryLog.length = 0;

    await logDose("u1", "m1", 1);

    expect(medicationLocks()).toHaveLength(1);
    expectLockBeforeDoseLogs();
  });
});

describe("the clock that orders writes is read after the lock (D7)", () => {
  const LATER = new Date(TAP.getTime() + 5_000);

  /**
   * drizzle's logger runs synchronously just before each statement is sent
   * (`logQuery` in drizzle-orm/pglite/session.js), and pg-db.ts's logger
   * pushes onto `queryLog`. Moving the fake clock the moment the medication
   * lock is logged therefore separates a clock read before the lock (TAP)
   * from one read after it (LATER).
   */
  function advanceClockAtMedicationLock(): void {
    vi.spyOn(queryLog, "push").mockImplementation((...items: string[]) => {
      if (items.some((q) => /from "medications"/i.test(q) && /for update/i.test(q))) {
        vi.setSystemTime(LATER);
      }
      return Array.prototype.push.apply(queryLog, items);
    });
  }

  it("Took it at's loggedAt", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    advanceClockAtMedicationLock();

    const dose = await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    expect(dose.loggedAt).toEqual(LATER);
    expect(dose.takenAt).toEqual(SLOT);
  });

  it("Skip's loggedAt", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    advanceClockAtMedicationLock();

    await skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC");

    const [row] = await rows();
    expect(row.loggedAt).toEqual(LATER);
    expect(row.takenAt).toEqual(SLOT);
  });

  it("Log now's loggedAt, while takenAt keeps the action's now", async () => {
    await seedTrackedMed();
    await seedDaily("08:00");
    advanceClockAtMedicationLock();

    const row = await logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC");

    expect(row.loggedAt).toEqual(LATER);
    expect(row.takenAt).toEqual(AT_0810);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/unit/pg/dose-slot-writes.test.ts`

Expected: FAIL. Every case that calls `logDoseAtSlot` or `skipDoseForSlot` fails with `TypeError: logDoseAtSlot is not a function` or `TypeError: skipDoseForSlot is not a function`. That covers every case in "Took it at — logDoseAtSlot", every case in "Skip — skipDoseForSlot", the first two "two medications" cases, and the Took it at and Skip cases under "the medication row lock" and "the clock…".

These cases already pass:

- the legacy skip-at-now case;
- the `logDose` case;
- every "Log now — logDoseForSlot" case, including Log now's clock case, because Task 4 moved its `loggedAt` after the lock;
- the Log now and chip lock cases.

- [ ] **Step 8: Extract `recomputeSlotActions` and the shared lock, and rebuild `logDoseForSlot` on them**

In `src/lib/server/doses.ts`:

**(a)** Replace

```ts
import { dashboardWindow, projectFixedTimes, segmentsFor, slotActions } from "$lib/utils/schedule";
```

with

```ts
import {
  dashboardWindow,
  projectFixedTimes,
  segmentsFor,
  slotActions,
  type SlotActions,
} from "$lib/utils/schedule";
```

**(b)** Replace the whole of `logDoseForSlot` and its doc comment with the three functions below.

- The block starts at the `/**` line directly above ` * Log now's write.`.
- It ends at `logDoseForSlot`'s closing `}`: the one straight after the `  });` that closes its `dbTx.transaction(async (tx) => {` call.

```ts
/**
 * The first statement of every guarded dashboard write: Log now, Took it at
 * and Skip.
 *
 * It locks the medication row, so two taps for one medication serialise here:
 * a double tap, a second device, a retry after an unknown outcome. The second
 * one's re-derivation then reads the first one's dose (spec D7: the
 * medication first, then its dose rows).
 *
 * The load lists active medications only (`getActiveMedications`), so an
 * archived one has no button to honour.
 */
async function lockSlotMedication(
  tx: DbTransaction,
  userId: string,
  medicationId: string,
): Promise<typeof medications.$inferSelect> {
  const [med] = await tx
    .select()
    .from(medications)
    .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
    .limit(1)
    .for("update");
  if (!med) throw new MedicationNotFoundError(medicationId);
  if (med.isArchived) {
    throw new SlotTargetChangedError(`Medication ${medicationId} is archived`);
  }
  return med;
}

/**
 * ONE medication's dashboard buttons, re-derived inside the caller's
 * transaction from rows read there. It uses the same pure functions the load
 * ran: `dashboardWindow`, `projectFixedTimes` and `slotActions`.
 *
 * The caller has already locked `med` (`lockSlotMedication`), so no other
 * write to this medication can land between this read and the caller's
 * insert. Log now, Took it at and Skip all ask it, and each writes only if
 * the answer still names the row its button sat on.
 *
 * PGlite is one backend and serialises transactions itself, so the lock's
 * effect cannot be exercised in the suite. `tests/unit/pg/dose-slot-writes.test.ts`
 * pins the lock by its SQL, and covers each losing side by seeding what it
 * would read.
 */
async function recomputeSlotActions(
  tx: DbTransaction,
  med: typeof medications.$inferSelect,
  userId: string,
  now: Date,
  timezone: string,
): Promise<SlotActions> {
  const window = dashboardWindow(now, timezone);

  const schedules = await tx
    .select()
    .from(medicationSchedules)
    .where(
      and(eq(medicationSchedules.medicationId, med.id), eq(medicationSchedules.userId, userId)),
    )
    .orderBy(asc(medicationSchedules.sortOrder));

  // The load's bounds, so pass 1 reaches as far either side of the window
  // here as it did when the button was drawn.
  const doses = await tx
    .select({
      id: doseLogs.id,
      takenAt: doseLogs.takenAt,
      status: doseLogs.status,
      quantity: doseLogs.quantity,
    })
    .from(doseLogs)
    .where(
      and(
        eq(doseLogs.userId, userId),
        eq(doseLogs.medicationId, med.id),
        gte(doseLogs.takenAt, window.doseFetchFrom),
        lt(doseLogs.takenAt, window.doseFetchTo),
      ),
    );

  // All-time and taken-only: `getLastDosePerMedication`'s `lastTakenAt`,
  // the anchor the load projects interval rows from.
  const [last] = await tx
    .select({ at: max(doseLogs.takenAt) })
    .from(doseLogs)
    .where(
      and(
        eq(doseLogs.userId, userId),
        eq(doseLogs.medicationId, med.id),
        eq(doseLogs.status, "taken"),
      ),
    );

  const fixedInstants = projectFixedTimes(schedules, segmentsFor(window), timezone);
  return slotActions({
    med,
    schedules,
    fixedInstants,
    doses,
    lastTakenAt: last?.at ?? null,
    window,
  });
}

/**
 * Log now's write.
 *
 * The page rendered Log now on the row a dose logged at render time would
 * resolve. By the time the tap arrives, that can be a different row: a slot
 * came within the hour, midnight passed, the 12h expiry hid the row, or
 * another device logged.
 *
 * So the server re-derives the target under the medication lock
 * (`recomputeSlotActions`) and writes only if it is still `forSlot`. A second
 * Log now for one medication reads the first one's dose, finds the one-hour
 * cooldown active, and is refused.
 *
 * Always ×1. A larger dose could resolve rows the simulation never proved,
 * and Log now's contract is "this row".
 */
export async function logDoseForSlot(
  userId: string,
  medicationId: string,
  forSlot: Date,
  now: Date,
  timezone: string,
): Promise<typeof doseLogs.$inferSelect> {
  return dbTx.transaction(async (tx) => {
    const med = await lockSlotMedication(tx, userId, medicationId);
    // D7: the clock that orders writes is read after the lock. `takenAt`
    // keeps the action's `now`, the instant the recompute judged.
    const loggedAt = new Date();

    const { logNowTarget } = await recomputeSlotActions(tx, med, userId, now, timezone);
    if (logNowTarget !== forSlot.toISOString()) {
      throw new SlotTargetChangedError(
        `Log-now target for ${medicationId} is ${logNowTarget ?? "none"}, not ${forSlot.toISOString()}`,
      );
    }

    return insertTakenDose(tx, {
      userId,
      medicationId,
      quantity: 1,
      takenAt: now,
      loggedAt,
      notes: null,
      sideEffects: null,
      previousCount: med.inventoryCount,
    });
  });
}
```

Run: `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "logDoseForSlot|Log now locks|Log now's loggedAt|Log now for one|Log now on an interval"`

Expected: PASS, 11 passed and 26 skipped. The 11 are the 7 under "Log now — logDoseForSlot" (including "two concurrent posts…"), "Log now locks the medication once…", "Log now's loggedAt…", "Log now for one is not cooled down…" and "Log now on an interval medication…". The refactor keeps every one green.

`-t` matches the full name, describe blocks included, so a plain `-t "Log now"` would also select two cases that call functions Steps 9 and 10 have not written yet: "refuses a stale second device: once Log now at 08:40 resolved 08:00, Took it at 08:00 writes nothing" and "refuses a stale Skip once another device's Log now resolved the slot". Both stay red until then, with `TypeError: logDoseAtSlot is not a function` and `TypeError: skipDoseForSlot is not a function`.

- [ ] **Step 9: Write `logDoseAtSlot`**

In `src/lib/server/doses.ts`, directly after the closing `}` of `logDoseForSlot` (from Step 8), add:

```ts
/**
 * Took it at's write: a ×1 taken dose at `slot`, the row's own instant.
 *
 * A fresh page offers Took it at on a row only when `slotActions` proved that
 * a dose at exactly that instant resolves the row and moves no other. By the
 * time of the tap that can have changed:
 *
 * - a second device logged or skipped the slot;
 * - a double tap already wrote it;
 * - midnight or the 12h expiry moved it off the dashboard.
 *
 * So the server re-derives the row's buttons under the medication lock, and
 * writes only if the row still offers Took it at `slot`. That also refuses a
 * slot a skip already resolved: remove the skip first.
 *
 * Before re-deriving, it checks whether `slot` already holds a taken dose of
 * this medication. The re-derivation would refuse that too, but a double tap
 * deserves the specific "it's already logged" (`SlotAlreadyTakenError`).
 *
 * Always ×1, like Log now: the simulation proved a probe of one dose, and a
 * larger dose could resolve rows it never checked. The action does not pass
 * the posted quantity.
 */
export async function logDoseAtSlot(
  userId: string,
  medicationId: string,
  slot: Date,
  notes: string | undefined,
  sideEffects: SideEffect[] | undefined,
  now: Date,
  timezone: string,
): Promise<typeof doseLogs.$inferSelect> {
  const slotIso = slot.toISOString();

  return dbTx.transaction(async (tx) => {
    const med = await lockSlotMedication(tx, userId, medicationId);
    // D7: the clock that orders writes is read after the lock.
    const loggedAt = new Date();

    const [existing] = await tx
      .select({ id: doseLogs.id })
      .from(doseLogs)
      .where(
        and(
          eq(doseLogs.userId, userId),
          eq(doseLogs.medicationId, medicationId),
          eq(doseLogs.takenAt, slot),
          eq(doseLogs.status, "taken"),
        ),
      )
      .limit(1);
    if (existing) {
      throw new SlotAlreadyTakenError(
        `Medication ${medicationId} already has a taken dose at ${slotIso}`,
      );
    }

    const { rows } = await recomputeSlotActions(tx, med, userId, now, timezone);
    if (rows.get(slotIso)?.tookItAt !== slotIso) {
      throw new SlotTargetChangedError(
        `Took it at ${slotIso} is no longer offered for ${medicationId}`,
      );
    }

    return insertTakenDose(tx, {
      userId,
      medicationId,
      quantity: 1,
      takenAt: slot,
      loggedAt,
      notes: notes ?? null,
      sideEffects: sideEffects ?? null,
      previousCount: med.inventoryCount,
    });
  });
}
```

In the doc comment above `async function insertTakenDose(`, replace this paragraph, as Task 3 Step 2 wrote it and Task 4 Step 12 corrected its last sentence:

```
 * `logDose` and `logDoseForSlot` both end here, so a Log-now dose and a chip
 * dose cannot drift apart on `inventoryApplied`, the column `deleteDose`
 * gives back. `previousCount` is the caller's own read of
 * `medications.inventoryCount`, taken inside the same transaction before
 * this insert, under the medication row lock every caller takes first (D7),
 * so no other stock writer can commit between that read and this decrement.
```

with

```
 * `logDose`, `logDoseForSlot` and `logDoseAtSlot` all end here, so a chip
 * dose, a Log-now dose and a Took-it-at dose cannot drift apart on
 * `inventoryApplied`, the column `deleteDose` gives back. `previousCount` is
 * the caller's own read of `medications.inventoryCount`, taken inside the
 * same transaction before this insert, under the medication row lock every
 * caller takes first (D7), so no other stock writer can commit between that
 * read and this decrement.
```

Only the list of callers changes; the rest is Task 4's wording, re-wrapped. Task 4 Step 12 already replaced `The caller decides whether that read locks.` with the D7 lock sentence, so this step adds no second lock sentence.

Run: `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "Took it at"`

Expected: PASS for every case whose name contains "Took it at", except "refuses to skip a slot Took it at already resolved". That one calls `skipDoseForSlot`, which Step 10 writes, and fails with `TypeError: skipDoseForSlot is not a function` until then. The passing cases include "Took it at locks the medication once…", "Took it at's loggedAt" and "Took it at for one does not find the other's dose…".

- [ ] **Step 10: Write `skipDoseForSlot`**

In `src/lib/server/doses.ts`, directly after the closing `}` of `logDoseAtSlot`, add:

```ts
/**
 * Skip's write: a skip for the row whose slot is `forSlot`.
 *
 * The page posts the row's slot, not an instant. The server re-derives the
 * row's buttons under the medication lock, and writes the skip at ITS
 * `skipAt`: `min(slot, now)`, the instant its own simulation proved.
 *
 * It refuses when the row no longer offers Skip, which covers a row resolved
 * by a dose or a skip, a row off the dashboard, and an instant that is not a
 * slot at all. There is no `checkSlotActionTime` here: a due-now slot is
 * legitimately still ahead.
 *
 * A pre-deploy page posted `takenAt` = its render-time `skipAt`. For one
 * release, the action hands that here as `forSlot` (spec D9). It names a slot
 * exactly when the slot was already past, which is the only case accepted.
 */
export async function skipDoseForSlot(
  userId: string,
  medicationId: string,
  forSlot: Date,
  now: Date,
  timezone: string,
): Promise<string> {
  const forSlotIso = forSlot.toISOString();

  return dbTx.transaction(async (tx) => {
    const med = await lockSlotMedication(tx, userId, medicationId);
    // D7: the clock that orders writes is read after the lock.
    const loggedAt = new Date();

    const { rows } = await recomputeSlotActions(tx, med, userId, now, timezone);
    const skipAt = rows.get(forSlotIso)?.skipAt ?? null;
    if (skipAt === null) {
      throw new SlotTargetChangedError(
        `Skip for ${forSlotIso} is no longer offered for ${medicationId}`,
      );
    }

    const id = createId();
    await tx.insert(doseLogs).values({
      id,
      userId,
      medicationId,
      quantity: 1,
      takenAt: new Date(skipAt),
      loggedAt,
      notes: null,
      sideEffects: null,
      status: "skipped",
    });
    await logAudit(userId, "dose_log", id, "create", undefined, tx);
    return id;
  });
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `npx vitest run tests/unit/pg/dose-slot-writes.test.ts`

Expected: PASS, with 37 tests.

- [ ] **Step 12: Prove by mutation**

Every mutation is in `src/lib/server/doses.ts`. Run the command, confirm the named test fails, restore the line, then re-run. Expected after each restore: PASS.

| #   | Break this                                                                                                                                                                           | Command                                                                                            | Test(s) that must fail                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | In `logDoseAtSlot`, delete the whole `if (existing) { throw new SlotAlreadyTakenError(…) }` block                                                                                    | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "double tap writes and decrements once"` | `refuses a second post at one slot as already taken, so a double tap writes and decrements once`. It now rejects with `SlotTargetChangedError`.                                                       |
| B2  | In `logDoseAtSlot`, change `if (rows.get(slotIso)?.tookItAt !== slotIso) {` to `if (false) {`                                                                                        | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "Took it at"`                            | `refuses a stale second device: …`, `refuses Took it at over a slot a skip already resolved — remove the skip first`, `names the slot to the millisecond — 1ms off is no row, and nothing is written` |
| B3  | In `logDoseAtSlot`'s `insertTakenDose` call, change `quantity: 1,` to `quantity: 2,` (the "pass the posted quantity" mutation, made at the only place a quantity can enter)          | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "writes one ×1 taken dose"`              | `writes one ×1 taken dose at the slot's instant, logged at the tap, with the stock bookkeeping`                                                                                                       |
| B4  | In `logDoseAtSlot`'s `insertTakenDose` call, change `notes: notes ?? null,` to `notes: null,`                                                                                        | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "keeps the notes"`                       | `keeps the notes and side effects the row was posted with`                                                                                                                                            |
| B5  | In `skipDoseForSlot`, replace `const skipAt = rows.get(forSlotIso)?.skipAt ?? null;` with `const skipAt: string                                                                      | null = forSlotIso;`, which trusts the page                                                         | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "Skip"`                                                                                                                                     | `skips a slot still ahead at the server's min(slot, now)…`, `refuses a second Skip at one slot…`, `refuses a stale Skip…`, `refuses to skip a slot Took it at already resolved`, `refuses a pre-deploy page's takenAt-only Skip on a slot still ahead…` |
| B6  | In `lockSlotMedication`, delete the `if (med.isArchived) { … }` block                                                                                                                | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "archived"`                              | both `finds nothing to honour on an archived medication…` cases, and `finds no target on an archived medication…`                                                                                     |
| B7  | In `lockSlotMedication`, delete `.for("update")`                                                                                                                                     | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "locks the medication once"`             | `Log now locks…`, `Took it at locks…`, `Skip locks…`                                                                                                                                                  |
| B8  | In `logDoseAtSlot`, move the `const [existing] = await tx.select({ id: doseLogs.id })…limit(1);` statement above `const med = await lockSlotMedication(…)`                           | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "Took it at locks the medication once"`  | `Took it at locks the medication once, before any dose_logs statement`                                                                                                                                |
| B9  | In `skipDoseForSlot`, move `const loggedAt = new Date();` to the line above `return dbTx.transaction(`. Then do the same in `logDoseAtSlot`, then in `logDoseForSlot`, one at a time | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "loggedAt"`                              | `Skip's loggedAt`, then `Took it at's loggedAt`, then `Log now's loggedAt, while takenAt keeps the action's now`. Each reads `TAP`, not `LATER`.                                                      |
| B10 | In `recomputeSlotActions`'s dose read, delete `eq(doseLogs.medicationId, med.id),`                                                                                                   | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "not refused by the other's taken dose"` | `Skip for one is not refused by the other's taken dose at that instant`                                                                                                                               |

---

#### Cycle C: the dashboard actions route Took it at and Skip to the new writes

- [ ] **Step 13: Write the failing tests in `tests/unit/dashboard-dose-actions.test.ts`**

Tasks 2 and 3 changed this file's delete and restore parts. Leave those untouched.

**(a)** Replace

```ts
const logSkippedDose = vi.fn(async (..._args: unknown[]) => "dose-skipped");
```

with

```ts
const logSkippedDose = vi.fn(async (..._args: unknown[]) => "dose-skipped");
const logDoseAtSlot = vi.fn(async (..._args: unknown[]) => ({ id: "dose-at-slot" }));
const skipDoseForSlot = vi.fn(async (..._args: unknown[]) => "dose-skipped-for-slot");
```

In the comment above those declarations, replace `a row for the two taken writes, an id string for a skip.` with `a row for each taken write, an id string for each skip.`

**(b)** In the `vi.mock("$lib/server/doses", () => ({ … }))` factory, replace

```ts
  logSkippedDose: (...args: unknown[]) => logSkippedDose(...args),
```

with

```ts
  logSkippedDose: (...args: unknown[]) => logSkippedDose(...args),
  logDoseAtSlot: (...args: unknown[]) => logDoseAtSlot(...args),
  skipDoseForSlot: (...args: unknown[]) => skipDoseForSlot(...args),
```

**(c)** In `beforeEach`, replace

```ts
logSkippedDose.mockClear();
```

with

```ts
logSkippedDose.mockClear();
logDoseAtSlot.mockClear();
skipDoseForSlot.mockClear();
```

**(d)** Replace the `describe("dashboard logDose action", () => { … });` block and the `describe("dashboard skipDose action", () => { … });` block with the two blocks below. Replace each from its `describe(` line to its matching closing `});`. Every other `describe` stays as it is.

```ts
describe("dashboard logDose action", () => {
  it("routes forSlot to logDoseForSlot with the request's clock and the user's zone", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toEqual({ success: true, doseId: "dose-log-now" });
    expect(logDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      NOW,
      "UTC",
    );
    expect(logDose).not.toHaveBeenCalled();
  });

  it("answers 409 when the Log-now target moved between render and tap (14:00 drawn at 18:50, posted at 19:05)", async () => {
    // At 18:50 a dose logged now counted for 14:00. At 19:05 the 20:00 slot
    // is within the hour and takes it. The recompute is logDoseForSlot's
    // (proven on PGlite in pg/dose-slot-writes.test.ts); this test pins what
    // the action does with the refusal.
    logDoseForSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("What's due has changed. Refresh to see what's due now.");
  });

  it("keeps the existing 404 shape when Log now's medication is gone", async () => {
    logDoseForSlot.mockRejectedValueOnce(new MedicationNotFoundError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    });
  });

  it("writes Took it at through logDoseAtSlot with the request's clock and zone, never the posted quantity", async () => {
    // Took it at is always ×1 (spec D9): the simulation proved a probe of one
    // dose, and a larger one could resolve rows it never checked.
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "3",
      takenAt: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toEqual({ success: true, doseId: "dose-at-slot" });
    expect(logDoseAtSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      undefined,
      undefined,
      NOW,
      "UTC",
    );
    expect(logDose).not.toHaveBeenCalled();
  });

  it("hands Took it at the posted notes and side effects", async () => {
    await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
      notes: "with food",
      sideEffects: JSON.stringify([{ name: "Nausea", severity: "mild" }]),
    });

    expect(logDoseAtSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      "with food",
      [{ name: "Nausea", severity: "mild" }],
      NOW,
      "UTC",
    );
  });

  it("answers 409 with no analytics when Took it at's instant already holds a taken dose", async () => {
    // Only a stale page offers this button there. Answering success would
    // hand its toast an Undo for the other record.
    logDoseAtSlot.mockRejectedValueOnce(new SlotAlreadyTakenError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({
      status: 409,
      data: { errors: { form: ["This dose is already logged as taken. Refresh to see it."] } },
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("answers 409 with no analytics when Took it at's row no longer offers it — a second device resolved the slot", async () => {
    logDoseAtSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({
      status: 409,
      data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("refuses a takenAt after now with a 400 on the field, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T19:05:00.001Z",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("That time hasn't happened yet.");
    expect(logDose).not.toHaveBeenCalled();
    expect(logDoseAtSlot).not.toHaveBeenCalled();
  });

  it("refuses a takenAt the dashboard no longer shows with a 409, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-15T23:59:59.999Z",
    });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe(
      "This dose has moved off your dashboard. Refresh to see what's due now.",
    );
    expect(logDose).not.toHaveBeenCalled();
    expect(logDoseAtSlot).not.toHaveBeenCalled();
  });

  it("rejects takenAt and forSlot together with a 400, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("Send takenAt or forSlot, not both");
    expect(logDose).not.toHaveBeenCalled();
    expect(logDoseForSlot).not.toHaveBeenCalled();
    expect(logDoseAtSlot).not.toHaveBeenCalled();
  });

  it("logs a chip dose exactly as before when neither is sent", async () => {
    const res = await logDoseAction({ medicationId: "m1", quantity: "2" });

    expect(res).toEqual({ success: true, doseId: "dose-logged" });
    expect(logDose).toHaveBeenCalledWith("u1", "m1", 2, undefined, undefined, undefined);
    expect(logDoseAtSlot).not.toHaveBeenCalled();
  });
});

describe("dashboard skipDose action", () => {
  it("answers 400, not 404, when medicationId is missing", async () => {
    const res = await skipDoseAction({});

    expect(res).toMatchObject({ status: 400 });
    expect(logSkippedDose).not.toHaveBeenCalled();
    expect(skipDoseForSlot).not.toHaveBeenCalled();
  });

  it("skips at now through the legacy door when neither forSlot nor takenAt is sent", async () => {
    const res = await skipDoseAction({ medicationId: "m1" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped" });
    expect(logSkippedDose).toHaveBeenCalledWith("u1", "m1");
    expect(skipDoseForSlot).not.toHaveBeenCalled();
  });

  it("routes forSlot to skipDoseForSlot with the request's clock and the user's zone", async () => {
    const res = await skipDoseAction({ medicationId: "m1", forSlot: "2026-04-16T14:00:00.000Z" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped-for-slot" });
    expect(skipDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      NOW,
      "UTC",
    );
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("sends a forSlot still ahead to the server's re-check, not to a 'future' 400", async () => {
    // A due-now row's slot can be up to an hour ahead. The skip lands at the
    // server's min(slot, now), so a slot in the future is expected here, and
    // only the re-derivation may refuse it.
    const res = await skipDoseAction({ medicationId: "m1", forSlot: "2026-04-16T19:30:00.000Z" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped-for-slot" });
    expect(skipDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T19:30:00.000Z"),
      NOW,
      "UTC",
    );
  });

  it("hands a pre-deploy page's takenAt-only Skip to skipDoseForSlot as the slot", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00:00.000Z" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped-for-slot" });
    expect(skipDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      NOW,
      "UTC",
    );
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("answers a legacy takenAt the row no longer offers with a 409, not the old 400", async () => {
    // A pre-deploy page's Skip on a slot still ahead posted its render-time
    // instant, which names no slot. skipDoseForSlot refuses it.
    skipDoseForSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T18:50:00.000Z" });

    expect(res).toMatchObject({
      status: 409,
      data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
    });
  });

  it("answers 409 when the row no longer offers Skip — the page was stale", async () => {
    skipDoseForSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await skipDoseAction({ medicationId: "m1", forSlot: "2026-04-16T14:00:00.000Z" });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("What's due has changed. Refresh to see what's due now.");
  });

  it("rejects forSlot and takenAt together with a 400, writing nothing", async () => {
    const res = await skipDoseAction({
      medicationId: "m1",
      takenAt: "2026-04-16T14:00:00.000Z",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("Send takenAt or forSlot, not both");
    expect(skipDoseForSlot).not.toHaveBeenCalled();
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("rejects a forSlot or takenAt that is not an ISO instant", async () => {
    for (const field of ["forSlot", "takenAt"]) {
      const res = await skipDoseAction({ medicationId: "m1", [field]: "2026-04-16T14:00" });
      expect(res, field).toMatchObject({ status: 400 });
    }
    expect(skipDoseForSlot).not.toHaveBeenCalled();
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("keeps the existing 404 shape for a medication that is gone, on either door", async () => {
    skipDoseForSlot.mockRejectedValueOnce(new MedicationNotFoundError());
    expect(
      await skipDoseAction({ medicationId: "m1", forSlot: "2026-04-16T14:00:00.000Z" }),
    ).toMatchObject({ status: 404, data: { error: "Medication not found" } });

    logSkippedDose.mockRejectedValueOnce(new MedicationNotFoundError());
    expect(await skipDoseAction({ medicationId: "m1" })).toMatchObject({
      status: 404,
      data: { error: "Medication not found" },
    });
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-dose-actions.test.ts`

Expected: FAIL. The action still calls `logDose(…, { exactInstantGuard: true })` for Took it at, and ignores `forSlot` on Skip.

- The Took it at cases fail with `AssertionError: expected "spy" to be called with arguments: [ 'u1', 'm1', … ]`, or `expected { success: true, doseId: 'dose-logged' } to deeply equal { success: true, doseId: 'dose-at-slot' }`. Both 409 cases fail because the rejection is queued on `logDoseAtSlot`, which is never called.
- The `forSlot` Skip cases fail with `doseId: 'dose-skipped'` instead of `'dose-skipped-for-slot'`.
- "sends a forSlot still ahead…" fails the same way.
- "hands a pre-deploy page's takenAt-only Skip…" fails because the call goes to `logSkippedDose`.
- "answers a legacy takenAt the row no longer offers with a 409…" fails because the old code accepts the write. `18:50` passes `checkSlotActionTime` (it is before `NOW`, and after today's `visibleStart`), so the action reaches `logSkippedDose` and returns `success` instead of 409.

- [ ] **Step 15: Write minimal implementation**

In `src/routes/(app)/dashboard/+page.server.ts`:

**(a)** In the `import { … } from "$lib/server/doses";` block, replace `  logDoseForSlot,` with

```ts
  logDoseForSlot,
  logDoseAtSlot,
```

and replace `  logSkippedDose,` with

```ts
  logSkippedDose,
  skipDoseForSlot,
```

**(b)** In the `logDose` action, replace

```ts
      } else if (at) {
        // "Took it at HH:MM": the slot's own instant. The guard refuses an
        // instant that already holds a taken dose, so a double tap is one row
        // and one decrement, and a stale page is told to refresh.
        const row = await logDose(user.id, medicationId, quantity, at, notes, sideEffects, {
          exactInstantGuard: true,
        });
        doseId = row.id;
```

with

```ts
      } else if (at) {
        // "Took it at HH:MM": the slot's own instant. `logDoseAtSlot` locks
        // the medication, re-derives this row's buttons and writes ×1 only if
        // the row still offers Took it at this instant. So a double tap, a
        // second device's stale page or a skip-resolved slot is told to
        // refresh. The posted `quantity` is not read (spec D9).
        const row = await logDoseAtSlot(
          user.id,
          medicationId,
          at,
          notes,
          sideEffects,
          now,
          user.timezone,
        );
        doseId = row.id;
```

**(c)** In the `skipDose` action, replace

```ts
    const { medicationId, takenAt } = parsed.data;
    const now = new Date();
    const at = takenAt ? new Date(takenAt) : undefined;

    if (at) {
      const problem = checkSlotActionTime(at, now, user.timezone);
      if (problem) return slotTimeFailure(problem);
    }

    let doseId: string;
    try {
      // With an instant, this is the row's own Skip (its `skipAt`), so it is
      // refused over a taken dose or an existing skip at that instant.
      // Without one it is the legacy skip-at-now.
      doseId = at
        ? await logSkippedDose(user.id, medicationId, at, { exactInstantGuard: true })
        : await logSkippedDose(user.id, medicationId);
    } catch (err) {
```

with

```ts
    const { medicationId, takenAt, forSlot } = parsed.data;
    const now = new Date();

    let doseId: string;
    try {
      if (forSlot) {
        // The row's own Skip. `skipDoseForSlot` locks the medication,
        // re-derives the row's buttons and writes the skip at the SERVER's
        // `min(slot, now)`. There is no `checkSlotActionTime` here: a due-now
        // slot is legitimately still ahead, and a row that is resolved or off
        // the dashboard is simply not offered.
        doseId = await skipDoseForSlot(
          user.id,
          medicationId,
          new Date(forSlot),
          now,
          user.timezone,
        );
      } else if (takenAt) {
        // legacy pre-deploy page; see spec D9; delete one release after.
        // That page posted the row's `skipAt`, which is the slot's own
        // instant exactly when the slot is past. So checking it as the slot
        // accepts every past-slot Skip and refuses the rest with a 409.
        doseId = await skipDoseForSlot(
          user.id,
          medicationId,
          new Date(takenAt),
          now,
          user.timezone,
        );
      } else {
        // The legacy skip-at-now.
        doseId = await logSkippedDose(user.id, medicationId);
      }
    } catch (err) {
```

The `catch` body below it is unchanged. It still maps `MedicationNotFoundError` → 404 `{ error: "Medication not found" }`, and `SlotAlreadyTakenError` / `SlotTargetChangedError` → 409 with their form copy. `checkSlotActionTime` and `slotTimeFailure` are still used by the `logDose` action, so keep their imports.

- [ ] **Step 16: Run test to verify it passes**

Run: `npx vitest run tests/unit/dashboard-dose-actions.test.ts`

Expected: PASS, including the Task 2/3 delete and restore cases.

- [ ] **Step 17: Prove by mutation**

Every mutation is in `src/routes/(app)/dashboard/+page.server.ts`. Restore each one, then re-run. Expected after each restore: PASS.

| #   | Break this                                                                                                                                                                                                     | Command                                                                                   | Test that must fail                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| C1  | In the `logDose` action's `else if (at)` branch, replace the `logDoseAtSlot(…)` call with `logDose(user.id, medicationId, quantity, at, notes, sideEffects)`. This is the "pass the posted quantity" mutation. | `npx vitest run tests/unit/dashboard-dose-actions.test.ts -t "never the posted quantity"` | `writes Took it at through logDoseAtSlot with the request's clock and zone, never the posted quantity` |
| C2  | In `logDoseAtSlot(…)`'s call, replace `notes,` with `undefined,`                                                                                                                                               | `npx vitest run tests/unit/dashboard-dose-actions.test.ts -t "posted notes"`              | `hands Took it at the posted notes and side effects`                                                   |
| C3  | Change `if (forSlot) {` to `if (false) {` in `skipDose`                                                                                                                                                        | `npx vitest run tests/unit/dashboard-dose-actions.test.ts -t "forSlot"`                   | `routes forSlot to skipDoseForSlot…`, `sends a forSlot still ahead…`                                   |
| C4  | Insert `const problem = checkSlotActionTime(new Date(forSlot), now, user.timezone); if (problem) return slotTimeFailure(problem);` as the first line inside `if (forSlot) {`                                   | `npx vitest run tests/unit/dashboard-dose-actions.test.ts -t "still ahead"`               | `sends a forSlot still ahead to the server's re-check, not to a 'future' 400`                          |
| C5  | In the `else if (takenAt)` branch, replace the `skipDoseForSlot(…)` call with `logSkippedDose(user.id, medicationId, new Date(takenAt))`                                                                       | `npx vitest run tests/unit/dashboard-dose-actions.test.ts -t "pre-deploy"`                | `hands a pre-deploy page's takenAt-only Skip to skipDoseForSlot as the slot`                           |

---

#### Cycle D: remove the exact-instant guard from `logDose` and `logSkippedDose`

Nothing passes `exactInstantGuard` any more. This cycle deletes it, in line with the spec: "`exactInstantGuard` is removed from `logDose` and `logSkippedDose`, because the new functions replace it."

- [ ] **Step 18: Replace `logDose` and `logSkippedDose`**

In `src/lib/server/doses.ts`, replace the whole `logDose` function with the code below. The block runs from `export async function logDose(` to its closing `}`, the one after `  return dose;` or after the `dbTx.transaction` call it returns.

The listing keeps Task 4's behaviour exactly:

- the medication read always locks;
- `loggedAt` is read after the lock;
- `takenAt` defaults to the `now` read before the transaction.

It drops the `opts` parameter and the `if (guard) { … }` block. A missing medication still throws `MedicationNotFoundError` from the locked read inside the transaction, as Task 4 left it.

```ts
/**
 * A taken dose with no slot to prove: the Quick Log chips, the 1–9 keys, the
 * medications card and `/api/v1 log_dose`. The dashboard's Took it at is
 * `logDoseAtSlot`, and Log now is `logDoseForSlot`.
 */
export async function logDose(
  userId: string,
  medicationId: string,
  quantity: number,
  takenAt?: Date,
  notes?: string,
  sideEffects?: SideEffect[],
) {
  const now = new Date();
  const at = takenAt ?? now;

  // Insert + inventory decrement + audit log all happen inside a single
  // transaction so logDose is all-or-nothing: on any throw, nothing —
  // including the audit row — is durably committed. This is required by
  // runCommands' reserve-first idempotency (see commands.ts), which relies
  // on "handler threw" meaning "safe to retry" for every command handler.
  return dbTx.transaction(async (tx) => {
    // D7: lock the medication before anything touches its doses or its stock.
    // The dose is measured against the count read here: the inventory event
    // records both ends of the change, and the row stores how much it
    // ACTUALLY removed, which is not `quantity` whenever the clamp engages.
    // So nothing may move the count between this read and the write.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    if (!med) throw new MedicationNotFoundError(medicationId);
    // D7: the clock that orders writes is read after the lock.
    const loggedAt = new Date();

    return insertTakenDose(tx, {
      userId,
      medicationId,
      quantity,
      takenAt: at,
      loggedAt,
      notes: notes ?? null,
      sideEffects: sideEffects ?? null,
      previousCount: med.inventoryCount,
    });
  });
}
```

Replace the whole `logSkippedDose` function, from `export async function logSkippedDose(` to its closing `}`, with:

```ts
/**
 * A skip at `takenAt` (default: now), with no slot to prove: the dashboard's
 * legacy skip-at-now and `/api/v1 skip_dose`. The dashboard's row Skip is
 * `skipDoseForSlot`.
 */
export async function logSkippedDose(
  userId: string,
  medicationId: string,
  takenAt?: Date,
): Promise<string> {
  const now = new Date();
  const at = takenAt ?? now;

  // Insert + audit log in a single transaction so logSkippedDose is
  // all-or-nothing (see logDose above for why this matters for
  // runCommands' reserve-first idempotency).
  return dbTx.transaction(async (tx) => {
    // D7: every dose insert locks its medication first, so the `loggedAt`
    // below is ordered against every other write to it.
    const [med] = await tx
      .select({ id: medications.id })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    if (!med) throw new MedicationNotFoundError(medicationId);
    const loggedAt = new Date();

    const id = createId();
    await tx.insert(doseLogs).values({
      id,
      userId,
      medicationId,
      quantity: 1,
      takenAt: at,
      loggedAt,
      notes: null,
      sideEffects: null,
      status: "skipped",
    });
    await logAudit(userId, "dose_log", id, "create", undefined, tx);
    return id;
  });
}
```

Then run

```bash
grep -n "assertMedicationBelongsToUser" src/lib/server/doses.ts
```

Expected: no output, because Task 4 Step 8 deleted it. If it still prints anything, delete the function (its whole body, down to its closing `}`); nothing calls it.

- [ ] **Step 19: Rewrite the two error classes' doc comments**

In `src/lib/server/doses.ts`, replace the doc comment above `export class SlotAlreadyTakenError extends Error {` (everything from its `/**` to its `*/`) with:

```ts
/**
 * Took it at was posted for an instant that already holds a TAKEN dose of
 * this medication.
 *
 * Only `logDoseAtSlot` throws it, before it re-derives the row's buttons. A
 * fresh page never offers Took it at on such an instant (pass 0 resolves that
 * slot), so the tap came from a stale page, usually a double tap. The
 * re-derivation would refuse it too, as SlotTargetChangedError. This check
 * runs first so the answer is the specific "refresh, it's already logged".
 */
```

Replace the doc comment above `export class SlotTargetChangedError extends Error {` with:

```ts
/**
 * The button that was tapped no longer names what the tap would do.
 *
 * Every guarded dashboard write re-derives the medication's `slotActions`
 * under the medication lock, and throws this when the posted slot no longer
 * offers its button:
 *
 * - Log now (`logDoseForSlot`) when the target moved;
 * - Took it at (`logDoseAtSlot`) or Skip (`skipDoseForSlot`) when the row is
 *   resolved, gone, or no longer offers that action.
 *
 * Causes: render-to-tap drift, a page left open across midnight, the 12h
 * expiry, a double tap, a second device. None of them writes anything.
 */
```

- [ ] **Step 20: Remove every remaining guarded call from the tests**

Run

```bash
grep -rn "exactInstantGuard" src tests
```

Expected: no hits in `src/`. After Cycles B and C, `tests/unit/pg/dose-slot-writes.test.ts` and `tests/unit/dashboard-dose-actions.test.ts` have none either.

If `tests/unit/pg/dose-writer-locks.test.ts` (Task 4) still has hits:

1. Delete each `it(…)` case whose call passes `{ exactInstantGuard: true }` (or a `GUARD` constant equal to it).
2. Delete the `GUARD` constant if nothing else uses it.

The guarded skip and log paths no longer exist. Their lock-order and clock-after-lock pins now live in `dose-slot-writes.test.ts`, as the "Took it at …" and "Skip …" cases under "the medication row lock" and "the clock that orders writes is read after the lock (D7)". Keep every unguarded `logDose` / `logSkippedDose` case there.

Run: `npx vitest run tests/unit/pg/`

Expected: PASS. That covers every PGlite file, including Task 4's `dose-writer-locks.test.ts`, `dose-inventory-symmetry.test.ts`, `low-inventory-episode.test.ts` and this task's `dose-slot-writes.test.ts`.

- [ ] **Step 21: Prove by mutation**

| #   | Break this                            | Command                                                                        | Test that must fail                                                    |
| --- | ------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| D1  | In `logDose`, delete `.for("update")` | `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "chip's dose locks"` | `a chip's dose locks the medication too — every dose insert does (D7)` |

Restore it, then re-run. Expected: PASS.

---

#### Cycle E: the Due card's Skip posts `forSlot`

- [ ] **Step 22: Write the failing test**

In `tests/unit/due-card-ssr.test.ts`, replace

```ts
it("Skip posts the shipped skipAt verbatim — for a slot still ahead, that is now", () => {
  const form = formOf(buttonNamed(renderCard(TODAY_CARD), "Skip: Metformin 500mg, 13:30 dose"));
  expect(form.getAttribute("action")).toBe("?/skipDose");
  expect(hiddenFields(form)).toEqual({ medicationId: "m1", takenAt: "2026-05-01T13:00:00.000Z" });
});
```

with

```ts
it("Skip posts the row's own slot as forSlot, never an instant — the server decides where it lands", () => {
  // The top row's skipAt is 13:00 (now: a skip is never future-dated), but
  // the page no longer chooses that instant. It names the slot, and
  // skipDoseForSlot writes the skip at the server's min(slot, now).
  const form = formOf(buttonNamed(renderCard(TODAY_CARD), "Skip: Metformin 500mg, 13:30 dose"));
  expect(form.getAttribute("action")).toBe("?/skipDose");
  expect(hiddenFields(form)).toEqual({ medicationId: "m1", forSlot: "2026-05-01T13:30:00.000Z" });
});

it("Skip on a past row posts that row's slot as forSlot", () => {
  const form = formOf(buttonNamed(renderCard(TODAY_CARD), "Skip: Metformin 500mg, 11:00 dose"));
  expect(hiddenFields(form)).toEqual({ medicationId: "m1", forSlot: "2026-05-01T11:00:00.000Z" });
});

it("offers Skip only where the row's skipAt is set, even though it posts the slot", () => {
  const card: DueCardData = {
    ...OVERDUE_CARD,
    rows: [row("2026-05-01T11:00:00.000Z", { skipAt: null })],
  };
  const names = [...renderCard(card).querySelectorAll("button")].map(accessibleName);
  expect(names).toEqual(["Took it at 11:00: Metformin 500mg"]);
});
```

- [ ] **Step 23: Run test to verify it fails**

Run: `npx vitest run tests/unit/due-card-ssr.test.ts -t "Skip"`

Expected: FAIL.

- "Skip posts the row's own slot as forSlot…" fails: `expected { medicationId: 'm1', takenAt: '2026-05-01T13:00:00.000Z' } to deeply equal { medicationId: 'm1', forSlot: '2026-05-01T13:30:00.000Z' }`.
- "Skip on a past row…" fails the same way, with `takenAt: '2026-05-01T11:00:00.000Z'`.
- "offers Skip only where the row's skipAt is set…" already passes. It is the guard for mutation E2.

- [ ] **Step 24: Write minimal implementation**

In `src/lib/components/dashboard/DueCard.svelte`, replace

```svelte
fields={{ medicationId: card.medicationId, takenAt: row.skipAt }}
```

with

```svelte
fields={{ medicationId: card.medicationId, forSlot: row.expectedTime }}
```

Leave the surrounding `{#if row.skipAt !== null}` and the `undoable` prop as they are.

In `src/lib/types.ts`, replace

```ts
/**
 * One outstanding slot on a Due card. `tookItAt` / `skipAt` are the exact
 * instants those buttons post, or null when the row does not offer them —
 * decided by simulation in `slotActions`, never by the component.
 */
```

with

```ts
/**
 * One outstanding slot on a Due card. `tookItAt` is the exact instant Took it
 * at posts; `skipAt` is where a Skip would land (`min(slot, now)` at render).
 * Either is null when the row does not offer that button — decided by
 * simulation in `slotActions`, never by the component. Skip posts the row's
 * `expectedTime` as `forSlot`, and the server re-derives where the skip lands
 * (`skipDoseForSlot`).
 */
```

- [ ] **Step 25: Run test to verify it passes**

Run: `npx vitest run tests/unit/due-card-ssr.test.ts`

Expected: PASS for every case, including the axe and tab-order cases. The Skip buttons' names are unchanged.

- [ ] **Step 26: Prove by mutation**

Every mutation is in `src/lib/components/dashboard/DueCard.svelte`. Restore each one, then re-run. Expected after each restore: PASS.

| #   | Break this                                                                                    | Command                                                                | Test that must fail                                                                                                  |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| E1  | `forSlot: row.expectedTime` → `takenAt: row.skipAt`                                           | `npx vitest run tests/unit/due-card-ssr.test.ts -t "forSlot"`          | `Skip posts the row's own slot as forSlot, never an instant…`, `Skip on a past row posts that row's slot as forSlot` |
| E2  | `{#if row.skipAt !== null}` (the one directly above the Skip `DoseActionForm`) → `{#if true}` | `npx vitest run tests/unit/due-card-ssr.test.ts -t "offers Skip only"` | `offers Skip only where the row's skipAt is set, even though it posts the slot`                                      |

---

#### Cycle F: the auth-guard mocks

- [ ] **Step 27: Update `tests/unit/app-action-auth-guard.test.ts`**

In the `vi.mock("$lib/server/doses", () => ({ … }))` factory, replace

```ts
  logSkippedDose: never("logSkippedDose"),
```

with

```ts
  logSkippedDose: never("logSkippedDose"),
  logDoseAtSlot: never("logDoseAtSlot"),
  skipDoseForSlot: never("skipDoseForSlot"),
```

No `CASES` entry changes:

- This task adds no action, so "covers every action defined under (app)" needs no new case.
- The existing `skipDose` body `{ medicationId: "m1" }` still passes `doseSkipSchema`.
- `logDose`'s `{ medicationId: "m1" }` still passes `doseLogSchema`.

Run: `npx vitest run tests/unit/app-action-auth-guard.test.ts`

Expected: PASS.

---

- [ ] **Step 28: Run the task's full suite**

```bash
npx prettier --write src/lib/server/doses.ts src/lib/utils/validation.ts "src/routes/(app)/dashboard/+page.server.ts" src/lib/components/dashboard/DueCard.svelte src/lib/types.ts tests/unit/pg/dose-slot-writes.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/due-card-ssr.test.ts tests/unit/validation.test.ts tests/unit/app-action-auth-guard.test.ts
npx vitest run tests/unit/pg/dose-slot-writes.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/due-card-ssr.test.ts tests/unit/validation.test.ts tests/unit/app-action-auth-guard.test.ts
npx vitest run
npm run check
npm run lint
npx prettier --check src tests
grep -rn "exactInstantGuard" src tests
```

Expected:

- **Prettier:** it may re-wrap long `it(…)` titles and call sites. It changes nothing else.
- **The five task files:** PASS. `dose-slot-writes` has 37 tests.
- **The whole unit suite:** PASS. `tests/unit/api/commands.test.ts`, `pg/dose-inventory-symmetry.test.ts`, `pg/low-inventory-episode.test.ts` and Task 4's `pg/dose-writer-locks.test.ts` all call `logDose`/`logSkippedDose` without `opts` and stay green.
- **`npm run check`:** no new errors or warnings compared with the count before this task. That is 0 errors where `@electric-sql/pglite` resolves.
  - A leftover `{ exactInstantGuard: true }` argument anywhere shows up here as `Expected 1-6 arguments, but got 7` or `Expected 2-3 arguments, but got 4`. Fix it as in Step 20.
- **`npm run lint`:** 0 errors and no new warnings.
- **`npx prettier --check src tests`:** `All matched files use Prettier code style!` The repo-wide `npm run format:check` is Task 14's gate: it also checks the untracked plan document under `docs/superpowers/`, which fails it today.
- **The final `grep`:** prints nothing.

- [ ] **Step 29: Commit**

```bash
git add src/lib/server/doses.ts src/lib/utils/validation.ts "src/routes/(app)/dashboard/+page.server.ts" src/lib/components/dashboard/DueCard.svelte src/lib/types.ts tests/unit/pg/dose-slot-writes.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/due-card-ssr.test.ts tests/unit/validation.test.ts tests/unit/app-action-auth-guard.test.ts
# only if Step 20 edited it:
git add tests/unit/pg/dose-writer-locks.test.ts
git commit -m "feat(dashboard): re-derive Took it at and Skip under the medication lock

Took it at (logDoseAtSlot) and Skip (skipDoseForSlot) now lock the
medication, re-run slotActions on rows read inside the transaction and
write only if the tapped row still offers that button, the same rule
Log now already followed (recomputeSlotActions, shared by all three).

A stale second device can no longer add a second taken dose or a skip
to a slot another device already resolved. Took it at is always x1 and
is refused over a skip-resolved slot. Skip posts forSlot and lands at
the server's min(slot, now); a pre-deploy page's takenAt-only Skip is
accepted for one release when it names a past slot, otherwise 409.

logDose and logSkippedDose lose exactInstantGuard."
```

---

### Task 7: The dose-writes foundations and the layout-owned lock

This task builds the client plumbing every later client task stands on. It adds no new user-visible behaviour except version polling. It:

- moves the write lock, the focus helper and the dose-write copy into `src/lib/components/dose-writes/`;
- makes the `(app)` layout the lock's only owner (spec D10), so the dashboard stops creating its own;
- adds `reloadAfterWrite()`, the one reload path later tasks use instead of enhance's `update()`;
- seeds the dashboard clock from the page payload without arming a timer, and gives it `isExpired()`;
- turns on `kit.version.pollInterval`, so `updated.current` can tell a stale tab to reload (spec D9).

`DoseActionForm` keeps its current logic in this task (Task 9 rewrites it). Only its imports, its stale guard and its network copy change here.

**Files:**

- Create: `src/lib/components/dose-writes/dose-write-lock.svelte.ts` (moved with `git mv` from `src/lib/components/dashboard/dose-write-lock.svelte.ts`, then gains `active`)
- Create: `src/lib/components/dose-writes/focus-after.ts` (moved with `git mv` from `src/lib/components/dashboard/focus-after.ts`, then gains `opts`, `isFocusLost` and `focusIfLost`)
- Create: `src/lib/components/dose-writes/copy.ts`
- Create: `src/lib/components/dose-writes/reload-after-write.ts`
- Delete: `src/lib/components/dashboard/dose-action.ts` (its constants move to `copy.ts`)
- Modify: `src/lib/components/dashboard/dashboard-clock.ts` (full replacement given below)
- Modify: `src/lib/components/dashboard/DoseActionForm.svelte` (anchor: `import { getDoseWriteLock } from "./dose-write-lock.svelte";`)
- Modify: `src/lib/components/dashboard/DueCard.svelte` (anchor: `import { focusTargetAfterResolve } from "./focus-after";`)
- Modify: `src/routes/(app)/+layout.svelte` (anchor: `let { data, children } = $props();`)
- Modify: `src/routes/(app)/dashboard/+page.svelte` (anchor: `setDoseWriteLock(createDoseWriteLock());`)
- Modify: `svelte.config.js` (anchor: `$server: "src/lib/server",`)
- Modify: `tests/unit/helpers/dashboard-context.ts` (full replacement given below)
- Modify: `tests/unit/helpers/dose-action-form-harness.ts` (anchor: `import type { DoseWriteLock } from "$lib/components/dashboard/dose-write-lock.svelte";`)
- Test (modify): `tests/unit/dose-write-lock.test.ts`, `tests/unit/dashboard-focus.test.ts`, `tests/unit/dashboard-clock.test.ts`, `tests/unit/dose-action-form.test.ts`, `tests/unit/due-card-ssr.test.ts`, `tests/unit/dashboard-page-ssr.test.ts`
- Test (create): `tests/unit/dose-write-lock.svelte.test.ts`, `tests/unit/dose-writes-copy.test.ts`, `tests/unit/reload-after-write.test.ts`, `tests/unit/app-layout-dose-writes.test.ts`, `tests/unit/svelte-config.test.ts`

**Interfaces:**

- Consumes: nothing from Tasks 1–6. This task needs no server change.
- Produces (later tasks rely on these exact names):
  - `src/lib/components/dose-writes/dose-write-lock.svelte.ts`: the same exports as before (`DOSE_WRITE_COOLDOWN_MS`, `DOSE_WRITE_LOCK`, `DoseWriteLock`, `createDoseWriteLock(opts?: { cooldownMs?: number })`, `setDoseWriteLock(lock)`, `getDoseWriteLock()`), plus `readonly active: boolean` on `DoseWriteLock` (`holders > 0`, backed by `$state`, so reactive).
  - `src/lib/components/dose-writes/copy.ts`:
    ```ts
    export const DELETE_ACTION = "/dashboard?/deleteDose";
    export const RESTORE_ACTION = "/dashboard?/restoreDose";
    export const STALE_TAP_MESSAGE = "The list just updated — check it and tap again";
    export const SUCCESS_FALLBACK_TOAST = "Saved";
    export const UNDONE_TOAST = "Undone";
    export const RESTORED_TOAST = "Dose restored";
    export const OFFLINE_WRITE_TOAST = "You're offline — nothing was saved.";
    export const UNKNOWN_OUTCOME_TOAST =
      "Couldn't confirm that saved — this page will update when the connection is back.";
    export const STILL_SAVING_TOAST = "Still saving your last change…";
    export const UNDO_OFFLINE_MESSAGE =
      "You're offline — Undo will still be here when you're back.";
    export const UNDO_NETWORK_MESSAGE =
      "Couldn't reach the server. The undo may not have gone through.";
    ```
  - `src/lib/components/dose-writes/reload-after-write.ts`:
    ```ts
    export const HEALTH_PROBE_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000]; // last value repeats
    export async function waitForServer(): Promise<void>;
    export async function reloadAfterWrite(opts?: { waitForServer?: boolean }): Promise<void>;
    export function reloadDocumentIfUpdated(): boolean;
    ```
  - `src/lib/components/dose-writes/focus-after.ts`:
    ```ts
    export interface FocusTargetOptions {
      attr?: "cardKey" | "doseId";
      precedingKeys?: readonly string[];
      pick?: (row: HTMLElement) => HTMLElement | null;
    }
    export function focusTargetAfterResolve(
      key: string,
      followingKeys: readonly string[],
      opts: FocusTargetOptions = {},
      root: ParentNode = document,
    ): HTMLElement | null;
    export function isFocusLost(): boolean;
    export function focusIfLost(...candidates: Array<() => HTMLElement | null | undefined>): void;
    ```
  - `src/lib/components/dashboard/dashboard-clock.ts`: `createDashboardClock(invalidate: () => Promise<void>, seed?: DashboardClockPayload): DashboardClockController`, and `DashboardClock` gains `isExpired(): boolean` (`serverNowMs() >= refreshAtMs`; `NaN` → false).
  - `src/routes/(app)/+layout.svelte` calls `setDoseWriteLock(createDoseWriteLock())` once per layout instance. Every page under `(app)` and the layout's own `<Toast />` can call `getDoseWriteLock()`.
  - `tests/unit/helpers/dashboard-context.ts`: `export function doseWriteContext(lock: DoseWriteLock = createDoseWriteLock()): Map<symbol, unknown>`; `fixedClock(now, overrides)` gains `isExpired`; `dashboardContext(opts)` keeps its signature.

---

- [ ] **Step 0: Record the `npm run check` baseline**

Run this on the unmodified branch, before any edit in this task:

Run: `npm run check 2>&1 | tail -3`
Expected: a line of the form `svelte-check found N errors and M warnings in K files`. Write N and M down. Step 41 compares against them.

---

#### Cycle A — the lock moves to `dose-writes/` and gains `active`

- [ ] **Step 1: Point the lock's test at the new path and add the `active` cases**

In `tests/unit/dose-write-lock.test.ts`, replace:

```ts
// The dashboard's page-wide dose-write lock, and the DoseActionForm path whose
```

with:

```ts
// The (app) layout's dose-write lock, and the DoseActionForm path whose
```

Replace:

```ts
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dashboard/dose-write-lock.svelte";
```

with:

```ts
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
```

Then, inside `describe("createDoseWriteLock", () => {`, directly after the `it("grants the lock once and refuses it while it is held", …)` case, insert:

```ts
it("is active only while a holder exists — never during the cooldown, which busy still covers", () => {
  // `active` is what separates "still saving your last change" (worth a
  // toast) from a tap that merely came inside the cooldown (not worth one).
  const lock = createDoseWriteLock();
  expect(lock.active).toBe(false);

  lock.acquire();
  expect(lock.active).toBe(true);
  lock.release();
  expect(lock.busy).toBe(true);
  expect(lock.active).toBe(false);

  lock.hold();
  expect(lock.active).toBe(true);
  lock.extend();
  expect(lock.busy).toBe(true);
  expect(lock.active).toBe(false);

  vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
  expect(lock.busy).toBe(false);
  expect(lock.active).toBe(false);
});

it("stays active until the last of two overlapping holders lets go", () => {
  const lock = createDoseWriteLock();
  lock.acquire();
  lock.hold();
  lock.release();
  expect(lock.active).toBe(true);
  lock.extend();
  expect(lock.active).toBe(false);
});
```

Create `tests/unit/dose-write-lock.svelte.test.ts`:

```ts
// `DoseWriteLock.active` must be reactive: a control that renders it has to
// re-render when a write starts and when the last holder lets go. The file
// is `.svelte.test.ts` so that `$effect.root` compiles (the same reason as
// accessible-pickers-focus.svelte.test.ts).
import { describe, it, expect } from "vitest";
import { flushSync } from "svelte";
import { createDoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";

describe("DoseWriteLock.active", () => {
  it("is reactive: an effect that reads it re-runs when a holder arrives and when the last one leaves", () => {
    const lock = createDoseWriteLock({ cooldownMs: 0 });
    const seen: boolean[] = [];
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(lock.active);
      });
    });
    try {
      flushSync();
      lock.acquire();
      flushSync();
      lock.release();
      flushSync();
      expect(seen).toEqual([false, true, false]);
    } finally {
      stop();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/dose-write-lock.test.ts tests/unit/dose-write-lock.svelte.test.ts`
Expected: FAIL. Both files fail to load with `Failed to resolve import "$lib/components/dose-writes/dose-write-lock.svelte"`.

- [ ] **Step 3: Move the lock and add `active`**

```bash
mkdir -p src/lib/components/dose-writes
git mv src/lib/components/dashboard/dose-write-lock.svelte.ts src/lib/components/dose-writes/dose-write-lock.svelte.ts
```

Replace the whole of `src/lib/components/dose-writes/dose-write-lock.svelte.ts` with:

```ts
import { getContext, setContext } from "svelte";

/**
 * How long every dose-writing control stays locked after a write settles. A
 * double tap on Log now lands well inside this, and the second tap would
 * otherwise hit a list that has not re-rendered yet — it would write against
 * whatever row slid under the finger. Exported for tests.
 */
export const DOSE_WRITE_COOLDOWN_MS = 700;

/** Context key. Exported so a test can render a component with a lock of its own. */
export const DOSE_WRITE_LOCK = Symbol("dose-write-lock");

export interface DoseWriteLock {
  /** True while any holder (an `acquire()` write or a `hold()` undo) is active, or during the cooldown after the last one lets go. */
  readonly busy: boolean;
  /**
   * True only while a holder exists — a write or an Undo actually in flight —
   * and false during the cooldown that `busy` also covers. It separates a tap
   * refused because something is still saving (worth saying) from one that
   * merely came too soon after the last write (not worth a toast). Reactive.
   */
  readonly active: boolean;
  /** Take the lock. False when any dose write already holds it, or while it cools down. */
  acquire(): boolean;
  /**
   * Let go of an `acquire()`d hold. A no-op when this caller holds nothing.
   * The cooldown starts only once every concurrent holder (including any
   * `hold()`) has let go — otherwise a write that finishes first would free
   * the lock while a concurrent Undo is still in flight.
   */
  release(): void;
  /**
   * Take the lock unconditionally, even over an in-progress write or a
   * running cooldown — for a write that must never be refused (the toast's
   * Undo). Cancels any cooldown already counting down, so `busy` reads true
   * without interruption until a matching `extend()`. Stacks with any other
   * active holder: each `hold()` needs its own `extend()` to let go.
   */
  hold(): void;
  /**
   * Let go of a `hold()`, and — once every concurrent holder has done the
   * same — start a fresh cooldown from now, replacing whatever cooldown
   * `release()` may already have started. Pairs with `hold()`: an Undo that
   * lands while the write it is undoing is still cooling down must not let
   * that earlier cooldown's deadline decide when the shifted list is safe
   * to tap again — it needs its own full cooldown after its own reload, and
   * that cooldown must not start while another holder is still active.
   */
  extend(): void;
}

/**
 * One lock for every page under the (app) layout, which creates it once per
 * layout instance (spec D10). A write or an Undo can outlive the page that
 * started it, so the page navigated to must read the same lock. While
 * `busy`, every dose control renders `aria-disabled` and cancels its submit —
 * never the `disabled` attribute, which drops keyboard focus to <body>
 * mid-task.
 *
 * `acquire()`/`release()` and `hold()`/`extend()` are two ends of the same
 * reference count, not two independent flags: at most one `acquire()` can
 * succeed at a time (it refuses while `busy`), but `hold()` is unconditional
 * and can stack on top of an active `acquire()` — the toast Undo for an
 * earlier write is exactly that. `busy` stays true, and no cooldown starts,
 * until EVERY active holder has let go via its own `release()`/`extend()`.
 * Without that, whichever holder finishes first would start a cooldown
 * timed from its own completion, and the lock would go free mid-write for
 * whoever is still holding it.
 */
export function createDoseWriteLock(opts: { cooldownMs?: number } = {}): DoseWriteLock {
  const cooldownMs = opts.cooldownMs ?? DOSE_WRITE_COOLDOWN_MS;
  let busy = $state(false);
  /** Count of active holders (each successful `acquire()` or `hold()` call). State, so `active` is reactive. */
  let holders = $state(0);
  let cooldown: ReturnType<typeof setTimeout> | undefined;

  function clearCooldown() {
    if (cooldown === undefined) return;
    clearTimeout(cooldown);
    cooldown = undefined;
  }

  function startCooldown() {
    clearCooldown();
    cooldown = setTimeout(() => {
      cooldown = undefined;
      busy = false;
    }, cooldownMs);
  }

  /** One holder letting go. Starts the cooldown only once none remain. */
  function releaseHolder() {
    if (holders === 0) return;
    holders--;
    if (holders > 0) return;
    if (cooldown !== undefined) return;
    startCooldown();
  }

  return {
    get busy() {
      return busy;
    },
    get active() {
      return holders > 0;
    },
    acquire() {
      if (busy) return false;
      holders++;
      busy = true;
      return true;
    },
    release: releaseHolder,
    hold() {
      clearCooldown();
      holders++;
      busy = true;
    },
    extend() {
      busy = true;
      releaseHolder();
    },
  };
}

/**
 * Call once, during the (app) layout's initialisation — never at module
 * scope, which during SSR is shared by every request the process serves.
 * Tests pass `doseWriteContext()` (tests/unit/helpers/dashboard-context.ts).
 */
export function setDoseWriteLock(lock: DoseWriteLock): void {
  setContext(DOSE_WRITE_LOCK, lock);
}

/** Call during a component's initialisation. Throws when no layout set a lock. */
export function getDoseWriteLock(): DoseWriteLock {
  const lock = getContext<DoseWriteLock | undefined>(DOSE_WRITE_LOCK);
  if (!lock) {
    throw new Error(
      "No dose-write lock in context: the (app) layout must call setDoseWriteLock() (tests: doseWriteContext())",
    );
  }
  return lock;
}
```

Update every other importer of the old path.

In `src/lib/components/dashboard/DoseActionForm.svelte`, replace:

```ts
import { getDoseWriteLock } from "./dose-write-lock.svelte";
```

with:

```ts
import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
```

In `src/routes/(app)/dashboard/+page.svelte`, replace:

```ts
  } from "$components/dashboard/dose-write-lock.svelte";
```

with:

```ts
  } from "$components/dose-writes/dose-write-lock.svelte";
```

In `tests/unit/helpers/dashboard-context.ts`, replace:

```ts
} from "$lib/components/dashboard/dose-write-lock.svelte";
```

with:

```ts
} from "$lib/components/dose-writes/dose-write-lock.svelte";
```

In `tests/unit/helpers/dose-action-form-harness.ts`, replace:

```ts
import type { DoseWriteLock } from "$lib/components/dashboard/dose-write-lock.svelte";
```

with:

```ts
import type { DoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";
```

In `tests/unit/due-card-ssr.test.ts`, replace:

```ts
import { createDoseWriteLock } from "$lib/components/dashboard/dose-write-lock.svelte";
```

with:

```ts
import { createDoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";
```

In `tests/unit/dose-action-form.test.ts`, replace:

```ts
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dashboard/dose-write-lock.svelte";
```

with:

```ts
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
```

Then confirm nothing still names the old path:

Run: `grep -rn "dashboard/dose-write-lock\|\./dose-write-lock" src tests`
Expected: no output.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/dose-write-lock.test.ts tests/unit/dose-write-lock.svelte.test.ts tests/unit/dose-action-form.test.ts tests/unit/due-card-ssr.test.ts tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts tests/unit/done-list-ssr.test.ts tests/unit/dashboard-page-ssr.test.ts`
Expected: PASS, every file.

- [ ] **Step 5: Prove by mutation**
  1. In `src/lib/components/dose-writes/dose-write-lock.svelte.ts`, change `return holders > 0;` to `return busy;`.
     Run: `npx vitest run tests/unit/dose-write-lock.test.ts`
     Expected: FAIL in `is active only while a holder exists — never during the cooldown, which busy still covers`. Restore the line.
  2. Change `let holders = $state(0);` to `let holders = 0;`.
     Run: `npx vitest run tests/unit/dose-write-lock.svelte.test.ts`
     Expected: FAIL in `is reactive: an effect that reads it re-runs when a holder arrives and when the last one leaves` (it sees `[false]`). Restore the line.
  3. Re-run both files: PASS.

---

#### Cycle B — `dose-writes/copy.ts` replaces `dashboard/dose-action.ts`

- [ ] **Step 6: Write the failing copy test**

Create `tests/unit/dose-writes-copy.test.ts`:

```ts
// @vitest-environment node
//
// Every dose write on every page takes its endpoints and copy from
// dose-writes/copy.ts, and later tasks import them rather than restate them.
// The strings are the spec's and the plan's, verbatim. They are pinned here so
// that changing one is a decision, not a drift. `toEqual` on the namespace
// also pins the export list: a constant added without a decision fails too.
import { describe, it, expect } from "vitest";
import * as copy from "$lib/components/dose-writes/copy";

describe("dose-writes copy", () => {
  it("says exactly what the spec says, and nothing else", () => {
    expect({ ...copy }).toEqual({
      DELETE_ACTION: "/dashboard?/deleteDose",
      RESTORE_ACTION: "/dashboard?/restoreDose",
      STALE_TAP_MESSAGE: "The list just updated — check it and tap again",
      SUCCESS_FALLBACK_TOAST: "Saved",
      UNDONE_TOAST: "Undone",
      RESTORED_TOAST: "Dose restored",
      OFFLINE_WRITE_TOAST: "You're offline — nothing was saved.",
      UNKNOWN_OUTCOME_TOAST:
        "Couldn't confirm that saved — this page will update when the connection is back.",
      STILL_SAVING_TOAST: "Still saving your last change…",
      UNDO_OFFLINE_MESSAGE: "You're offline — Undo will still be here when you're back.",
      UNDO_NETWORK_MESSAGE: "Couldn't reach the server. The undo may not have gone through.",
    });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/unit/dose-writes-copy.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dose-writes/copy"`.

- [ ] **Step 8: Create `copy.ts`, switch its importers, delete `dose-action.ts`**

Create `src/lib/components/dose-writes/copy.ts`:

```ts
/**
 * Endpoints and copy for every dose write, on every page. Plain constants, so
 * a test imports them without rendering anything.
 */

/**
 * Absolute, not `?/deleteDose`: the toast that offers an Undo lives in the
 * (app) layout and outlives navigation, so a relative action would post to
 * whichever page the user has moved to.
 */
export const DELETE_ACTION = "/dashboard?/deleteDose";

/** Absolute for the same reason as DELETE_ACTION: a delete's Undo can be pressed from any page. */
export const RESTORE_ACTION = "/dashboard?/restoreDose";

/** The client-side stale guard: the payload expired before the tap. The server's own check is the authority. */
export const STALE_TAP_MESSAGE = "The list just updated — check it and tap again";

/** The success toast when the caller supplied no builder, or its builder had nothing to say. */
export const SUCCESS_FALLBACK_TOAST = "Saved";

/** After a create's Undo removed the dose. */
export const UNDONE_TOAST = "Undone";

/** After a delete's Undo put the dose back. */
export const RESTORED_TOAST = "Dose restored";

/** A write refused before it was sent, because the device is offline. Nothing was posted. */
export const OFFLINE_WRITE_TOAST = "You're offline — nothing was saved.";

/**
 * A write whose request never completed, so it may or may not have landed.
 * The page reloads itself once the server answers again, and dose controls
 * stay locked until it has: a retry against data nobody has checked is how a
 * duplicate dose happens.
 */
export const UNKNOWN_OUTCOME_TOAST =
  "Couldn't confirm that saved — this page will update when the connection is back.";

/** A tap refused because another dose write is still in flight (not merely cooling down). */
export const STILL_SAVING_TOAST = "Still saving your last change…";

/** Shown on the Undo offer when Undo is pressed offline. Nothing was sent, and the offer stays. */
export const UNDO_OFFLINE_MESSAGE = "You're offline — Undo will still be here when you're back.";

/** Shown on the Undo offer when its request failed on the network. The offer stays and can be retried. */
export const UNDO_NETWORK_MESSAGE =
  "Couldn't reach the server. The undo may not have gone through.";
```

In `src/lib/components/dashboard/DoseActionForm.svelte`, replace:

```ts
import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
import {
  NETWORK_FAILURE_TOAST,
  STALE_TAP_MESSAGE,
  SUCCESS_FALLBACK_TOAST,
  UNDO_ACTION,
  UNDONE_TOAST,
} from "./dose-action";
```

with:

```ts
import {
  DELETE_ACTION,
  STALE_TAP_MESSAGE,
  SUCCESS_FALLBACK_TOAST,
  UNDONE_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "$components/dose-writes/copy";
import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
```

In the same file, replace:

```ts
        const response = await fetch(UNDO_ACTION, {
```

with:

```ts
        const response = await fetch(DELETE_ACTION, {
```

Replace:

```ts
showToast(actionErrorMessage({ type: "error", error }, NETWORK_FAILURE_TOAST), "error");
```

with:

```ts
showToast(actionErrorMessage({ type: "error", error }, UNKNOWN_OUTCOME_TOAST), "error");
```

Replace:

```ts
showToast(actionErrorMessage(result, NETWORK_FAILURE_TOAST), "error");
```

with:

```ts
showToast(actionErrorMessage(result, UNKNOWN_OUTCOME_TOAST), "error");
```

In `tests/unit/dose-action-form.test.ts`, replace:

```ts
import {
  NETWORK_FAILURE_TOAST,
  STALE_TAP_MESSAGE,
  SUCCESS_FALLBACK_TOAST,
  UNDO_ACTION,
  UNDONE_TOAST,
} from "$lib/components/dashboard/dose-action";
```

with:

```ts
import {
  DELETE_ACTION,
  STALE_TAP_MESSAGE,
  SUCCESS_FALLBACK_TOAST,
  UNDONE_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "$lib/components/dose-writes/copy";
```

Replace:

```ts
expect(url).toBe(UNDO_ACTION);
```

with:

```ts
expect(url).toBe(DELETE_ACTION);
```

Replace:

```ts
  it("a network failure says to check Done before retrying, not the browser's own text", async () => {
    // The write may or may not have landed, and a chip retry would log a
    // second dose.
```

with:

```ts
  it("a network failure says the outcome is unknown, not the browser's own text", async () => {
    // The write may or may not have landed, and a chip retry would log a
    // second dose.
```

Replace:

```ts
expect(h.showToast).toHaveBeenCalledWith(NETWORK_FAILURE_TOAST, "error");
```

with:

```ts
expect(h.showToast).toHaveBeenCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
```

Replace:

```ts
expect(h.showToast).toHaveBeenLastCalledWith(NETWORK_FAILURE_TOAST, "error");
```

with:

```ts
expect(h.showToast).toHaveBeenLastCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
```

Delete the old module:

```bash
git rm src/lib/components/dashboard/dose-action.ts
```

Run: `grep -rnE "dashboard/dose-action\"|\./dose-action\"|NETWORK_FAILURE_TOAST|UNDO_ACTION" src tests`
Expected: no output.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/dose-writes-copy.test.ts tests/unit/dose-action-form.test.ts tests/unit/dose-write-lock.test.ts`
Expected: PASS.

- [ ] **Step 10: Prove by mutation**
  1. In `src/lib/components/dose-writes/copy.ts`, change `export const UNDONE_TOAST = "Undone";` to `export const UNDONE_TOAST = "Undone.";`.
     Run: `npx vitest run tests/unit/dose-writes-copy.test.ts`
     Expected: FAIL in `says exactly what the spec says, and nothing else`. Restore the line.
  2. Add `export const EXTRA = "x";` at the end of `copy.ts`. Run the same command. Expected: FAIL in the same test. Remove the line.
  3. Re-run: PASS.

---

#### Cycle C — `focus-after.ts` moves and learns /log's rules

- [ ] **Step 11: Rewrite the focus test against the new module**

Replace the whole of `tests/unit/dashboard-focus.test.ts` with:

```ts
// After a write resolves a row: the same row if it survived the reload, else
// the next row that was below it, else (with precedingKeys) the nearest row
// that was above it, else the caller's fallback (the page's h1). Never
// another write button — a repeated Enter must not log a different
// medication. And focus moves only if it was lost.
import { describe, it, expect, afterEach } from "vitest";
import {
  focusIfLost,
  focusTargetAfterResolve,
  isFocusLost,
} from "$lib/components/dose-writes/focus-after";
import { DASHBOARD_HEADING_ID, DONE_HEADING_ID } from "$lib/components/dashboard/dom-ids";

function renderCards(...keys: string[]) {
  document.body.innerHTML = keys
    .map((key) => `<li tabindex="-1" data-card-key="${key}"></li>`)
    .join("");
}

/** /log-shaped rows: each has a ✎ (`data-edit`) and a ×, and the × must never take focus. */
function renderDoseRows(...ids: string[]) {
  document.body.innerHTML = ids
    .map(
      (id) =>
        `<li data-dose-id="${id}"><button data-edit>Edit ${id}</button><button>Delete ${id}</button></li>`,
    )
    .join("");
}

const editOf = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-edit]");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("focusTargetAfterResolve", () => {
  it("returns the same card when it survived the reload", () => {
    renderCards("earlier:m1", "today:m1", "today:m2");
    expect(focusTargetAfterResolve("today:m1", ["today:m2"])?.dataset.cardKey).toBe("today:m1");
  });

  it("otherwise returns the first card that was below it and still exists", () => {
    renderCards("earlier:m1", "today:m3");
    expect(focusTargetAfterResolve("today:m2", ["today:m9", "today:m3"])?.dataset.cardKey).toBe(
      "today:m3",
    );
  });

  it("never returns a card that was above it", () => {
    renderCards("earlier:m1");
    expect(focusTargetAfterResolve("today:m2", ["today:m3"])).toBeNull();
  });

  it("names the page's two fixed focus targets", () => {
    expect(DASHBOARD_HEADING_ID).toBe("dashboard-heading");
    expect(DONE_HEADING_ID).toBe("done-heading");
  });
});

describe("focusTargetAfterResolve with options", () => {
  it("finds dose rows by [data-dose-id] when asked, and by [data-card-key] by default", () => {
    document.body.innerHTML = `<li data-card-key="d2"></li><li data-dose-id="d2"></li>`;
    expect(focusTargetAfterResolve("d2", [], { attr: "doseId" })?.dataset.doseId).toBe("d2");
    expect(focusTargetAfterResolve("d2", [])?.dataset.cardKey).toBe("d2");
  });

  it("hands the found row to pick, so a /log row gives its ✎ and never its ×", () => {
    renderDoseRows("d1", "d3");
    const target = focusTargetAfterResolve("d2", ["d3"], { attr: "doseId", pick: editOf });
    expect(target?.textContent).toBe("Edit d3");
  });

  it("tries every following row before any preceding one, and the nearest preceding first", () => {
    const opts = { attr: "doseId" as const, precedingKeys: ["d2", "d1"], pick: editOf };
    renderDoseRows("d1", "d2", "d5");
    expect(focusTargetAfterResolve("d3", ["d4", "d5"], opts)?.textContent).toBe("Edit d5");
    renderDoseRows("d1", "d2");
    expect(focusTargetAfterResolve("d3", ["d4", "d5"], opts)?.textContent).toBe("Edit d2");
  });

  it("skips a row that pick finds nothing in, rather than stopping at it", () => {
    document.body.innerHTML = `<li data-dose-id="d4"></li><li data-dose-id="d5"><button data-edit>Edit d5</button></li>`;
    expect(
      focusTargetAfterResolve("d3", ["d4", "d5"], { attr: "doseId", pick: editOf })?.textContent,
    ).toBe("Edit d5");
  });

  it("returns null when nothing around it survived, leaving the fallback to the caller", () => {
    renderDoseRows("d9");
    expect(
      focusTargetAfterResolve("d3", ["d4"], { attr: "doseId", precedingKeys: ["d2"] }),
    ).toBeNull();
  });

  it("searches only within the root it is given", () => {
    document.body.innerHTML = `<ul id="a"><li data-card-key="k1"></li></ul><ul id="b"></ul>`;
    expect(focusTargetAfterResolve("k1", [], {}, document.getElementById("b")!)).toBeNull();
    expect(focusTargetAfterResolve("k1", [], {}, document.getElementById("a")!)).not.toBeNull();
  });
});

describe("isFocusLost", () => {
  it("is true on <body>", () => {
    document.body.innerHTML = `<button>Other</button>`;
    expect(document.activeElement).toBe(document.body);
    expect(isFocusLost()).toBe(true);
  });

  it("is false on a control still in the page", () => {
    document.body.innerHTML = `<button>Other</button>`;
    document.querySelector("button")!.focus();
    expect(isFocusLost()).toBe(false);
  });

  it("is true inside the toast stack, whose Undo offer is about to go away", () => {
    document.body.innerHTML = `<div data-toast-stack><button>Undo</button></div>`;
    document.querySelector("button")!.focus();
    expect(isFocusLost()).toBe(true);
  });

  it("is true once a reload has removed the focused control", () => {
    document.body.innerHTML = `<button>Log now</button>`;
    const button = document.querySelector("button")!;
    button.focus();
    button.remove();
    expect(isFocusLost()).toBe(true);
  });
});

describe("focusIfLost", () => {
  it("leaves focus where the user put it", () => {
    document.body.innerHTML = `<button id="kept">Kept</button><button id="target">Target</button>`;
    document.getElementById("kept")!.focus();
    focusIfLost(() => document.getElementById("target"));
    expect(document.activeElement?.id).toBe("kept");
  });

  it("otherwise focuses the first candidate that is still in the document", () => {
    document.body.innerHTML = `<button id="target">Target</button>`;
    const detached = document.createElement("button");
    focusIfLost(
      () => null,
      () => detached,
      () => document.getElementById("target"),
    );
    expect(document.activeElement?.id).toBe("target");
  });
});
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-focus.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dose-writes/focus-after"`.

- [ ] **Step 13: Move `focus-after.ts` and extend it**

```bash
git mv src/lib/components/dashboard/focus-after.ts src/lib/components/dose-writes/focus-after.ts
```

Replace the whole of `src/lib/components/dose-writes/focus-after.ts` with:

```ts
/**
 * Where focus goes after a dose write resolves a row, and the rule for when
 * to move it at all. Shared by every dose-write surface: the dashboard's Due
 * cards, /log's rows and the Undo offer.
 */

export interface FocusTargetOptions {
  /**
   * Which row identity to look up. "cardKey" (the default) is a Due card's
   * `[data-card-key]`; "doseId" is a dose row's `[data-dose-id]` (/log, Done).
   */
  attr?: "cardKey" | "doseId";
  /**
   * Keys rendered ABOVE the row at the tap, nearest first. They are tried
   * only after every following key is gone. DueCard passes none, because a
   * card above is never its target.
   */
  precedingKeys?: readonly string[];
  /**
   * Narrows a found row to the element that should take focus (/log: the
   * row's ✎, never its ×). A row it returns null for is skipped.
   */
  pick?: (row: HTMLElement) => HTMLElement | null;
}

const ROW_SELECTOR = { cardKey: "[data-card-key]", doseId: "[data-dose-id]" } as const;

/**
 * The same row if it survived the reload, else the first row that was
 * rendered BELOW it and still exists, else (with `precedingKeys`) the nearest
 * surviving row that was ABOVE it, else null. On null the caller uses its
 * own fallback, the page's h1.
 *
 * `followingKeys` and `precedingKeys` must be captured at the moment of the
 * tap: after the reload the resolved row is gone and the DOM can no longer
 * say what surrounded it. DueCard snapshots them in `onsubmitcapture`.
 */
export function focusTargetAfterResolve(
  key: string,
  followingKeys: readonly string[],
  opts: FocusTargetOptions = {},
  root: ParentNode = document,
): HTMLElement | null {
  const attr = opts.attr ?? "cardKey";
  const rows = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>(ROW_SELECTOR[attr])) {
    const rowKey = el.dataset[attr];
    if (rowKey) rows.set(rowKey, el);
  }
  const pick = opts.pick ?? ((row: HTMLElement) => row);
  for (const candidate of [key, ...followingKeys, ...(opts.precedingKeys ?? [])]) {
    const row = rows.get(candidate);
    const target = row ? pick(row) : null;
    if (target) return target;
  }
  return null;
}

/**
 * Whether keyboard focus has nowhere useful to be: on <body>, on a node a
 * reload removed, or inside the toast stack (whose Undo offer is about to go
 * away). Every dose write follows one rule with it: move focus only if it
 * was lost, and never onto a different dose's write button.
 */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body || !active.isConnected) return true;
  return active.closest("[data-toast-stack]") !== null;
}

/** If focus is lost, focus the first candidate that returns an element still in the document. */
export function focusIfLost(...candidates: Array<() => HTMLElement | null | undefined>): void {
  if (!isFocusLost()) return;
  for (const candidate of candidates) {
    const el = candidate();
    if (el?.isConnected) {
      el.focus();
      return;
    }
  }
}
```

In `src/lib/components/dashboard/DueCard.svelte`, replace:

```ts
import { focusTargetAfterResolve } from "./focus-after";
```

with:

```ts
import { focusTargetAfterResolve } from "$components/dose-writes/focus-after";
```

DueCard's call, `focusTargetAfterResolve(snap.key, snap.following)`, is unchanged: with no `opts` it keeps its "same card, then the next card, else the h1" rule.

Run: `grep -rn "dashboard/focus-after\|\./focus-after" src tests`
Expected: no output.

- [ ] **Step 14: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/dashboard-focus.test.ts tests/unit/due-card-focus.test.ts tests/unit/due-card-ssr.test.ts`
Expected: PASS.

- [ ] **Step 15: Prove by mutation** (restore each change and re-run green before the next)
  1. In `focusTargetAfterResolve`, change `[key, ...followingKeys, ...(opts.precedingKeys ?? [])]` to `[key, ...(opts.precedingKeys ?? []), ...followingKeys]`.
     Run: `npx vitest run tests/unit/dashboard-focus.test.ts`
     Expected: FAIL in `tries every following row before any preceding one, and the nearest preceding first`.
  2. Change `ROW_SELECTOR[attr]` to `ROW_SELECTOR.cardKey`. Same command. Expected: FAIL in `finds dose rows by [data-dose-id] when asked, and by [data-card-key] by default`.
  3. Change `const target = row ? pick(row) : null;` to `const target = row ?? null;`. Same command. Expected: FAIL in `hands the found row to pick, so a /log row gives its ✎ and never its ×`.
  4. In `isFocusLost`, change `return active.closest("[data-toast-stack]") !== null;` to `return false;`. Same command. Expected: FAIL in `is true inside the toast stack, whose Undo offer is about to go away`.
  5. In `focusIfLost`, delete `if (!isFocusLost()) return;`. Same command. Expected: FAIL in `leaves focus where the user put it`.
  6. In `focusIfLost`, change `if (el?.isConnected) {` to `if (el) {`. Same command. Expected: FAIL in `otherwise focuses the first candidate that is still in the document`.
  7. Restore everything and re-run: PASS.

---

#### Cycle D — the dashboard clock is seeded and answers `isExpired()`

- [ ] **Step 16: Write the failing clock tests**

In `tests/unit/dashboard-clock.test.ts`, append at the end of the file:

```ts
describe("a clock seeded from the page payload", () => {
  // The device reads 12:10 while the server's payload says 12:00.
  const SEED = { now: "2026-05-01T12:00:00.000Z", nextRefreshAt: "2026-05-01T12:30:00.000Z" };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:10:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is expired at once when the payload already was, and arms no timer", () => {
    const invalidate = vi.fn(async () => {});
    const clock = createDashboardClock(invalidate, {
      now: "2026-05-01T12:00:00.000Z",
      nextRefreshAt: "2026-05-01T12:00:00.000Z",
    });
    expect(clock.isExpired()).toBe(true);
    // A timer armed here would be a setTimeout during SSR, outliving the
    // request. Only sync(), from the page's effect, may arm one.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60 * MIN);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("tells server time from the seed, and expires on the server's clock, not the device's", () => {
    const clock = createDashboardClock(
      vi.fn(async () => {}),
      SEED,
    );
    expect(clock.serverNow().toISOString()).toBe("2026-05-01T12:00:00.000Z");
    // Device 12:39:59.999 is server 12:29:59.999: not yet.
    vi.advanceTimersByTime(30 * MIN - 1);
    expect(clock.isExpired()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(clock.isExpired()).toBe(true);
  });

  it("is never expired before it has any payload", () => {
    expect(createDashboardClock(vi.fn(async () => {})).isExpired()).toBe(false);
  });

  it("still arms its one refresh timer when sync() adopts the payload after seeding", () => {
    const invalidate = vi.fn(async () => {});
    const clock = createDashboardClock(invalidate, SEED);
    clock.sync(SEED);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(30 * MIN);
    expect(invalidate).toHaveBeenCalledOnce();
    clock.dispose();
  });
});
```

- [ ] **Step 17: Run the test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-clock.test.ts`
Expected: FAIL in the first three new cases:

- `is expired at once when the payload already was, and arms no timer` and `is never expired before it has any payload` fail with `isExpired is not a function`.
- `tells server time from the seed, and expires on the server's clock, not the device's` fails on its first assertion. The seed is ignored, so `serverNow()` reads the device's 12:10.

`still arms its one refresh timer when sync() adopts the payload after seeding` already passes, because `sync()` works today. It pins that seeding does not break it. Every pre-existing case still passes.

- [ ] **Step 18: Seed the clock and add `isExpired()`**

Replace the whole of `src/lib/components/dashboard/dashboard-clock.ts` with:

```ts
import { getContext, setContext } from "svelte";

/** Context key. Exported so a test can render a component with a clock of its own. */
export const DASHBOARD_CLOCK = Symbol("dashboard-clock");

/**
 * Server time minus device time, measured when a payload arrives.
 *
 * Every payload instant (`now`, `nextRefreshAt`, slot times) is on the
 * server's clock. Compare one with raw `Date.now()` on a device ten minutes
 * fast and the page reloads in a loop — each reload hands back a
 * `nextRefreshAt` the device already believes has passed — and the stale
 * guard refuses every tap near a boundary.
 */
export function skewFrom(serverNowIso: string, clientNowMs: number = Date.now()): number {
  return Date.parse(serverNowIso) - clientNowMs;
}

export interface DashboardClock {
  /** The current instant on the server's clock. */
  serverNow(): Date;
  /** When the loaded payload stops being true, on the server's clock. */
  nextRefreshAt(): Date;
  /**
   * Whether the loaded payload has stopped being true: the server's clock has
   * reached `nextRefreshAt`. False before any payload. This is the stale
   * guard's one question, so no caller compares instants itself.
   */
  isExpired(): boolean;
  /** Reload the page data now. Overlapping calls share one reload. */
  refresh(): Promise<void>;
}

export interface DashboardClockPayload {
  now: string;
  nextRefreshAt: string;
}

export interface DashboardClockController extends DashboardClock {
  /** Adopt a freshly loaded payload: re-measure skew and re-arm the one refresh timer. Call once per payload. */
  sync(payload: DashboardClockPayload): void;
  /** For `visibilitychange` → visible: reload if the payload expired while the tab was hidden. */
  onVisible(): void;
  /** For the window's `online` event: run a refresh that came due while offline. */
  onOnline(): void;
  /** Clear the refresh timer. */
  dispose(): void;
}

/**
 * `seed` is the payload the page rendered with. It sets the skew and the
 * refresh instant WITHOUT arming the timer: during SSR a setTimeout would
 * outlive the request, and before hydration there is nothing to reload. The
 * page's effect arms the timer with `sync()`, once per payload. Without a
 * seed the refresh instant is NaN until then, and `isExpired()` answers false.
 */
export function createDashboardClock(
  invalidate: () => Promise<void>,
  seed?: DashboardClockPayload,
): DashboardClockController {
  let skewMs = seed ? skewFrom(seed.now) : 0;
  let refreshAtMs = seed ? Date.parse(seed.nextRefreshAt) : Number.NaN;
  let firedFor: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;

  const serverNowMs = () => Date.now() + skewMs;
  /** A NaN refresh instant (no payload yet) compares false, so an unseeded clock is never expired. */
  const isExpired = () => serverNowMs() >= refreshAtMs;

  function refresh(): Promise<void> {
    inFlight ??= invalidate().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  /**
   * Reload at most once per payload, only once the SERVER's clock says it has
   * expired, and never while offline. A reload whose data request fails does
   * not leave the page as it was: SvelteKit falls back to a full navigation,
   * which the service worker answers with its plain "Offline" page. A refresh
   * skipped offline stays pending, and `onOnline` runs it.
   */
  function refreshIfExpired(): void {
    if (!isExpired() || firedFor === refreshAtMs) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    firedFor = refreshAtMs;
    void refresh().catch(() => {});
  }

  function arm(): void {
    clearTimeout(timer);
    timer = undefined;
    if (Number.isNaN(refreshAtMs)) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        // A timer measures elapsed time, and the device clock can be stepped
        // underneath it. If the server clock has not reached the refresh yet,
        // wait out the difference rather than dropping the refresh.
        if (serverNowMs() < refreshAtMs) arm();
        else refreshIfExpired();
      },
      Math.max(0, refreshAtMs - serverNowMs()),
    );
  }

  return {
    serverNow: () => new Date(serverNowMs()),
    nextRefreshAt: () => new Date(refreshAtMs),
    isExpired,
    refresh,
    sync(payload) {
      skewMs = skewFrom(payload.now);
      refreshAtMs = Date.parse(payload.nextRefreshAt);
      arm();
    },
    onVisible: refreshIfExpired,
    onOnline: refreshIfExpired,
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Call once, during +page.svelte's initialisation. */
export function setDashboardClock(c: DashboardClock): void {
  setContext(DASHBOARD_CLOCK, c);
}

/** Call during a component's initialisation. Throws when no page set a clock. */
export function getDashboardClock(): DashboardClock {
  const clock = getContext<DashboardClock | undefined>(DASHBOARD_CLOCK);
  if (!clock) {
    throw new Error("No dashboard clock in context: +page.svelte must call setDashboardClock()");
  }
  return clock;
}
```

- [ ] **Step 19: Run the test to verify it passes**

Run: `npx vitest run tests/unit/dashboard-clock.test.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 20: Prove by mutation** (restore each change and re-run green before the next)
  1. Seed through `sync()`. Replace the two seed lines

     ```ts
     let skewMs = seed ? skewFrom(seed.now) : 0;
     let refreshAtMs = seed ? Date.parse(seed.nextRefreshAt) : Number.NaN;
     ```

     with `let skewMs = 0;` and `let refreshAtMs = Number.NaN;`. Then, in the returned object, cut the literal into `const controller: DashboardClockController = { … };` and add `if (seed) controller.sync(seed);` before `return controller;`.
     Run: `npx vitest run tests/unit/dashboard-clock.test.ts`
     Expected: FAIL in `is expired at once when the payload already was, and arms no timer` (timer count 1, and `invalidate` is called).

  2. Change `const isExpired = () => serverNowMs() >= refreshAtMs;` to `const isExpired = () => Date.now() >= refreshAtMs;`. Same command. Expected: FAIL in `tells server time from the seed, and expires on the server's clock, not the device's`.
  3. Change it to `const isExpired = () => !(serverNowMs() < refreshAtMs);`. Same command. Expected: FAIL in `is never expired before it has any payload`.
  4. Restore and re-run: PASS.

- [ ] **Step 21: Give `fixedClock` its `isExpired`, and write the failing stale-guard test**

Replace the whole of `tests/unit/helpers/dashboard-context.ts` with:

```ts
import {
  createDoseWriteLock,
  DOSE_WRITE_LOCK,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { DASHBOARD_CLOCK, type DashboardClock } from "$lib/components/dashboard/dashboard-clock";

/** A clock frozen at `now` whose payload expires an hour later unless overridden. */
export function fixedClock(now: Date, overrides: Partial<DashboardClock> = {}): DashboardClock {
  const clock: DashboardClock = {
    serverNow: () => now,
    nextRefreshAt: () => new Date(now.getTime() + 60 * 60 * 1000),
    refresh: async () => {},
    // Derived from the two instants, so a test that overrides only
    // nextRefreshAt gets the isExpired that goes with it.
    isExpired: () => clock.serverNow().getTime() >= clock.nextRefreshAt().getTime(),
    ...overrides,
  };
  return clock;
}

/**
 * The context the (app) layout sets for every page under it: its one
 * dose-write lock. For `render()` / `mount()`'s `context` option when a test
 * renders a dose control, or a page, without the layout around it.
 */
export function doseWriteContext(
  lock: DoseWriteLock = createDoseWriteLock(),
): Map<symbol, unknown> {
  return new Map<symbol, unknown>([[DOSE_WRITE_LOCK, lock]]);
}

/** The layout's lock plus the dashboard page's clock, for `render()` / `mount()`'s `context` option. */
export function dashboardContext(
  opts: { lock?: DoseWriteLock; clock?: DashboardClock; now?: Date } = {},
): Map<unknown, unknown> {
  return new Map<unknown, unknown>([
    ...doseWriteContext(opts.lock),
    [DASHBOARD_CLOCK, opts.clock ?? fixedClock(opts.now ?? new Date("2026-05-01T13:00:00.000Z"))],
  ]);
}
```

In `tests/unit/dose-action-form.test.ts`, directly after the case `it("refuses a tap on an expired list: cancels, reloads, says so, and stays locked until the reload lands", …)`, insert:

```ts
it("asks the clock whether the list expired, rather than comparing instants itself", async () => {
  // The instants say an hour is left; only the clock's own answer says otherwise.
  const refresh = vi.fn(async () => {});
  const { form, submit } = setup({ clock: { isExpired: () => true, refresh } });

  const { cancel, callback } = await startSubmit(submit, form);
  expect(cancel).toHaveBeenCalledOnce();
  expect(callback).toBeNull();
  expect(refresh).toHaveBeenCalledOnce();
  expect(h.showToast).toHaveBeenCalledWith(STALE_TAP_MESSAGE, "error");
});
```

The existing case `refuses a tap on an expired list…` needs no edit: it overrides `nextRefreshAt: () => NOW`, and `fixedClock`'s derived `isExpired` follows it.

- [ ] **Step 22: Run the test to verify it fails**

Run: `npx vitest run tests/unit/dose-action-form.test.ts`
Expected: FAIL in `asks the clock whether the list expired, rather than comparing instants itself`. The assertion that `cancel` was called once fails: it was called 0 times, because the old guard compares the instants, and they say an hour is left. Every other case passes.

- [ ] **Step 23: Switch the stale guard to `isExpired()`**

In `src/lib/components/dashboard/DoseActionForm.svelte`, replace:

```ts
    // Server-relative: comparing with raw Date.now() would refuse every tap
    // near a boundary on a device whose clock runs fast.
    if (clock.serverNow().getTime() >= clock.nextRefreshAt().getTime()) {
```

with:

```ts
    // The clock answers on the server's time: comparing with raw Date.now()
    // would refuse every tap near a boundary on a device whose clock runs fast.
    if (clock.isExpired()) {
```

- [ ] **Step 24: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/dose-action-form.test.ts tests/unit/dose-write-lock.test.ts tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts tests/unit/due-card-ssr.test.ts tests/unit/done-list-ssr.test.ts`
Expected: PASS.

- [ ] **Step 25: Prove by mutation**
  1. Change `if (clock.isExpired()) {` back to `if (clock.serverNow().getTime() >= clock.nextRefreshAt().getTime()) {`.
     Run: `npx vitest run tests/unit/dose-action-form.test.ts`
     Expected: FAIL in `asks the clock whether the list expired, rather than comparing instants itself`.
  2. Restore and re-run: PASS.

---

#### Cycle E — `reloadAfterWrite()`

- [ ] **Step 26: Write the failing reload tests**

Create `tests/unit/reload-after-write.test.ts`:

```ts
// reloadAfterWrite is how every dose write refreshes the page (spec Section
// 3). It never calls enhance's update(). It waits out a client-side
// navigation already in flight, because an invalidateAll issued mid-navigation
// aborts it. After a failure the network may have caused, it waits until
// /api/health answers. Then it runs exactly one invalidateAll.
//
// The $app/state mock has the real `navigating` shape: every field null while
// idle, and `complete` a promise that rejects when the navigation is aborted
// and never settles when it unloads the document.
//
// Every test that starts waitForServer() lets it finish. A loop left pending
// keeps its `online` and `visibilitychange` listeners, and a later test's
// event would wake it against that test's fetch mock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  invalidateAll: vi.fn(async () => {}),
  navigating: {
    from: null as { url: URL } | null,
    to: null as { url: URL } | null,
    type: null as string | null,
    willUnload: null as boolean | null,
    delta: null as number | null,
    complete: null as Promise<void> | null,
  },
  updated: { current: false, check: async () => false },
}));

vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$app/state", () => ({ navigating: h.navigating, updated: h.updated }));

import {
  HEALTH_PROBE_BACKOFF_MS,
  reloadAfterWrite,
  reloadDocumentIfUpdated,
  waitForServer,
} from "$lib/components/dose-writes/reload-after-write";

/** Enough of a Response for the probe, which reads only `ok`. */
function response(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function makeFetch() {
  return vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => response(200));
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A client-side link navigation, as $app/state reports it while it runs. */
function startNavigation(complete: Promise<void>, willUnload = false) {
  Object.assign(h.navigating, {
    from: { url: new URL("http://localhost/dashboard") },
    to: { url: new URL("http://localhost/log") },
    type: "link",
    willUnload,
    complete,
  });
}

const flush = () => vi.advanceTimersByTimeAsync(0);

let fetchMock: ReturnType<typeof makeFetch>;

beforeEach(() => {
  vi.useFakeTimers();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  Object.assign(h.navigating, {
    from: null,
    to: null,
    type: null,
    willUnload: null,
    delta: null,
    complete: null,
  });
  h.updated.current = false;
  fetchMock = makeFetch();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("reloadAfterWrite", () => {
  it("with nothing in flight and the device online, reloads once, at once, without probing", async () => {
    await reloadAfterWrite();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for a client-side navigation in flight, because invalidateAll would abort it", async () => {
    const nav = deferred();
    startNavigation(nav.promise);
    const done = reloadAfterWrite();
    await flush();
    expect(h.invalidateAll).not.toHaveBeenCalled();

    nav.resolve();
    await done;
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("treats an aborted navigation as settled, not as an error", async () => {
    const nav = deferred();
    startNavigation(nav.promise);
    const done = reloadAfterWrite();
    nav.reject(new Error("navigation aborted"));
    await expect(done).resolves.toBeUndefined();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("does not wait on a navigation that unloads the document, whose promise never settles", async () => {
    startNavigation(new Promise<void>(() => {}), true);
    void reloadAfterWrite();
    await flush();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("offline: holds the reload until the online event, then probes and reloads once", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const done = reloadAfterWrite();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.invalidateAll).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", { onLine: true });
    window.dispatchEvent(new Event("online"));
    await done;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/health", { cache: "no-store" });
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("after a network failure while online, probes /api/health on the backoff and reloads after the first ok", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // t = 0
      .mockResolvedValueOnce(response(503)) // t = 2s
      .mockResolvedValueOnce(response(503)); // t = 6s; ok from t = 14s
    const done = reloadAfterWrite({ waitForServer: true });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(h.invalidateAll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("re-checks for a navigation the user started while it waited for the server", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const done = reloadAfterWrite({ waitForServer: true });
    await flush();

    const nav = deferred();
    startNavigation(nav.promise);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(h.invalidateAll).not.toHaveBeenCalled();

    nav.resolve();
    await done;
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("does not reject when the load itself throws: the next write is re-checked on the server", async () => {
    h.invalidateAll.mockRejectedValueOnce(new Error("load failed"));
    await expect(reloadAfterWrite()).resolves.toBeUndefined();
  });
});

describe("waitForServer", () => {
  it("counts the service worker's synthetic 503 as unreachable", async () => {
    fetchMock.mockResolvedValueOnce(response(503));
    let reached = false;
    const done = waitForServer().then(() => {
      reached = true;
    });
    await flush();
    expect(reached).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(reached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off 2s, 4s, 8s, 16s, then every 30s", async () => {
    expect(HEALTH_PROBE_BACKOFF_MS).toEqual([2_000, 4_000, 8_000, 16_000, 30_000]);
    fetchMock.mockResolvedValue(response(503));
    const done = waitForServer();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (const [i, gap] of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000].entries()) {
      await vi.advanceTimersByTimeAsync(gap - 1);
      expect(fetchMock, `probe ${i + 2} came early`).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock, `probe ${i + 2} is late`).toHaveBeenCalledTimes(i + 2);
    }

    // End the loop, or its listeners outlive this test.
    fetchMock.mockResolvedValue(response(200));
    window.dispatchEvent(new Event("online"));
    await done;
  });

  it("re-probes at once when the page becomes visible, not when it is hidden, and leaves no timer behind", async () => {
    fetchMock.mockResolvedValueOnce(response(503));
    const done = waitForServer();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Back to jsdom's own getter, which reads "visible".
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await done;
    // The 2s backoff timer was cleared when the event woke the loop, not left to fire.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-probes at once on the online event, even though navigator.onLine never went false", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const done = waitForServer();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await done;
  });
});

describe("reloadDocumentIfUpdated", () => {
  it("does nothing, and says so, while this tab runs the current deploy", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    expect(reloadDocumentIfUpdated()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the document once polling has seen a new deploy", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    h.updated.current = true;
    expect(reloadDocumentIfUpdated()).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 27: Run the test to verify it fails**

Run: `npx vitest run tests/unit/reload-after-write.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dose-writes/reload-after-write"`.

- [ ] **Step 28: Write `reload-after-write.ts`**

Create `src/lib/components/dose-writes/reload-after-write.ts`:

```ts
import { invalidateAll } from "$app/navigation";
import { navigating, updated } from "$app/state";

/**
 * How long to wait after each failed reachability probe. The last value
 * repeats. After a network error `navigator.onLine` can stay true with no
 * `online` event ever coming (a reset connection, a PWA backgrounded
 * mid-request), so probing is the only way to learn the server is back.
 */
export const HEALTH_PROBE_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000];

/** Unauthenticated and database-free (src/routes/api/health), so it answers whenever the app can. */
const HEALTH_URL = "/api/health";

/**
 * Anything but `ok` counts as unreachable: the service worker answers a
 * failed GET with a synthetic `503 Offline`. A thrown fetch counts too.
 */
async function probe(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

function untilOnline(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener("online", () => resolve(), { once: true });
  });
}

/**
 * Resolves after `delayMs`, or sooner on the `online` event or when the page
 * becomes visible again. Removes its listeners and its timer whichever wins.
 */
function untilRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisibility);
      resolve();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };
    timer = setTimeout(wake, delayMs);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisibility);
  });
}

/**
 * Resolves once the device is online AND `/api/health` answers ok. While
 * offline it only waits for the `online` event and never probes.
 */
export async function waitForServer(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    while (navigator.onLine === false) await untilOnline();
    if (await probe()) return;
    await untilRetry(
      HEALTH_PROBE_BACKOFF_MS[Math.min(attempt, HEALTH_PROBE_BACKOFF_MS.length - 1)],
    );
  }
}

/**
 * Wait out a client-side navigation in flight: an `invalidateAll` issued now
 * would abort it (kit's client sets a new navigation token and the running
 * one aborts on the mismatch). An aborted navigation rejects, which is not an
 * error here. A navigation that unloads the document never settles, and there
 * is nothing left to reload after it.
 */
async function settleNavigation(): Promise<void> {
  if (navigating.to !== null && !navigating.willUnload) {
    await navigating.complete?.catch(() => {});
  }
}

/**
 * The one way a dose write refreshes the page. Nothing calls enhance's
 * `update()`: it applies a result only while the action's path matches the
 * current page, so a write posted across routes would drop its failure
 * silently, and it runs `reset_focus` on whichever page matches.
 *
 * `waitForServer` is for a write whose request failed on the network: the
 * caller keeps its lock held until this resolves, so nothing is retried
 * against data nobody has checked. Offline, it waits for the server whether
 * asked to or not, because a reload that fails offline becomes a full
 * navigation, which the service worker answers with its "Offline" page.
 */
export async function reloadAfterWrite(opts: { waitForServer?: boolean } = {}): Promise<void> {
  await settleNavigation();
  if (opts.waitForServer || navigator.onLine === false) {
    await waitForServer();
    // The user can navigate while the server is unreachable.
    await settleNavigation();
  }
  try {
    await invalidateAll();
  } catch {
    // The data stays as it was; the next write is re-checked on the server.
  }
}

/**
 * After a 409: if version polling has seen a new deploy, reload the document
 * instead of the data. `invalidateAll` refreshes data, not JavaScript, and a
 * tab running pre-deploy code keeps posting a shape the server now refuses.
 * Returns whether it reloaded.
 */
export function reloadDocumentIfUpdated(): boolean {
  if (!updated.current) return false;
  location.reload();
  return true;
}
```

- [ ] **Step 29: Run the test to verify it passes**

Run: `npx vitest run tests/unit/reload-after-write.test.ts`
Expected: PASS, all 14 cases.

- [ ] **Step 30: Prove by mutation** (restore each change and re-run green before the next)
  1. In `reloadAfterWrite`, delete the first `await settleNavigation();`.
     Run: `npx vitest run tests/unit/reload-after-write.test.ts`
     Expected: FAIL in `waits for a client-side navigation in flight, because invalidateAll would abort it`.
  2. In `settleNavigation`, change `await navigating.complete?.catch(() => {});` to `await navigating.complete;`. Same command. Expected: FAIL in `treats an aborted navigation as settled, not as an error`.
  3. Change `if (navigating.to !== null && !navigating.willUnload) {` to `if (navigating.to !== null) {`. Same command. Expected: FAIL in `does not wait on a navigation that unloads the document, whose promise never settles`.
  4. Change `if (opts.waitForServer || navigator.onLine === false) {` to `if (opts.waitForServer) {`. Same command. Expected: FAIL in `offline: holds the reload until the online event, then probes and reloads once`.
  5. In `waitForServer`, delete `while (navigator.onLine === false) await untilOnline();`. Same command. Expected: FAIL in `offline: holds the reload until the online event, then probes and reloads once` (a probe runs while offline).
  6. In `probe`, change `return res.ok;` to `return true;`. Same command. Expected: FAIL in `counts the service worker's synthetic 503 as unreachable`.
  7. In `probe`, remove the `try`/`catch` so a thrown fetch propagates. Same command. Expected: FAIL in `after a network failure while online, probes /api/health on the backoff and reloads after the first ok`.
  8. Change `HEALTH_PROBE_BACKOFF_MS[Math.min(attempt, HEALTH_PROBE_BACKOFF_MS.length - 1)]` to `HEALTH_PROBE_BACKOFF_MS[attempt]`. Same command. Expected: FAIL in `backs off 2s, 4s, 8s, 16s, then every 30s` (fake timers abort on the zero-delay loop, or the count is wrong).
  9. In `untilRetry`, delete `document.addEventListener("visibilitychange", onVisibility);`. Same command. Expected: FAIL in `re-probes at once when the page becomes visible, not when it is hidden, and leaves no timer behind`.
  10. Change `if (document.visibilityState === "visible") wake();` to `wake();`. Same command. Expected: FAIL in the same test (it probes on hidden).
  11. In `wake`, delete `clearTimeout(timer);`. Same command. Expected: FAIL in the same test (`getTimerCount()` is 1).
  12. In `untilRetry`, delete `window.addEventListener("online", wake);`. Same command. Expected: FAIL in `re-probes at once on the online event, even though navigator.onLine never went false`.
  13. Delete the second `await settleNavigation();` (inside the `if`). Same command. Expected: FAIL in `re-checks for a navigation the user started while it waited for the server`.
  14. Remove the `try`/`catch` around `await invalidateAll();`. Same command. Expected: FAIL in `does not reject when the load itself throws: the next write is re-checked on the server`.
  15. In `reloadDocumentIfUpdated`, change `if (!updated.current) return false;` to `if (updated.current) return false;`. Same command. Expected: FAIL in both `reloadDocumentIfUpdated` cases.
  16. Restore everything and re-run: PASS.

  A mutation that leaves a `waitForServer` loop pending can make later cases in the same run fail as well. Judge each mutation by the named test only.

---

#### Cycle F — the `(app)` layout owns the lock; the dashboard seeds its clock

- [ ] **Step 31: Write the failing layout and page tests**

Create `tests/unit/app-layout-dose-writes.test.ts`:

```ts
// The (app) layout owns the one dose-write lock every page under it reads
// (spec D10). A write or an Undo can outlive the page that started it, so the
// lock cannot belong to a page: the page navigated to must read the same one.
// It is also per layout instance, never module state, which during SSR is
// shared by every request the process serves.
//
// The page is a raw snippet that looks the lock up exactly as a dose control's
// initialisation does. Svelte runs a snippet inside the component context of
// the component that renders it, which here is the layout.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { readable } from "svelte/store";

// Sidebar reads $page for aria-current, and the layout registers an
// afterNavigate callback; both need a running SvelteKit client otherwise.
vi.mock("$app/navigation", () => ({ afterNavigate: () => {} }));
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));

import Layout from "../../src/routes/(app)/+layout.svelte";
import {
  getDoseWriteLock,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "system",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
} as const;

const mounted: Array<{ app: ReturnType<typeof mount>; target: HTMLElement }> = [];

afterEach(() => {
  for (const { app, target } of mounted.splice(0)) {
    unmount(app);
    target.remove();
  }
});

/** Mounts the layout around a page, and returns the lock that page found in context. */
function mountLayout(): DoseWriteLock | null {
  let seen: DoseWriteLock | null = null;
  const children = createRawSnippet(() => {
    seen = getDoseWriteLock();
    return { render: () => "<p>page</p>" };
  });
  const target = document.body.appendChild(document.createElement("div"));
  const app = mount(Layout, { target, props: { data: { user, preferences }, children } });
  flushSync();
  mounted.push({ app, target });
  return seen;
}

describe("the (app) layout's dose-write lock", () => {
  it("puts a lock in context for the page it renders", () => {
    const lock = mountLayout();
    expect(lock).not.toBeNull();
    expect(lock!.busy).toBe(false);
    expect(lock!.acquire()).toBe(true);
  });

  it("gives every layout instance its own lock, never one shared through module state", () => {
    const first = mountLayout();
    const second = mountLayout();
    expect(first).not.toBe(second);
    first!.acquire();
    expect(second!.busy).toBe(false);
  });
});
```

In `tests/unit/dashboard-page-ssr.test.ts`:

Replace:

```ts
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import Page from "../../src/routes/(app)/dashboard/+page.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
```

with:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "svelte/server";

// A spy that keeps the real clock, so the page's wiring can be asserted
// without changing anything it renders.
vi.mock("$lib/components/dashboard/dashboard-clock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/components/dashboard/dashboard-clock")>();
  return { ...actual, createDashboardClock: vi.fn(actual.createDashboardClock) };
});

import Page from "../../src/routes/(app)/dashboard/+page.svelte";
import { createDashboardClock } from "$lib/components/dashboard/dashboard-clock";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
```

Replace:

```ts
function renderPage(overrides: Partial<DashboardPageData> = {}) {
```

with:

```ts
/** `context` is what the (app) layout provides: its dose-write lock. */
function renderPage(
  overrides: Partial<DashboardPageData> = {},
  context: Map<symbol, unknown> = doseWriteContext(),
) {
```

Replace:

```ts
return render(Page, { props: { data: { ...dash, user, preferences } } });
```

with:

```ts
return render(Page, { props: { data: { ...dash, user, preferences } }, context });
```

Append at the end of the file:

```ts
describe("dashboard page wiring (SSR)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes the dose-write lock from the (app) layout instead of making its own", () => {
    // A lock of the page's own would be a second lock: a write or an Undo
    // still in flight from another page would not hold it.
    expect(() => renderPage(SCHEDULED, new Map())).toThrow(/No dose-write lock in context/);
  });

  it("seeds its clock with the payload it rendered from", () => {
    renderPage(SCHEDULED);
    expect(createDashboardClock).toHaveBeenLastCalledWith(expect.any(Function), {
      now: NOW,
      nextRefreshAt: "2026-04-16T09:00:00.000Z",
    });
  });

  it("leaves no timer pending after a server render", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderPage(SCHEDULED);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 32: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/app-layout-dose-writes.test.ts tests/unit/dashboard-page-ssr.test.ts`
Expected: FAIL.

- Both layout cases throw `No dose-write lock in context: the (app) layout must call setDoseWriteLock() (tests: doseWriteContext())` during `mount`.
- `takes the dose-write lock from the (app) layout instead of making its own` fails with `expected [Function] to throw an error`, because the page still makes its own lock.
- `seeds its clock with the payload it rendered from` fails: the clock was last called with `invalidateAll` alone.
- `leaves no timer pending after a server render` passes already. It is a guard that Step 34 proves by mutation.
- Every pre-existing composition case passes.

- [ ] **Step 33: Move the lock into the layout, and seed the page's clock**

In `src/routes/(app)/+layout.svelte`, replace:

```ts
import { collectFocusable, trapTab } from "$lib/utils/focus-trap";

let { data, children } = $props();
```

with:

```ts
import { collectFocusable, trapTab } from "$lib/utils/focus-trap";
import {
  createDoseWriteLock,
  setDoseWriteLock,
} from "$components/dose-writes/dose-write-lock.svelte";

let { data, children } = $props();

// The one dose-write lock for every page under (app) (spec D10). It lives
// here, not in a page, because a write or an Undo can outlive the page
// that started it, and the page navigated to must read the same lock, or
// its controls stay live while that write is in flight. Created once per
// layout instance, never at module scope, which during SSR is shared by
// every request the process serves.
setDoseWriteLock(createDoseWriteLock());
```

In `src/routes/(app)/dashboard/+page.svelte`, replace:

```ts
<script lang="ts">
  import { invalidateAll } from "$app/navigation";
```

with:

```ts
<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
```

Delete these lines:

```ts
import {
  createDoseWriteLock,
  setDoseWriteLock,
} from "$components/dose-writes/dose-write-lock.svelte";
```

Replace:

```ts
// One page-wide write lock and one server-relative clock. Every
// DoseActionForm, DueCard and chip reads them from context; nothing here
// re-implements a timer, a skew or a lock.
setDoseWriteLock(createDoseWriteLock());
const clock = createDashboardClock(invalidateAll);
setDashboardClock(clock);
```

with:

```ts
// One server-relative clock. Every DoseActionForm, DueCard and chip reads
// it from context; nothing here re-implements a timer or a skew. The write
// lock they also read is the (app) layout's, shared with every page.
//
// Seeded from the payload this page rendered with, so the stale guard can
// answer from the first tap rather than reading NaN until the effect below
// runs. The seed arms no timer: during SSR a setTimeout would outlive the
// request. `untrack` because the seed is deliberately the FIRST payload
// only; the effect adopts every later one through sync().
const clock = createDashboardClock(
  invalidateAll,
  untrack(() => ({ now: data.now, nextRefreshAt: data.nextRefreshAt })),
);
setDashboardClock(clock);
```

The `$effect` that calls `clock.sync({ now: data.now, nextRefreshAt: data.nextRefreshAt })` stays exactly as it is. It still arms the refresh timer once per payload.

- [ ] **Step 34: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/app-layout-dose-writes.test.ts tests/unit/dashboard-page-ssr.test.ts tests/unit/mobile-nav-focus.test.ts`
Expected: PASS.

- [ ] **Step 35: Prove by mutation** (restore each change and re-run green before the next)
  1. In `src/routes/(app)/+layout.svelte`, delete `setDoseWriteLock(createDoseWriteLock());`.
     Run: `npx vitest run tests/unit/app-layout-dose-writes.test.ts`
     Expected: FAIL in both `puts a lock in context for the page it renders` and `gives every layout instance its own lock, never one shared through module state`.
  2. Make the lock module state. Add at the top of `src/routes/(app)/+layout.svelte`:

     ```svelte
     <script module lang="ts">
       import { createDoseWriteLock as createSharedLock } from "$components/dose-writes/dose-write-lock.svelte";
       const SHARED_LOCK = createSharedLock();
     </script>
     ```

     Then change `setDoseWriteLock(createDoseWriteLock());` to `setDoseWriteLock(SHARED_LOCK);`. Same command. Expected: FAIL in `gives every layout instance its own lock, never one shared through module state`.

  3. In `src/routes/(app)/dashboard/+page.svelte`, put back a page-owned lock. Add `import { createDoseWriteLock, setDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";`, and add `setDoseWriteLock(createDoseWriteLock());` above `const clock =`.
     Run: `npx vitest run tests/unit/dashboard-page-ssr.test.ts`
     Expected: FAIL in `takes the dose-write lock from the (app) layout instead of making its own`.
  4. Seed through `sync()` at the page level. Replace the `const clock = createDashboardClock(invalidateAll, untrack(…));` statement with `const clock = createDashboardClock(invalidateAll);` followed by `untrack(() => clock.sync({ now: data.now, nextRefreshAt: data.nextRefreshAt }));`. Same command. Expected: FAIL in `leaves no timer pending after a server render`, and in `seeds its clock with the payload it rendered from`.
  5. Restore everything and re-run: PASS.

---

#### Cycle G — version polling

- [ ] **Step 36: Write the failing config test**

Create `tests/unit/svelte-config.test.ts`:

```ts
// @vitest-environment node
//
// `kit.version.pollInterval` is what lets `updated.current` (from $app/state)
// ever become true (spec D9). An installed PWA can stay open for days across
// deploys. Without polling, a 409 can refresh its data but never its
// JavaScript, and the tab keeps re-posting a request shape the server no
// longer accepts. reloadDocumentIfUpdated() reads the flag this turns on.
import { describe, it, expect } from "vitest";
import config from "../../svelte.config.js";

describe("svelte.config.js", () => {
  it("polls for a new deploy every five minutes", () => {
    expect(config.kit.version?.pollInterval).toBe(300_000);
  });
});
```

- [ ] **Step 37: Run the test to verify it fails**

Run: `npx vitest run tests/unit/svelte-config.test.ts`
Expected: FAIL with `expected undefined to be 300000`.

- [ ] **Step 38: Turn on version polling**

In `svelte.config.js`, replace:

```js
    alias: {
      $components: "src/lib/components",
      $server: "src/lib/server",
    },
```

with:

```js
    alias: {
      $components: "src/lib/components",
      $server: "src/lib/server",
    },
    // Spec D9 (docs/superpowers/specs/2026-09-25-undoable-dose-actions-design.md).
    // Polling is what turns `updated.current` true once a new deploy is live.
    // Dose writes read it on a 409 and reload the document rather than the
    // data, because a tab running pre-deploy code otherwise keeps posting a
    // request shape the server now refuses, and an installed PWA can stay open
    // for days. Only a tab loaded with this setting polls: a tab loaded before
    // it shipped runs the old client, never learns of a deploy, and must be
    // reloaded by hand.
    version: { pollInterval: 300_000 },
```

- [ ] **Step 39: Run the test to verify it passes, then prove it by mutation**

Run: `npx vitest run tests/unit/svelte-config.test.ts`
Expected: PASS.

Mutation: delete the `version: { pollInterval: 300_000 },` line. Re-run the same command. Expected: FAIL in `polls for a new deploy every five minutes`. Restore the line and re-run: PASS.

---

- [ ] **Step 40: Update existing tests this change breaks**

Every edit below was already made in the cycle named. This step is the checklist: confirm each one, then run the greps.

- `tests/unit/dose-write-lock.test.ts` (Step 1): lock import from `$lib/components/dose-writes/dose-write-lock.svelte`; header says "(app) layout's"; two new `active` cases.
- `tests/unit/due-card-ssr.test.ts` (Step 3): `import { createDoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";`.
- `tests/unit/helpers/dose-action-form-harness.ts` (Step 3): `import type { DoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";`.
- `tests/unit/helpers/dashboard-context.ts` (Step 21): full replacement, with `doseWriteContext`, `fixedClock.isExpired`, and `dashboardContext` built on `doseWriteContext`.
- `tests/unit/dose-action-form.test.ts`:
  - lock import (Step 3);
  - copy import from `$lib/components/dose-writes/copy`, with `DELETE_ACTION` for `UNDO_ACTION` and `UNKNOWN_OUTCOME_TOAST` for `NETWORK_FAILURE_TOAST` in both network cases, and the renamed case `a network failure says the outcome is unknown, not the browser's own text` (Step 8);
  - the new `isExpired` case (Step 21).
- `tests/unit/dashboard-focus.test.ts` (Step 11): full rewrite against `$lib/components/dose-writes/focus-after`.
- `tests/unit/dashboard-clock.test.ts` (Step 16): the seeded `describe`, appended. The existing cases are unchanged, because `seed` is optional.
- `tests/unit/dashboard-page-ssr.test.ts` (Step 31): `renderPage` passes `context` (default `doseWriteContext()`), the clock spy, and the wiring `describe`. Without the context, every case in this file would now throw, because the page no longer sets a lock.

No other existing test renders a dose control outside `dashboardContext()`, so nothing else needs `doseWriteContext()` yet. `due-card-focus`, `quick-log-bar`, `done-list-ssr`, `due-card-ssr` and `dose-write-lock` all go through `dashboardContext`, which now includes it.

Run: `grep -rnE "dashboard/dose-write-lock|dashboard/focus-after|dashboard/dose-action\"|\./dose-action\"|\./focus-after\"|\./dose-write-lock|NETWORK_FAILURE_TOAST|UNDO_ACTION" src tests`
Expected: no output.

Run: `git status --short`
Expected: the renames `src/lib/components/{dashboard → dose-writes}/dose-write-lock.svelte.ts` and `…/focus-after.ts`, the deletion of `src/lib/components/dashboard/dose-action.ts`, the new and modified files listed under **Files**, and nothing else (plus the untracked plan document, if it is still untracked).

- [ ] **Step 41: Run the task's full suite**

Run: `npx vitest run tests/unit/dose-write-lock.test.ts tests/unit/dose-write-lock.svelte.test.ts tests/unit/dose-writes-copy.test.ts tests/unit/dashboard-focus.test.ts tests/unit/dashboard-clock.test.ts tests/unit/dose-action-form.test.ts tests/unit/reload-after-write.test.ts tests/unit/app-layout-dose-writes.test.ts tests/unit/dashboard-page-ssr.test.ts tests/unit/svelte-config.test.ts tests/unit/due-card-ssr.test.ts tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts tests/unit/done-list-ssr.test.ts tests/unit/mobile-nav-focus.test.ts tests/unit/appearance-bundle-boundary.test.ts`
Expected: PASS, every file.

Run: `npx vitest run`
Expected: PASS: 0 failed test files and 0 failed tests. Any PGlite file that is skipped here was skipped before this task too.

Run: `npm run check 2>&1 | tail -3`
Expected: `svelte-check found N errors and M warnings`, where N and M are exactly Step 0's baseline. In particular:

- there is no `state_referenced_locally` warning for `src/routes/(app)/dashboard/+page.svelte` (the seed is read inside `untrack`);
- there is no error in `tests/unit/helpers/dashboard-context.ts` (`fixedClock` implements `isExpired`);
- there is no error in `tests/unit/svelte-config.test.ts` (`kit.version` now exists).

If either count went up, fix the new entry before committing.

Run: `npm run lint`
Expected: 0 errors. The warning count is no higher than before this task.

Run: `npx prettier --write src/lib/components/dose-writes src/lib/components/dashboard/dashboard-clock.ts src/lib/components/dashboard/DoseActionForm.svelte src/lib/components/dashboard/DueCard.svelte "src/routes/(app)/+layout.svelte" "src/routes/(app)/dashboard/+page.svelte" svelte.config.js tests/unit/helpers/dashboard-context.ts tests/unit/helpers/dose-action-form-harness.ts tests/unit/dose-write-lock.test.ts tests/unit/dose-write-lock.svelte.test.ts tests/unit/dose-writes-copy.test.ts tests/unit/dashboard-focus.test.ts tests/unit/dashboard-clock.test.ts tests/unit/dose-action-form.test.ts tests/unit/reload-after-write.test.ts tests/unit/app-layout-dose-writes.test.ts tests/unit/dashboard-page-ssr.test.ts tests/unit/svelte-config.test.ts tests/unit/due-card-ssr.test.ts`

Then run: `npx prettier --check src/lib/components/dose-writes src/lib/components/dashboard/dashboard-clock.ts src/lib/components/dashboard/DoseActionForm.svelte src/lib/components/dashboard/DueCard.svelte "src/routes/(app)/+layout.svelte" "src/routes/(app)/dashboard/+page.svelte" svelte.config.js tests/unit/helpers/dashboard-context.ts tests/unit/helpers/dose-action-form-harness.ts tests/unit/dose-write-lock.test.ts tests/unit/dose-write-lock.svelte.test.ts tests/unit/dose-writes-copy.test.ts tests/unit/dashboard-focus.test.ts tests/unit/dashboard-clock.test.ts tests/unit/dose-action-form.test.ts tests/unit/reload-after-write.test.ts tests/unit/app-layout-dose-writes.test.ts tests/unit/dashboard-page-ssr.test.ts tests/unit/svelte-config.test.ts tests/unit/due-card-ssr.test.ts`
Expected: every listed file passes, and the command ends with `All matched files use Prettier code style!` Do not use the repo-wide `npm run format:check` here: it already fails before this task on the untracked plan document under `docs/superpowers/plans/`, which `.prettierignore` does not exclude (the repo-wide check is Task 14's gate). If `--write` reflowed anything, re-run `npx vitest run` on the touched test files. A reflow never changes behaviour, but confirm it.

- [ ] **Step 42: Commit**

```bash
git add src/lib/components/dose-writes \
  src/lib/components/dashboard/dashboard-clock.ts \
  src/lib/components/dashboard/DoseActionForm.svelte \
  src/lib/components/dashboard/DueCard.svelte \
  "src/routes/(app)/+layout.svelte" \
  "src/routes/(app)/dashboard/+page.svelte" \
  svelte.config.js \
  tests/unit/helpers/dashboard-context.ts \
  tests/unit/helpers/dose-action-form-harness.ts \
  tests/unit/dose-write-lock.test.ts \
  tests/unit/dose-write-lock.svelte.test.ts \
  tests/unit/dose-writes-copy.test.ts \
  tests/unit/dashboard-focus.test.ts \
  tests/unit/dashboard-clock.test.ts \
  tests/unit/dose-action-form.test.ts \
  tests/unit/reload-after-write.test.ts \
  tests/unit/app-layout-dose-writes.test.ts \
  tests/unit/dashboard-page-ssr.test.ts \
  tests/unit/svelte-config.test.ts \
  tests/unit/due-card-ssr.test.ts
git add -u src/lib/components/dashboard
git commit -m "feat(dose-writes): one layout-owned write lock and the shared reload path

Move the dose-write lock, the focus helper and the dose-write copy into
src/lib/components/dose-writes/, where every page's dose controls will
read them. The (app) layout now creates the one lock, once per layout
instance; the dashboard page stops making its own.

- DoseWriteLock gains a reactive 'active' (a holder exists), distinct
  from 'busy', which also covers the cooldown.
- reloadAfterWrite waits out a navigation in flight, and after a
  network failure probes /api/health with backoff before its single
  invalidateAll. reloadDocumentIfUpdated reloads a stale tab.
- The dashboard clock is seeded from the page payload without arming a
  timer, and answers isExpired(); DoseActionForm's stale guard asks it.
- focusTargetAfterResolve takes a row attribute, preceding keys and a
  pick; isFocusLost/focusIfLost encode 'move focus only if it was lost'.
- kit.version.pollInterval is five minutes, so updated.current can see
  a new deploy."
```

`git add -u src/lib/components/dashboard` stages the two renames' old paths and the deletion of `dose-action.ts`. The commit message carries no Claude/AI attribution, no `Co-Authored-By` and no session link.

---

### Task 8: The Undo registry and Toast

One Undo offer at a time, held as module state (like Toast's plain-toast list) so it outlives the page that made it, rendered by `Toast.svelte` above the plain toasts, and cleared when the `(app)` layout unmounts. This task builds the registry, the Toast markup and the layout clear. The dashboard still shows its old per-toast Undo until Task 9 moves `DoseActionForm` onto `offerUndo`, so the legacy `undoAction` parameter of `showToast` **stays** in this task.

**Files:**

- Create: `src/lib/components/dose-writes/undo-registry.svelte.ts`
- Modify: `src/lib/components/ui/Toast.svelte` (whole-file replacement, below)
- Modify: `src/routes/(app)/+layout.svelte` (anchors: `import { tick } from "svelte";`, `import Toast from "$components/ui/Toast.svelte";`, and the line Task 7 added that calls `setDoseWriteLock(`)
- Modify: `tests/unit/mobile-nav-focus.test.ts` (anchor: the `vi.mock("$app/stores", …)` block)
- Modify: `tests/unit/app-layout-dose-writes.test.ts` (created by Task 7 Step 31; anchor: `vi.mock("$app/navigation", () => ({ afterNavigate: () => {} }));` and the `vi.mock("$app/stores", …)` block after it)
- Test: `tests/unit/undo-registry.test.ts` (new)
- Test: `tests/unit/toast-undo.svelte.test.ts` (new)

**Interfaces:**

- Consumes:
  - Task 1: `DOSE_UNDO_WINDOW_MS` from `$lib/utils/dose-undo` (`10 * 60_000`).
  - Task 7, `$components/dose-writes/dose-write-lock.svelte`: `createDoseWriteLock(opts?)`, `getDoseWriteLock()`, `DOSE_WRITE_COOLDOWN_MS`, and `DoseWriteLock { readonly busy; readonly active; acquire(): boolean; release(): void; hold(): void; extend(): void }`.
  - Task 7, `$components/dose-writes/copy`: `DELETE_ACTION = "/dashboard?/deleteDose"`, `RESTORE_ACTION = "/dashboard?/restoreDose"`, `UNDONE_TOAST`, `RESTORED_TOAST`, `STILL_SAVING_TOAST`, `UNDO_OFFLINE_MESSAGE`, `UNDO_NETWORK_MESSAGE`.
  - Task 7, `$components/dose-writes/reload-after-write`: `reloadAfterWrite(opts?: { waitForServer?: boolean }): Promise<void>` (never rejects on a failed `invalidateAll`).
  - Task 7, `$components/dose-writes/focus-after`: `focusIfLost(...candidates: Array<() => HTMLElement | null | undefined>): void` — acts only when `isFocusLost()` (active element null, `<body>`, disconnected, or inside `[data-toast-stack]`), and focuses the first candidate returning a connected element.
  - Task 7, `tests/unit/helpers/dashboard-context.ts`: `doseWriteContext(lock: DoseWriteLock = createDoseWriteLock()): Map<symbol, unknown>`.
  - Task 7: `(app)/+layout.svelte` calls `setDoseWriteLock(createDoseWriteLock())` once per layout instance.
  - Tasks 2–3 (server): `/dashboard?/deleteDose` with `forUndo=1` answers `{ success: true, doseId }`; `/dashboard?/restoreDose` answers `{ success: true, doseId }`, `fail(410, { error: "Too late to undo. Log it again if you need it." })`, `fail(409, { error: "A newer entry exists for this medication, so Undo wasn't applied." })`, or `fail(404, { error: "Dose not found" })`.
- Produces (`src/lib/components/dose-writes/undo-registry.svelte.ts`, exactly as the contract names them):

  ```ts
  export type UndoKind = "delete" | "restore";
  export interface UndoOfferInput {
    message: string;
    doseId: string;
    kind: UndoKind;
    deletedAt?: string;
    expiresInMs?: number;
    respondedAt?: number;
    focusTarget: () => HTMLElement | null;
  }
  export interface UndoOffer extends UndoOfferInput {
    id: string;
    deadline: number;
    running: boolean;
    note: string | null;
  }
  export function offerUndo(input: UndoOfferInput): void; // deadline = (respondedAt ?? Date.now()) + lifetime
  export function currentUndo(): UndoOffer | null;
  export function clearUndo(): void;
  export function withdrawUndoFor(doseId: string): void;
  export function dismissUndo(): void;
  export function rememberFocusBeforeStack(el: HTMLElement | null): void;
  export type UndoOutcome =
    | { kind: "settled"; message: string; type: "success" | "error" }
    | { kind: "kept"; note: string }
    | { kind: "refused" };
  export async function runUndo(lock: DoseWriteLock): Promise<UndoOutcome>;
  export function resetUndoRegistry(): void;
  ```

  - `kind: "delete"` is a **create's** offer (its Undo deletes the new dose, posting `forUndo=1`); `kind: "restore"` is a **delete's** offer (its Undo restores it with `deletedAt`).
  - `respondedAt` is the epoch ms at which the response that made the offer arrived. The deadline counts from it, not from the `offerUndo` call, because the caller offers only after its reload has rendered (Task 9 passes it). It defaults to `Date.now()`. `expiresInMs` is kept exactly as the server sent it.
  - `Toast.svelte` exports `clearToasts(): void`; its stack container carries `data-toast-stack`; the offer is `[data-undo-offer]`, its Undo button is named through `aria-labelledby="undo-word-<id> undo-message-<id>"`, and Dismiss is `aria-label="Dismiss"`.
  - `showToast(message, type, undoAction?)` keeps its legacy third parameter in this task (Task 9 removes it).

---

- [ ] **Step 1: Record the type-check baseline**

Run: `npm run check 2>&1 | tail -3`
Expected: a summary line such as `svelte-check found N errors and M warnings`. Write N and M down; Step 16 compares against them.

- [ ] **Step 2: Write the failing registry test**

Create `tests/unit/undo-registry.test.ts`:

```ts
// The undo registry: the ONE Undo offer, held as module state like Toast's
// list so it outlives the page that made it, and runUndo, which carries out
// a press of it. Rendering and pressing it through Toast is in
// toast-undo.svelte.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  reloadAfterWrite: vi.fn(async (_opts?: { waitForServer?: boolean }) => {}),
}));

// Every mutator is a no-op during SSR. These tests are the browser.
vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({ deserialize: (text: string) => JSON.parse(text) }));
// reload-after-write.test.ts covers the reload itself. Here it is a seam:
// what runUndo asks of it, and when.
vi.mock("$lib/components/dose-writes/reload-after-write", () => ({
  HEALTH_PROBE_BACKOFF_MS: [2_000, 4_000, 8_000, 16_000, 30_000],
  waitForServer: async () => {},
  reloadAfterWrite: (opts?: { waitForServer?: boolean }) => h.reloadAfterWrite(opts),
  reloadDocumentIfUpdated: () => false,
}));

import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import {
  DELETE_ACTION,
  RESTORE_ACTION,
  RESTORED_TOAST,
  UNDO_NETWORK_MESSAGE,
  UNDO_OFFLINE_MESSAGE,
  UNDONE_TOAST,
} from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  clearUndo,
  currentUndo,
  dismissUndo,
  offerUndo,
  rememberFocusBeforeStack,
  resetUndoRegistry,
  runUndo,
  withdrawUndoFor,
  type UndoOfferInput,
} from "$lib/components/dose-writes/undo-registry.svelte";

const NOW = new Date("2026-05-01T13:00:00.000Z");

/** A create's offer: its Undo deletes the dose just logged. */
const CREATE: UndoOfferInput = {
  message: "Metformin 500mg logged at 13:00",
  doseId: "d-new",
  kind: "delete",
  focusTarget: () => null,
};

/** A delete's offer: its Undo restores the dose, keyed on the server's deletedAt. */
const REMOVAL: UndoOfferInput = {
  message: "Dose removed: Paracetamol 500mg at 8:00",
  doseId: "d1",
  kind: "restore",
  deletedAt: "2026-05-01T12:59:30.000Z",
  expiresInMs: 600_000,
  focusTarget: () => null,
};

/** RESTORE_GONE_MESSAGE in src/lib/server/dose-actions.ts (server-only, so not imported). */
const GONE = "Too late to undo. Log it again if you need it.";

const RESTORED = { type: "success", status: 200, data: { success: true, doseId: "d1" } };
const DELETED = { type: "success", status: 200, data: { success: true, doseId: "d-new" } };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** What fetch resolves with for an action's JSON response. */
function respondWith(result: unknown, status = 200): Response {
  return { status, text: async () => JSON.stringify(result) } as unknown as Response;
}

function stubFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  h.reloadAfterWrite.mockReset();
  h.reloadAfterWrite.mockResolvedValue(undefined);
});

afterEach(() => {
  resetUndoRegistry();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("offerUndo and an offer's lifetime", () => {
  it("a create's offer lasts the whole undo window, idle and with no note", () => {
    offerUndo(CREATE);
    const offer = currentUndo();
    expect(offer).toMatchObject({ ...CREATE, running: false, note: null });
    expect(typeof offer?.id).toBe("string");
    expect(offer!.deadline - Date.now()).toBe(DOSE_UNDO_WINDOW_MS);
  });

  it("a delete's offer ends 30s before the server's window closes, so a late press is not refused in flight", () => {
    offerUndo(REMOVAL);
    expect(currentUndo()!.deadline - Date.now()).toBe(600_000 - 30_000);
    offerUndo({ ...REMOVAL, expiresInMs: undefined });
    expect(currentUndo()!.deadline - Date.now()).toBe(DOSE_UNDO_WINDOW_MS - 30_000);
  });

  it("counts a deadline from when the response arrived, not from when the offer is made", () => {
    // The caller offers only after its reload has rendered, which took 5s here.
    const respondedAt = Date.now();
    vi.advanceTimersByTime(5_000);

    offerUndo({ ...CREATE, respondedAt });
    expect(currentUndo()!.deadline).toBe(respondedAt + DOSE_UNDO_WINDOW_MS);

    offerUndo({ ...REMOVAL, respondedAt });
    expect(currentUndo()!.deadline).toBe(respondedAt + 600_000 - 30_000);
    // And it clears then: 5s sooner than an offer timed from the call would.
    vi.advanceTimersByTime(600_000 - 30_000 - 5_000 - 1);
    expect(currentUndo()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(currentUndo()).toBeNull();
  });

  it("clears itself at its deadline, and not a millisecond before", () => {
    offerUndo(CREATE);
    vi.advanceTimersByTime(DOSE_UNDO_WINDOW_MS - 1);
    expect(currentUndo()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(currentUndo()).toBeNull();
  });

  it("holds one offer: a second replaces the first", () => {
    offerUndo(CREATE);
    const first = currentUndo()!.id;
    offerUndo(REMOVAL);
    expect(currentUndo()?.doseId).toBe("d1");
    expect(currentUndo()?.id).not.toBe(first);
  });

  it("withdrawUndoFor clears only an offer naming that dose", () => {
    offerUndo(REMOVAL);
    withdrawUndoFor("d2");
    expect(currentUndo()?.doseId).toBe("d1");
    withdrawUndoFor("d1");
    expect(currentUndo()).toBeNull();
  });

  it("clearUndo and dismissUndo each clear an idle offer", () => {
    offerUndo(CREATE);
    clearUndo();
    expect(currentUndo()).toBeNull();
    offerUndo(CREATE);
    dismissUndo();
    expect(currentUndo()).toBeNull();
  });

  it("a running offer is never replaced, cleared, withdrawn or dismissed, and its deadline waits for it", async () => {
    const response = deferred<Response>();
    stubFetch(response.promise);
    offerUndo({ ...REMOVAL, expiresInMs: 31_000 }); // its deadline is 1s away
    const run = runUndo(createDoseWriteLock());
    await flushMicrotasks();
    const running = currentUndo()!;
    expect(running.running).toBe(true);

    offerUndo(CREATE);
    clearUndo();
    dismissUndo();
    withdrawUndoFor("d1");
    vi.advanceTimersByTime(5_000); // well past its deadline
    expect(currentUndo()?.id).toBe(running.id);

    response.resolve(respondWith(RESTORED));
    await expect(run).resolves.toEqual({
      kind: "settled",
      message: RESTORED_TOAST,
      type: "success",
    });
    expect(currentUndo()).toBeNull();
  });

  it("resetUndoRegistry clears everything, a running offer included, and stops the deadline timer", async () => {
    const response = deferred<Response>();
    stubFetch(response.promise);
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();
    const run = runUndo(lock);
    await flushMicrotasks();
    expect(currentUndo()?.running).toBe(true);

    resetUndoRegistry();
    expect(currentUndo()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // The request still settles: it neither resurrects the offer nor keeps the lock.
    response.resolve(respondWith(RESTORED));
    await run;
    expect(currentUndo()).toBeNull();
    expect(lock.active).toBe(false);
  });
});

describe("runUndo", () => {
  it("a create's Undo posts doseId and forUndo=1 to the absolute deleteDose action, reloads, and settles as 'Undone'", async () => {
    const fetchMock = stubFetch(respondWith(DELETED));
    offerUndo(CREATE);

    const outcome = await runUndo(createDoseWriteLock());

    expect(outcome).toEqual({ kind: "settled", message: UNDONE_TOAST, type: "success" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DELETE_ACTION);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    const body = init?.body as FormData;
    expect(body.get("doseId")).toBe("d-new");
    expect(body.get("forUndo")).toBe("1");
    expect(h.reloadAfterWrite).toHaveBeenCalledOnce();
    expect(h.reloadAfterWrite.mock.calls[0][0]).toBeUndefined();
    expect(currentUndo()).toBeNull();
  });

  it("a delete's Undo posts doseId and deletedAt to the absolute restoreDose action and settles as 'Dose restored'", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    offerUndo(REMOVAL);

    const outcome = await runUndo(createDoseWriteLock());

    expect(outcome).toEqual({ kind: "settled", message: RESTORED_TOAST, type: "success" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESTORE_ACTION);
    const body = init?.body as FormData;
    expect(body.get("doseId")).toBe("d1");
    expect(body.get("deletedAt")).toBe("2026-05-01T12:59:30.000Z");
    expect(body.get("forUndo")).toBeNull();
  });

  it("a refusal from the server (410, too late) reloads and settles with the server's own words", async () => {
    stubFetch(respondWith({ type: "failure", status: 410, data: { error: GONE } }, 410));
    offerUndo(REMOVAL);

    const outcome = await runUndo(createDoseWriteLock());

    expect(outcome).toEqual({ kind: "settled", message: GONE, type: "error" });
    expect(h.reloadAfterWrite).toHaveBeenCalledOnce();
    expect(currentUndo()).toBeNull();
  });

  it("an error with a status below 500 (an expired session) settles with its message", async () => {
    stubFetch(respondWith({ type: "error", error: { message: "Unauthorized" } }, 401));
    offerUndo(REMOVAL);

    const outcome = await runUndo(createDoseWriteLock());

    expect(outcome).toEqual({ kind: "settled", message: "Unauthorized", type: "error" });
    expect(currentUndo()).toBeNull();
  });

  it("a 5xx keeps the offer, idle and retryable, with the error as its note", async () => {
    stubFetch(
      respondWith(
        {
          type: "error",
          error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
        },
        500,
      ),
    );
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();

    const outcome = await runUndo(lock);

    const note = "Something went wrong on our end. (reference a3f10c9e)";
    expect(outcome).toEqual({ kind: "kept", note });
    expect(currentUndo()).toMatchObject({ doseId: "d1", running: false, note });
    expect(h.reloadAfterWrite).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
  });

  it("a request that never completes says the undo may not have gone through, keeps the lock until the server answers, then keeps the offer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      }),
    );
    const reload = deferred();
    h.reloadAfterWrite.mockImplementation(() => reload.promise);
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();

    const run = runUndo(lock);
    await flushMicrotasks();

    expect(h.reloadAfterWrite).toHaveBeenCalledWith({ waitForServer: true });
    expect(currentUndo()).toMatchObject({ running: true, note: UNDO_NETWORK_MESSAGE });
    expect(lock.active).toBe(true);

    reload.resolve();
    await expect(run).resolves.toEqual({ kind: "kept", note: UNDO_NETWORK_MESSAGE });
    expect(currentUndo()).toMatchObject({
      doseId: "d1",
      running: false,
      note: UNDO_NETWORK_MESSAGE,
    });
    expect(lock.active).toBe(false);
  });

  it("an offer whose deadline passed while its request was lost is dropped once the request gives up, with the note as the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      }),
    );
    const reload = deferred();
    h.reloadAfterWrite.mockImplementation(() => reload.promise);
    offerUndo({ ...REMOVAL, expiresInMs: 31_000 }); // its deadline is 1s away

    const run = runUndo(createDoseWriteLock());
    await flushMicrotasks();
    vi.advanceTimersByTime(2_000);
    reload.resolve();

    await expect(run).resolves.toEqual({
      kind: "settled",
      message: UNDO_NETWORK_MESSAGE,
      type: "error",
    });
    expect(currentUndo()).toBeNull();
  });

  it("offline, nothing is sent, no lock is taken, and the offer says Undo will still be here", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    offerUndo(REMOVAL);
    setOnline(false);
    const lock = createDoseWriteLock();

    const outcome = await runUndo(lock);

    expect(outcome).toEqual({ kind: "kept", note: UNDO_OFFLINE_MESSAGE });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lock.busy).toBe(false);
    expect(currentUndo()).toMatchObject({
      doseId: "d1",
      running: false,
      note: UNDO_OFFLINE_MESSAGE,
    });
  });

  it("is refused, sending nothing, while another dose write holds the lock", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();
    lock.acquire();

    const outcome = await runUndo(lock);

    expect(outcome).toEqual({ kind: "refused" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(currentUndo()).toMatchObject({ doseId: "d1", running: false, note: null });
  });

  it("is refused with no offer to run", async () => {
    await expect(runUndo(createDoseWriteLock())).resolves.toEqual({ kind: "refused" });
  });

  it("holds the lock through the request and the reload — even over a running cooldown — then cools down afresh", async () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release();
    // The create being undone is still cooling down, with 50ms of it left.
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS - 50);
    expect(lock.busy).toBe(true);

    const response = deferred<Response>();
    stubFetch(response.promise);
    const reload = deferred();
    h.reloadAfterWrite.mockImplementation(() => reload.promise);
    offerUndo(CREATE);
    const run = runUndo(lock);

    // Past where the earlier cooldown would have ended: hold() took it over.
    await vi.advanceTimersByTimeAsync(100);
    expect(lock.busy).toBe(true);

    response.resolve(respondWith(DELETED));
    await flushMicrotasks();
    expect(lock.busy).toBe(true); // the reload is still pending

    reload.resolve();
    await run;
    expect(lock.busy).toBe(true); // now cooling down, from this moment
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 1);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
  });

  it("lets go of the lock and the running flag even when the reload throws", async () => {
    stubFetch(respondWith(RESTORED));
    h.reloadAfterWrite.mockRejectedValueOnce(new Error("reload blew up"));
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();

    await expect(runUndo(lock)).rejects.toThrow("reload blew up");

    expect(lock.active).toBe(false);
    expect(currentUndo()?.running).toBe(false);
  });
});

describe("runUndo — where focus goes", () => {
  beforeEach(() => {
    stubFetch(respondWith(RESTORED));
  });

  it("when focus was lost, to the offer's target", async () => {
    const edit = document.body.appendChild(document.createElement("button"));
    offerUndo({ ...REMOVAL, focusTarget: () => edit });
    await runUndo(createDoseWriteLock());
    expect(document.activeElement).toBe(edit);
  });

  it("with no target, back to where focus was before it entered the toast stack", async () => {
    const search = document.body.appendChild(document.createElement("input"));
    rememberFocusBeforeStack(search);
    offerUndo(REMOVAL);
    await runUndo(createDoseWriteLock());
    expect(document.activeElement).toBe(search);
  });

  it("with neither, to the page's h1", async () => {
    const heading = document.body.appendChild(document.createElement("h1"));
    heading.tabIndex = -1;
    offerUndo(REMOVAL);
    await runUndo(createDoseWriteLock());
    expect(document.activeElement).toBe(heading);
  });

  it("leaves focus that is somewhere real where it is", async () => {
    const edit = document.body.appendChild(document.createElement("button"));
    const search = document.body.appendChild(document.createElement("input"));
    search.focus();
    offerUndo({ ...REMOVAL, focusTarget: () => edit });
    await runUndo(createDoseWriteLock());
    expect(document.activeElement).toBe(search);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/undo-registry.test.ts`
Expected: FAIL — the suite cannot load: `Failed to resolve import "$lib/components/dose-writes/undo-registry.svelte"` (the module does not exist yet).

- [ ] **Step 4: Write the registry**

Create `src/lib/components/dose-writes/undo-registry.svelte.ts`:

```ts
import { tick } from "svelte";
import type { ActionResult } from "@sveltejs/kit";
import { browser } from "$app/environment";
import { deserialize } from "$app/forms";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { actionErrorMessage } from "$lib/utils/form-errors";
import {
  DELETE_ACTION,
  RESTORE_ACTION,
  RESTORED_TOAST,
  UNDO_NETWORK_MESSAGE,
  UNDO_OFFLINE_MESSAGE,
  UNDONE_TOAST,
} from "./copy";
import type { DoseWriteLock } from "./dose-write-lock.svelte";
import { focusIfLost } from "./focus-after";
import { reloadAfterWrite } from "./reload-after-write";

/**
 * The ONE Undo offer on screen, and how pressing it runs.
 *
 * Module state, like Toast's list, because an offer outlives the page that
 * made it: log a dose on the dashboard, go to /log, and the Undo is still
 * there. Every mutator is a no-op when `!browser`: this module is evaluated
 * during SSR on every authenticated page, and module state is per-process on
 * the server, so an offer made during SSR would be shown to whichever user
 * rendered next.
 *
 * At most one offer exists. The next successful dose write replaces it, which
 * is what removes "which Undo?" when several toasts each carried one, and the
 * double click that landed on an older toast's Undo once the newer one went.
 * It stays until it is pressed and settles, dismissed, replaced, withdrawn by
 * a write to the same dose, or its deadline passes. A running offer is never
 * replaced or withdrawn: an Undo holds the layout's write lock, so no other
 * write can even start, and every mutator below refuses a running offer too.
 *
 * An offer never captures a lock. `runUndo` is handed the lock of the layout
 * that is on screen when the button is pressed (Toast reads it from context),
 * which is what makes an Undo pressed after navigating hold the lock the new
 * page's controls read.
 */

export type UndoKind = "delete" | "restore";

export interface UndoOfferInput {
  message: string;
  doseId: string;
  /** "delete": a create's Undo, which deletes the new dose. "restore": a delete's Undo. */
  kind: UndoKind;
  /** A restore's key, exactly as the delete action returned it. */
  deletedAt?: string;
  /** How long the server keeps the dose restorable, from the delete's response. */
  expiresInMs?: number;
  /** Epoch ms the response that made this offer arrived; the deadline counts from here. Defaults to now. */
  respondedAt?: number;
  /** Where focus goes once the Undo's reload has rendered the page. */
  focusTarget: () => HTMLElement | null;
}

export interface UndoOffer extends UndoOfferInput {
  id: string;
  /** Epoch ms after which the offer is gone. */
  deadline: number;
  /** An Undo for this offer is in flight: its button reads "Undoing…". */
  running: boolean;
  /** A line under the message: why the offer is still here after a press. */
  note: string | null;
}

export type UndoOutcome =
  | { kind: "settled"; message: string; type: "success" | "error" }
  | { kind: "kept"; note: string }
  | { kind: "refused" };

/**
 * A restore's offer goes this long before the server's window closes, so a
 * press in the last seconds is not refused as "too late" while in flight.
 */
const RESTORE_DEADLINE_MARGIN_MS = 30_000;

let offer = $state.raw<UndoOffer | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
/** Where focus was before it entered the toast stack; Toast records it. */
let focusBeforeStack: HTMLElement | null = null;

function stopTimer(): void {
  clearTimeout(timer);
  timer = undefined;
}

/** Remove the offer with this id, if it is still the current one. */
function drop(id: string): void {
  if (offer?.id !== id) return;
  stopTimer();
  offer = null;
}

/** Update the offer with this id, if it is still the current one. */
function patch(id: string, changes: Partial<Pick<UndoOffer, "running" | "note">>): void {
  const current = offer;
  if (current?.id !== id) return;
  offer = { ...current, ...changes };
}

function arm(target: UndoOffer): void {
  stopTimer();
  timer = setTimeout(
    () => {
      timer = undefined;
      // A running Undo owns its offer until it settles; `keep` drops one
      // whose deadline passed in flight.
      if (offer?.id === target.id && !offer.running) offer = null;
    },
    Math.max(0, target.deadline - Date.now()),
  );
}

/**
 * Replace the current offer, unless an Undo for it is running.
 *
 * The lifetime counts from `respondedAt`, when the response arrived, not from
 * this call: the caller offers only after its reload has rendered, and that
 * reload can wait out a navigation or an unreachable server. Counted from
 * here, a restore's offer could outlive the server's window and a late press
 * would be refused as "too late". `arm` clamps a deadline already past to 0.
 */
export function offerUndo(input: UndoOfferInput): void {
  if (!browser || offer?.running) return;
  const lifetime =
    input.kind === "restore"
      ? (input.expiresInMs ?? DOSE_UNDO_WINDOW_MS) - RESTORE_DEADLINE_MARGIN_MS
      : DOSE_UNDO_WINDOW_MS;
  const next: UndoOffer = {
    ...input,
    id: crypto.randomUUID(),
    deadline: (input.respondedAt ?? Date.now()) + lifetime,
    running: false,
    note: null,
  };
  offer = next;
  arm(next);
}

/** The current offer. Reactive: read it in a component and it re-renders. */
export function currentUndo(): UndoOffer | null {
  return offer;
}

/** A successful dose write clears whatever offer is left. Never a running one. */
export function clearUndo(): void {
  if (!browser || !offer || offer.running) return;
  drop(offer.id);
}

/**
 * A write about to be SENT for this dose withdraws its offer: an Undo of a
 * dose that is being deleted or edited would reverse the wrong thing.
 */
export function withdrawUndoFor(doseId: string): void {
  if (!browser || !offer || offer.running || offer.doseId !== doseId) return;
  drop(offer.id);
}

/** The offer's Dismiss button. */
export function dismissUndo(): void {
  clearUndo();
}

/** Toast calls this when focus enters its stack from outside. */
export function rememberFocusBeforeStack(el: HTMLElement | null): void {
  if (!browser) return;
  focusBeforeStack = el;
}

/**
 * Everything, running or not. The (app) layout calls this when it unmounts:
 * signing out leaves (app), and on a shared device the next person to sign in
 * must never see, or press, the last person's "Dose removed: <medication>".
 */
export function resetUndoRegistry(): void {
  if (!browser) return;
  stopTimer();
  offer = null;
  focusBeforeStack = null;
}

async function post(target: UndoOffer): Promise<ActionResult> {
  const body = new FormData();
  body.set("doseId", target.doseId);
  if (target.kind === "delete") body.set("forUndo", "1");
  else body.set("deletedAt", target.deletedAt ?? "");
  // Absolute actions: the offer outlives the page, so a relative `?/…`
  // would post to whichever page the user has moved to.
  const response = await fetch(target.kind === "delete" ? DELETE_ACTION : RESTORE_ACTION, {
    method: "POST",
    body,
    headers: { accept: "application/json" },
  });
  const result = deserialize(await response.text()) as ActionResult;
  // As enhance does: an error result carries its HTTP status, which is how a
  // retryable 5xx is told apart from a 401.
  if (result.type === "error") result.status = response.status;
  return result;
}

/**
 * Keep the offer for another press, unless its deadline passed while the
 * request was in flight: the deadline timer skips a running offer, so this is
 * where such an offer goes, and its note becomes a plain toast instead.
 */
function keep(target: UndoOffer, note: string): UndoOutcome {
  if (Date.now() < target.deadline) return { kind: "kept", note };
  drop(target.id);
  return { kind: "settled", message: note, type: "error" };
}

/**
 * Carry out a press of the current offer's Undo, holding `lock` — the
 * layout's — for the request and the reload.
 *
 * "refused": no offer, one already running, or another dose write in flight
 * (the caller says "Still saving…"). "kept": the offer stays, with a note
 * saying why (offline, lost request, a 5xx). "settled": the offer is gone,
 * and the caller shows `message` as a plain toast.
 *
 * Focus moves (only if it was lost) AFTER the reload has rendered the page
 * and BEFORE the offer is removed: until then the pressed button is still
 * mounted, so focus never falls to <body> in between, and the restored row's
 * control exists to receive it.
 */
export async function runUndo(lock: DoseWriteLock): Promise<UndoOutcome> {
  const target = offer;
  if (!browser || !target || target.running) return { kind: "refused" };
  if (lock.active) return { kind: "refused" };
  if (navigator.onLine === false) {
    patch(target.id, { note: UNDO_OFFLINE_MESSAGE });
    return { kind: "kept", note: UNDO_OFFLINE_MESSAGE };
  }

  // hold(), not acquire(): the write being undone may still be cooling down,
  // and an Undo must not be refused by that. extend() then starts a fresh
  // cooldown from this Undo's own reload.
  lock.hold();
  patch(target.id, { running: true, note: null });
  try {
    let result: ActionResult;
    try {
      result = await post(target);
    } catch {
      // The request never completed: it may or may not have landed. Say so
      // at once, but keep the button busy until the server answers and the
      // page has reloaded, so a retry acts on data somebody has checked.
      patch(target.id, { note: UNDO_NETWORK_MESSAGE });
      await reloadAfterWrite({ waitForServer: true });
      patch(target.id, { running: false });
      return keep(target, UNDO_NETWORK_MESSAGE);
    }

    await reloadAfterWrite();
    await tick();

    if (result.type === "error" && (result.status ?? 0) >= 500) {
      // Nothing happened on the server that can be relied on; the offer
      // stays, and focus stays on it.
      const note = actionErrorMessage(result);
      patch(target.id, { running: false, note });
      return keep(target, note);
    }

    focusIfLost(
      target.focusTarget,
      () => focusBeforeStack,
      () => document.querySelector<HTMLElement>("h1"),
    );
    drop(target.id);
    if (result.type === "success") {
      return {
        kind: "settled",
        message: target.kind === "delete" ? UNDONE_TOAST : RESTORED_TOAST,
        type: "success",
      };
    }
    // 410 too late, 409 logged since, 404 not found, a 401: the server's words.
    return { kind: "settled", message: actionErrorMessage(result), type: "error" };
  } finally {
    if (offer?.id === target.id && offer.running) patch(target.id, { running: false });
    lock.extend();
  }
}
```

- [ ] **Step 5: Run the registry test to verify it passes**

Run: `npx vitest run tests/unit/undo-registry.test.ts`
Expected: PASS (25 tests).

- [ ] **Step 6: Prove the registry tests by mutation**

Make each change in `src/lib/components/dose-writes/undo-registry.svelte.ts`, run `npx vitest run tests/unit/undo-registry.test.ts`, confirm the named test FAILS, then restore the line and re-run green.

| Mutation (exact line)                                                                                                                                                                                                    | Test that must fail                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| In `offerUndo`, change `(input.expiresInMs ?? DOSE_UNDO_WINDOW_MS) - RESTORE_DEADLINE_MARGIN_MS` to `(input.expiresInMs ?? DOSE_UNDO_WINDOW_MS)`                                                                         | "a delete's offer ends 30s before the server's window closes, …"                                                                            |
| In `offerUndo`, change `deadline: (input.respondedAt ?? Date.now()) + lifetime,` to `deadline: Date.now() + lifetime,`                                                                                                   | "counts a deadline from when the response arrived, not from when the offer is made" (its first `toBe` gets a deadline exactly 5_000ms late) |
| In `offerUndo`, delete `arm(next);`                                                                                                                                                                                      | "clears itself at its deadline, and not a millisecond before"                                                                               |
| In `offerUndo`, change `if (!browser \|\| offer?.running) return;` to `if (!browser \|\| offer) return;`                                                                                                                 | "holds one offer: a second replaces the first"                                                                                              |
| In `offerUndo`, change `if (!browser \|\| offer?.running) return;` to `if (!browser) return;`                                                                                                                            | "a running offer is never replaced, cleared, withdrawn or dismissed, …"                                                                     |
| In the `arm` timer callback, change `if (offer?.id === target.id && !offer.running) offer = null;` to `if (offer?.id === target.id) offer = null;`                                                                       | "a running offer is never replaced, cleared, withdrawn or dismissed, …"                                                                     |
| In `withdrawUndoFor`, delete `\|\| offer.doseId !== doseId`                                                                                                                                                              | "withdrawUndoFor clears only an offer naming that dose"                                                                                     |
| In `resetUndoRegistry`, add `if (offer?.running) return;` as its second line                                                                                                                                             | "resetUndoRegistry clears everything, a running offer included, …"                                                                          |
| In `post`, delete `if (result.type === "error") result.status = response.status;`                                                                                                                                        | "a 5xx keeps the offer, idle and retryable, …"                                                                                              |
| In `post`, replace the two lines `if (target.kind === "delete") body.set("forUndo", "1");` / `else body.set("deletedAt", target.deletedAt ?? "");` with the single line `body.set("deletedAt", target.deletedAt ?? "");` | "a create's Undo posts doseId and forUndo=1 …"                                                                                              |
| In the network `catch`, change `await reloadAfterWrite({ waitForServer: true });` to `await reloadAfterWrite();`                                                                                                         | "a request that never completes says the undo may not have gone through, …"                                                                 |
| In `keep`, replace the body with `return { kind: "kept", note };`                                                                                                                                                        | "an offer whose deadline passed while its request was lost is dropped …"                                                                    |
| In `runUndo`, delete `if (navigator.onLine === false) { … }` (the whole block)                                                                                                                                           | "offline, nothing is sent, no lock is taken, …"                                                                                             |
| In `runUndo`, delete `if (lock.active) return { kind: "refused" };`                                                                                                                                                      | "is refused, sending nothing, while another dose write holds the lock"                                                                      |
| In `runUndo`, change `lock.hold();` to `lock.acquire();`                                                                                                                                                                 | "holds the lock through the request and the reload — even over a running cooldown — …"                                                      |
| In `runUndo`, delete `lock.extend();` from the `finally` block and add `lock.extend();` as the line just before `drop(target.id);` (so a throw from the reload skips it)                                                 | "lets go of the lock and the running flag even when the reload throws"                                                                      |
| In `runUndo`, delete the `() => focusBeforeStack,` candidate                                                                                                                                                             | "with no target, back to where focus was before it entered the toast stack"                                                                 |
| In `runUndo`, delete the `() => document.querySelector<HTMLElement>("h1"),` candidate                                                                                                                                    | "with neither, to the page's h1"                                                                                                            |
| Replace the `focusIfLost(…)` call with `target.focusTarget()?.focus();`                                                                                                                                                  | "leaves focus that is somewhere real where it is"                                                                                           |

- [ ] **Step 7: Write the failing Toast test**

Create `tests/unit/toast-undo.svelte.test.ts` (the first DOM test of Toast):

```ts
// Toast, mounted for real (jsdom, client svelte). It is mounted once, in the
// (app) layout, and renders the ONE Undo offer the undo registry holds above
// its plain toasts. The registry's own rules (deadlines, replacing,
// withdrawing, what runUndo posts) are in undo-registry.test.ts; this file
// is about what a person sees and presses, and where their focus goes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { readable } from "svelte/store";

const h = vi.hoisted(() => ({
  reloadAfterWrite: vi.fn(async (_opts?: { waitForServer?: boolean }) => {}),
}));

// `showToast` and every registry mutator are no-ops unless `browser`.
vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  deserialize: (text: string) => JSON.parse(text),
  enhance: () => ({ destroy() {} }),
}));
// For the layout: it registers an afterNavigate callback, and Sidebar reads
// $page. SvelteKit's client runtime is not running here.
vi.mock("$app/navigation", () => ({ afterNavigate: () => {}, invalidateAll: async () => {} }));
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { data: {} },
}));
// The reload is a seam here: a test makes it render what the server would.
vi.mock("$lib/components/dose-writes/reload-after-write", () => ({
  HEALTH_PROBE_BACKOFF_MS: [2_000, 4_000, 8_000, 16_000, 30_000],
  waitForServer: async () => {},
  reloadAfterWrite: (opts?: { waitForServer?: boolean }) => h.reloadAfterWrite(opts),
  reloadDocumentIfUpdated: () => false,
}));

import Toast, { clearToasts, showToast } from "$lib/components/ui/Toast.svelte";
import {
  RESTORED_TOAST,
  STILL_SAVING_TOAST,
  UNDO_OFFLINE_MESSAGE,
} from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
  type UndoOfferInput,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { doseWriteContext } from "./helpers/dashboard-context";

const { default: Layout } = await import("../../src/routes/(app)/+layout.svelte");

const REMOVAL: UndoOfferInput = {
  message: "Dose removed: Paracetamol 500mg at 8:00",
  doseId: "d1",
  kind: "restore",
  deletedAt: "2026-05-01T12:59:30.000Z",
  expiresInMs: 600_000,
  focusTarget: () => document.querySelector<HTMLElement>('[data-dose-id="d1"] [data-edit]'),
};

const RESTORED = { type: "success", status: 200, data: { success: true, doseId: "d1" } };

const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  h.reloadAfterWrite.mockReset();
  h.reloadAfterWrite.mockResolvedValue(undefined);
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  resetUndoRegistry();
  clearToasts();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function mountToast(lock: DoseWriteLock = createDoseWriteLock()) {
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(Toast, { target, context: doseWriteContext(lock) });
  flushSync();
  cleanups.push(() => {
    unmount(component);
    target.remove();
  });
  const stack = target.querySelector<HTMLElement>("[data-toast-stack]");
  if (!stack) throw new Error("Toast rendered no [data-toast-stack]");
  return { lock, stack };
}

function show(input: UndoOfferInput = REMOVAL) {
  offerUndo(input);
  flushSync();
}

function undoButton(stack: HTMLElement): HTMLButtonElement {
  const button = stack.querySelector<HTMLButtonElement>(
    "[data-undo-offer] button[aria-labelledby]",
  );
  if (!button) throw new Error("no Undo button in the toast stack");
  return button;
}

function dismissButton(stack: HTMLElement): HTMLButtonElement {
  const button = stack.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
  if (!button) throw new Error("no Dismiss button in the toast stack");
  return button;
}

/** The accessible name aria-labelledby gives: each referenced element's text, space-joined. */
function nameFromLabelledBy(el: Element): string {
  return (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .join(" ");
}

function stubFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function respondWith(result: unknown, status = 200): Response {
  return { status, text: async () => JSON.stringify(result) } as unknown as Response;
}

describe("Toast's Undo offer", () => {
  it("names Undo by its word and the message through aria-labelledby, adding nothing else to the live region", () => {
    const { stack } = mountToast();
    show();
    const undo = undoButton(stack);

    expect(stack.getAttribute("role")).toBe("status");
    expect(undo.textContent?.trim()).toBe("Undo");
    expect(undo.hasAttribute("aria-label")).toBe(false);
    expect(nameFromLabelledBy(undo)).toBe("Undo Dose removed: Paracetamol 500mg at 8:00");
    // Nothing is announced twice.
    expect(stack.querySelectorAll(".sr-only")).toHaveLength(0);
    expect(stack.textContent?.match(/Dose removed/g)).toHaveLength(1);
  });

  it("gives Undo and Dismiss 44px targets, like every other dose control", () => {
    const { stack } = mountToast();
    show();
    expect([...undoButton(stack).classList]).toEqual(expect.arrayContaining(["min-h-11", "px-3"]));
    expect([...dismissButton(stack).classList]).toEqual(expect.arrayContaining(["size-11"]));
  });

  it("shows one offer: a second replaces the first", () => {
    const { stack } = mountToast();
    show();
    show({ ...REMOVAL, doseId: "d2", message: "Dose removed: Ibuprofen 200mg at 9:00" });

    expect(stack.querySelectorAll("[data-undo-offer]")).toHaveLength(1);
    expect(stack.textContent).toContain("Ibuprofen");
    expect(stack.textContent).not.toContain("Paracetamol");
  });

  it("restores on a press, then puts focus on the restored row's ✎ — never on <body> — and says 'Dose restored'", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    h.reloadAfterWrite.mockImplementation(async () => {
      // What the reload renders: the restored row, with its ✎.
      const row = document.body.appendChild(document.createElement("div"));
      row.dataset.doseId = "d1";
      row.innerHTML = '<button type="button" data-edit>✎</button>';
    });
    const { stack } = mountToast();
    show();
    const undo = undoButton(stack);
    undo.focus();

    undo.click();

    await vi.waitFor(() => expect(stack.textContent).toContain(RESTORED_TOAST));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stack.querySelector("[data-undo-offer]")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-dose-id="d1"] [data-edit]'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("a double press sends one request, and says nothing about 'still saving'", async () => {
    let respond!: (response: Response) => void;
    const fetchMock = stubFetch(new Promise<Response>((r) => (respond = r)));
    const { stack } = mountToast();
    show();
    const undo = undoButton(stack);

    undo.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(undo.textContent?.trim()).toBe("Undoing…");
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    undo.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stack.textContent).not.toContain(STILL_SAVING_TOAST);

    respond(respondWith(RESTORED));
    await vi.waitFor(() => expect(currentUndo()).toBeNull());
  });

  it("an Undo pressed while another dose write is in flight sends nothing, says it is still saving, and keeps the offer", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    const lock = createDoseWriteLock();
    const { stack } = mountToast(lock);
    show();
    lock.acquire();

    undoButton(stack).click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stack.textContent).toContain(STILL_SAVING_TOAST);
    expect(stack.querySelector("[data-undo-offer]")).not.toBeNull();
  });

  it("an Undo pressed offline sends nothing, keeps the offer, and says Undo will still be here", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const { stack } = mountToast();
    show();

    undoButton(stack).click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stack.querySelector("[data-undo-offer]")?.textContent).toContain(UNDO_OFFLINE_MESSAGE);
  });

  it("Dismiss removes the offer and sends nothing", () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    const { stack } = mountToast();
    show();

    dismissButton(stack).click();
    flushSync();

    expect(stack.querySelector("[data-undo-offer]")).toBeNull();
    expect(currentUndo()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("outlives the five seconds a plain toast gets", () => {
    const { stack } = mountToast();
    showToast("Metformin 500mg logged at 13:00", "success");
    show();

    vi.advanceTimersByTime(5_000);
    flushSync();

    expect(stack.textContent).not.toContain("logged at 13:00");
    expect(stack.querySelector("[data-undo-offer]")).not.toBeNull();
  });

  it("Review Focus #3: an Undo pressed after the page that offered it has gone holds the layout's lock, the one every page reads", async () => {
    let respond!: (response: Response) => void;
    stubFetch(new Promise<Response>((r) => (respond = r)));
    const lock = createDoseWriteLock();
    const { stack } = mountToast(lock);
    // Made by a control on a page the user has since left: nothing but the
    // registry refers to the offer now, and it carries no lock of its own.
    show();

    undoButton(stack).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(lock.active).toBe(true);
    expect(lock.acquire()).toBe(false); // the page now on screen cannot write

    respond(respondWith(RESTORED));
    await vi.waitFor(() => expect(currentUndo()).toBeNull());
    expect(lock.active).toBe(false);
  });
});

describe("the (app) layout", () => {
  const user = {
    id: "u1",
    email: "person@example.com",
    name: "Test Person",
    avatarUrl: null,
    timezone: "UTC",
    twoFactorEnabled: false,
    emailVerified: true,
  };

  const preferences = {
    userId: "u1",
    accentColor: "#4f46e5",
    theme: "system",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    uiDensity: "comfortable",
    reducedMotion: false,
    overdueEmailReminders: true,
    overduePushReminders: true,
    lowInventoryEmailAlerts: true,
    lowInventoryPushAlerts: false,
    doseLogPageSize: 20,
    heatmapPeriod: 90,
    exportFormat: "pdf",
    updatedAt: new Date("2026-08-01T00:00:00Z"),
  } as const;

  function mountLayout() {
    const target = document.body.appendChild(document.createElement("div"));
    const children = createRawSnippet(() => ({ render: () => `<p>The page</p>` }));
    const app = mount(Layout, { target, props: { data: { user, preferences }, children } });
    flushSync();
    return {
      target,
      destroy() {
        unmount(app);
        target.remove();
      },
    };
  }

  it("Review Focus #3: clears the Undo offer and every plain toast when it unmounts, so the next sign-in on this device sees neither", () => {
    const first = mountLayout();
    offerUndo({ ...REMOVAL, message: "Dose removed: Sertraline 50mg at 8:00" });
    showToast("Sertraline 50mg logged at 8:00", "success");
    flushSync();
    expect(first.target.querySelector("[data-undo-offer]")?.textContent).toContain("Sertraline");
    expect(first.target.textContent).toContain("Sertraline 50mg logged at 8:00");

    // Signing out leaves (app); signing in again mounts a new layout.
    first.destroy();
    const second = mountLayout();
    cleanups.push(() => second.destroy());

    expect(currentUndo()).toBeNull();
    expect(second.target.querySelector("[data-undo-offer]")).toBeNull();
    expect(second.target.querySelector("[data-toast-stack]")?.textContent?.trim()).toBe("");
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run tests/unit/toast-undo.svelte.test.ts`
Expected: FAIL — `mountToast` throws `Toast rendered no [data-toast-stack]` in every "Toast's Undo offer" test, and the layout test fails at `querySelector("[data-undo-offer]")` (the current Toast renders no offer).

- [ ] **Step 9: Write the new Toast**

Replace the whole of `src/lib/components/ui/Toast.svelte` with:

```svelte
<script lang="ts" module>
  import { browser } from "$app/environment";

  type ToastItem = {
    id: string;
    message: string;
    type: "success" | "error";
    undoAction?: () => void;
  };

  /**
   * Module-level state, so EXACTLY ONE <Toast /> may be mounted — it now
   * lives in (app)/+layout.svelte. Mount a second and every toast renders
   * twice in two aria-live regions, and screen readers announce it twice.
   *
   * The `browser` guard exists because the layout mount means this module is
   * evaluated during SSR on every authenticated page. Module state is
   * per-process on the server, so a showToast() reached during SSR would be
   * visible to whichever user rendered next.
   */
  let toasts = $state<ToastItem[]>([]);

  export function showToast(
    message: string,
    type: "success" | "error" = "success",
    undoAction?: () => void,
  ) {
    if (!browser) return;
    const id = crypto.randomUUID();
    toasts.push({ id, message, type, undoAction });
    scheduleDismiss(id);
  }

  export function dismissToast(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    toasts = toasts.filter((t) => t.id !== id);
  }

  /**
   * Remove every plain toast and stop its timer. The (app) layout calls this,
   * with resetUndoRegistry(), when it unmounts: signing out leaves (app), and
   * on a shared device the next person to sign in must not read what the
   * last one was told. A no-op during SSR, like showToast.
   */
  export function clearToasts(): void {
    if (!browser) return;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    toasts = [];
    pointerInside = false;
    focusInside = false;
  }

  const DISMISS_MS = 5000;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Start or restart the automatic dismissal timer for a toast. */
  function scheduleDismiss(id: string) {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        toasts = toasts.filter((t) => t.id !== id);
      }, DISMISS_MS),
    );
  }

  /**
   * WCAG 2.2.1: a five-second auto-dismiss is a time limit, and the Undo here is
   * the ONLY way back from a logged or deleted dose. Reaching it by keyboard
   * means tabbing past the whole page — comfortably more than five seconds — so
   * hovering or focusing the stack holds it open.
   *
   * Pointer and focus are tracked separately because either one alone is reason
   * to keep holding it. A single pause/resume pair let them overwrite each
   * other: moving the pointer away while an Undo button was focused resumed
   * every timer, and five seconds later the focused toast — and the only route
   * back from a logged or deleted dose — vanished from under the keyboard. The
   * inverse held too, focus leaving while the pointer still hovered.
   *
   * Resuming restarts the full interval rather than the remainder. That is
   * deliberate: it errs towards giving the user more time, never less.
   *
   * The registry's Undo offer is not one of these toasts and has no 5s timer:
   * it stays until it is used, dismissed, replaced or withdrawn, capped by its
   * own deadline (dose-writes/undo-registry.svelte.ts).
   */
  let pointerInside = false;
  let focusInside = false;

  /** Hold or restart dismissal to match the current pointer and focus state. */
  function updateDismissal() {
    if (pointerInside || focusInside) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      return;
    }
    for (const toast of toasts) scheduleDismiss(toast.id);
  }

  /** Record whether the pointer is currently over the toast stack. */
  function setPointerInside(inside: boolean) {
    pointerInside = inside;
    updateDismissal();
  }

  /** Record whether focus is currently inside the toast stack. */
  function setFocusInside(inside: boolean) {
    focusInside = inside;
    updateDismissal();
  }
</script>

<script lang="ts">
  import { STILL_SAVING_TOAST } from "$components/dose-writes/copy";
  import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
  import {
    currentUndo,
    dismissUndo,
    rememberFocusBeforeStack,
    runUndo,
  } from "$components/dose-writes/undo-registry.svelte";

  /**
   * The (app) layout's write lock. Context can only be read while a component
   * initialises, so it is read here; Toast is mounted once, in that layout, and
   * lives exactly as long as it, so this IS the lock every page under the
   * layout reads. Offers never carry a lock: an Undo pressed after navigating
   * holds the lock the page now on screen reads.
   */
  const lock = getDoseWriteLock();
  const offer = $derived(currentUndo());

  async function pressUndo(): Promise<void> {
    // A second press while the first runs does nothing at all — not even
    // "Still saving…", which would describe this Undo as someone else's write.
    const current = currentUndo();
    if (!current || current.running) return;
    const outcome = await runUndo(lock);
    if (outcome.kind === "settled") showToast(outcome.message, outcome.type);
    else if (outcome.kind === "refused" && lock.active) showToast(STILL_SAVING_TOAST, "error");
  }

  /** Remember where focus came from, so an Undo can hand it back there. */
  function onStackFocusIn(e: FocusEvent & { currentTarget: EventTarget & HTMLDivElement }) {
    const from = e.relatedTarget;
    if (!e.currentTarget.contains(from as Node | null)) {
      rememberFocusBeforeStack(from instanceof HTMLElement ? from : null);
    }
    setFocusInside(true);
  }
</script>

<!-- This container IS the live region. The toasts inside previously each carried
     role="alert" as well, nesting an assertive region inside a polite one: the
     inner role won and interrupted whatever was being read. Successes and
     failures both come through here, so polite is the right register.
     data-toast-stack: focus inside it counts as lost (focus-after.ts), so an
     Undo moves it back to the page before its button goes. -->
<div
  class="fixed right-4 bottom-4 z-50 flex flex-col gap-2"
  role="status"
  aria-live="polite"
  aria-atomic="false"
  data-toast-stack
  onmouseenter={() => setPointerInside(true)}
  onmouseleave={() => setPointerInside(false)}
  onfocusin={onStackFocusIn}
  onfocusout={(e) => {
    // focusout also fires moving BETWEEN controls inside the stack, so treat it
    // as leaving only when focus lands outside the container. contains(null) is
    // false, so focus lost to nothing still counts as leaving.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setFocusInside(false);
  }}
>
  {#if offer}
    <!-- The ONE Undo offer. Undo's accessible name is its word plus the
         message, through aria-labelledby ("Undo Dose removed: …"), so the
         live region holds nothing extra and nothing is announced twice. Both
         buttons are 44px, like every other dose control. -->
    <div
      data-undo-offer
      class="border-success/30 bg-success/10 text-success flex max-w-sm flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl"
    >
      <span id="undo-message-{offer.id}" class="min-w-0 flex-1 text-sm">{offer.message}</span>
      <button
        type="button"
        class="min-h-11 px-3 text-sm font-medium underline aria-disabled:cursor-not-allowed"
        aria-labelledby="undo-word-{offer.id} undo-message-{offer.id}"
        aria-disabled={offer.running ? "true" : undefined}
        onclick={pressUndo}
        ><span id="undo-word-{offer.id}">{offer.running ? "Undoing…" : "Undo"}</span></button
      >
      <button
        type="button"
        class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-base aria-disabled:cursor-not-allowed"
        aria-label="Dismiss"
        aria-disabled={offer.running ? "true" : undefined}
        onclick={dismissUndo}><span aria-hidden="true">×</span></button
      >
      {#if offer.note}
        <p class="basis-full text-sm">{offer.note}</p>
      {/if}
    </div>
  {/if}
  {#each toasts as toast (toast.id)}
    <div
      class="flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl {toast.type ===
      'success'
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-danger-ink/30 bg-danger/10 text-danger-ink'}"
    >
      <span class="text-sm">{toast.message}</span>
      {#if toast.undoAction}
        <!-- min-h-11 px-3: Undo is the only one-tap route back from a logged
             dose and must meet the 44px target every dose control does. -->
        <button
          class="min-h-11 px-3 text-sm font-medium underline"
          onclick={() => {
            toast.undoAction?.();
            dismissToast(toast.id);
          }}
        >
          Undo
        </button>
      {/if}
    </div>
  {/each}
</div>
```

The offer reuses the plain success toast's exact colour classes (`border-success/30 bg-success/10 text-success`), so `tests/unit/theme-tokens.test.ts` needs no new chip combination. The legacy `{#if toast.undoAction}` block is unchanged, so `tests/unit/dashboard-chrome-copy.test.ts` still passes; Task 9 removes both.

- [ ] **Step 10: Run the Toast test**

Run: `npx vitest run tests/unit/toast-undo.svelte.test.ts`
Expected: every test in "Toast's Undo offer" PASSES; "the (app) layout › Review Focus #3: clears the Undo offer and every plain toast when it unmounts, …" still FAILS at `expect(currentUndo()).toBeNull()` (nothing clears the registry yet).

- [ ] **Step 11: Clear the registry and the toasts when the layout unmounts**

In `src/routes/(app)/+layout.svelte`:

Replace `import { tick } from "svelte";` with:

```ts
import { onDestroy, tick } from "svelte";
```

Replace `import Toast from "$components/ui/Toast.svelte";` with:

```ts
import Toast, { clearToasts } from "$components/ui/Toast.svelte";
import { resetUndoRegistry } from "$components/dose-writes/undo-registry.svelte";
```

Immediately after the line Task 7 added that calls `setDoseWriteLock(` (it reads `setDoseWriteLock(createDoseWriteLock());`), add:

```ts
// Signing out leaves (app), and this is the one place that sees it happen.
// The Undo offer and the plain toasts are module state and outlive this
// layout, so without this, on a shared device the next person to sign in
// would be shown — and could press — the last person's "Dose removed:
// <their medication>". Both calls are no-ops during SSR, where Svelte also
// runs onDestroy.
onDestroy(() => {
  resetUndoRegistry();
  clearToasts();
});
```

- [ ] **Step 12: Run the Toast test to verify it passes**

Run: `npx vitest run tests/unit/toast-undo.svelte.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 13: Prove the Toast and layout tests by mutation**

Make each change, run `npx vitest run tests/unit/toast-undo.svelte.test.ts`, confirm the named test FAILS, restore, re-run green.

| Mutation (exact line)                                                                                                                                                                                                  | Test that must fail                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Toast.svelte`: inside the Undo `<button>`, before `<span id="undo-word-…">`, add `<span class="sr-only">Undo {offer.message}</span>`                                                                                  | "names Undo by its word and the message through aria-labelledby, …"                                              |
| `Toast.svelte`: delete `aria-labelledby="undo-word-{offer.id} undo-message-{offer.id}"`                                                                                                                                | "names Undo by its word and the message through aria-labelledby, …" (and every test that finds the button by it) |
| `Toast.svelte`: on the Undo button, change `min-h-11` to `min-h-8`                                                                                                                                                     | "gives Undo and Dismiss 44px targets, …"                                                                         |
| `Toast.svelte`: in `pressUndo`, delete `if (!current \|\| current.running) return;`                                                                                                                                    | "a double press sends one request, and says nothing about 'still saving'"                                        |
| `Toast.svelte`: change `const outcome = await runUndo(lock);` to `const outcome = await runUndo(createDoseWriteLock());` (add `import { createDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";`) | "Review Focus #3: an Undo pressed after the page that offered it has gone holds the layout's lock, …"            |
| `Toast.svelte`: change `onclick={dismissUndo}` to `onclick={() => {}}`                                                                                                                                                 | "Dismiss removes the offer and sends nothing"                                                                    |
| `undo-registry.svelte.ts`: in `offerUndo`, change `deadline: (input.respondedAt ?? Date.now()) + lifetime,` to `deadline: Date.now() + 5_000,`                                                                         | "outlives the five seconds a plain toast gets"                                                                   |
| `undo-registry.svelte.ts`: in `runUndo`, move the `focusIfLost(…)` call to just above `lock.hold();`                                                                                                                   | "restores on a press, then puts focus on the restored row's ✎ — never on <body> — …"                             |
| `undo-registry.svelte.ts`: in `runUndo`, delete the `focusIfLost(…)` call                                                                                                                                              | "restores on a press, then puts focus on the restored row's ✎ — never on <body> — …"                             |
| `undo-registry.svelte.ts`: in `runUndo`, delete `if (lock.active) return { kind: "refused" };`                                                                                                                         | "an Undo pressed while another dose write is in flight sends nothing, …"                                         |
| `undo-registry.svelte.ts`: in `runUndo`, delete the `if (navigator.onLine === false) { … }` block                                                                                                                      | "an Undo pressed offline sends nothing, keeps the offer, …"                                                      |
| `(app)/+layout.svelte`: delete the whole `onDestroy(() => { … });` block                                                                                                                                               | "Review Focus #3: clears the Undo offer and every plain toast when it unmounts, …"                               |
| `(app)/+layout.svelte`: delete only `clearToasts();`                                                                                                                                                                   | "Review Focus #3: clears the Undo offer and every plain toast when it unmounts, …"                               |

- [ ] **Step 14: Update the existing tests this change reaches**

Two existing suites mount the real `(app)` layout in jsdom: `tests/unit/mobile-nav-focus.test.ts` and `tests/unit/app-layout-dose-writes.test.ts` (Task 7 Step 31). The layout's Toast now reaches `$app/forms` (through the registry's `deserialize`) and `$app/state` (through `reload-after-write`), and so does the layout's own new `resetUndoRegistry` import. Neither suite submits or reloads, so give both inert stand-ins rather than SvelteKit's client runtime. Task 7 adds neither mock to either file.

**`tests/unit/mobile-nav-focus.test.ts`.** Immediately after this existing block:

```ts
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));
```

add:

```ts
// The layout's Toast reaches `$app/forms` and `$app/state` through the Undo
// registry (dose-writes/undo-registry.svelte.ts). Nothing here submits or
// reloads, so inert stand-ins keep SvelteKit's client runtime out of it.
vi.mock("$app/forms", () => ({
  deserialize: (text: string) => JSON.parse(text),
  enhance: () => ({ destroy() {} }),
}));
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { url: new URL("http://localhost/dashboard"), data: {} },
}));
```

**`tests/unit/app-layout-dose-writes.test.ts`.** Immediately after these existing lines (Task 7 wrote them):

```ts
vi.mock("$app/navigation", () => ({ afterNavigate: () => {} }));
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));
```

add the same two blocks, with their comment:

```ts
// The layout's Toast reaches `$app/forms` and `$app/state` through the Undo
// registry (dose-writes/undo-registry.svelte.ts). Nothing here submits or
// reloads, so inert stand-ins keep SvelteKit's client runtime out of it.
vi.mock("$app/forms", () => ({
  deserialize: (text: string) => JSON.parse(text),
  enhance: () => ({ destroy() {} }),
}));
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { url: new URL("http://localhost/dashboard"), data: {} },
}));
```

Run: `grep -rln 'routes/(app)/+layout.svelte' tests/unit`
Expected: exactly `tests/unit/app-layout-dose-writes.test.ts`, `tests/unit/mobile-nav-focus.test.ts` and `tests/unit/toast-undo.svelte.test.ts` (in any order). The last already mocks both modules (Step 7). If any other file is listed, add the same two blocks to it after its `vi.mock("$app/stores", …)` block and include it in Steps 15–17.

Run: `npx vitest run tests/unit/mobile-nav-focus.test.ts tests/unit/app-layout-dose-writes.test.ts tests/unit/dashboard-chrome-copy.test.ts`
Expected: PASS (all three unchanged in behaviour; the legacy `{#if toast.undoAction}` block the chrome-copy test reads is still there).

- [ ] **Step 15: Run the task's suites and the whole unit suite**

Run: `npx vitest run tests/unit/undo-registry.test.ts tests/unit/toast-undo.svelte.test.ts tests/unit/mobile-nav-focus.test.ts tests/unit/app-layout-dose-writes.test.ts tests/unit/dashboard-chrome-copy.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS — the same number of failing files as before this task (zero, or only suites that already failed to import before Task 1, which the executor recorded when starting the plan). The appearance, notifications and mobile-nav-link-names SSR suites import `showToast` from Toast unmocked and must still pass: Toast's new imports load under the `node` environment as `$app/forms` already does for `dashboard-page-ssr.test.ts`.

- [ ] **Step 16: Type-check and format**

Run: `npm run check 2>&1 | tail -3`
Expected: the same error and warning counts as Step 1.

Run: `npx prettier --check src/lib/components/dose-writes/undo-registry.svelte.ts src/lib/components/ui/Toast.svelte "src/routes/(app)/+layout.svelte" tests/unit/undo-registry.test.ts tests/unit/toast-undo.svelte.test.ts tests/unit/mobile-nav-focus.test.ts tests/unit/app-layout-dose-writes.test.ts`
Expected: all files pass. If one does not, run the same command with `--write` and re-run Step 15's suites.

Run: `npx eslint src/lib/components/dose-writes/undo-registry.svelte.ts src/lib/components/ui/Toast.svelte "src/routes/(app)/+layout.svelte" tests/unit/undo-registry.test.ts tests/unit/toast-undo.svelte.test.ts tests/unit/mobile-nav-focus.test.ts tests/unit/app-layout-dose-writes.test.ts`
Expected: no errors.

Run: `git status --short`
Expected: exactly the seven files in the `git add` below, as new (`??`) or modified (` M`), plus the untracked plan document if it is still untracked. Anything else modified means an edit landed outside this task's files.

- [ ] **Step 17: Commit**

```bash
git add src/lib/components/dose-writes/undo-registry.svelte.ts src/lib/components/ui/Toast.svelte "src/routes/(app)/+layout.svelte" tests/unit/undo-registry.test.ts tests/unit/toast-undo.svelte.test.ts tests/unit/mobile-nav-focus.test.ts tests/unit/app-layout-dose-writes.test.ts
git commit -m "feat(dose-writes): hold the one Undo offer in a registry that Toast renders

The offer is module state, like Toast's list, so it outlives the page that
made it. One at a time: the next dose write replaces it. It stays until
pressed, dismissed, replaced or withdrawn, capped by a deadline 30s inside
the server's restore window, instead of the plain toast's 5s. The deadline
counts from when the response arrived, not from the later offerUndo call.

runUndo holds the layout's lock (Toast reads it from context at init, and
offers never capture one), reloads, moves focus only if it was lost and
only after the reload has rendered the restored row, then settles the offer
by id. Offline, a lost request or a 5xx keep the offer with a note.

The (app) layout clears the offer and every plain toast when it unmounts,
so a shared device never shows the previous user's offer after sign-out."
```

---

### Task 9: `createDoseWrite`, with `DoseActionForm` built on it

`DoseActionForm`'s submit and Undo logic move out into one primitive, `createDoseWrite` (`src/lib/components/dose-writes/dose-write.svelte.ts`), which Tasks 12 and 13 reuse on /log and /medications. It owns the submit order (offline gate → the layout's lock → the dashboard's stale guard → withdrawing the Undo offer for the dose being written → the POST) and every result path, and it **never calls enhance's `update()`**. A create's success now puts up a registry offer (Task 8) instead of a toast carrying its own Undo, so the legacy `undoAction` parameter of `showToast` goes.

**Files:**

- Create: `src/lib/components/dose-writes/dose-write.svelte.ts`
- Create: `tests/unit/helpers/DoseWriteProbe.svelte` (a bare control over the primitive, for its tests)
- Modify: `src/lib/components/dashboard/DoseActionForm.svelte` (whole-file replacement, below)
- Modify: `src/lib/components/dashboard/DueCard.svelte` (anchors: the end of `function focusAfterResolve()`, and the three `undoable` lines after `buildToast={view.logNowToast}`, `buildToast={view.tookToast}` and `buildToast={view.skipToast}`)
- Modify: `src/lib/components/QuickLogBar.svelte` (anchors: `import { formatDoseLabel } from "$lib/utils/dashboard-copy";`, the `chipToast` doc comment, the end of `chipToast`, and `        undoable`)
- Modify: `src/lib/components/ui/Toast.svelte` (whole-file replacement, below: the legacy `undoAction` is removed, and an identical toast already on screen restarts its timer instead of stacking a second)
- Test: `tests/unit/dose-write.svelte.test.ts` (new)
- Test: `tests/unit/toast-undo.svelte.test.ts` (Task 8's; one describe added, anchor: `describe("the (app) layout", () => {`)
- Test: `tests/unit/dose-action-form.test.ts` (rewritten)
- Test: `tests/unit/due-card-focus.test.ts` (rewritten)
- Test: `tests/unit/quick-log-bar.test.ts` (rewritten)
- Test: `tests/unit/dose-write-lock.test.ts` (one mock added)
- Test: `tests/unit/dashboard-chrome-copy.test.ts` (the `Toast` describe replaced)

**Interfaces:**

- Consumes:
  - Task 7, `$components/dose-writes/dose-write-lock.svelte`: `getDoseWriteLock()`, `createDoseWriteLock(opts?)`, `DOSE_WRITE_COOLDOWN_MS`, `DoseWriteLock { readonly busy; readonly active; acquire(); release(); hold(); extend() }`.
  - Task 7, `$components/dose-writes/copy`: `OFFLINE_WRITE_TOAST`, `STILL_SAVING_TOAST`, `STALE_TAP_MESSAGE`, `SUCCESS_FALLBACK_TOAST`, `UNKNOWN_OUTCOME_TOAST`, `UNDONE_TOAST`, `DELETE_ACTION`.
  - Task 7, `$components/dose-writes/reload-after-write`: `HEALTH_PROBE_BACKOFF_MS: readonly number[]` (`[2_000, 4_000, 8_000, 16_000, 30_000]`), `reloadAfterWrite(opts?: { waitForServer?: boolean }): Promise<void>` (waits for an in-flight navigation via `navigating.to`/`willUnload`/`complete`; then, if `waitForServer` or offline, for the `online` event and a first `ok` `fetch("/api/health", { cache: "no-store" })`, probing at once and then after each backoff; then `invalidateAll()` in a try/catch), `reloadDocumentIfUpdated(): boolean` (`location.reload()` and `true` when `updated.current`).
  - Task 7, `$components/dose-writes/focus-after`: `focusTargetAfterResolve(key, followingKeys, opts = {}, root = document)`, `focusIfLost(...candidates)`.
  - Task 7, `$components/dashboard/dashboard-clock`: `DashboardClock` gains `isExpired(): boolean`.
  - Task 7, `tests/unit/helpers/dashboard-context.ts`: `doseWriteContext(lock?)`, `dashboardContext(opts)`, `fixedClock(now, overrides)` (with `isExpired`).
  - Task 8, `$components/dose-writes/undo-registry.svelte`: `UndoKind`, `UndoOfferInput`, `offerUndo`, `currentUndo`, `clearUndo`, `withdrawUndoFor`, `runUndo`, `resetUndoRegistry`. `UndoOfferInput` carries `respondedAt?: number` (epoch ms the response that made the offer arrived), and `offerUndo` sets `deadline: (input.respondedAt ?? Date.now()) + lifetime`, where `lifetime` is `expiresInMs − 30_000` for a restore.
  - Task 2: a delete action answers `{ success: true, doseId, restore: { deletedAt: <iso>, expiresInMs: DOSE_UNDO_WINDOW_MS } }` (no `restore` for `forUndo=1`).
  - `$lib/utils/quick-log`: `findQuickLogForm(root, medicationId): HTMLFormElement | null` (existing).
- Produces (exactly as the contract names them):

  ```ts
  export interface DoseWriteOptions {
    staleGuard?: DashboardClock;
    undo?: { kind: UndoKind; focusTarget: () => HTMLElement | null };
    withdrawsUndoFor?: string;
    buildToast?: (doseId: string | null, respondedAt: Date) => string | null;
    focusAfter?: () => HTMLElement | null;
    busyContainer?: () => HTMLElement | null;
    onSuccess?: () => void;
  }
  export interface DoseWrite {
    submit: SubmitFunction;
    readonly pending: boolean;
    readonly busy: boolean;
    onkeydown: (e: KeyboardEvent) => void;
  }
  export function createDoseWrite(getOptions: () => DoseWriteOptions): DoseWrite; // call during component init
  ```

  - On success the primitive's FIRST step is `const respondedAt = Date.now();`, before `readSuccess` and before `reloadAfterWrite()`. It calls `options.buildToast?.(doseId, new Date(respondedAt))` after the reload, and passes `respondedAt` to `offerUndo`, so the offer's deadline and the toast's time both count from the response, never from the end of a reload that waited out a navigation or an unreachable server. `expiresInMs` is passed through exactly as the server sent it. A one-argument `buildToast` stays valid.
  - `DoseActionForm` props: `undoable?: boolean` is replaced by `undo?: DoseWriteOptions["undo"]`, and `withdrawsUndoFor?: string` is added. `buildToast` is now typed `DoseWriteOptions["buildToast"]`, so it also receives the response time; every existing one-argument builder stays valid. Every other prop is unchanged (`action`, `fields`, `label`, `srContext`, `pendingLabel`, `variant`, `quickLog`, `focusAfter`, `onSuccess`, `children`, `class`). Task 10 passes `undo: { kind: "restore", … }` and `withdrawsUndoFor` from DoneList and the edit dialog.
  - `showToast(message: string, type?: "success" | "error")` — two parameters only. A toast with the same message and type already on screen has its five-second timer restarted instead of a second one being pushed, so taps refused during one write show one "Still saving your last change…".

---

- [ ] **Step 1: Record the type-check baseline**

Run: `npm run check 2>&1 | tail -3`
Expected: `svelte-check found N errors and M warnings`. Write N and M down; Step 22 compares against them.

- [ ] **Step 2: Write the probe component**

Create `tests/unit/helpers/DoseWriteProbe.svelte`:

```svelte
<!--
  A bare control over createDoseWrite, for tests/unit/dose-write.svelte.test.ts.
  DoseActionForm always passes the dashboard clock as its stale guard; the
  /log and /medications controls pass none, and this is how the suite drives
  the primitive the way they do: with only the lock in context.
-->
<script lang="ts">
  import { enhance } from "$app/forms";
  import {
    createDoseWrite,
    type DoseWriteOptions,
  } from "$lib/components/dose-writes/dose-write.svelte";

  let {
    action = "?/logDose",
    fields = { medicationId: "m1", quantity: "1" },
    options = {},
  }: {
    action?: string;
    fields?: Record<string, string>;
    options?: DoseWriteOptions;
  } = $props();

  const write = createDoseWrite(() => options);
</script>

<form method="POST" {action} use:enhance={write.submit}>
  {#each Object.entries(fields) as [name, value] (name)}
    <input type="hidden" {name} {value} />
  {/each}
  <button type="submit" aria-disabled={write.busy ? "true" : undefined} onkeydown={write.onkeydown}
    >Write</button
  >
</form>
```

- [ ] **Step 3: Write the failing primitive test**

Create `tests/unit/dose-write.svelte.test.ts`:

```ts
// createDoseWrite — the one client path for a dose write, on every page —
// driven through a bare control (helpers/DoseWriteProbe.svelte), really
// mounted, with its use:enhance callback driven by hand. DoseActionForm, the
// dashboard's markup over it, is in dose-action-form.test.ts; pressing an
// Undo is in undo-registry.test.ts; the reload's own rules are in
// reload-after-write.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  invalidateAll: vi.fn(async () => {}),
  applyAction: vi.fn(async (_result: unknown) => {}),
  showToast: vi.fn(),
  navigating: { to: null, willUnload: null, complete: null } as {
    to: unknown;
    willUnload: boolean | null;
    complete: Promise<void> | null;
  },
  updated: { current: false },
  reloadDocumentIfUpdated: vi.fn(() => false),
}));

// The registry's offerUndo/withdrawUndoFor are no-ops unless `browser`.
vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: (result: unknown) => h.applyAction(result),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
// The real shape of $app/state's `navigating` and `updated` (kit
// src/runtime/app/state/client.js), mutated per test.
vi.mock("$app/state", () => ({ navigating: h.navigating, updated: h.updated, page: { data: {} } }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));
// The real reload, except the document reload: jsdom's location.reload cannot
// be observed. The stand-in answers from `updated.current`, as the real one
// does before it reloads.
vi.mock("$lib/components/dose-writes/reload-after-write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/components/dose-writes/reload-after-write")>()),
  reloadDocumentIfUpdated: () => h.reloadDocumentIfUpdated(),
}));

import DoseWriteProbe from "./helpers/DoseWriteProbe.svelte";
import {
  OFFLINE_WRITE_TOAST,
  STILL_SAVING_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { HEALTH_PROBE_BACKOFF_MS } from "$lib/components/dose-writes/reload-after-write";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
  type UndoOfferInput,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

type ProbeProps = ComponentProps<typeof DoseWriteProbe>;

const SUCCESS: ActionResult = {
  type: "success",
  status: 200,
  data: { success: true, doseId: "d-new" },
};
const DELETED: ActionResult = {
  type: "success",
  status: 200,
  data: {
    success: true,
    doseId: "d1",
    restore: { deletedAt: "2026-05-01T12:59:59.000Z", expiresInMs: 600_000 },
  },
};
const NOT_FOUND: ActionResult = {
  type: "failure",
  status: 404,
  data: { errors: { form: ["Medication not found"] } },
};
const CONFLICT: ActionResult = {
  type: "failure",
  status: 409,
  data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
};
const CRASH: ActionResult = {
  type: "error",
  status: 500,
  error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
};
/** What enhance builds when fetch itself rejects: no response, so no status. */
const LOST: ActionResult = { type: "error", error: new TypeError("Failed to fetch") };

/** An offer a previous delete of d1 left standing. */
const REMOVAL_OFFER: UndoOfferInput = {
  message: "Dose removed: Paracetamol 500mg at 8:00",
  doseId: "d1",
  kind: "restore",
  deletedAt: "2026-05-01T12:50:00.000Z",
  expiresInMs: 600_000,
  focusTarget: () => null,
};

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

const cleanups: Array<() => void> = [];

function mountProbe(opts: {
  lock: DoseWriteLock;
  props?: Partial<ProbeProps>;
  context?: Map<symbol, unknown>;
}) {
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(DoseWriteProbe, {
    target,
    props: opts.props ?? {},
    context: opts.context ?? doseWriteContext(opts.lock),
  });
  flushSync();
  cleanups.push(() => {
    unmount(component);
    target.remove();
  });
  const form = target.querySelector("form");
  const button = target.querySelector("button");
  if (!form || !button) throw new Error("DoseWriteProbe rendered no form or button");
  const submit = h.submits.get(form);
  if (!submit) throw new Error("use:enhance never attached");
  return { form, button, submit };
}

beforeEach(() => {
  vi.useFakeTimers();
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.applyAction.mockReset();
  h.showToast.mockReset();
  Object.assign(h.navigating, { to: null, willUnload: null, complete: null });
  h.updated.current = false;
  h.reloadDocumentIfUpdated.mockReset();
  h.reloadDocumentIfUpdated.mockImplementation(() => h.updated.current);
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  resetUndoRegistry();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("createDoseWrite, before anything is sent", () => {
  it("offline at submit: cancels, says nothing was saved, and takes no lock", async () => {
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock });
    setOnline(false);

    const { cancel, callback } = await startSubmit(submit, form);

    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(OFFLINE_WRITE_TOAST, "error");
    expect(lock.busy).toBe(false);
  });

  it("two controls under one layout share its lock: a write in one cancels the other's submit", async () => {
    const lock = createDoseWriteLock();
    const context = doseWriteContext(lock);
    const a = mountProbe({ lock, context });
    const b = mountProbe({
      lock,
      context,
      props: { fields: { medicationId: "m2", quantity: "1" } },
    });

    const first = await startSubmit(a.submit, a.form);
    const second = await startSubmit(b.submit, b.form);

    expect(first.callback).not.toBeNull();
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(second.callback).toBeNull();
  });

  it("a tap refused while another write is in flight says it is still saving; one refused in the cooldown alone says nothing", async () => {
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock });

    lock.acquire(); // another write is in flight
    let tap = await startSubmit(submit, form);
    expect(tap.cancel).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error");

    lock.release(); // it settled; its cooldown is running
    h.showToast.mockClear();
    tap = await startSubmit(submit, form);
    expect(tap.cancel).toHaveBeenCalledOnce();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("with no staleGuard there is no stale check and no dashboard clock is needed — /log and /medications pass none", async () => {
    const lock = createDoseWriteLock();
    // doseWriteContext holds the lock only: there is no DASHBOARD_CLOCK.
    const { form, submit } = mountProbe({ lock, props: { options: {} } });

    const { cancel, callback } = await startSubmit(submit, form);

    expect(cancel).not.toHaveBeenCalled();
    expect(callback).not.toBeNull();
  });

  it("withdraws the Undo offer for its own dose once the write is sure to be sent — a refused write withdraws nothing", async () => {
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({
      lock,
      props: {
        action: "?/deleteDose",
        fields: { doseId: "d1" },
        options: { withdrawsUndoFor: "d1" },
      },
    });
    offerUndo(REMOVAL_OFFER);

    lock.acquire(); // refused: the user keeps their Undo
    await startSubmit(submit, form);
    expect(currentUndo()?.doseId).toBe("d1");

    lock.release();
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    const { callback } = await startSubmit(submit, form);
    expect(callback).not.toBeNull();
    expect(currentUndo()).toBeNull();
  });

  it("a held Enter fires once: the repeat is defaultPrevented, the first press is not", () => {
    const { button } = mountProbe({ lock: createDoseWriteLock() });
    const first = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const held = new KeyboardEvent("keydown", {
      key: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });

    button.dispatchEvent(first);
    button.dispatchEvent(held);

    expect(first.defaultPrevented).toBe(false);
    expect(held.defaultPrevented).toBe(true);
  });
});

describe("createDoseWrite, on the result", () => {
  it("never calls update(): a failure posted to another route's action still toasts", async () => {
    // SvelteKit's update() applies a result only while the posting route is
    // the page on screen, and this page is not /dashboard.
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock, props: { action: "/dashboard?/logDose" } });

    for (const result of [SUCCESS, NOT_FOUND, CRASH]) {
      await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
      const { callback } = await startSubmit(submit, form);
      const { update, done } = finishSubmit(callback!, form, result);
      await done;
      expect(update).not.toHaveBeenCalled();
    }
    expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
  });

  it("a delete's success offers Undo as a restore carrying the response's deletedAt and window", async () => {
    const focusTarget = () => null;
    const { form, submit } = mountProbe({
      lock: createDoseWriteLock(),
      props: {
        action: "?/deleteDose",
        fields: { doseId: "d1" },
        options: {
          undo: { kind: "restore", focusTarget },
          buildToast: () => "Dose removed: Paracetamol 500mg at 8:00",
        },
      },
    });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, DELETED).done;

    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d1",
      message: "Dose removed: Paracetamol 500mg at 8:00",
      deletedAt: "2026-05-01T12:59:59.000Z",
      expiresInMs: 600_000,
      focusTarget,
    });
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("a delete's offer deadline counts from the response, not from the end of a slow reload", async () => {
    // The reload can wait out a navigation, or an unreachable server, for as
    // long as it takes. The server's window started when it answered.
    h.invalidateAll.mockImplementationOnce(
      () => new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    );
    const { form, submit } = mountProbe({
      lock: createDoseWriteLock(),
      props: {
        action: "?/deleteDose",
        fields: { doseId: "d1" },
        options: { undo: { kind: "restore", focusTarget: () => null } },
      },
    });

    const { callback } = await startSubmit(submit, form);
    const t0 = Date.now(); // the response arrives now
    const { done } = finishSubmit(callback!, form, DELETED);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    // 30s inside the server's 600_000ms window, counted from t0, not t0 + 5s.
    expect(currentUndo()!.deadline).toBe(t0 + 600_000 - 30_000);
    // The window itself is passed through as the server sent it.
    expect(currentUndo()!.expiresInMs).toBe(600_000);
  });

  it("builds the toast with the time the response arrived, not the time a slow reload finished", async () => {
    h.invalidateAll.mockImplementationOnce(
      () => new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    );
    const buildToast = vi.fn(
      (_doseId: string | null, respondedAt: Date) => `Logged at ${respondedAt.toISOString()}`,
    );
    const { form, submit } = mountProbe({
      lock: createDoseWriteLock(),
      props: { options: { buildToast } },
    });

    const { callback } = await startSubmit(submit, form);
    const t0 = Date.now(); // the response arrives now
    const { done } = finishSubmit(callback!, form, SUCCESS);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(buildToast).toHaveBeenCalledWith("d-new", new Date(t0));
    expect(h.showToast).toHaveBeenCalledWith(`Logged at ${new Date(t0).toISOString()}`, "success");
  });

  it("a success with no Undo of its own shows a plain toast and clears the offer another write left", async () => {
    offerUndo(REMOVAL_OFFER);
    const { form, submit } = mountProbe({
      lock: createDoseWriteLock(),
      props: { options: { buildToast: () => "Metformin 500mg logged at 13:00" } },
    });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    expect(h.showToast).toHaveBeenCalledWith("Metformin 500mg logged at 13:00", "success");
    expect(currentUndo()).toBeNull();
  });

  it("after a 409 whose reload lost focus, focus goes to focusAfter; focus somewhere real is left alone", async () => {
    const heading = document.body.appendChild(document.createElement("h1"));
    heading.tabIndex = -1;
    const lock = createDoseWriteLock();
    const { form, button, submit } = mountProbe({
      lock,
      props: { options: { focusAfter: () => heading } },
    });

    // The reload removed what had focus: it fell to <body>.
    h.invalidateAll.mockImplementationOnce(async () => button.blur());
    button.focus();
    let { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, CONFLICT).done;
    expect(document.activeElement).toBe(heading);

    // Focus the user moved somewhere real during the request stays there.
    const search = document.body.appendChild(document.createElement("input"));
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    ({ callback } = await startSubmit(submit, form));
    search.focus();
    await finishSubmit(callback!, form, CONFLICT).done;
    expect(document.activeElement).toBe(search);
  });

  it("a 409 once a newer version is deployed reloads the document, not just the data", async () => {
    h.updated.current = true;
    const { form, submit } = mountProbe({ lock: createDoseWriteLock() });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, CONFLICT).done;

    expect(h.reloadDocumentIfUpdated).toHaveBeenCalledOnce();
    expect(h.invalidateAll).not.toHaveBeenCalled();
  });

  it("Review Focus #1: a request lost while online keeps the lock, probes /api/health, and reloads exactly once when it answers", async () => {
    const health = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 }) // the service worker's synthetic "Offline"
      .mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", health);
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock });

    const { callback } = await startSubmit(submit, form);
    const { done } = finishSubmit(callback!, form, LOST);
    await flushMicrotasks();

    expect(h.showToast).toHaveBeenCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
    expect(health).toHaveBeenCalledTimes(1);
    expect(health.mock.calls[0][0]).toBe("/api/health");
    expect(h.invalidateAll).not.toHaveBeenCalled();
    // The write may have landed. A retry now would act on data nobody has checked.
    expect(lock.active).toBe(true);

    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_BACKOFF_MS[0]);
    await done;

    expect(health).toHaveBeenCalledTimes(2);
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
    expect(lock.busy).toBe(true); // cooling down, as after any write
  });

  it("a request lost while offline reloads nothing until the connection is back", async () => {
    const health = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", health);
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock });

    const { callback } = await startSubmit(submit, form);
    setOnline(false);
    const { done } = finishSubmit(callback!, form, LOST);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(health).not.toHaveBeenCalled();
    expect(h.invalidateAll).not.toHaveBeenCalled();
    expect(lock.active).toBe(true);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    await done;

    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
  });

  it("a result that lands mid-navigation waits for the navigation to finish before reloading", async () => {
    const { form, submit } = mountProbe({ lock: createDoseWriteLock() });
    const { callback } = await startSubmit(submit, form);
    const navigation = deferred();
    Object.assign(h.navigating, {
      to: { url: new URL("http://localhost/log") },
      willUnload: false,
      complete: navigation.promise,
    });

    const { done } = finishSubmit(callback!, form, SUCCESS);
    await flushMicrotasks();
    // An invalidateAll now would abort the navigation the user started.
    expect(h.invalidateAll).not.toHaveBeenCalled();

    Object.assign(h.navigating, { to: null, willUnload: null, complete: null });
    navigation.resolve();
    await done;
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("applies a redirect", async () => {
    const redirect: ActionResult = { type: "redirect", status: 303, location: "/auth/login" };
    const { form, submit } = mountProbe({ lock: createDoseWriteLock() });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, redirect).done;

    expect(h.applyAction).toHaveBeenCalledWith(redirect);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run tests/unit/dose-write.svelte.test.ts`
Expected: FAIL — the suite cannot load: `Failed to resolve import "$lib/components/dose-writes/dose-write.svelte"` from `tests/unit/helpers/DoseWriteProbe.svelte`.

- [ ] **Step 5: Write the primitive**

Create `src/lib/components/dose-writes/dose-write.svelte.ts`:

```ts
import { tick } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";
import { applyAction } from "$app/forms";
import type { DashboardClock } from "$components/dashboard/dashboard-clock";
import { showToast } from "$components/ui/Toast.svelte";
import { actionErrorMessage } from "$lib/utils/form-errors";
import {
  OFFLINE_WRITE_TOAST,
  STALE_TAP_MESSAGE,
  STILL_SAVING_TOAST,
  SUCCESS_FALLBACK_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "./copy";
import { getDoseWriteLock } from "./dose-write-lock.svelte";
import { focusIfLost } from "./focus-after";
import { reloadAfterWrite, reloadDocumentIfUpdated } from "./reload-after-write";
import { clearUndo, offerUndo, withdrawUndoFor, type UndoKind } from "./undo-registry.svelte";

/**
 * The ONE client path for a dose write, on every page: the dashboard's Due
 * cards, chips and Done removals (through DoseActionForm), the /log × and the
 * medications card's Log. Edit Save is the stated exception: it keeps its own
 * enhance for inline field errors, and follows the same rules by hand
 * (DoseEditForm).
 *
 * At submit, in this order, and each step can stop the write: the offline
 * gate, the layout's write lock, the dashboard's stale guard, withdrawing the
 * Undo offer for the dose being written (only now, so a refused tap never
 * deletes the user's Undo), then the request. On the result it owns the
 * reload, the toast or Undo offer, focus and the release.
 *
 * It never calls enhance's `update()`. That applies a result only while the
 * action's route is the page on screen (kit forms.js), so a failure posted
 * across routes — the card's Log posts to /dashboard from /medications — was
 * dropped silently, and its reset_focus sent focus to <body>. None of these
 * pages reads `form` for a dose action, so nothing is lost. Every reload goes
 * through reloadAfterWrite(), which waits out a navigation in flight and, when
 * it must, for the server to be reachable.
 */

export interface DoseWriteOptions {
  /** The dashboard's clock. A tap on a payload that has expired is refused and the page reloaded. Only dashboard controls pass one. */
  staleGuard?: DashboardClock;
  /**
   * Offer an Undo on success. "delete" for a create (the Undo deletes the new
   * dose), "restore" for a delete (the Undo restores it with the response's
   * `restore` handle). `focusTarget` is where focus goes once that Undo has run.
   */
  undo?: { kind: UndoKind; focusTarget: () => HTMLElement | null };
  /** The dose this write acts on. An Undo offer naming it is withdrawn once the write is sure to be sent. */
  withdrawsUndoFor?: string;
  /**
   * Called AFTER the reload, so it reads the reloaded page, with the returned
   * doseId and the time the response ARRIVED: a reload can take a while, and
   * "logged at" means when the server answered. null falls back to "Saved".
   */
  buildToast?: (doseId: string | null, respondedAt: Date) => string | null;
  /** Where focus goes after a success, and after a failure when the reload lost it. Never another dose's write button. */
  focusAfter?: () => HTMLElement | null;
  /** Marked aria-busy while the write is in flight (a Due card). */
  busyContainer?: () => HTMLElement | null;
  onSuccess?: () => void;
}

export interface DoseWrite {
  /** For `use:enhance`. */
  submit: SubmitFunction;
  /** This control's own write is in flight: show its spinner. */
  readonly pending: boolean;
  /** Any dose write holds the layout's lock, or it is cooling down: render aria-disabled. */
  readonly busy: boolean;
  /** For the write button. Enter activates on keydown and repeats; Space does neither. */
  onkeydown: (e: KeyboardEvent) => void;
}

/** What a delete or log action's success says about the dose it wrote. */
function readSuccess(data: Record<string, unknown> | undefined): {
  doseId: string | null;
  deletedAt: string | undefined;
  expiresInMs: number | undefined;
} {
  const restore = data?.restore as { deletedAt?: unknown; expiresInMs?: unknown } | undefined;
  return {
    doseId: typeof data?.doseId === "string" ? data.doseId : null,
    deletedAt: typeof restore?.deletedAt === "string" ? restore.deletedAt : undefined,
    expiresInMs: typeof restore?.expiresInMs === "number" ? restore.expiresInMs : undefined,
  };
}

/**
 * Call during a component's initialisation: it reads the (app) layout's write
 * lock from context. `getOptions` is called once per submit, and the values
 * it returns are used for the whole write: the response usually re-renders
 * the control away, and a callback must not read props of a component the
 * reload has unmounted.
 */
export function createDoseWrite(getOptions: () => DoseWriteOptions): DoseWrite {
  const lock = getDoseWriteLock();
  let pending = $state(false);

  const submit: SubmitFunction = ({ cancel }) => {
    const options = getOptions();

    // 1. Nothing can be sent: take no lock and withdraw nothing.
    if (navigator.onLine === false) {
      cancel();
      showToast(OFFLINE_WRITE_TOAST, "error");
      return;
    }

    // 2. One dose write at a time, across every page under the layout.
    if (!lock.acquire()) {
      cancel();
      // A write in flight: say so, or a refused 1–9 press looks like nothing
      // happened. A tap refused by the cooldown alone is a double tap, and
      // stays silent.
      if (lock.active) showToast(STILL_SAVING_TOAST, "error");
      return;
    }

    // 3. The dashboard's payload has expired (on the SERVER's clock). Refuse,
    // reload, and hold the lock through the reload, so nothing is tapped on
    // the old list.
    if (options.staleGuard?.isExpired()) {
      cancel();
      showToast(STALE_TAP_MESSAGE, "error");
      const release = () => lock.release();
      reloadAfterWrite().then(release, release);
      return;
    }

    // 4. The write is now sure to be sent.
    if (options.withdrawsUndoFor) withdrawUndoFor(options.withdrawsUndoFor);

    // Where focus was at the tap: the button, or whatever a 1–9 shortcut was
    // pressed from. A caller with no focusAfter (a chip) gets it back here.
    const returnFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const busyElement = options.busyContainer?.() ?? null;
    pending = true;
    busyElement?.setAttribute("aria-busy", "true");

    /** After a failure: only if the reload lost focus, never over where the user put it. */
    const refocusIfLost = () =>
      focusIfLost(
        () => options.focusAfter?.(),
        () => (returnFocus?.isConnected ? returnFocus : null),
      );

    return async ({ result }) => {
      try {
        if (result.type === "success") {
          // First, before anything can wait: the server's restore window and
          // the time a toast states both run from its answer, not from the end
          // of a reload that waited out a navigation or an unreachable server.
          const respondedAt = Date.now();
          const { doseId, deletedAt, expiresInMs } = readSuccess(result.data);
          await reloadAfterWrite();
          await tick();
          // Built from the RELOADED data, so it can say what the dose covered.
          const message =
            options.buildToast?.(doseId, new Date(respondedAt)) ?? SUCCESS_FALLBACK_TOAST;
          // Whatever offer is left belongs to an earlier write: this one replaces or ends it.
          clearUndo();
          const undo = options.undo;
          if (undo && doseId && (undo.kind === "delete" || deletedAt !== undefined)) {
            offerUndo({
              message,
              doseId,
              kind: undo.kind,
              deletedAt,
              // As the server sent it: the deadline counts from respondedAt.
              expiresInMs,
              respondedAt,
              focusTarget: undo.focusTarget,
            });
          } else {
            showToast(message, "success");
          }
          (options.focusAfter
            ? options.focusAfter()
            : returnFocus?.isConnected
              ? returnFocus
              : null
          )?.focus();
          options.onSuccess?.();
        } else if (result.type === "failure") {
          showToast(actionErrorMessage(result), "error");
          // A 409 means the button that failed is stale. A tab still running
          // pre-deploy code reloads itself instead of repeating a refused post.
          if (result.status === 409 && !reloadDocumentIfUpdated()) await reloadAfterWrite();
          refocusIfLost();
        } else if (result.type === "error") {
          if (result.status === undefined) {
            // The request never completed: the write may or may not have
            // landed. Keep the lock until the server answers and the page has
            // reloaded, so no retry acts on data nobody has checked.
            showToast(UNKNOWN_OUTCOME_TOAST, "error");
            await reloadAfterWrite({ waitForServer: true });
          } else {
            showToast(actionErrorMessage(result), "error");
            await reloadAfterWrite();
          }
          refocusIfLost();
        } else {
          await applyAction(result);
        }
      } finally {
        pending = false;
        busyElement?.removeAttribute("aria-busy");
        lock.release();
      }
    };
  };

  return {
    submit,
    get pending() {
      return pending;
    },
    get busy() {
      return lock.busy;
    },
    onkeydown(e: KeyboardEvent) {
      if (e.key === "Enter" && e.repeat) e.preventDefault();
    },
  };
}
```

- [ ] **Step 6: Run the primitive test to verify it passes**

Run: `npx vitest run tests/unit/dose-write.svelte.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 7: Prove the primitive tests by mutation**

Make each change, run `npx vitest run tests/unit/dose-write.svelte.test.ts`, confirm the named test FAILS, restore, re-run green. Rows marked _(Task 7)_ break Task 7's `reload-after-write.ts`: the primitive's tests are what catch them from the write's side.

| Mutation (exact line)                                                                                                                                                                                                                                  | Test that must fail                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `dose-write.svelte.ts`: delete the `if (navigator.onLine === false) { … }` block                                                                                                                                                                       | "offline at submit: cancels, says nothing was saved, and takes no lock"                                                  |
| `dose-write.svelte.ts`: change `const lock = getDoseWriteLock();` to `const lock = createDoseWriteLock();` (import it from `./dose-write-lock.svelte`)                                                                                                 | "two controls under one layout share its lock: …"                                                                        |
| `dose-write.svelte.ts`: change `if (lock.active) showToast(STILL_SAVING_TOAST, "error");` to `if (lock.busy) showToast(STILL_SAVING_TOAST, "error");`                                                                                                  | "a tap refused while another write is in flight says it is still saving; one refused in the cooldown alone says nothing" |
| `dose-write.svelte.ts`: add `const clock = getDashboardClock();` as the second line of `createDoseWrite` (import it from `$components/dashboard/dashboard-clock`)                                                                                      | "with no staleGuard there is no stale check and no dashboard clock is needed — …" (mount throws)                         |
| `dose-write.svelte.ts`: move `if (options.withdrawsUndoFor) withdrawUndoFor(options.withdrawsUndoFor);` to just before `if (!lock.acquire()) {`                                                                                                        | "withdraws the Undo offer for its own dose once the write is sure to be sent — a refused write withdraws nothing"        |
| `dose-write.svelte.ts`: in `onkeydown`, delete `if (e.key === "Enter" && e.repeat) e.preventDefault();`                                                                                                                                                | "a held Enter fires once: …"                                                                                             |
| `dose-write.svelte.ts`: change `return async ({ result }) => {` to `return async ({ result, update }) => {` and add `await update();` as the first line of the `if (result.type === "success") {` branch                                               | "never calls update(): a failure posted to another route's action still toasts"                                          |
| `dose-write.svelte.ts`: in `offerUndo({ … })`, delete `deletedAt,`                                                                                                                                                                                     | "a delete's success offers Undo as a restore carrying the response's deletedAt and window"                               |
| `dose-write.svelte.ts`: in `offerUndo({ … })`, delete `respondedAt,` (the deadline then counts from the end of the reload)                                                                                                                             | "a delete's offer deadline counts from the response, not from the end of a slow reload"                                  |
| `dose-write.svelte.ts`: change `options.buildToast?.(doseId, new Date(respondedAt))` to `options.buildToast?.(doseId, new Date())`                                                                                                                     | "builds the toast with the time the response arrived, not the time a slow reload finished"                               |
| `dose-write.svelte.ts`: delete `clearUndo();`                                                                                                                                                                                                          | "a success with no Undo of its own shows a plain toast and clears the offer another write left"                          |
| `dose-write.svelte.ts`: in the `failure` branch, delete `refocusIfLost();`                                                                                                                                                                             | "after a 409 whose reload lost focus, focus goes to focusAfter; …"                                                       |
| `dose-write.svelte.ts`: replace the whole `const refocusIfLost = () => focusIfLost(…);` definition with `const refocusIfLost = () => options.focusAfter?.()?.focus();` (focus moved whether or not it was lost)                                        | "after a 409 whose reload lost focus, focus goes to focusAfter; focus somewhere real is left alone"                      |
| `dose-write.svelte.ts`: change `if (result.status === 409 && !reloadDocumentIfUpdated()) await reloadAfterWrite();` to `if (result.status === 409) await reloadAfterWrite();`                                                                          | "a 409 once a newer version is deployed reloads the document, not just the data"                                         |
| `dose-write.svelte.ts`: change `await reloadAfterWrite({ waitForServer: true });` to `await reloadAfterWrite();`                                                                                                                                       | "Review Focus #1: a request lost while online keeps the lock, …"                                                         |
| `dose-write.svelte.ts`: change `await reloadAfterWrite({ waitForServer: true });` to `void reloadAfterWrite({ waitForServer: true });`                                                                                                                 | "Review Focus #1: a request lost while online keeps the lock, …" (the lock is released at once)                          |
| _(Task 7)_ `reload-after-write.ts`: in `waitForServer`, delete `while (navigator.onLine === false) await untilOnline();` (it then probes while offline)                                                                                                | "a request lost while offline reloads nothing until the connection is back"                                              |
| _(Task 7)_ `reload-after-write.ts`: in `settleNavigation()`, delete the whole `if (navigating.to !== null && !navigating.willUnload) { await navigating.complete?.catch(() => {}); }` block, so both of `reloadAfterWrite`'s calls to it skip the wait | "a result that lands mid-navigation waits for the navigation to finish before reloading"                                 |
| `dose-write.svelte.ts`: replace `await applyAction(result);` with nothing                                                                                                                                                                              | "applies a redirect"                                                                                                     |

- [ ] **Step 8: Rewrite the DoseActionForm test (failing)**

Replace the whole of `tests/unit/dose-action-form.test.ts` with:

```ts
// DoseActionForm is the dashboard's markup over createDoseWrite
// (dose-writes/dose-write.svelte.ts). These drive its use:enhance callback by
// hand against a really mounted component, for what DoseActionForm itself
// decides: its markup, that it passes the dashboard clock as the stale guard,
// its card's aria-busy, and that its props reach the primitive. The
// primitive's own rules are in dose-write.svelte.test.ts, pressing an Undo in
// undo-registry.test.ts, SSR markup in due-card-ssr.test.ts, and the 'error'
// ordering in dose-write-lock.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRawSnippet, flushSync } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submit: null as SubmitFunction | null,
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    h.submit = submit;
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: async () => {},
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { data: {} },
}));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import type { DashboardClock } from "$lib/components/dashboard/dashboard-clock";
import {
  DELETE_ACTION,
  STALE_TAP_MESSAGE,
  STILL_SAVING_TOAST,
  SUCCESS_FALLBACK_TOAST,
  UNDONE_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "$lib/components/dose-writes/copy";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
  runUndo,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { fixedClock } from "./helpers/dashboard-context";
import {
  finishSubmit,
  mountDoseActionForm,
  startSubmit,
  type DoseActionFormProps,
} from "./helpers/dose-action-form-harness";
import { accessibleName } from "./helpers/dom-names";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const SUCCESS = { type: "success", status: 200, data: { success: true, doseId: "d-new" } } as const;
/** A create's Undo: it deletes the new dose. */
const CREATE_UNDO = { kind: "delete", focusTarget: () => null } as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

let destroy: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.submit = null;
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
});

afterEach(() => {
  destroy?.();
  destroy = null;
  resetUndoRegistry();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(
  opts: {
    props?: Partial<DoseActionFormProps>;
    clock?: Partial<DashboardClock>;
    insideCard?: boolean;
  } = {},
) {
  const lock = createDoseWriteLock();
  const mounted = mountDoseActionForm({
    lock,
    clock: fixedClock(NOW, opts.clock),
    props: opts.props,
    insideCard: opts.insideCard,
  });
  destroy = mounted.destroy;
  const submit = h.submit;
  if (!submit) throw new Error("use:enhance never attached");
  return { lock, submit, ...mounted };
}

describe("DoseActionForm markup", () => {
  it("posts its fields as hidden inputs to its action", () => {
    const { form } = setup();
    expect(form.getAttribute("action")).toBe("?/logDose");
    expect(Object.fromEntries(new FormData(form))).toEqual({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-05-01T13:30:00.000Z",
    });
  });

  it("names the button by its visible label first, then the screen-reader context", () => {
    const { button } = setup();
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(accessibleName(button)).toBe("Log now: Metformin 500mg, 13:30 dose");
  });

  it("renders children before the label, which is how a chip gets its sr-only 'Log '", () => {
    const { button, form } = setup({
      props: {
        variant: "chip",
        label: "Ibuprofen 200mg ×2",
        srContext: undefined,
        quickLog: true,
        children: createRawSnippet(() => ({ render: () => `<span class="sr-only">Log </span>` })),
      },
    });
    expect(accessibleName(button)).toBe("Log Ibuprofen 200mg ×2");
    expect(form.hasAttribute("data-quick-log")).toBe(true);
  });

  it("marks only quick-log forms with data-quick-log", () => {
    expect(setup().form.hasAttribute("data-quick-log")).toBe(false);
  });

  it("is aria-disabled — never disabled — while any dose write holds the lock", () => {
    const { lock, button } = setup();
    expect(button.getAttribute("aria-disabled")).toBeNull();
    lock.acquire();
    flushSync();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
  });

  it("gives chip and danger their own fixed-height recipes", () => {
    const chip = setup({ props: { variant: "chip" } }).button;
    expect([...chip.classList]).toEqual(expect.arrayContaining(["h-11", "rounded-full"]));
    destroy?.();
    const danger = setup({ props: { variant: "danger" } }).button;
    expect([...danger.classList]).toEqual(expect.arrayContaining(["min-h-11", "text-danger-ink"]));
  });

  it("ignores a held Enter: the repeat is defaultPrevented, the first press is not", () => {
    const { button } = setup();
    const first = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const held = new KeyboardEvent("keydown", {
      key: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(first);
    button.dispatchEvent(held);
    expect(first.defaultPrevented).toBe(false);
    expect(held.defaultPrevented).toBe(true);
  });
});

describe("DoseActionForm submit", () => {
  it("refuses a tap while another dose write is in flight, and says it is still saving", async () => {
    const { lock, form, submit } = setup();
    lock.acquire();
    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error");
  });

  it("refuses a tap during the cooldown silently, with no request", async () => {
    const { lock, form, submit } = setup();
    lock.acquire();
    lock.release();
    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("refuses a tap on an expired list: cancels, says so, reloads, and stays locked until the reload lands", async () => {
    const reload = deferred();
    h.invalidateAll.mockImplementation(() => reload.promise);
    const { lock, form, submit } = setup({ clock: { isExpired: () => true } });

    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(STALE_TAP_MESSAGE, "error");

    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.busy).toBe(true);

    reload.resolve();
    await flushMicrotasks();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });

  it("shows the pending label and marks its card aria-busy until the write settles", async () => {
    const { host, form, button, submit } = setup({ insideCard: true });
    const label = button.querySelector('[data-part="label"]');
    const pending = button.querySelector('[data-part="pending"]');
    expect(pending?.getAttribute("aria-hidden")).toBe("true");

    const { callback } = await startSubmit(submit, form);
    flushSync();
    expect(host.getAttribute("aria-busy")).toBe("true");
    expect(label?.getAttribute("aria-hidden")).toBe("true");
    expect(pending?.getAttribute("aria-hidden")).toBeNull();
    expect(pending?.textContent).toContain("Logging…");

    await finishSubmit(callback!, form, SUCCESS).done;
    flushSync();
    expect(host.hasAttribute("aria-busy")).toBe(false);
    expect(pending?.getAttribute("aria-hidden")).toBe("true");
  });

  it("on success: reloads first, then offers Undo built from the reloaded data, then focuses, then calls onSuccess", async () => {
    const order: string[] = [];
    const target = document.createElement("h1");
    target.tabIndex = -1;
    document.body.append(target);
    const buildToast = vi.fn((doseId: string | null) => {
      order.push(`toast:${doseId}`);
      return "Metformin 500mg logged at 13:00";
    });
    const focusAfter = vi.fn(() => {
      order.push("focus");
      return target;
    });
    const onSuccess = vi.fn(() => {
      order.push("onSuccess");
    });
    // The reload takes time. Everything after it must wait for it to land,
    // or the builder reads the old page data and drops what the reload says.
    const reload = deferred();
    h.invalidateAll.mockImplementation(async () => {
      order.push("reload:start");
      await reload.promise;
      order.push("reload:done");
    });
    const { lock, form, submit } = setup({
      props: { buildToast, undo: CREATE_UNDO, focusAfter, onSuccess },
    });

    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, SUCCESS);
    await flushMicrotasks();
    expect(order).toEqual(["reload:start"]);

    reload.resolve();
    await done;

    expect(order).toEqual(["reload:start", "reload:done", "toast:d-new", "focus", "onSuccess"]);
    expect(currentUndo()).toMatchObject({
      message: "Metformin 500mg logged at 13:00",
      doseId: "d-new",
      kind: "delete",
    });
    expect(h.showToast).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });

  it("with no focusAfter, a chip keeps focus through the reload", async () => {
    // The reload can re-render focus away; a chip has nowhere better to send
    // it than itself, or the next Tab after every keyboard log starts from
    // the top of the page.
    const { form, button, submit } = setup({ props: { variant: "chip", quickLog: true } });
    button.focus();
    h.invalidateAll.mockImplementationOnce(async () => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute("tabindex");
    });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);
  });

  it("still toasts when the reload itself fails — the write did not", async () => {
    h.invalidateAll.mockRejectedValueOnce(new Error("load failed"));
    const buildToast = vi.fn(() => "Metformin 500mg logged at 13:00");
    const { form, submit } = setup({ props: { buildToast } });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    // The second argument is when the response arrived; dose-write.svelte.test.ts pins it.
    expect(buildToast).toHaveBeenCalledWith("d-new", expect.any(Date));
    expect(h.showToast).toHaveBeenCalledWith("Metformin 500mg logged at 13:00", "success");
  });

  it("falls back to a plain 'Saved' toast, with no offer, when there is no builder or no doseId", async () => {
    const { form, submit } = setup({ props: { undo: CREATE_UNDO } });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, { type: "success", status: 200, data: { success: true } })
      .done;
    expect(h.showToast).toHaveBeenCalledWith(SUCCESS_FALLBACK_TOAST, "success");
    expect(currentUndo()).toBeNull();
  });

  it("its create's Undo, pressed, posts the doseId and forUndo=1 to the absolute deleteDose action", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      status: 200,
      text: async () =>
        JSON.stringify({ type: "success", status: 200, data: { success: true, doseId: "d-new" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { lock, form, submit } = setup({
      props: { buildToast: () => "logged", undo: CREATE_UNDO },
    });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    const outcome = await runUndo(lock);

    expect(outcome).toEqual({ kind: "settled", message: UNDONE_TOAST, type: "success" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DELETE_ACTION);
    expect((init?.body as FormData).get("doseId")).toBe("d-new");
    expect((init?.body as FormData).get("forUndo")).toBe("1");
  });

  it("a Remove withdraws its dose's offer when sent, and offers a restore with the response's handle", async () => {
    const { form, submit } = setup({
      props: {
        action: "?/deleteDose",
        fields: { doseId: "d1" },
        label: "Remove this dose",
        srContext: undefined,
        pendingLabel: "Removing…",
        variant: "danger",
        buildToast: () => "Dose removed: Paracetamol 500mg at 8:00",
        undo: { kind: "restore", focusTarget: () => null },
        withdrawsUndoFor: "d1",
      },
    });
    // The offer from logging this dose a moment ago.
    offerUndo({
      message: "Paracetamol 500mg logged at 8:00",
      doseId: "d1",
      kind: "delete",
      focusTarget: () => null,
    });

    const { callback } = await startSubmit(submit, form);
    expect(currentUndo()).toBeNull();

    await finishSubmit(callback!, form, {
      type: "success",
      status: 200,
      data: {
        success: true,
        doseId: "d1",
        restore: { deletedAt: "2026-05-01T12:59:59.000Z", expiresInMs: 600_000 },
      },
    }).done;

    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d1",
      message: "Dose removed: Paracetamol 500mg at 8:00",
      deletedAt: "2026-05-01T12:59:59.000Z",
      expiresInMs: 600_000,
    });
  });

  it("a 409 toasts, reloads before releasing the lock, and never runs update()", async () => {
    const reload = deferred();
    h.invalidateAll.mockImplementation(() => reload.promise);
    const { lock, form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, {
      type: "failure",
      status: 409,
      data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
    });

    expect(h.showToast).toHaveBeenCalledWith(
      "What's due has changed. Refresh to see what's due now.",
      "error",
    );
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
    expect(lock.busy).toBe(true);
    expect(update).not.toHaveBeenCalled();

    reload.resolve();
    await done;
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });

  it("a network failure says the outcome is unknown and the page will update — not the browser's words", async () => {
    // The server answers the reachability probe at once.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 })),
    );
    const { form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, { type: "error", error: new TypeError("Failed to fetch") })
      .done;
    expect(h.showToast).toHaveBeenCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("any other failure toasts and releases without a reload, and never runs update()", async () => {
    const { lock, form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, {
      type: "failure",
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    });
    await done;
    expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
    expect(update).not.toHaveBeenCalled();
    expect(h.invalidateAll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });
});
```

The Undo press's own lock-hold rules (held across its fetch and reload, even over the undone write's cooldown; refused while another write is in flight) were two tests here and now live in `undo-registry.test.ts` (Task 8), because the Undo runs from the registry, not from this component.

- [ ] **Step 9: Run it to verify it fails**

Run: `npx vitest run tests/unit/dose-action-form.test.ts`
Expected: FAIL — including "refuses a tap while another dose write is in flight, and says it is still saving" (no toast), "on success: reloads first, then offers Undo …" (`currentUndo()` is `null`; the old form hands `showToast` a third argument instead), "ignores a held Enter" (no key guard) and "a Remove withdraws its dose's offer when sent, …".

- [ ] **Step 10: Rebuild DoseActionForm on the primitive**

Replace the whole of `src/lib/components/dashboard/DoseActionForm.svelte` with:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import { enhance } from "$app/forms";
  import {
    createDoseWrite,
    type DoseWriteOptions,
  } from "$components/dose-writes/dose-write.svelte";
  import { getDashboardClock } from "./dashboard-clock";

  type Variant = "primary" | "secondary" | "quiet" | "chip" | "danger";

  let {
    action,
    fields,
    label,
    srContext,
    pendingLabel,
    variant,
    quickLog = false,
    buildToast,
    undo,
    withdrawsUndoFor,
    focusAfter,
    onSuccess,
    children,
    class: className = "",
  }: {
    /** The form action, e.g. "?/logDose". */
    action: string;
    /** Posted verbatim as hidden inputs. */
    fields: Record<string, string>;
    /** The visible label — the start of the accessible name (WCAG 2.5.3). */
    label: string;
    /** Screen-reader-only context appended to the label, e.g. ": Metformin 500mg, 11:00 dose". */
    srContext?: string;
    /** Shown with a spinner while pending: "Logging…", "Recording…", "Skipping…", "Removing…". */
    pendingLabel: string;
    variant: Variant;
    /** Marks the form `data-quick-log`: the ONLY forms the 1–9 shortcuts may submit. */
    quickLog?: boolean;
    /** Called AFTER the reload with the returned doseId and the time the response arrived; builds the toast from the reloaded data. */
    buildToast?: DoseWriteOptions["buildToast"];
    /** Offer an Undo on success: "delete" for a create, "restore" for a delete. Needs a doseId in the result. */
    undo?: DoseWriteOptions["undo"];
    /** The dose this write acts on: an Undo offer naming it is withdrawn once the write is sent. */
    withdrawsUndoFor?: string;
    /** Where focus goes after success. Never another write button. */
    focusAfter?: () => HTMLElement | null;
    onSuccess?: () => void;
    /** Rendered inside the button BEFORE the label (a chip's sr-only "Log " and its glyph). */
    children?: Snippet;
    /** Classes for the <form> (layout inside the parent); the button's look is the variant's. */
    class?: string;
  } = $props();

  // The dashboard's markup over createDoseWrite, the one client path for
  // dose writes: the lock, the reload, the toast or Undo offer, focus and
  // every failure are the primitive's. What this adds is the look, and the
  // dashboard clock as the stale guard — only dashboard controls have one.
  const clock = getDashboardClock();
  let formEl: HTMLFormElement | undefined = $state();

  // Read when the form submits, never here: the response usually re-renders
  // this row away, and the callback must not read props of a component the
  // reload has unmounted. createDoseWrite takes the values once, at submit.
  const write = createDoseWrite(() => ({
    staleGuard: clock,
    undo,
    withdrawsUndoFor,
    buildToast,
    focusAfter,
    onSuccess,
    busyContainer: () => formEl?.closest<HTMLElement>("[data-dose-card]") ?? null,
  }));

  // Fixed heights, never padding-derived: data-density="compact" rewrites only
  // .p-5, .p-6 and .py-2.5 (app.css), so none of these can shrink a target.
  const VARIANTS: Record<Variant, string> = {
    primary:
      "h-12 min-w-26 rounded-lg bg-accent px-4 text-base font-semibold text-accent-fg hover:brightness-110",
    secondary:
      "h-11 rounded-lg border border-border-strong px-3 text-sm font-medium text-text-primary hover:bg-surface-overlay",
    quiet:
      "h-11 min-w-11 rounded-lg px-3 text-sm font-medium text-text-secondary hover:bg-surface-overlay",
    chip: "h-11 rounded-full px-3 text-sm font-medium text-text-primary hover:bg-surface-overlay",
    danger: "min-h-11 rounded-lg px-3 text-sm font-medium text-danger-ink hover:bg-surface-overlay",
  };
</script>

<form
  method="POST"
  {action}
  class={className}
  data-quick-log={quickLog ? "" : undefined}
  bind:this={formEl}
  use:enhance={write.submit}
>
  {#each Object.entries(fields) as [name, value] (name)}
    <input type="hidden" {name} {value} />
  {/each}
  <!-- aria-disabled, never `disabled`: the disabled attribute drops keyboard
       focus to <body>. A busy tap is cancelled in the primitive instead. The
       label and the pending label share one grid cell, so the pressed button
       keeps its width. onkeydown: a held Enter fires once. -->
  <button
    type="submit"
    aria-disabled={write.busy ? "true" : undefined}
    onkeydown={write.onkeydown}
    class="inline-flex items-center justify-center transition-colors aria-disabled:cursor-not-allowed {VARIANTS[
      variant
    ]}"
  >
    <span class="inline-grid">
      <span
        data-part="label"
        class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {write.pending
          ? 'invisible'
          : ''}"
        aria-hidden={write.pending ? "true" : undefined}
        >{@render children?.()}<span
          >{label}{#if srContext}<span class="sr-only">{srContext}</span>{/if}</span
        ></span
      >
      <span
        data-part="pending"
        class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {write.pending
          ? ''
          : 'invisible'}"
        aria-hidden={write.pending ? undefined : "true"}
        ><span
          class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        ></span>{pendingLabel}</span
      >
    </span>
  </button>
</form>
```

- [ ] **Step 11: Run the DoseActionForm test to verify it passes**

Run: `npx vitest run tests/unit/dose-action-form.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 12: Prove the DoseActionForm tests by mutation**

| Mutation (exact line, in `DoseActionForm.svelte`)             | Test that must fail                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| delete `staleGuard: clock,`                                   | "refuses a tap on an expired list: cancels, says so, reloads, and stays locked until the reload lands" |
| delete `withdrawsUndoFor,` from the options object            | "a Remove withdraws its dose's offer when sent, and offers a restore with the response's handle"       |
| delete `undo,` from the options object                        | "on success: reloads first, then offers Undo built from the reloaded data, …"                          |
| change the busyContainer line to `busyContainer: () => null,` | "shows the pending label and marks its card aria-busy until the write settles"                         |
| delete `onkeydown={write.onkeydown}`                          | "ignores a held Enter: the repeat is defaultPrevented, the first press is not"                         |

Run `npx vitest run tests/unit/dose-action-form.test.ts` after each, confirm the named test FAILS, restore, re-run green.

- [ ] **Step 13: Rewrite the DueCard focus test and the Quick Log test (failing)**

Replace the whole of `tests/unit/due-card-focus.test.ts` with:

```ts
// Where focus lands after a Due row resolves, with DueCards really mounted.
// The order is: the same card if it survived the reload, else the next card
// that was rendered below it at the tap, else the page's h1. The tap-time
// snapshot is what makes "the next card" answerable: after the reload the
// resolved card is gone and the DOM can no longer say what followed it. A
// Log now's Undo offer sends focus by the same rule, once the Undo's own
// reload has brought the row back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  invalidateAll: vi.fn(async () => {}),
}));

vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$app/state", () => ({
  page: {
    data: {
      done: [],
      todayStart: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
      preferences: { timeFormat: "24h" },
    },
  },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import DueCard from "$lib/components/dashboard/DueCard.svelte";
import type { DueCard as DueCardData } from "$lib/types";
import { currentUndo, resetUndoRegistry } from "$lib/components/dose-writes/undo-registry.svelte";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");
const SUCCESS = { type: "success", status: 200, data: { success: true, doseId: "d-new" } } as const;

/** One card whose only row is due now and offers Log now alone. */
function card(medicationId: string, name: string, expectedTime: string): DueCardData {
  return {
    key: `today:${medicationId}`,
    medicationId,
    name,
    dosageAmount: "10",
    dosageUnit: "mg",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    rows: [
      {
        key: `${medicationId}@${expectedTime}`,
        kind: "fixed_time",
        expectedTime,
        state: "due-now",
        logNow: true,
        tookItAt: null,
        skipAt: null,
      },
    ],
  };
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  resetUndoRegistry();
  vi.useRealTimers();
});

function setup() {
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  const list = document.createElement("ul");
  document.body.append(heading, list);
  const context = dashboardContext({ now: NOW });
  const alive = new Map<string, ReturnType<typeof mount>>();
  /** Render a card, as a reload that brings its row back does. */
  const addCard = (data: DueCardData) => {
    alive.set(
      data.key,
      mount(DueCard, {
        target: list,
        props: {
          card: data,
          serverNow: NOW,
          todayStart: TODAY_START,
          timezone: "UTC",
          timeFormat: "24h",
          focusAfter: () => heading,
        },
        context,
      }),
    );
    flushSync();
  };
  /** What a reload does to a resolved card: it is gone. */
  const removeCard = (key: string) => {
    const component = alive.get(key);
    if (component) unmount(component);
    alive.delete(key);
    flushSync();
  };
  addCard(card("m1", "Metformin", "2026-05-01T12:45:00.000Z"));
  addCard(card("m2", "Lisinopril", "2026-05-01T13:00:00.000Z"));
  addCard(card("m3", "Atorvastatin", "2026-05-01T13:15:00.000Z"));
  cleanup = () => {
    for (const component of alive.values()) unmount(component);
    alive.clear();
    list.remove();
    heading.remove();
  };
  const cardEl = (key: string) => list.querySelector<HTMLElement>(`[data-card-key="${key}"]`);
  return { heading, cardEl, addCard, removeCard };
}

/** Tap a card's Log now: the card's capture-phase snapshot first, then enhance's submit. */
async function tapLogNow(cardElement: HTMLElement) {
  const form = cardElement.querySelector<HTMLFormElement>('form[action="?/logDose"]');
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("the card's Log now never attached use:enhance");
  // The browser fires submit before enhance's handler runs; the card's
  // capture listener sees it first and snapshots the order.
  form.dispatchEvent(
    new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: form.querySelector("button"),
    }),
  );
  const { callback } = await startSubmit(submit, form);
  return { form, callback: callback! };
}

describe("DueCard focus after its row resolves", () => {
  it("moves to the next card below when the tapped card is gone, not back to the top", async () => {
    const { heading, cardEl, removeCard } = setup();
    const { form, callback } = await tapLogNow(cardEl("today:m2")!);
    // The reload is invalidateAll; it re-renders the resolved card away.
    h.invalidateAll.mockImplementationOnce(async () => removeCard("today:m2"));

    await finishSubmit(callback, form, SUCCESS).done;

    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(cardEl("today:m3"));
    expect(document.activeElement).not.toBe(cardEl("today:m1"));
    expect(document.activeElement).not.toBe(heading);
  });

  it("a Log now's Undo sends focus back to its card once the Undo's reload brings the row back, else the card below, else the h1", async () => {
    const { heading, cardEl, addCard, removeCard } = setup();
    const { form, callback } = await tapLogNow(cardEl("today:m2")!);
    h.invalidateAll.mockImplementationOnce(async () => removeCard("today:m2"));
    await finishSubmit(callback, form, SUCCESS).done;

    const offer = currentUndo();
    expect(offer).toMatchObject({ kind: "delete", doseId: "d-new" });
    // Before the Undo runs the row is still resolved: the card that was below it.
    expect(offer!.focusTarget()).toBe(cardEl("today:m3"));
    // The Undo's reload brings the row, and its card, back.
    addCard(card("m2", "Lisinopril", "2026-05-01T13:00:00.000Z"));
    expect(offer!.focusTarget()).toBe(cardEl("today:m2"));
    // With no card left at all, the page's h1.
    for (const key of ["today:m1", "today:m2", "today:m3"]) removeCard(key);
    expect(offer!.focusTarget()).toBe(heading);
  });
});
```

Replace the whole of `tests/unit/quick-log-bar.test.ts` with:

```ts
// The chip's quantity is a per-tap choice, not a sticky setting. It resets to
// 1 after a SUCCESSFUL log and is kept after a failure, so a retry sends what
// the user chose. Live, a chip still read "3×" after a ×3 log. A chip's log
// offers an Undo that hands focus back to that chip.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({ submit: null as SubmitFunction | null }));

vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    h.submit = submit;
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
// A realistic reloaded payload, so whichever dose-toasts helper the chip's
// toast builder calls finds the keys it reads and falls back cleanly.
vi.mock("$app/state", () => ({
  page: {
    data: {
      done: [],
      todayStart: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
      preferences: { timeFormat: "24h" },
    },
  },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import QuickLogBar from "$lib/components/QuickLogBar.svelte";
import type { Medication } from "$lib/types";
import { currentUndo, resetUndoRegistry } from "$lib/components/dose-writes/undo-registry.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";
import { accessibleName } from "./helpers/dom-names";

const METFORMIN: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m1",
  name: "Metformin",
  lowInventoryEpisodeAt: null,
};

const SUCCESS: ActionResult = {
  type: "success",
  status: 200,
  data: { success: true, doseId: "d-new" },
};
const NOT_FOUND: ActionResult = {
  type: "failure",
  status: 404,
  data: { errors: { form: ["Medication not found"] } },
};

let destroy: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.submit = null;
});

afterEach(() => {
  destroy?.();
  destroy = null;
  resetUndoRegistry();
  vi.useRealTimers();
});

function setup() {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(QuickLogBar, {
    target,
    props: {
      medications: [METFORMIN],
      todayStart: new Date("2026-04-16T00:00:00Z"),
      timezone: "UTC",
      timeFormat: "24h",
    },
    context: dashboardContext(),
  });
  flushSync();
  destroy = () => {
    unmount(component);
    target.remove();
  };
  const form = target.querySelector<HTMLFormElement>("form[data-quick-log]");
  const plus = target.querySelector<HTMLButtonElement>(
    'button[aria-label="Increase quantity for Metformin"]',
  );
  const submit = h.submit;
  if (!form || !plus || !submit) {
    throw new Error("no chip form, no + segment, or use:enhance never attached");
  }
  const chip = () => form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const quantity = () => new FormData(form).get("quantity");
  return { form, plus, submit, chip, quantity };
}

describe("QuickLogBar quantity", () => {
  it("resets to 1 after a successful log", async () => {
    const { form, plus, submit, chip, quantity } = setup();
    plus.click();
    flushSync();
    expect(quantity()).toBe("2");
    expect(accessibleName(chip())).toContain("×2");

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;
    flushSync();

    expect(quantity()).toBe("1");
    expect(accessibleName(chip())).not.toContain("×");
  });

  it("keeps the chosen quantity after a failed log, so a retry sends it again", async () => {
    const { form, plus, submit, chip, quantity } = setup();
    plus.click();
    flushSync();
    plus.click();
    flushSync();
    expect(quantity()).toBe("3");

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, NOT_FOUND).done;
    flushSync();

    expect(quantity()).toBe("3");
    expect(accessibleName(chip())).toContain("×3");
  });
});

describe("QuickLogBar Undo", () => {
  it("offers Undo for the dose it logged, and that Undo sends focus back to the chip", async () => {
    const { form, submit, chip } = setup();

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    const offer = currentUndo();
    expect(offer).toMatchObject({ kind: "delete", doseId: "d-new" });
    expect(offer!.focusTarget()).toBe(chip());
  });
});
```

- [ ] **Step 14: Run them to verify they fail**

Run: `npx vitest run tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts`
Expected: FAIL — "a Log now's Undo sends focus back to its card …" and "offers Undo for the dose it logged, …" (`currentUndo()` is `null`: DueCard and QuickLogBar still pass the removed `undoable` prop). The other three tests PASS.

- [ ] **Step 15: Give DueCard and QuickLogBar their Undo targets**

In `src/lib/components/dashboard/DueCard.svelte`, immediately after this existing block:

```ts
/** The same card if it survived, else the next card, else the page's fallback (its h1). */
function focusAfterResolve(): HTMLElement | null {
  const snap = focusSnapshot;
  if (!snap) return focusAfter();
  return focusTargetAfterResolve(snap.key, snap.following) ?? snap.fallback();
}
```

add:

```ts
/**
 * Every write on this card creates a dose, so its Undo deletes it. Once the
 * Undo's reload has brought the row back, focus goes where it would after a
 * resolve: this card, else the card that was below it at the tap, else the
 * page's h1. The snapshot is a plain value, so this still works after the
 * reload has unmounted this card.
 */
const createUndo = { kind: "delete" as const, focusTarget: focusAfterResolve };
```

Then replace each of the three `undoable` props:

```svelte
buildToast={view.logNowToast}
undoable
```

becomes

```svelte
buildToast={view.logNowToast}
undo={createUndo}
```

```svelte
buildToast={view.tookToast}
undoable
```

becomes

```svelte
buildToast={view.tookToast}
undo={createUndo}
```

```svelte
buildToast={view.skipToast}
undoable
```

becomes

```svelte
buildToast={view.skipToast}
undo={createUndo}
```

In `src/lib/components/QuickLogBar.svelte`:

After `import { formatDoseLabel } from "$lib/utils/dashboard-copy";` add:

```ts
import { findQuickLogForm } from "$lib/utils/quick-log";
```

In the `chipToast` doc comment, replace:

```ts
   * The chip's success toast. DoseActionForm calls it after `update()` and
   * `tick()`, so `page.data` is the RELOADED payload and the sentence states
```

with:

```ts
   * The chip's success toast. DoseActionForm calls it after the reload and
   * `tick()`, so `page.data` is the RELOADED payload and the sentence states
```

Immediately after the end of `chipToast`:

```ts
        tz,
        tf,
      );
  }
```

add:

```ts
/**
 * A chip's log is a create, so its Undo deletes the dose, and focus then
 * goes back to that chip: the control the user was on, whether they tapped
 * it or pressed its 1–9 key. The chip is keyed by medication, so the one
 * findQuickLogForm returns after the reload is the same element.
 */
function chipUndo(medId: string) {
  return {
    kind: "delete" as const,
    focusTarget: () =>
      findQuickLogForm(document, medId)?.querySelector<HTMLElement>('button[type="submit"]') ??
      null,
  };
}
```

Replace:

```svelte
undoable buildToast={chipToast(med, qty)}
```

with:

```svelte
undo={chipUndo(med.id)}
buildToast={chipToast(med, qty)}
```

- [ ] **Step 16: Run them to verify they pass**

Run: `npx vitest run tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 17: Prove them by mutation**

| Mutation (exact line)                                                                                                                                                                    | Test that must fail                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DueCard.svelte`: change `const createUndo = { kind: "delete" as const, focusTarget: focusAfterResolve };` to `const createUndo = { kind: "delete" as const, focusTarget: () => null };` | "a Log now's Undo sends focus back to its card once the Undo's reload brings the row back, …" |
| `DueCard.svelte`: on Log now, change `undo={createUndo}` back to `undoable`                                                                                                              | "a Log now's Undo sends focus back to its card …"                                             |
| `QuickLogBar.svelte`: in `chipUndo`, change the `focusTarget` body to `() => null`                                                                                                       | "offers Undo for the dose it logged, and that Undo sends focus back to the chip"              |
| `QuickLogBar.svelte`: delete `onSuccess={() => setQty(med.id, MIN_QTY)}`                                                                                                                 | "resets to 1 after a successful log"                                                          |

Run `npx vitest run tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts` after each, confirm the named test FAILS, restore, re-run green.

- [ ] **Step 18: Update the Toast source test (failing), then drop the legacy per-toast Undo**

In `tests/unit/dashboard-chrome-copy.test.ts`, replace this whole block:

```ts
describe("Toast", () => {
  it("gives Undo at least a 44px-tall target with side padding, like every other dose control", () => {
    const src = source("src/lib/components/ui/Toast.svelte");
    const start = src.indexOf("{#if toast.undoAction}");
    expect(start, "the Undo block moved: update this test").toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("{/if}", start));
    const classes = /class="([^"]*)"/.exec(block)?.[1].split(" ") ?? [];
    expect(classes).toEqual(expect.arrayContaining(["min-h-11", "px-3"]));
  });
});
```

with:

```ts
describe("Toast", () => {
  it("gives the Undo offer's Undo and Dismiss at least a 44px target, like every other dose control", () => {
    const src = source("src/lib/components/ui/Toast.svelte");
    // Each piece starts just after "<button", so its first class="…" is that
    // button's own: attributes come before children.
    const buttons = src.split("<button").slice(1);
    const undo = buttons.find((piece) => piece.includes("aria-labelledby="));
    const dismiss = buttons.find((piece) => piece.includes('aria-label="Dismiss"'));
    expect(undo, "the Undo button moved: update this test").toBeDefined();
    expect(dismiss, "the Dismiss button moved: update this test").toBeDefined();
    const classes = (piece: string) => /class="([^"]*)"/.exec(piece)?.[1].split(" ") ?? [];
    expect(classes(undo!)).toEqual(expect.arrayContaining(["min-h-11", "px-3"]));
    expect(classes(dismiss!)).toEqual(expect.arrayContaining(["size-11"]));
  });

  it("has no per-toast Undo any more: the one offer lives in the undo registry", () => {
    expect(source("src/lib/components/ui/Toast.svelte")).not.toContain("undoAction");
  });
});
```

Run: `npx vitest run tests/unit/dashboard-chrome-copy.test.ts`
Expected: FAIL — "has no per-toast Undo any more: …" (Task 8 kept the legacy `undoAction`). The 44px test passes already.

In `tests/unit/toast-undo.svelte.test.ts` (Task 8), immediately before the existing line

```ts
describe("the (app) layout", () => {
```

add:

```ts
describe("Toast's plain toasts", () => {
  it("two refused taps during one write show one 'Still saving…' toast", () => {
    const { stack } = mountToast();
    const count = () => (stack.textContent ?? "").split(STILL_SAVING_TOAST).length - 1;

    // What createDoseWrite, or an Undo press, does for each tap refused while
    // another dose write is in flight.
    showToast(STILL_SAVING_TOAST, "error");
    flushSync();
    vi.advanceTimersByTime(4_000);
    showToast(STILL_SAVING_TOAST, "error");
    flushSync();

    expect(count()).toBe(1);
    // The second tap restarted its five seconds: still up 8s after the first.
    vi.advanceTimersByTime(4_000);
    flushSync();
    expect(count()).toBe(1);
    vi.advanceTimersByTime(1_000);
    flushSync();
    expect(count()).toBe(0);
  });
});
```

Run: `npx vitest run tests/unit/toast-undo.svelte.test.ts -t "two refused taps"`
Expected: FAIL — `expected 2 to be 1` (Task 8's `showToast` pushes a second toast).

Replace the whole of `src/lib/components/ui/Toast.svelte` with:

```svelte
<script lang="ts" module>
  import { browser } from "$app/environment";

  type ToastItem = {
    id: string;
    message: string;
    type: "success" | "error";
  };

  /**
   * Module-level state, so EXACTLY ONE <Toast /> may be mounted — it now
   * lives in (app)/+layout.svelte. Mount a second and every toast renders
   * twice in two aria-live regions, and screen readers announce it twice.
   *
   * The `browser` guard exists because the layout mount means this module is
   * evaluated during SSR on every authenticated page. Module state is
   * per-process on the server, so a showToast() reached during SSR would be
   * visible to whichever user rendered next.
   *
   * A plain toast carries no Undo. The one Undo offer lives in
   * dose-writes/undo-registry.svelte.ts and is rendered above these.
   */
  let toasts = $state<ToastItem[]>([]);

  export function showToast(message: string, type: "success" | "error" = "success") {
    if (!browser) return;
    // The same words already on screen: give them their five seconds again
    // instead of stacking a copy. Taps refused during one slow write each
    // toast "Still saving…", and the live region should say it once.
    const same = toasts.find((t) => t.message === message && t.type === type);
    if (same) {
      scheduleDismiss(same.id);
      return;
    }
    const id = crypto.randomUUID();
    toasts.push({ id, message, type });
    scheduleDismiss(id);
  }

  export function dismissToast(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    toasts = toasts.filter((t) => t.id !== id);
  }

  /**
   * Remove every plain toast and stop its timer. The (app) layout calls this,
   * with resetUndoRegistry(), when it unmounts: signing out leaves (app), and
   * on a shared device the next person to sign in must not read what the
   * last one was told. A no-op during SSR, like showToast.
   */
  export function clearToasts(): void {
    if (!browser) return;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    toasts = [];
    pointerInside = false;
    focusInside = false;
  }

  const DISMISS_MS = 5000;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Start or restart the automatic dismissal timer for a toast. */
  function scheduleDismiss(id: string) {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        toasts = toasts.filter((t) => t.id !== id);
      }, DISMISS_MS),
    );
  }

  /**
   * WCAG 2.2.1: a five-second auto-dismiss is a time limit. Reading a toast by
   * keyboard or screen reader can take longer than that, so hovering or
   * focusing the stack holds every plain toast open.
   *
   * Pointer and focus are tracked separately because either one alone is reason
   * to keep holding it. A single pause/resume pair let them overwrite each
   * other: moving the pointer away while a control in the stack was focused
   * resumed every timer, and five seconds later the toast vanished from under
   * the keyboard. The inverse held too, focus leaving while the pointer still
   * hovered.
   *
   * Resuming restarts the full interval rather than the remainder. That is
   * deliberate: it errs towards giving the user more time, never less.
   *
   * The Undo offer — the only way back from a logged or deleted dose — is not
   * one of these and has no 5s timer at all: it stays until it is used,
   * dismissed, replaced or withdrawn, capped by its own deadline
   * (dose-writes/undo-registry.svelte.ts).
   */
  let pointerInside = false;
  let focusInside = false;

  /** Hold or restart dismissal to match the current pointer and focus state. */
  function updateDismissal() {
    if (pointerInside || focusInside) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      return;
    }
    for (const toast of toasts) scheduleDismiss(toast.id);
  }

  /** Record whether the pointer is currently over the toast stack. */
  function setPointerInside(inside: boolean) {
    pointerInside = inside;
    updateDismissal();
  }

  /** Record whether focus is currently inside the toast stack. */
  function setFocusInside(inside: boolean) {
    focusInside = inside;
    updateDismissal();
  }
</script>

<script lang="ts">
  import { STILL_SAVING_TOAST } from "$components/dose-writes/copy";
  import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
  import {
    currentUndo,
    dismissUndo,
    rememberFocusBeforeStack,
    runUndo,
  } from "$components/dose-writes/undo-registry.svelte";

  /**
   * The (app) layout's write lock. Context can only be read while a component
   * initialises, so it is read here; Toast is mounted once, in that layout, and
   * lives exactly as long as it, so this IS the lock every page under the
   * layout reads. Offers never carry a lock: an Undo pressed after navigating
   * holds the lock the page now on screen reads.
   */
  const lock = getDoseWriteLock();
  const offer = $derived(currentUndo());

  async function pressUndo(): Promise<void> {
    // A second press while the first runs does nothing at all — not even
    // "Still saving…", which would describe this Undo as someone else's write.
    const current = currentUndo();
    if (!current || current.running) return;
    const outcome = await runUndo(lock);
    if (outcome.kind === "settled") showToast(outcome.message, outcome.type);
    else if (outcome.kind === "refused" && lock.active) showToast(STILL_SAVING_TOAST, "error");
  }

  /** Remember where focus came from, so an Undo can hand it back there. */
  function onStackFocusIn(e: FocusEvent & { currentTarget: EventTarget & HTMLDivElement }) {
    const from = e.relatedTarget;
    if (!e.currentTarget.contains(from as Node | null)) {
      rememberFocusBeforeStack(from instanceof HTMLElement ? from : null);
    }
    setFocusInside(true);
  }
</script>

<!-- This container IS the live region. The toasts inside previously each carried
     role="alert" as well, nesting an assertive region inside a polite one: the
     inner role won and interrupted whatever was being read. Successes and
     failures both come through here, so polite is the right register.
     data-toast-stack: focus inside it counts as lost (focus-after.ts), so an
     Undo moves it back to the page before its button goes. -->
<div
  class="fixed right-4 bottom-4 z-50 flex flex-col gap-2"
  role="status"
  aria-live="polite"
  aria-atomic="false"
  data-toast-stack
  onmouseenter={() => setPointerInside(true)}
  onmouseleave={() => setPointerInside(false)}
  onfocusin={onStackFocusIn}
  onfocusout={(e) => {
    // focusout also fires moving BETWEEN controls inside the stack, so treat it
    // as leaving only when focus lands outside the container. contains(null) is
    // false, so focus lost to nothing still counts as leaving.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setFocusInside(false);
  }}
>
  {#if offer}
    <!-- The ONE Undo offer. Undo's accessible name is its word plus the
         message, through aria-labelledby ("Undo Dose removed: …"), so the
         live region holds nothing extra and nothing is announced twice. Both
         buttons are 44px, like every other dose control. -->
    <div
      data-undo-offer
      class="border-success/30 bg-success/10 text-success flex max-w-sm flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl"
    >
      <span id="undo-message-{offer.id}" class="min-w-0 flex-1 text-sm">{offer.message}</span>
      <button
        type="button"
        class="min-h-11 px-3 text-sm font-medium underline aria-disabled:cursor-not-allowed"
        aria-labelledby="undo-word-{offer.id} undo-message-{offer.id}"
        aria-disabled={offer.running ? "true" : undefined}
        onclick={pressUndo}
        ><span id="undo-word-{offer.id}">{offer.running ? "Undoing…" : "Undo"}</span></button
      >
      <button
        type="button"
        class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-base aria-disabled:cursor-not-allowed"
        aria-label="Dismiss"
        aria-disabled={offer.running ? "true" : undefined}
        onclick={dismissUndo}><span aria-hidden="true">×</span></button
      >
      {#if offer.note}
        <p class="basis-full text-sm">{offer.note}</p>
      {/if}
    </div>
  {/if}
  {#each toasts as toast (toast.id)}
    <div
      class="flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl {toast.type ===
      'success'
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-danger-ink/30 bg-danger/10 text-danger-ink'}"
    >
      <span class="text-sm">{toast.message}</span>
    </div>
  {/each}
</div>
```

Run: `npx vitest run tests/unit/dashboard-chrome-copy.test.ts tests/unit/toast-undo.svelte.test.ts`
Expected: PASS.

Mutations, each run with the same command: re-add `undoAction?: () => void;` to `ToastItem` → "has no per-toast Undo any more: …" FAILS; change the Undo button's `min-h-11` to `min-h-8` → "gives the Undo offer's Undo and Dismiss at least a 44px target, …" FAILS; in `showToast`, delete the `if (same) { scheduleDismiss(same.id); return; }` block → "two refused taps during one write show one 'Still saving…' toast" FAILS (`expected 2 to be 1`); in that block, delete only `scheduleDismiss(same.id);` → the same test FAILS (the toast is gone 8s after the first tap: expected 0 to be 1). Restore each and re-run green.

- [ ] **Step 19: Update the existing test this change breaks**

`tests/unit/dose-write-lock.test.ts` renders DoseActionForm for its 'error' ordering test, whose reload now goes through `reloadAfterWrite`, which reads `navigating` from `$app/state`. Immediately after this existing line:

```ts
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
```

add:

```ts
// DoseActionForm's reload goes through reloadAfterWrite, which reads $app/state.
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { data: {} },
}));
```

Nothing else in that file changes: an 'error' with a status still toasts `actionErrorMessage`, never runs `update()`, and holds the lock until `invalidateAll` resolves.

Run: `npx vitest run tests/unit/dose-write-lock.test.ts`
Expected: PASS.

- [ ] **Step 20: Check for any other caller of the removed APIs**

Run: `grep -rn "undoable\|undoAction" src tests`
Expected: only the `"undoAction"` string inside `tests/unit/dashboard-chrome-copy.test.ts`'s `not.toContain`. Any other hit is a caller this task missed: switch it to `undo={…}` / a registry offer. (A three-argument `showToast` call anywhere is a type error that Step 22's `npm run check` reports.)

- [ ] **Step 21: Run the task's suites and the whole unit suite**

Run: `npx vitest run tests/unit/dose-write.svelte.test.ts tests/unit/dose-action-form.test.ts tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts tests/unit/dose-write-lock.test.ts tests/unit/dashboard-chrome-copy.test.ts tests/unit/undo-registry.test.ts tests/unit/toast-undo.svelte.test.ts tests/unit/due-card-ssr.test.ts tests/unit/done-list-ssr.test.ts tests/unit/dashboard-page-ssr.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS — the same set of failing files as before this task (none, or only suites that already failed to import when the plan started).

- [ ] **Step 22: Type-check, lint and format**

Run: `npm run check 2>&1 | tail -3`
Expected: the same error and warning counts as Step 1. In particular no `undoable` prop error in DueCard or QuickLogBar, and no `Object literal may only specify known properties` on `DoseActionForm`.

Run: `npx prettier --check src/lib/components/dose-writes/dose-write.svelte.ts src/lib/components/dashboard/DoseActionForm.svelte src/lib/components/dashboard/DueCard.svelte src/lib/components/QuickLogBar.svelte src/lib/components/ui/Toast.svelte tests/unit/helpers/DoseWriteProbe.svelte tests/unit/dose-write.svelte.test.ts tests/unit/dose-action-form.test.ts tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts tests/unit/dose-write-lock.test.ts tests/unit/dashboard-chrome-copy.test.ts tests/unit/toast-undo.svelte.test.ts`
Expected: all pass. If one does not, re-run with `--write`, then re-run Step 21's first command.

Run: `npx eslint src/lib/components/dose-writes/dose-write.svelte.ts src/lib/components/dashboard/DoseActionForm.svelte src/lib/components/dashboard/DueCard.svelte src/lib/components/QuickLogBar.svelte src/lib/components/ui/Toast.svelte tests/unit/helpers/DoseWriteProbe.svelte tests/unit/dose-write.svelte.test.ts tests/unit/dose-action-form.test.ts tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts tests/unit/dose-write-lock.test.ts tests/unit/dashboard-chrome-copy.test.ts tests/unit/toast-undo.svelte.test.ts`
Expected: no errors.

- [ ] **Step 23: Commit**

```bash
git add src/lib/components/dose-writes/dose-write.svelte.ts src/lib/components/dashboard/DoseActionForm.svelte src/lib/components/dashboard/DueCard.svelte src/lib/components/QuickLogBar.svelte src/lib/components/ui/Toast.svelte tests/unit/helpers/DoseWriteProbe.svelte tests/unit/dose-write.svelte.test.ts tests/unit/dose-action-form.test.ts tests/unit/due-card-focus.test.ts tests/unit/quick-log-bar.test.ts tests/unit/dose-write-lock.test.ts tests/unit/dashboard-chrome-copy.test.ts tests/unit/toast-undo.svelte.test.ts
git commit -m "feat(dose-writes): route dashboard dose writes through createDoseWrite

createDoseWrite is the one client path for a dose write. At submit it runs
the offline gate, the layout's lock (a refused tap during a write says
\"Still saving…\"), the dashboard's stale guard, then withdraws the Undo
offer for the dose being written, only once the write is sure to be sent.

It never calls enhance's update(), which dropped failures posted across
routes and reset focus to <body>. Every reload goes through
reloadAfterWrite. A request that never completes keeps the lock until
/api/health answers and the page has reloaded, so no retry runs against
unchecked data. A 409 on a tab running pre-deploy code reloads the
document. After a failure, focus moves only if the reload lost it.

DoseActionForm is now the dashboard's markup over it. Due cards and chips
offer their Undo through the registry, with focus returning to the card or
the chip. Toast drops its per-toast undoAction, and a toast whose words are
already on screen restarts its timer instead of stacking a copy, so taps
refused during one write say \"Still saving…\" once.

An Undo offer's deadline and a toast's \"logged at\" time both count from
when the response arrived, not from the end of a slow reload."
```

---

### Task 10: Dashboard surfaces — restore Undo on Done and the edit dialog's Remove, 44px chips, shortcuts that respect dialogs

**Files:**

- Modify: `src/lib/components/dashboard/DoneList.svelte` (whole-file replacement; T7–T9 do not touch this file, so it is still the `HEAD` version, anchored on its first line `<script lang="ts">` and its `removeLabel: dose.status === "skipped" ? "Undo skip" : "Remove",`)
- Modify: `src/lib/components/dashboard/dom-ids.ts` (anchor: ``/** DoneList's `<h2>`: focus lands here after Remove or Undo skip. Always rendered. */``)
- Modify: `src/routes/(app)/dashboard/+page.svelte` (anchors: `import DoneList from "$components/dashboard/DoneList.svelte";`, `import type { DateFormat, TimeFormat } from "$lib/utils/time";`, `const doneHeading = () => document.getElementById(DONE_HEADING_ID);`, `buildToast={() => "Dose removed"}`)
- Modify: `src/lib/components/QuickLogBar.svelte` (anchor: `class="border-border-strong bg-glass text-text-primary flex h-11 items-center overflow-hidden rounded-full border"`)
- Modify: `src/lib/components/KeyboardShortcuts.svelte` (anchor: `    if (isControlFocused()) return;`)
- Create: `tests/unit/done-list-undo.test.ts`
- Create: `tests/unit/dashboard-remove-undo.test.ts`
- Test: `tests/unit/done-list-ssr.test.ts`, `tests/unit/quick-log-bar.test.ts`, `tests/unit/quick-log-target.test.ts`

**Interfaces:**

- Consumes:
  - `DoseActionForm.svelte` props after Task 9: `action: string`, `fields: Record<string, string>`, `label: string`, `srContext?: string`, `pendingLabel: string`, `variant`, `quickLog?: boolean`, `buildToast?: (doseId: string | null, respondedAt: Date) => string | null` (Task 9's `DoseWriteOptions["buildToast"]`; a zero-argument builder such as this task's `v.removeToast` and `removedToast(dose)` stays valid), `undo?: { kind: UndoKind; focusTarget: () => HTMLElement | null }`, `withdrawsUndoFor?: string`, `focusAfter?: () => HTMLElement | null`, `onSuccess?: () => void`, `children?: Snippet`, `class?: string`. On success it records `respondedAt = Date.now()` before the reload, then calls `offerUndo({ message, doseId, kind, deletedAt: data.restore?.deletedAt, expiresInMs: data.restore?.expiresInMs, respondedAt, focusTarget })` when `undo` is set (`expiresInMs` passes through as the server sent it, which is what this task's `toMatchObject({ expiresInMs: DOSE_UNDO_WINDOW_MS })` assertions read), and withdraws the offer naming `withdrawsUndoFor` at submit.
  - `$components/dose-writes/focus-after` (Task 7): `export interface FocusTargetOptions { attr?: "cardKey" | "doseId"; precedingKeys?: readonly string[]; pick?: (row: HTMLElement) => HTMLElement | null }` and `export function focusTargetAfterResolve(key: string, followingKeys: readonly string[], opts: FocusTargetOptions = {}, root: ParentNode = document): HTMLElement | null`.
  - `$components/dose-writes/undo-registry.svelte` (Task 8): `offerUndo(input: UndoOfferInput): void`, `currentUndo(): UndoOffer | null`, `resetUndoRegistry(): void`, where `UndoOfferInput = { message: string; doseId: string; kind: UndoKind; deletedAt?: string; expiresInMs?: number; respondedAt?: number; focusTarget: () => HTMLElement | null }` (the offer's `deadline` is `(respondedAt ?? Date.now()) + lifetime`; this task's direct `offerUndo` calls omit `respondedAt`).
  - `$lib/utils/dose-undo` (Task 1): `DOSE_UNDO_WINDOW_MS`.
  - `$components/dose-writes/dose-write-lock.svelte` (Task 7): `createDoseWriteLock()`.
  - `tests/unit/helpers/dashboard-context.ts` (Task 7): `doseWriteContext(lock: DoseWriteLock = createDoseWriteLock()): Map<symbol, unknown>`; `dashboardContext(opts: { lock?: DoseWriteLock; clock?: DashboardClock; now?: Date } = {})` still sets both the lock and the clock.
  - The dashboard delete action's success body (Task 2): `{ success: true, doseId, restore: { deletedAt: <iso>, expiresInMs: DOSE_UNDO_WINDOW_MS } }`.
  - Existing: `startSubmit`, `finishSubmit` (`tests/unit/helpers/dose-action-form-harness.ts`), `formatDoseLabel` (`$lib/utils/dashboard-copy`), `formatUserTime` (`$lib/utils/time`).
- Produces:
  - `export function restoredDoneRowFocus(doseId: string): () => HTMLElement | null`, from `DoneList.svelte`'s `<script module>`: the restored row's `[data-edit]`, else the Done heading. The dashboard page imports it for the dialog's Remove.
  - Done rows carry `data-dose-id`; a taken row's Edit carries `data-edit` (the same attribute names Task 12 uses on /log).
  - `KeyboardShortcuts` ignores `e.repeat` and any keydown while `[aria-modal="true"]` is present, except `?` closing its own overlay.

- [ ] **Step 1: Write the failing tests for Done's rows**

Edit `tests/unit/done-list-ssr.test.ts`.

Replace the header comment line

```ts
// alternatives to the toast's Undo (Edit → Remove, Undo skip). `node` is
```

with

```ts
// alternatives to the toast's Undo (Edit → Remove, Remove skip). `node` is
```

Replace the skipped-row test, from `  it("gives a skipped row a neutral marker, the word, and an Undo skip that removes it", () => {` down to (and including) the line `    const form = buttonNamed(li, "Undo skip: Metformin 500mg, skipped at 11:00").closest("form")!;`, with:

```ts
  it("gives a skipped row a neutral marker, the word, and a Remove skip that removes it", () => {
    const li = items(renderList(ROWS))[1];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Skipped");
    expect(textOf(li)).toContain("Skipped");
    // Not "Undo skip": every Undo offer has a button named Undo, and a voice
    // command of "click Undo" must not match this one as well.
    expect(textOf(li)).not.toContain("Undo");
    const form = buttonNamed(li, "Remove skip: Metformin 500mg, skipped at 11:00").closest("form")!;
```

(The two lines after it, `expect(form.getAttribute("action")).toBe("?/deleteDose");` and `expect(hiddenFields(form)).toEqual({ doseId: "d2" });`, stay.)

Insert this test immediately before `  it("has no hover-revealed controls", () => {`:

```ts
it("marks every row with its dose id, and only a taken row's Edit with data-edit", () => {
  // What an Undo's focus target reads once the restore's reload has
  // re-rendered the row: the row by its id, then its Edit.
  const doc = renderList(ROWS);
  expect(items(doc).map((li) => li.getAttribute("data-dose-id"))).toEqual(["d0", "d2", "d3", "d1"]);
  const edits = [...doc.querySelectorAll<HTMLElement>("[data-edit]")];
  expect(edits.map((el) => el.closest("li")?.getAttribute("data-dose-id"))).toEqual(["d0", "d1"]);
  for (const edit of edits) expect(visibleLabel(edit)).toBe("Edit");
});
```

Create `tests/unit/done-list-undo.test.ts`:

```ts
// Done's Remove and Remove skip are deletes, so each offers an Undo that
// restores the row: the offer carries the delete response's `restore`
// handle, and its focus target finds the restored row after the reload.
// Mounted for real (jsdom, client svelte) with the form's use:enhance
// callback driven by hand. Names and markup are in done-list-ssr.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DoneRow, DoseLogWithMedication } from "$lib/types";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy: () => void h.submits.delete(form) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll(), goto: vi.fn() }));
// reloadAfterWrite reads both: no navigation in flight, no new deploy.
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
// The Undo registry is a no-op unless `browser`, like Toast's list.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import DoneList, { restoredDoneRowFocus } from "$lib/components/dashboard/DoneList.svelte";
import { DONE_HEADING_ID } from "$lib/components/dashboard/dom-ids";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";
import { accessibleName, buttonNamed } from "./helpers/dom-names";

const NOW = new Date("2026-05-01T14:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");
const DELETED_AT = "2026-05-01T14:00:05.000Z";

function dose(overrides: Partial<DoseLogWithMedication> = {}): DoseLogWithMedication {
  const takenAt = overrides.takenAt ?? new Date("2026-05-01T13:31:00.000Z");
  return {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    takenAt,
    loggedAt: takenAt,
    notes: null,
    sideEffects: null,
    status: "taken",
    updatedAt: takenAt,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

const TAKEN: DoneRow = { key: "d1", dose: dose({ id: "d1" }), covers: [], dayLabel: null };
const SKIPPED: DoneRow = {
  key: "d2",
  dose: dose({ id: "d2", status: "skipped", takenAt: new Date("2026-05-01T11:00:00.000Z") }),
  covers: [],
  dayLabel: null,
};
const MISSED: DoneRow = {
  key: "d3",
  dose: dose({ id: "d3", status: "missed", takenAt: new Date("2026-05-01T12:00:00.000Z") }),
  covers: [],
  dayLabel: null,
};

/** The dashboard delete action's success: the dose id and its restore handle. */
function removed(doseId: string): ActionResult {
  return {
    type: "success",
    status: 200,
    data: {
      success: true,
      doseId,
      restore: { deletedAt: DELETED_AT, expiresInMs: DOSE_UNDO_WINDOW_MS },
    },
  };
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  resetUndoRegistry();
});

function mountList(rows: DoneRow[] = [TAKEN, SKIPPED, MISSED]) {
  app = mount(DoneList, {
    target,
    props: {
      rows,
      title: "Done today",
      todayStart: TODAY_START,
      timezone: "UTC",
      timeFormat: "24h",
      onedit: () => {},
    },
    context: dashboardContext({ now: NOW }),
  });
  flushSync();
}

function removeForm(name: string) {
  const form = buttonNamed(target, name).closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error(`"${name}" is not a use:enhance form`);
  return { form, submit };
}

/** Submit a row's remove form and settle it with `result`, as SvelteKit would. */
async function remove(name: string, result: ActionResult) {
  const { form, submit } = removeForm(name);
  const { callback } = await startSubmit(submit, form);
  expect(callback, "the remove was refused").not.toBeNull();
  await finishSubmit(callback!, form, result).done;
  flushSync();
  return form;
}

describe("Done's Remove skip and Remove offer a restore Undo", () => {
  it("Remove skip posts the dose id to ?/deleteDose and offers an Undo carrying the restore handle", async () => {
    mountList();
    const form = await remove("Remove skip: Metformin 500mg, skipped at 11:00", removed("d2"));

    expect(form.getAttribute("action")).toBe("?/deleteDose");
    expect(Object.fromEntries(new FormData(form))).toEqual({ doseId: "d2" });
    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d2",
      deletedAt: DELETED_AT,
      expiresInMs: DOSE_UNDO_WINDOW_MS,
      message: "Metformin 500mg: skip removed",
    });
    // The offer is the confirmation; the same sentence is not toasted twice.
    expect(h.showToast).not.toHaveBeenCalledWith("Metformin 500mg: skip removed", "success");
  });

  it("Remove on a missed entry says so, with the same kind of Undo", async () => {
    mountList();
    await remove("Remove: Metformin 500mg, missed at 12:00", removed("d3"));

    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d3",
      deletedAt: DELETED_AT,
      message: "Metformin 500mg: missed entry removed",
    });
  });

  it("withdraws an Undo that names the same dose as soon as the remove is sent", async () => {
    // The Skip's own Undo would delete this row; once Remove skip is on its
    // way that Undo acts on nothing.
    mountList();
    offerUndo({
      message: "Metformin 500mg: 11:00 dose skipped",
      doseId: "d2",
      kind: "delete",
      focusTarget: () => null,
    });
    expect(currentUndo()?.doseId).toBe("d2");

    const { form, submit } = removeForm("Remove skip: Metformin 500mg, skipped at 11:00");
    const { callback } = await startSubmit(submit, form);

    expect(callback).not.toBeNull();
    expect(currentUndo()).toBeNull();
  });
});

describe("restoredDoneRowFocus: where focus goes once an Undo has restored a Done row", () => {
  it("is the restored row's Edit when it has one", () => {
    mountList();
    expect(restoredDoneRowFocus("d1")()).toBe(
      buttonNamed(target, "Edit: Metformin 500mg dose taken at 13:31"),
    );
  });

  it("is the Done heading for a restored skip or missed entry, never its Remove", () => {
    mountList();
    const heading = document.getElementById(DONE_HEADING_ID);
    for (const id of ["d2", "d3"]) {
      const focus = restoredDoneRowFocus(id)();
      expect(focus, id).toBe(heading);
      expect(accessibleName(focus!), id).not.toMatch(/^Remove/);
    }
  });

  it("is the Done heading when the row is not on the page", () => {
    mountList([TAKEN]);
    expect(restoredDoneRowFocus("d9")()).toBe(document.getElementById(DONE_HEADING_ID));
  });

  it("is the target Remove skip's offer focuses", async () => {
    mountList();
    await remove("Remove skip: Metformin 500mg, skipped at 11:00", removed("d2"));
    // invalidateAll is inert here, so the row is still rendered: the page as
    // the restore's reload leaves it.
    expect(currentUndo()!.focusTarget()).toBe(document.getElementById(DONE_HEADING_ID));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/done-list-ssr.test.ts tests/unit/done-list-undo.test.ts`
Expected: FAIL.

- `done-list-ssr.test.ts`: "gives a skipped row … Remove skip" fails with `no button named "Remove skip: Metformin 500mg, skipped at 11:00"`; "marks every row with its dose id…" fails with `expected [ null, null, null, null ] to deeply equal [ 'd0', 'd2', 'd3', 'd1' ]`.
- `done-list-undo.test.ts`: every test fails, with `no button named "Remove skip: …"` (or `"Remove: …"` passes the name but then `expected null to match object`) and `restoredDoneRowFocus is not a function`.

- [ ] **Step 3: Write the minimal implementation for Done's rows**

Replace the whole of `src/lib/components/dashboard/DoneList.svelte` with:

```svelte
<script lang="ts" module>
  import { focusTargetAfterResolve } from "$components/dose-writes/focus-after";
  import { DONE_HEADING_ID } from "./dom-ids";

  /**
   * Where focus goes once an Undo has restored a Done row: that row's Edit,
   * else the Done heading. A restored skip or missed entry has no Edit — its
   * only control is Remove, a write — so it gets the heading rather than a
   * button that would remove it again. Called after the restore's reload, so
   * the row is looked up by its `data-dose-id`, never held as an element.
   * Exported for the dashboard's edit-dialog Remove, which restores into this
   * list too.
   */
  export function restoredDoneRowFocus(doseId: string): () => HTMLElement | null {
    return () =>
      focusTargetAfterResolve(doseId, [], {
        attr: "doseId",
        pick: (row) => row.querySelector<HTMLElement>("[data-edit]"),
      }) ?? document.getElementById(DONE_HEADING_ID);
  }
</script>

<script lang="ts">
  import type { DoneRow, DoseLogWithMedication } from "$lib/types";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { formatDoseLabel, formatSlotTime } from "$lib/utils/dashboard-copy";
  import DoseActionForm from "./DoseActionForm.svelte";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";

  let {
    rows,
    title,
    todayStart,
    timezone,
    timeFormat,
    onedit,
  }: {
    rows: DoneRow[];
    /** "Done today", or "Logged today" on an as-needed-only account. */
    title: string;
    /** Covered slots before this instant are prefixed "yesterday". */
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
    onedit: (dose: DoseLogWithMedication) => void;
  } = $props();

  function focusDoneHeading(): HTMLElement | null {
    return document.getElementById(DONE_HEADING_ID);
  }

  function view(row: DoneRow) {
    const { dose } = row;
    const med = dose.medication;
    const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit);
    const time = formatUserTime(new Date(dose.takenAt), timezone, timeFormat);
    const when = row.dayLabel === "yesterday" ? `yesterday ${time}` : time;
    const covers = row.covers.map((iso) =>
      formatSlotTime(new Date(iso), todayStart, timezone, timeFormat),
    );
    const skipped = dose.status === "skipped";
    const removeToast = skipped ? `${label}: skip removed` : `${label}: missed entry removed`;
    return {
      label,
      time,
      when,
      dose: `${med.dosageAmount}${med.dosageUnit}${
        dose.status === "taken" && dose.quantity > 1 ? ` ×${dose.quantity}` : ""
      }`,
      statusWord:
        dose.status === "skipped" ? "Skipped" : dose.status === "missed" ? "Missed" : null,
      // Facts only, no verdict: the slots this dose resolved.
      coversText: covers.length > 0 ? `for ${covers.join(", ")}` : null,
      // "Remove skip", not "Undo skip": every Undo offer now has a button
      // named Undo, and "click Undo" must not be ambiguous for voice control.
      removeLabel: skipped ? "Remove skip" : "Remove",
      removeToast: () => removeToast,
      restoreFocus: restoredDoneRowFocus(dose.id),
    };
  }
</script>

<section aria-labelledby={DONE_HEADING_ID}>
  <!-- tabindex="-1" and always rendered: focus lands here after Remove or
       Remove skip, and after an Undo restores a row that has no Edit. -->
  <h2
    id={DONE_HEADING_ID}
    tabindex="-1"
    class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
  >
    {title}
  </h2>
  <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
    {#if rows.length === 0}
      <p class="text-text-secondary py-3 text-sm">Nothing logged yet today</p>
    {:else}
      <ul role="list" class="divide-glass-border divide-y">
        {#each rows as row (row.key)}
          {@const v = view(row)}
          <!-- data-dose-id and data-edit are how an Undo finds the restored
               row after the reload has re-rendered it. -->
          <li data-dose-id={row.dose.id} class="flex min-h-11 items-center gap-3 py-1">
            <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums">
              {#if row.dayLabel === "yesterday"}<span class="block text-xs">Yesterday</span
                >{/if}{v.time}
            </span>
            <StatusMarker state={row.dose.status} />
            <MedicationGlyph
              colour={row.dose.medication.colour}
              colourSecondary={row.dose.medication.colourSecondary}
              pattern={row.dose.medication.pattern}
              size="sm"
            />
            <div class="min-w-0 flex-1">
              <p class="flex min-w-0 items-baseline gap-2 text-sm">
                <span class="text-text-primary truncate font-medium"
                  >{row.dose.medication.name}</span
                >
                <span class="text-text-secondary shrink-0">{v.dose}</span>
                {#if v.statusWord}
                  <span class="text-text-secondary shrink-0">{v.statusWord}</span>
                {/if}
              </p>
              {#if v.coversText}
                <p class="text-text-secondary truncate text-xs">{v.coversText}</p>
              {/if}
            </div>
            {#if row.dose.status === "taken"}
              <button
                type="button"
                data-edit
                class="border-border-strong text-text-primary hover:bg-surface-overlay h-11 shrink-0 rounded-lg border px-3 text-sm font-medium"
                onclick={() => onedit(row.dose)}
                >Edit<span class="sr-only">: {v.label} dose taken at {v.when}</span></button
              >
            {:else}
              <DoseActionForm
                class="shrink-0"
                action="?/deleteDose"
                fields={{ doseId: row.dose.id }}
                label={v.removeLabel}
                srContext={`: ${v.label}, ${row.dose.status} at ${v.when}`}
                pendingLabel="Removing…"
                variant="quiet"
                buildToast={v.removeToast}
                undo={{ kind: "restore", focusTarget: v.restoreFocus }}
                withdrawsUndoFor={row.dose.id}
                focusAfter={focusDoneHeading}
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
```

In `src/lib/components/dashboard/dom-ids.ts`, replace

```ts
/** DoneList's `<h2>`: focus lands here after Remove or Undo skip. Always rendered. */
```

with

```ts
/** DoneList's `<h2>`: focus lands here after Remove or Remove skip, and after an Undo restores a row with no Edit. Always rendered. */
```

Why the restored skip gets the heading and not its row: spec Section 3 ("the restored row's Edit, or the Done heading when that row's only control is a write"). `focusTargetAfterResolve` does the lookup by `dataset.doseId`, so no id is ever interpolated into a CSS selector.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/done-list-ssr.test.ts tests/unit/done-list-undo.test.ts`
Expected: PASS (both files, every test).

- [ ] **Step 5: Prove the Done tests by mutation**

Break each line in `src/lib/components/dashboard/DoneList.svelte`, run `npx vitest run tests/unit/done-list-ssr.test.ts tests/unit/done-list-undo.test.ts`, confirm the named test fails, restore the line, re-run green.

1. Delete `                undo={{ kind: "restore", focusTarget: v.restoreFocus }}` → FAIL: "Remove skip posts the dose id to ?/deleteDose and offers an Undo carrying the restore handle" and "Remove on a missed entry says so, with the same kind of Undo" (`expected null to match object`).
2. Change `removeLabel: skipped ? "Remove skip" : "Remove",` to `removeLabel: skipped ? "Undo skip" : "Remove",` → FAIL: "gives a skipped row a neutral marker, the word, and a Remove skip that removes it".
3. Change ``const removeToast = skipped ? `${label}: skip removed` : `${label}: missed entry removed`;`` to ``const removeToast = skipped ? `${label}: skip undone` : `${label}: missed entry removed`;`` → FAIL: "Remove skip posts the dose id … restore handle".
4. Delete `                withdrawsUndoFor={row.dose.id}` → FAIL: "withdraws an Undo that names the same dose as soon as the remove is sent".
5. Change `pick: (row) => row.querySelector<HTMLElement>("[data-edit]"),` to `pick: (row) => row.querySelector<HTMLElement>("[data-edit], button"),` → FAIL: "is the Done heading for a restored skip or missed entry, never its Remove".
6. Delete the `data-edit` line on the Edit button → FAIL: "marks every row with its dose id, and only a taken row's Edit with data-edit" and "is the restored row's Edit when it has one".
7. Change `<li data-dose-id={row.dose.id} class=` to `<li class=` → FAIL: "marks every row with its dose id…" and "is the restored row's Edit when it has one".

- [ ] **Step 6: Write the failing test for the edit dialog's Remove**

Create `tests/unit/dashboard-remove-undo.test.ts`:

```ts
// The dashboard edit dialog's "Remove this dose" is a delete, so it offers
// an Undo that restores the dose, and that Undo's focus lands on the
// restored Done row's Edit. Mounted as the whole page (jsdom, client svelte),
// because the dialog, its Remove and the Done list only meet there; the
// Remove form's use:enhance callback is driven by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DashboardPageData, DoneRow, Medication } from "$lib/types";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy: () => void h.submits.delete(form) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll(), goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import Page from "../../src/routes/(app)/dashboard/+page.svelte";
import { createDoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";
import { buttonNamed } from "./helpers/dom-names";

// The (app) layout adds `user` and `preferences` to the merged PageData, and
// svelte-check types this fixture against it.
const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "dark",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const metformin: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m1",
  name: "Metformin",
  lowInventoryEpisodeAt: null,
};

const TAKEN_AT = new Date("2026-05-01T13:31:00.000Z");
const DELETED_AT = "2026-05-01T14:00:05.000Z";

const D1: DoneRow = {
  key: "d1",
  dose: {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    status: "taken",
    takenAt: TAKEN_AT,
    loggedAt: TAKEN_AT,
    updatedAt: TAKEN_AT,
    notes: null,
    sideEffects: null,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#ff0000",
      colourSecondary: null,
      pattern: "solid",
    },
  },
  covers: [],
  dayLabel: null,
};

const DASH: DashboardPageData = {
  now: "2026-05-01T14:00:00.000Z",
  nextRefreshAt: "2026-05-01T15:00:00.000Z",
  timezone: "UTC",
  todayStart: "2026-05-01T00:00:00.000Z",
  status: {
    kind: "all-done",
    dueCount: 0,
    doneToday: 1,
    totalToday: 1,
    loggedToday: 1,
    next: null,
  },
  earlier: [],
  today: [],
  done: [D1],
  later: [],
  medications: [metformin],
  refillForecast: [],
};

const REMOVED: ActionResult = {
  type: "success",
  status: 200,
  data: {
    success: true,
    doseId: "d1",
    restore: { deletedAt: DELETED_AT, expiresInMs: DOSE_UNDO_WINDOW_MS },
  },
};

const EDIT_D1 = "Edit: Metformin 500mg dose taken at 13:31";

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
  target = document.body.appendChild(document.createElement("div"));
  // The lock is the (app) layout's; the page reads it from context.
  app = mount(Page, {
    target,
    props: { data: { ...DASH, user, preferences } },
    context: doseWriteContext(createDoseWriteLock()),
  });
  flushSync();
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  resetUndoRegistry();
});

/** Open the edit dialog on d1 and return its Remove form. */
function openRemove() {
  buttonNamed(target, EDIT_D1).click();
  flushSync();
  const form = buttonNamed(target, "Remove this dose").closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("the dialog's Remove is not a use:enhance form");
  return { form, submit };
}

describe("the edit dialog's Remove this dose", () => {
  it("offers an Undo that restores the dose, naming the dose and its time", async () => {
    const { form, submit } = openRemove();
    expect(form.getAttribute("action")).toBe("?/deleteDose");

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, REMOVED).done;
    flushSync();

    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d1",
      deletedAt: DELETED_AT,
      expiresInMs: DOSE_UNDO_WINDOW_MS,
      message: "Dose removed: Metformin 500mg at 13:31",
    });
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(target.querySelector('[role="dialog"]'), "the dialog should close").toBeNull();
  });

  it("sends the Undo's focus to the restored row's Edit", async () => {
    const { form, submit } = openRemove();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, REMOVED).done;
    flushSync();

    // invalidateAll is inert here, so d1 is still rendered: the page as the
    // restore's reload leaves it. The absent-row fallback (the Done heading)
    // is covered by done-list-undo.test.ts.
    expect(currentUndo()!.focusTarget()).toBe(buttonNamed(target, EDIT_D1));
  });

  it("withdraws an Undo for the same dose as soon as the Remove is sent", async () => {
    // Log now's Undo would delete this dose; once Remove is on its way, that
    // Undo acts on nothing.
    offerUndo({
      message: "Metformin 500mg logged at 13:31",
      doseId: "d1",
      kind: "delete",
      focusTarget: () => null,
    });
    const { form, submit } = openRemove();

    const { callback } = await startSubmit(submit, form);

    expect(callback).not.toBeNull();
    expect(currentUndo()).toBeNull();
  });
});
```

`13:31` is what `formatUserTime(new Date("2026-05-01T13:31:00.000Z"), "UTC", "24h")` renders (two-digit hour, so no padding question).

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run tests/unit/dashboard-remove-undo.test.ts`
Expected: FAIL. "offers an Undo that restores the dose…" and "sends the Undo's focus…" fail with `expected null to match object` / `Cannot read properties of null (reading 'focusTarget')` (the Remove still posts with no `undo`, so it shows a plain "Dose removed" toast). "withdraws an Undo for the same dose…" fails with `expected { …(offer for d1) } to be null`.

- [ ] **Step 8: Wire the dialog's Remove to a restore Undo**

In `src/routes/(app)/dashboard/+page.svelte`:

Replace

```ts
import DoneList from "$components/dashboard/DoneList.svelte";
```

with

```ts
import DoneList, { restoredDoneRowFocus } from "$components/dashboard/DoneList.svelte";
```

Replace

```ts
import type { DateFormat, TimeFormat } from "$lib/utils/time";
```

with

```ts
import { formatDoseLabel } from "$lib/utils/dashboard-copy";
import { formatUserTime, type DateFormat, type TimeFormat } from "$lib/utils/time";
```

Replace

```ts
/** The Done h2 (tabindex="-1", always rendered): focus after Remove. */
const doneHeading = () => document.getElementById(DONE_HEADING_ID);
```

with

```ts
/** The Done h2 (tabindex="-1", always rendered): focus after Remove. */
const doneHeading = () => document.getElementById(DONE_HEADING_ID);

/**
 * The edit dialog's Remove toast: "Dose removed: Metformin 500mg at 08:00".
 * Resolved to a string when the dialog renders, because it is read after
 * the reload and onSuccess clears editingDose straight after.
 */
function removedToast(dose: DoseLogWithMedication): () => string {
  const med = dose.medication;
  const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit);
  const at = formatUserTime(new Date(dose.takenAt), data.timezone, timeFormat);
  const message = `Dose removed: ${label} at ${at}`;
  return () => message;
}
```

Replace (inside the Modal's `<DoseActionForm action="?/deleteDose" …>`)

```svelte
buildToast={() => "Dose removed"}
focusAfter={doneHeading}
onSuccess={() => (editingDose = null)}
```

with

```svelte
buildToast={removedToast(editingDose)}
undo={{ kind: "restore", focusTarget: restoredDoneRowFocus(editingDose.id) }}
withdrawsUndoFor={editingDose.id}
focusAfter={doneHeading}
onSuccess={() => (editingDose = null)}
```

`buildToast` and `undo.focusTarget` are closures built at render, over plain values, so they stay valid after `onSuccess` clears `editingDose`. `withdrawsUndoFor` is read at submit (Task 9 reads options at submit time), while `editingDose` is still set.

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run tests/unit/dashboard-remove-undo.test.ts tests/unit/dashboard-page-ssr.test.ts`
Expected: PASS (the SSR composition suite still renders the page, which now imports `restoredDoneRowFocus`).

- [ ] **Step 10: Prove the dialog tests by mutation**

In `src/routes/(app)/dashboard/+page.svelte`, break each, run `npx vitest run tests/unit/dashboard-remove-undo.test.ts`, confirm the named failure, restore, re-run green.

1. Delete `        undo={{ kind: "restore", focusTarget: restoredDoneRowFocus(editingDose.id) }}` → FAIL: "offers an Undo that restores the dose, naming the dose and its time".
2. Change `buildToast={removedToast(editingDose)}` to `buildToast={() => "Dose removed"}` → FAIL: "offers an Undo that restores the dose…" (message `"Dose removed"`).
3. Change `focusTarget: restoredDoneRowFocus(editingDose.id)` to `focusTarget: doneHeading` → FAIL: "sends the Undo's focus to the restored row's Edit".
4. Delete `        withdrawsUndoFor={editingDose.id}` → FAIL: "withdraws an Undo for the same dose as soon as the Remove is sent".

- [ ] **Step 11: Write the failing test for full-size chip segments**

Append to the end of `tests/unit/quick-log-bar.test.ts` (it reuses that file's `setup()`, which mounts `QuickLogBar` with `dashboardContext()` and returns the chip `form`):

```ts
describe("QuickLogBar chip segments", () => {
  it("sizes the chip by its content box, so the 1px border cannot clip the 44px segments", () => {
    // Under border-box the border sat inside h-11 and overflow-hidden cut
    // each segment down to 42px.
    const { form } = setup();
    const li = form.closest("li")!;
    expect([...li.classList]).toEqual(
      expect.arrayContaining(["box-content", "h-11", "border", "overflow-hidden"]),
    );
  });
});
```

- [ ] **Step 12: Run it to verify it fails**

Run: `npx vitest run tests/unit/quick-log-bar.test.ts`
Expected: FAIL in "sizes the chip by its content box…" with `expected [ …, 'h-11', …, 'border' ] to include 'box-content'` (the array does not contain it).

- [ ] **Step 13: Give the chip `li` a content box**

In `src/lib/components/QuickLogBar.svelte`, replace

```svelte
    <li
      class="border-border-strong bg-glass text-text-primary flex h-11 items-center overflow-hidden rounded-full border"
    >
```

with

```svelte
    <!-- box-content: under border-box the 1px border sits inside h-11, and
         overflow-hidden clipped each 44px segment to 42px. Content-box keeps
         44px inside and draws the border-strong edge outside it (46px). -->
    <li
      class="border-border-strong bg-glass text-text-primary box-content flex h-11 items-center overflow-hidden rounded-full border"
    >
```

(`box-content` sits before `flex`: that is prettier-plugin-tailwindcss's order, checked against this repo's config.)

- [ ] **Step 14: Run it to verify it passes, then prove it**

Run: `npx vitest run tests/unit/quick-log-bar.test.ts`
Expected: PASS.

Mutation: delete `box-content ` from the `li` class. Run the same command. Expected: FAIL in "sizes the chip by its content box, so the 1px border cannot clip the 44px segments". Restore, re-run: PASS.

- [ ] **Step 15: Write the failing keyboard-shortcut tests**

In `tests/unit/quick-log-target.test.ts`, replace

```ts
import { flushSync, mount, unmount } from "svelte";
import { findQuickLogForm } from "$lib/utils/quick-log";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

import KeyboardShortcuts from "$lib/components/KeyboardShortcuts.svelte";
```

with

```ts
import { flushSync, mount, tick, unmount } from "svelte";
import { findQuickLogForm } from "$lib/utils/quick-log";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

import { goto } from "$app/navigation";
import KeyboardShortcuts from "$lib/components/KeyboardShortcuts.svelte";
```

Append to the end of the file:

```ts
describe("KeyboardShortcuts guards", () => {
  let destroy: (() => void) | null = null;

  afterEach(() => {
    destroy?.();
    destroy = null;
    vi.restoreAllMocks();
  });

  function mountWithChip() {
    document.body.innerHTML = logForm('data-quick-log data-testid="chip-m1"', "m1");
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    vi.mocked(goto).mockClear();
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(KeyboardShortcuts, {
      target,
      props: { medications: [{ id: "m1", name: "A" }] },
    });
    flushSync();
    destroy = () => unmount(component);
    return { requestSubmit };
  }

  /** A keydown from wherever focus is, bubbling to the window like a real one. */
  function press(key: string, init: KeyboardEventInit = {}) {
    const from =
      document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    from.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
    flushSync();
  }

  it("ignores a held key's repeats, so holding 1 logs once", () => {
    // The write lock's 700ms cooldown is all that stood between a held digit
    // and a second dose.
    const { requestSubmit } = mountWithChip();
    press("1", { repeat: true });
    expect(requestSubmit).not.toHaveBeenCalled();
    press("1");
    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("fires nothing behind an open dialog, even with focus on its tabindex=-1 panel", () => {
    // ui/Modal's panel is tabindex="-1", which isControlFocused() exempts, so
    // 1 logged a dose and n navigated away behind the edit dialog.
    const { requestSubmit } = mountWithChip();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;
    document.body.append(dialog);
    dialog.focus();
    expect(document.activeElement).toBe(dialog);

    press("1");
    press("n");
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();

    // The dialog was the only reason: once it has gone, 1 logs again.
    dialog.remove();
    press("1");
    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("still lets ? close its own help overlay, and lets nothing else through while it is open", async () => {
    const { requestSubmit } = mountWithChip();
    const overlay = () => document.querySelector('[aria-label="Keyboard shortcuts"]');

    press("?");
    expect(overlay()).not.toBeNull();
    await tick();
    await tick();
    // Focus on the overlay's own tabindex="-1" panel, where a click inside it
    // leaves it. On the Close button every shortcut is already skipped.
    const panel = overlay()!.querySelector<HTMLElement>(":scope > div")!;
    panel.focus();
    expect(document.activeElement).toBe(panel);

    press("1");
    expect(requestSubmit).not.toHaveBeenCalled();

    press("?");
    expect(overlay()).toBeNull();
  });
});
```

The file's existing top-level `afterEach` (`document.body.innerHTML = ""`) still runs after this block's own `afterEach`, because vitest runs after-hooks innermost first.

- [ ] **Step 16: Run them to verify they fail**

Run: `npx vitest run tests/unit/quick-log-target.test.ts`
Expected: FAIL. "ignores a held key's repeats…" (`expected "spy" to not be called at all, but actually been called 1 times`); "fires nothing behind an open dialog…" (`requestSubmit` called once and `goto` called with `/medications/new`); "still lets ? close…" (`requestSubmit` called by `1` while the overlay is open). The five existing tests (three `findQuickLogForm`, two `KeyboardShortcuts`) still pass.

- [ ] **Step 17: Add the two guards to `KeyboardShortcuts`**

In `src/lib/components/KeyboardShortcuts.svelte`, replace

```ts
if (isControlFocused()) return;
```

with

```ts
// A held key repeats its keydown. Without this, holding a digit logged the
// same medication again the moment the 700ms write cooldown ran out.
if (e.repeat) return;

// Nothing fires behind an open dialog. isControlFocused() below exempts
// [tabindex="-1"], and every modal panel here is exactly that (ui/Modal,
// this overlay, the mobile menu), so with focus on a panel 1–9 logged a
// dose and n navigated away behind the edit dialog. `?` is let through
// only to close this component's own overlay.
if (document.querySelector('[aria-modal="true"]') && !(showHelp && e.key === "?")) return;

if (isControlFocused()) return;
```

Both checks sit after the `if (showHelp) { … }` block, so the overlay keeps its own Escape and Tab handling. Every `aria-modal="true"` element in the app (ui/Modal's panel, this overlay, the `(app)` mobile menu) is rendered only while open, so the check never matches a closed dialog.

- [ ] **Step 18: Run them to verify they pass, then prove them**

Run: `npx vitest run tests/unit/quick-log-target.test.ts`
Expected: PASS (all eight tests: the five existing ones and the three new guards).

Mutations in `src/lib/components/KeyboardShortcuts.svelte` (run the same command after each, then restore and re-run green):

1. Delete `    if (e.repeat) return;` → FAIL: "ignores a held key's repeats, so holding 1 logs once".
2. Delete the `if (document.querySelector('[aria-modal="true"]') && …) return;` line → FAIL: "fires nothing behind an open dialog, even with focus on its tabindex=-1 panel" and "still lets ? close its own help overlay, and lets nothing else through while it is open".
3. Change that line to `if (document.querySelector('[aria-modal="true"]')) return;` (dropping the `?` exemption) → FAIL: "still lets ? close its own help overlay…" (`expected <div …> to be null`).

- [ ] **Step 19: Update existing tests this change breaks**

- `tests/unit/done-list-ssr.test.ts`: done in Step 1 (the "Undo skip" name at `:167-172` and the header comment).
- No other test names "Undo skip" or "skip undone" (`grep -rn "Undo skip\|skip undone" tests src` returns only the lines already changed). `tests/unit/dashboard-page-ssr.test.ts` needs no edit: it renders the page, and the new named import from `DoneList.svelte` is SSR-safe.

- [ ] **Step 20: Run the task's full suite**

Run: `npx vitest run tests/unit/done-list-ssr.test.ts tests/unit/done-list-undo.test.ts tests/unit/dashboard-remove-undo.test.ts tests/unit/dashboard-page-ssr.test.ts tests/unit/quick-log-bar.test.ts tests/unit/quick-log-target.test.ts`
Expected: PASS, every file.

Run: `npx vitest run`
Expected: PASS, the whole unit suite (no test outside this task's files changes result).

Run: `npm run check`
Expected: no errors or warnings in `DoneList.svelte`, `dom-ids.ts`, `dashboard/+page.svelte`, `QuickLogBar.svelte`, `KeyboardShortcuts.svelte` or the five test files; the total error/warning count is unchanged from before this task.

Run: `npx prettier --check src/lib/components/dashboard/DoneList.svelte src/lib/components/dashboard/dom-ids.ts "src/routes/(app)/dashboard/+page.svelte" src/lib/components/QuickLogBar.svelte src/lib/components/KeyboardShortcuts.svelte tests/unit/done-list-ssr.test.ts tests/unit/done-list-undo.test.ts tests/unit/dashboard-remove-undo.test.ts tests/unit/quick-log-bar.test.ts tests/unit/quick-log-target.test.ts`
Expected: "All matched files use Prettier code style!"

- [ ] **Step 21: Commit**

```bash
git add src/lib/components/dashboard/DoneList.svelte src/lib/components/dashboard/dom-ids.ts "src/routes/(app)/dashboard/+page.svelte" src/lib/components/QuickLogBar.svelte src/lib/components/KeyboardShortcuts.svelte tests/unit/done-list-ssr.test.ts tests/unit/done-list-undo.test.ts tests/unit/dashboard-remove-undo.test.ts tests/unit/quick-log-bar.test.ts tests/unit/quick-log-target.test.ts
git commit -m "feat(dashboard): undoable Done removals, 44px chip segments, shortcuts that respect dialogs

Remove, Remove skip (renamed from Undo skip) and the edit dialog's Remove
now offer a restore Undo carrying the delete's restore handle, withdraw
any offer for the same dose when sent, and send the Undo's focus to the
restored row's Edit or the Done heading. The Quick Log li is box-content
so its segments are a full 44px. KeyboardShortcuts ignores repeated
keydowns and anything pressed while an aria-modal dialog is open."
```

---

### Task 11: Edit Save under the shared lock (`DoseEditForm`)

**Files:**

- Modify: `src/lib/components/DoseEditForm.svelte` (the whole `<script lang="ts">…</script>` block, anchored on its first line `  import { enhance } from "$app/forms";` and last line `</script>`; the form's opening tag, anchored on `  use:enhance={() => {`; the Save button, anchored on `      disabled={loading}`). Tasks 7–10 do not touch this file, so it is still the `HEAD` version.
- Create: `tests/unit/dose-edit-form-lock.test.ts`
- Test: `tests/unit/form-errors-enhance-callbacks.test.ts`

**Interfaces:**

- Consumes:
  - `$components/dose-writes/dose-write-lock.svelte` (Task 7): `getDoseWriteLock(): DoseWriteLock`, `createDoseWriteLock(opts: { cooldownMs?: number } = {})`, `DOSE_WRITE_COOLDOWN_MS`, and `DoseWriteLock { readonly busy: boolean; readonly active: boolean; acquire(): boolean; release(): void; hold(): void; extend(): void }`.
  - `$components/dose-writes/copy` (Task 7): `OFFLINE_WRITE_TOAST`, `STILL_SAVING_TOAST`, `UNKNOWN_OUTCOME_TOAST`.
  - `$components/dose-writes/reload-after-write` (Task 7): `reloadAfterWrite(opts?: { waitForServer?: boolean }): Promise<void>` — waits out a navigation in flight, then (when asked, or offline) `waitForServer()`, which probes `fetch("/api/health", { cache: "no-store" })` until `res.ok`, then `invalidateAll()`.
  - `$components/dose-writes/undo-registry.svelte` (Task 8): `clearUndo(): void`, `withdrawUndoFor(doseId: string): void`; the tests also use `offerUndo`, `currentUndo`, `resetUndoRegistry`.
  - `DoseActionForm.svelte` (Task 9), mounted in a test as the dialog's Remove.
  - `tests/unit/helpers/dashboard-context.ts` (Task 7): `doseWriteContext(lock?)`, `dashboardContext({ lock })`.
  - `$lib/utils/dose-undo` (Task 1): `DOSE_UNDO_WINDOW_MS`.
  - Existing: `actionFieldErrors`, `unsavedErrorMessage` (`$lib/utils/form-errors`); `startSubmit`, `finishSubmit` (`tests/unit/helpers/dose-action-form-harness.ts`).
- Produces:
  - `DoseEditForm` keeps its props `{ dose: DoseLogWithMedication; timezone: string; onclose: () => void }` but now calls `getDoseWriteLock()` during init, so anything that mounts it must provide the `(app)` layout's lock in context (the dashboard and /log pages do, through the layout; tests use `doseWriteContext()`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dose-edit-form-lock.test.ts`:

```ts
// DoseEditForm keeps its own use:enhance, for its inline field errors, but a
// Save is a dose write: it takes the (app) layout's write lock, refuses to
// run offline, withdraws and clears Undo offers, and reloads through
// reloadAfterWrite(), never update(). Mounted for real (jsdom, client svelte)
// with each form's use:enhance callback driven by hand. How each failure is
// SHOWN (field messages, the in-dialog alert) is in
// form-errors-enhance-callbacks.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DoseLogWithMedication } from "$lib/types";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy: () => void h.submits.delete(form) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll(), goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import DoseEditForm from "$lib/components/DoseEditForm.svelte";
import DoseActionForm from "$lib/components/dashboard/DoseActionForm.svelte";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  OFFLINE_WRITE_TOAST,
  STILL_SAVING_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "$lib/components/dose-writes/copy";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

const DOSE: DoseLogWithMedication = {
  id: "d1",
  userId: "u1",
  medicationId: "m1",
  quantity: 1,
  takenAt: new Date("2026-05-01T09:00:00.000Z"),
  loggedAt: new Date("2026-05-01T09:00:00.000Z"),
  notes: null,
  sideEffects: null,
  status: "taken",
  updatedAt: new Date("2026-05-01T09:00:00.000Z"),
  medication: {
    name: "Ibuprofen",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
  },
};

const SAVED: ActionResult = { type: "success", status: 200, data: { success: true } };
// What `enhance` builds when `fetch` itself rejects: no response, no status.
const NO_RESPONSE = { type: "error", error: new TypeError("Failed to fetch") } as ActionResult;

let lock: DoseWriteLock;
let onclose: Mock<() => void>;
let teardown: Array<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
  lock = createDoseWriteLock();
  onclose = vi.fn();
  teardown = [];
});

afterEach(() => {
  for (const fn of teardown) fn();
  resetUndoRegistry();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A fresh host element, removed again (with whatever was mounted in it) after the test. */
function host(): HTMLElement {
  return document.body.appendChild(document.createElement("div"));
}

function track(target: HTMLElement, app: ReturnType<typeof mount>): void {
  flushSync();
  teardown.push(() => {
    unmount(app);
    target.remove();
  });
}

function enhanced(form: HTMLFormElement | null) {
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("no use:enhance form");
  return { form, submit };
}

function mountEditForm() {
  const target = host();
  track(
    target,
    mount(DoseEditForm, {
      target,
      props: { dose: DOSE, timezone: "UTC", onclose },
      context: dashboardContext({ lock }),
    }),
  );
  const save = target.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  return { save, ...enhanced(target.querySelector<HTMLFormElement>('form[action="?/editDose"]')) };
}

/** The dialog's Remove, as the dashboard renders it beside the edit form, under the same lock. */
function mountRemove() {
  const target = host();
  track(
    target,
    mount(DoseActionForm, {
      target,
      props: {
        action: "?/deleteDose",
        fields: { doseId: DOSE.id },
        label: "Remove this dose",
        pendingLabel: "Removing…",
        variant: "danger",
      },
      context: dashboardContext({ lock }),
    }),
  );
  return enhanced(target.querySelector("form"));
}

function offerFor(doseId: string): void {
  offerUndo({
    message: `Dose removed: ${doseId}`,
    doseId,
    kind: "restore",
    deletedAt: "2026-05-01T09:05:00.000Z",
    expiresInMs: DOSE_UNDO_WINDOW_MS,
    focusTarget: () => null,
  });
  expect(currentUndo()?.doseId).toBe(doseId);
}

describe("DoseEditForm under the layout's write lock", () => {
  it("cancels a Save while another dose write holds the lock, and says so only while one is in flight", async () => {
    const { form, submit, save } = mountEditForm();

    lock.acquire();
    const busy = await startSubmit(submit, form);
    expect(busy.cancel).toHaveBeenCalledOnce();
    expect(busy.callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error");
    flushSync();
    expect(save.textContent?.trim()).toBe("Save Changes");

    // The write has let go and only its cooldown remains: refused silently.
    lock.release();
    h.showToast.mockClear();
    const cooling = await startSubmit(submit, form);
    expect(cooling.cancel).toHaveBeenCalledOnce();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("cancels the dialog's Remove while a Save is in flight, and frees both once it settles", async () => {
    const edit = mountEditForm();
    const remove = mountRemove();

    const saving = await startSubmit(edit.submit, edit.form);
    expect(saving.cancel).not.toHaveBeenCalled();

    const removing = await startSubmit(remove.submit, remove.form);
    expect(removing.cancel).toHaveBeenCalledOnce();
    expect(removing.callback).toBeNull();

    await finishSubmit(saving.callback!, edit.form, SAVED).done;
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);

    const retry = await startSubmit(remove.submit, remove.form);
    expect(retry.cancel).not.toHaveBeenCalled();
  });

  it("is aria-disabled, never disabled, while any dose write holds the lock, and 44px tall", () => {
    const { save } = mountEditForm();
    expect(save.hasAttribute("aria-disabled")).toBe(false);
    expect([...save.classList]).toContain("min-h-11");

    lock.acquire();
    flushSync();
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.disabled).toBe(false);
  });

  it("offline, cancels the Save, says nothing was saved, and takes no lock", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { form, submit } = mountEditForm();

    const { cancel, callback } = await startSubmit(submit, form);

    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(OFFLINE_WRITE_TOAST, "error");
    expect(lock.busy).toBe(false);
  });
});

describe("DoseEditForm and the Undo offer", () => {
  it("withdraws an offer naming this dose once the Save is sent, and a refused Save withdraws nothing", async () => {
    const { form, submit } = mountEditForm();
    offerFor("d1");

    lock.acquire();
    await startSubmit(submit, form);
    expect(currentUndo()?.doseId, "a refused Save must keep the Undo").toBe("d1");

    lock.release();
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    const sent = await startSubmit(submit, form);
    expect(sent.cancel).not.toHaveBeenCalled();
    expect(currentUndo()).toBeNull();
  });

  it("clears whatever offer remains after a successful Save, even one naming another dose", async () => {
    // An edit can move a dose onto a deleted one's slot; restoring that one
    // afterwards would record two doses for one slot.
    const { form, submit } = mountEditForm();
    offerFor("d9");

    const { callback } = await startSubmit(submit, form);
    expect(currentUndo()?.doseId, "the submit withdraws only this dose's offer").toBe("d9");

    const { update, done } = finishSubmit(callback!, form, SAVED);
    await done;

    expect(currentUndo()).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith("Dose updated", "success");
    expect(onclose).toHaveBeenCalledOnce();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    expect(lock.active).toBe(false);
  });
});

describe("DoseEditForm when the outcome is unknown", () => {
  it("keeps the lock until the server answers, then reloads exactly once and lets go", async () => {
    let answer!: (response: { ok: boolean }) => void;
    const probe = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => (answer = resolve)));
    vi.stubGlobal("fetch", probe);
    const { form, submit } = mountEditForm();

    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, NO_RESPONSE);

    await vi.waitFor(() =>
      expect(probe).toHaveBeenCalledWith("/api/health", { cache: "no-store" }),
    );
    expect(h.showToast).toHaveBeenCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
    expect(lock.active, "a retry must not run against unchecked data").toBe(true);
    expect(h.invalidateAll).not.toHaveBeenCalled();

    answer({ ok: true });
    await done;

    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
```

Notes for the executor:

- `dashboardContext({ lock })` sets the lock and a fixed dashboard clock; `DoseActionForm` needs the clock, `DoseEditForm` only the lock.
- `vi.waitFor` advances fake timers by its 50ms interval on each check; nothing in this flow arms a timer before the probe answers, so that is harmless.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/dose-edit-form-lock.test.ts`
Expected: FAIL, all seven tests:

- "cancels a Save while another dose write holds the lock…": `expected "spy" to be called once, but got 0 times` (the old form never cancels).
- "cancels the dialog's Remove while a Save is in flight…": the Remove is not cancelled (`expected "spy" to be called once, but got 0 times`), because Save never took the lock.
- "is aria-disabled, never disabled…": `expected [ … ] to include 'min-h-11'`.
- "offline, cancels the Save…": `cancel` not called.
- "withdraws an offer naming this dose…": `expected 'd1' to be null` on the second half.
- "clears whatever offer remains…": `expected { …(offer for d9) } to be null`, and `update` was called.
- "keeps the lock until the server answers…": `vi.waitFor` times out (the old form never probes `/api/health`).

- [ ] **Step 3: Write the implementation**

In `src/lib/components/DoseEditForm.svelte`, replace the whole `<script lang="ts">` block (from `<script lang="ts">` through the first `</script>`) with:

```svelte
<script lang="ts">
  import { applyAction, enhance } from "$app/forms";
  import { tick } from "svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { showToast } from "$components/ui/Toast.svelte";
  import SideEffectPicker from "$components/SideEffectPicker.svelte";
  import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
  import {
    OFFLINE_WRITE_TOAST,
    STILL_SAVING_TOAST,
    UNKNOWN_OUTCOME_TOAST,
  } from "$components/dose-writes/copy";
  import { reloadAfterWrite } from "$components/dose-writes/reload-after-write";
  import { clearUndo, withdrawUndoFor } from "$components/dose-writes/undo-registry.svelte";
  import { formatDateTimeLocal } from "$lib/utils/time";
  import { actionFieldErrors, unsavedErrorMessage } from "$lib/utils/form-errors";
  import type { DoseLogWithMedication, SideEffect } from "$lib/types";

  // `timezone` is the user's PROFILE zone and is not optional: the server
  // parses this field back with `parseDateTimeLocal(takenAt, user.timezone)`,
  // so rendering it in the browser's zone instead silently shifted the
  // timestamp on every save for anyone whose device zone differs.
  let {
    dose,
    timezone,
    onclose,
  }: { dose: DoseLogWithMedication; timezone: string; onclose: () => void } = $props();

  // The (app) layout's dose-write lock. Save keeps its own enhance for the
  // inline field errors below, but it is a dose write like any other: it
  // takes the same lock, so Save and the dialog's Remove exclude each other,
  // and a Save cannot start while another dose write is still in flight.
  const lock = getDoseWriteLock();

  let loading = $state(false);
  let sideEffects = $state<SideEffect[]>(dose.sideEffects ?? []);
  // The action's per-field messages, shown beside their controls. The toast
  // names one problem and then disappears; a rejected date and quantity
  // together need both to stay put next to the fields that caused them.
  let fieldErrors = $state<Record<string, string>>({});
  // Everything with no field of its own to sit beside: a dose deleted in
  // another tab, an expired session, a crash and its reference. The toast is
  // not enough on its own. It lives in the (app) layout, outside this
  // aria-modal dialog, so a screen reader is not told about it while the
  // dialog is open; and it closes after five seconds, taking the reference
  // support would ask for with it.
  let formError = $state("");

  // The keys with a message slot in this form. Any other keyed failure (the
  // hidden doseId, say) has nowhere to go but `formError`.
  const INLINE_FIELDS = ["takenAt", "quantity", "notes", "sideEffects"];

  /**
   * Put focus on the first thing that went wrong, inside this form: the
   * first invalid control, otherwise the first message. It moves on every
   * failed save, even one identical to the last, because a message that
   * does not change is not announced again, and landing on the field
   * re-reads its label and its description.
   */
  async function focusFirstProblem(form: HTMLFormElement) {
    await tick();
    const target =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form.querySelector<HTMLElement>('[role="alert"]');
    target?.focus();
  }

  /**
   * Nothing here calls enhance's `update()`. On success its `reset_focus`
   * sent focus to <body> after the Modal had returned it to the Edit button;
   * on an error result it handed the page to +error.svelte and threw the
   * edit away. Reloads go through `reloadAfterWrite()` instead.
   */
  const save: SubmitFunction = ({ cancel }) => {
    // Offline nothing can be saved, and the reload afterwards would swap the
    // page for the service worker's Offline page.
    if (navigator.onLine === false) {
      cancel();
      showToast(OFFLINE_WRITE_TOAST, "error");
      return;
    }
    if (!lock.acquire()) {
      cancel();
      // Only while another write is actually in flight. A tap refused by the
      // cooldown alone needs no explanation.
      if (lock.active) showToast(STILL_SAVING_TOAST, "error");
      return;
    }
    // Only once the Save is certain to be sent, so a refused Save never costs
    // the user their Undo. An offer naming this dose would otherwise act on
    // the row as it was before the edit.
    withdrawUndoFor(dose.id);
    loading = true;

    return async ({ formElement, result }) => {
      try {
        loading = false;
        fieldErrors = actionFieldErrors(result);
        formError = "";
        if (result.type === "success") {
          // An edit can move a dose onto a deleted one's slot, so no older
          // Undo survives it, whichever dose it names.
          clearUndo();
          showToast("Dose updated", "success");
          onclose();
          await reloadAfterWrite();
        } else if (result.type === "redirect") {
          await applyAction(result);
        } else if (result.type === "error" && result.status === undefined) {
          // No response at all: the edit may or may not have landed. Say so
          // inside the dialog too, where a screen reader can hear it, then
          // keep the lock until the server answers and the page has reloaded,
          // so a retry acts on data somebody has checked.
          showToast(UNKNOWN_OUTCOME_TOAST, "error");
          formError = UNKNOWN_OUTCOME_TOAST;
          await focusFirstProblem(formElement);
          await reloadAfterWrite({ waitForServer: true });
        } else {
          const message = unsavedErrorMessage(result, "Couldn't update dose. Please try again.");
          showToast(message, "error");
          const besideAField = INLINE_FIELDS.some((field) => fieldErrors[field]);
          formError = fieldErrors.form ?? (besideAField ? "" : message);
          await focusFirstProblem(formElement);
          // A refusal (a dose deleted in another tab, a rejected field)
          // reloads, so the list behind the dialog stops showing a dose that
          // is gone. An expired session or a crash does not: the edit stays
          // open, unchanged, to retry or cancel.
          if (result.type === "failure") await reloadAfterWrite();
        }
      } finally {
        loading = false;
        lock.release();
      }
    };
  };
</script>
```

Replace the form's opening tag, from

```svelte
<form
  method="POST"
  action="?/editDose"
  use:enhance={() => {
```

down to and including its closing lines

```svelte
}} class="space-y-4" >
```

with

```svelte
<form method="POST" action="?/editDose" use:enhance={save} class="space-y-4">
```

Replace the Save button

```svelte
    <button
      type="submit"
      disabled={loading}
      class="bg-accent text-accent-fg flex-1 rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
    >
```

with

```svelte
    <!-- aria-disabled, never `disabled`: the attribute drops keyboard focus
         to <body>. A busy Save is cancelled in `save` instead. min-h-11 is
         the dose-control floor; compact density rewrites .py-2.5. -->
    <button
      type="submit"
      aria-disabled={loading || lock.busy ? "true" : undefined}
      class="bg-accent text-accent-fg min-h-11 flex-1 rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    >
```

Everything else in the markup (the fields, the side-effect picker, the form-level alert, Cancel) is unchanged.

Behaviour, result by result (spec Section 3, "Edit dialog Save"):

- **success:** `clearUndo()`, toast "Dose updated", `onclose()` (the Modal returns focus to the ✎/Edit button), then `reloadAfterWrite()` with the lock still held.
- **failure (4xx):** the existing inline field errors and form message, focus the first problem, then `reloadAfterWrite()`, so a dose deleted in another tab leaves the list behind the dialog.
- **error with a status (401, 5xx):** the existing in-place message; no reload.
- **error with no status (network):** toast and in-dialog message `UNKNOWN_OUTCOME_TOAST`, then `reloadAfterWrite({ waitForServer: true })` while the lock is held.
- **redirect:** `applyAction(result)`.
- `finally`: `loading = false; lock.release()`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/dose-edit-form-lock.test.ts`
Expected: PASS (all seven tests).

- [ ] **Step 5: Prove by mutation**

For each, edit `src/lib/components/DoseEditForm.svelte`, run `npx vitest run tests/unit/dose-edit-form-lock.test.ts`, confirm the named failure, restore, re-run green.

1. Save without `acquire()`: delete the block `if (!lock.acquire()) { cancel(); if (lock.active) showToast(STILL_SAVING_TOAST, "error"); return; }` → FAIL: "cancels a Save while another dose write holds the lock, and says so only while one is in flight" and "cancels the dialog's Remove while a Save is in flight, and frees both once it settles".
2. Change `if (lock.active) showToast(STILL_SAVING_TOAST, "error");` to `if (lock.busy) showToast(STILL_SAVING_TOAST, "error");` → FAIL: "cancels a Save while another dose write holds the lock, and says so only while one is in flight" (the cooldown-only tap toasts).
3. Withdraw before `acquire()`: move `withdrawUndoFor(dose.id);` to the first line of `save`, above the offline gate → FAIL: "withdraws an offer naming this dose once the Save is sent, and a refused Save withdraws nothing".
4. Withdraw only the edited dose on success: change `clearUndo();` to `withdrawUndoFor(dose.id);` → FAIL: "clears whatever offer remains after a successful Save, even one naming another dose".
5. Remove the offline gate (the `if (navigator.onLine === false) { … }` block) → FAIL: "offline, cancels the Save, says nothing was saved, and takes no lock".
6. Release before the reload: delete `lock.release();` from `finally` and add it as the first line of the `try` block → FAIL: "keeps the lock until the server answers, then reloads exactly once and lets go" (`lock.active` is false while the probe is pending).
7. Restore the old button: replace `aria-disabled={loading || lock.busy ? "true" : undefined}` with `disabled={loading || lock.busy}` → FAIL: "is aria-disabled, never disabled, while any dose write holds the lock, and 44px tall".

- [ ] **Step 6: Update existing tests this change breaks**

`tests/unit/form-errors-enhance-callbacks.test.ts` now throws at mount (`No dose-write lock in context`) and asserts the old `update()` calls. Edit it as follows.

Replace

```ts
import type { DoseLogWithMedication } from "$lib/types";
import { NO_RESPONSE_MESSAGE, SESSION_EXPIRED_MESSAGE } from "$lib/utils/form-errors";
```

with

```ts
import type { DoseLogWithMedication } from "$lib/types";
import { SESSION_EXPIRED_MESSAGE } from "$lib/utils/form-errors";
import { UNKNOWN_OUTCOME_TOAST } from "$lib/components/dose-writes/copy";
import { createDoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";
import { doseWriteContext } from "./helpers/dashboard-context";
```

Replace

```ts
vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    captured.submit = submit;
    return { destroy() {} };
  },
}));

const showToast = vi.hoisted(() => vi.fn());
vi.mock("$components/ui/Toast.svelte", () => ({ showToast }));
```

with

```ts
vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    captured.submit = submit;
    return { destroy() {} };
  },
  applyAction: vi.fn(async () => {}),
}));

const showToast = vi.hoisted(() => vi.fn());
vi.mock("$components/ui/Toast.svelte", () => ({ showToast }));

// DoseEditForm reloads through reloadAfterWrite(), never `update()`: these
// are what that reads. No navigation in flight, no new deploy, and the Undo
// registry live (it is a no-op unless `browser`).
const invalidateAll = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("$app/navigation", () => ({ invalidateAll, goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
```

Replace

```ts
beforeEach(() => {
  captured.submit = undefined;
  showToast.mockReset();
```

with

```ts
beforeEach(() => {
  captured.submit = undefined;
  showToast.mockReset();
  invalidateAll.mockClear();
```

Replace

```ts
afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  target.remove();
});
```

with

```ts
afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  target.remove();
  vi.unstubAllGlobals();
});
```

In the `submit()` helper, replace

```ts
  flushSync();
  await tick();
  return update;
}
```

with

```ts
  flushSync();
  await tick();
  // DoseEditForm's write lock cools down on a zero-length timer here (see its
  // mount below), so a test's next submit is not refused as a double tap.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return update;
}
```

In the `DoseEditForm` describe's `beforeEach`, replace

```ts
component = mount(DoseEditForm, { target, props: { dose, timezone: "UTC", onclose } });
```

with

```ts
// The (app) layout's lock, which DoseEditForm now takes like every dose
// write. No cooldown, so consecutive submits in one test are not refused.
component = mount(DoseEditForm, {
  target,
  props: { dose, timezone: "UTC", onclose },
  context: doseWriteContext(createDoseWriteLock({ cooldownMs: 0 })),
});
```

In "says a dose deleted in another tab inside the dialog, not only in the toast" (`:186-193`), replace

```ts
    expect(target.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(update).toHaveBeenCalledOnce();
  });
```

with

```ts
    expect(target.querySelector('[aria-invalid="true"]')).toBeNull();
    // Not `update()`: reloadAfterWrite(), so the list behind the dialog
    // stops showing a dose that is gone.
    expect(update).not.toHaveBeenCalled();
    expect(invalidateAll).toHaveBeenCalledOnce();
  });
```

In "answers a crash in place, with the reference, and keeps the edit open", replace

```ts
// `update()` would replace the page with +error.svelte and discard the edit.
expect(update).not.toHaveBeenCalled();
expect(onclose).not.toHaveBeenCalled();
```

with

```ts
// `update()` would replace the page with +error.svelte and discard the edit.
expect(update).not.toHaveBeenCalled();
// Nothing changed on the server, so nothing is reloaded under the edit.
expect(invalidateAll).not.toHaveBeenCalled();
expect(onclose).not.toHaveBeenCalled();
```

Replace the whole test

```ts
it("answers a request that never got a response without the browser's wording", async () => {
  const update = await submit(NO_RESPONSE);

  expectFormAlert(NO_RESPONSE_MESSAGE);
  expect(update).not.toHaveBeenCalled();
});
```

with

```ts
it("answers a request that never got a response without the browser's wording", async () => {
  // No response, so the edit may have landed: the same sentence as every
  // other dose write, inside the dialog as well as in the toast. The page
  // reloads once the server answers the health probe.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true })),
  );
  const update = await submit(NO_RESPONSE);

  expect(showToast).toHaveBeenCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
  expectFormAlert(UNKNOWN_OUTCOME_TOAST);
  expect(update).not.toHaveBeenCalled();
  expect(invalidateAll).toHaveBeenCalledOnce();
});
```

In "clears the previous attempt's field messages once a save succeeds" (`:246-257`), replace

```ts
    expect(showToast).toHaveBeenLastCalledWith("Dose updated", "success");
    expect(onclose).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });
```

with

```ts
    expect(showToast).toHaveBeenLastCalledWith("Dose updated", "success");
    expect(onclose).toHaveBeenCalledOnce();
    // reloadAfterWrite(), not `update()`: update's reset_focus sent focus to
    // <body> after the Modal had returned it to the Edit button.
    expect(update).not.toHaveBeenCalled();
    expect(invalidateAll).toHaveBeenCalledOnce();
  });
```

The `MedicationForm` describe is untouched: it does not use the lock, and the extra zero-length wait in `submit()` does not change what it observes.

Run: `npx vitest run tests/unit/form-errors-enhance-callbacks.test.ts`
Expected: PASS (all tests, both describes).

Mutation for the reload on success: in `DoseEditForm.svelte` delete `await reloadAfterWrite();` from the success branch. Run `npx vitest run tests/unit/form-errors-enhance-callbacks.test.ts tests/unit/dose-edit-form-lock.test.ts`. Expected: FAIL in "clears the previous attempt's field messages once a save succeeds" and "clears whatever offer remains after a successful Save, even one naming another dose" (`invalidateAll` not called). Restore, re-run green.

Mutation for the reload on a refusal: change `if (result.type === "failure") await reloadAfterWrite();` to nothing (delete the line). Run `npx vitest run tests/unit/form-errors-enhance-callbacks.test.ts`. Expected: FAIL in "says a dose deleted in another tab inside the dialog, not only in the toast". Restore, re-run green.

No other test mounts `DoseEditForm` directly: `grep -rln "DoseEditForm.svelte" tests` lists only `form-errors-enhance-callbacks.test.ts` and the new `dose-edit-form-lock.test.ts`. One test reaches it indirectly: `tests/unit/dashboard-remove-undo.test.ts` (Task 10) mounts the dashboard page and opens the edit dialog, and it already provides `doseWriteContext()` and mocks `$app/forms` (with `applyAction`), `$app/navigation`, `$app/state` and `$app/environment`, so it needs no edit. `tests/unit/log-page-mount.svelte.test.ts` never opens the dialog, so `DoseEditForm` is not mounted there.

- [ ] **Step 7: Run the task's full suite**

Run: `npx vitest run tests/unit/dose-edit-form-lock.test.ts tests/unit/form-errors-enhance-callbacks.test.ts tests/unit/dashboard-remove-undo.test.ts tests/unit/dashboard-page-ssr.test.ts tests/unit/log-page-mount.svelte.test.ts`
Expected: PASS, every file.

Run: `npx vitest run`
Expected: PASS, the whole unit suite.

Run: `npm run check`
Expected: no errors or warnings in `DoseEditForm.svelte` or either test file; the total count is unchanged from before this task.

Run: `npx prettier --check src/lib/components/DoseEditForm.svelte tests/unit/dose-edit-form-lock.test.ts tests/unit/form-errors-enhance-callbacks.test.ts`
Expected: "All matched files use Prettier code style!"

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/DoseEditForm.svelte tests/unit/dose-edit-form-lock.test.ts tests/unit/form-errors-enhance-callbacks.test.ts
git commit -m "fix(doses): put edit Save under the shared dose-write lock

DoseEditForm keeps its own enhance for inline field errors, but Save now
takes the layout's write lock (so Save and Remove exclude each other),
refuses to run offline, withdraws the Undo offer naming the edited dose
only once the Save is sent, clears any remaining offer on success, and
reloads through reloadAfterWrite() instead of update(), holding the lock
until the server answers after a network failure. The Save button uses
aria-disabled rather than disabled."
```

---

### Task 12: /log — one-tap delete with Undo

This task turns the /log row's × from a two-step confirmation into a one-tap delete that goes through the shared dose-write primitive, so the toast offers a restore Undo (spec D2, Section 3 "/log `TimelineEntry`", Section 4 "Focus"). It:

- deletes the inline "Delete this dose? This can't be undone." confirmation and everything that served it;
- makes × a submit inside `<form action="?/deleteDose">` driven by `createDoseWrite`, but only once the row has mounted (before hydration it stays an inert `type="button"`);
- adds the `dayLabel` prop, so the Undo offer reads "Dose removed: Paracetamol 500mg yesterday at 8:00" or "…on Tue 7 Apr at 8:00";
- marks every row `data-dose-id` and its ✎ `data-edit`, and moves focus after a delete to the next surviving row's ✎ below (crossing day groups), else the nearest above, else the page's `h1` — never a ×;
- gives the /log `h1` `tabindex="-1"` so it can take that last-resort focus.

It carries **Review Focus #4**: a keyboard user deletes the last dose of a day, focus goes to the next day's first ✎ (never `<body>`), and after Undo focus goes to the restored row's ✎.

The /log ✎ and × are the stated exception to the 44px Global Constraint (`size-8 pointer-coarse:size-11`: 32px for a mouse, 44px on a coarse pointer; spec Section 3). Do not enlarge them to `size-11`.

The server side is already done: Task 2 made `/log`'s `?/deleteDose` action `deleteDoseAction`, which answers `{ success: true, doseId, restore: { deletedAt, expiresInMs } }`. Task 3 added `/dashboard?/restoreDose`. This task changes no server file.

**Files:**

- Modify: `src/lib/components/TimelineEntry.svelte` (full replacement given in Step 5)
- Modify: `src/routes/(app)/log/+page.svelte` (anchors: `<h1 class="text-2xl font-bold">Dose History</h1>`, `const groups: Array<{ dateKey: string; label: string; doses: typeof data.doses }> = [];`, `timeFormat={data.preferences.timeFormat as "12h" | "24h"}`)
- Create: `tests/unit/timeline-entry-delete.test.ts`
- Delete: `tests/unit/timeline-entry-delete-confirm.test.ts` (its still-true cases move into the new file; the confirmation cases go with the confirmation)
- Test (modify): `tests/unit/timeline-entry-ssr.test.ts` (anchors: `// explained in tests/unit/timeline-entry-delete-confirm.test.ts.`, `vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));`, `onedit: () => {},`, `return x!.parentElement!;`, `const atRest = tokens(x!.parentElement!).filter((t) => !t.includes(":"));`)
- Test (modify): `tests/unit/log-page-mount.svelte.test.ts` (anchors quoted in Step 9)
- Test (modify): `tests/unit/log-pagination-ssr.test.ts` (anchors: `const { default: LogPage } = await import("../../src/routes/(app)/log/+page.svelte");`, and the `}).body;` that closes `renderAt`, quoted in full in Step 8)

**Interfaces:**

- Consumes:
  - Task 2 — `/log`'s `deleteDose` action is `(event) => deleteDoseAction(event)`, returning `ActionFailure<{ error: string }> | { success: true; doseId: string; restore?: { deletedAt: string; expiresInMs: number } }`; `restore` is present because × does not post `forUndo`.
  - Task 3 — `/dashboard?/restoreDose` answers `{ success: true, doseId }`, `fail(410, { error: RESTORE_GONE_MESSAGE })` or `fail(409, { error: RESTORE_LOGGED_SINCE_MESSAGE })`.
  - Task 7 — `src/lib/components/dose-writes/dose-write-lock.svelte.ts`: `DOSE_WRITE_COOLDOWN_MS`, `DoseWriteLock` (with `busy` and `active`), `createDoseWriteLock(opts?: { cooldownMs?: number })`.
  - Task 7 — `src/lib/components/dose-writes/focus-after.ts`:
    ```ts
    export interface FocusTargetOptions {
      attr?: "cardKey" | "doseId";
      precedingKeys?: readonly string[];
      pick?: (row: HTMLElement) => HTMLElement | null;
    }
    export function focusTargetAfterResolve(
      key: string,
      followingKeys: readonly string[],
      opts: FocusTargetOptions = {},
      root: ParentNode = document,
    ): HTMLElement | null;
    ```
    Order: same key, then `followingKeys`, then `precedingKeys`; a row that `pick` returns null for is skipped.
  - Task 7 — `src/lib/components/dose-writes/copy.ts`: `RESTORE_ACTION = "/dashboard?/restoreDose"`, `RESTORED_TOAST = "Dose restored"`, `STILL_SAVING_TOAST = "Still saving your last change…"`.
  - Task 7 — `tests/unit/helpers/dashboard-context.ts`: `doseWriteContext(lock: DoseWriteLock = createDoseWriteLock()): Map<symbol, unknown>`.
  - Task 8 — `src/lib/components/dose-writes/undo-registry.svelte.ts`: `offerUndo(input: UndoOfferInput)`, `currentUndo(): UndoOffer | null`, `resetUndoRegistry()`; `UndoOffer` carries `message`, `doseId`, `kind`, `deletedAt?`, `expiresInMs?`, `respondedAt?`, `focusTarget`, `id`, `deadline`, `running`, `note`; `deadline` is `(respondedAt ?? Date.now()) + lifetime`. `runUndo` posts a restore-kind offer to `RESTORE_ACTION` with `doseId` and `deletedAt`, runs `reloadAfterWrite()`, `tick()`, then `focusIfLost(offer.focusTarget, () => remembered, () => document.querySelector("h1"))`.
  - Task 8 — `src/lib/components/ui/Toast.svelte`: default export (mounted once in the `(app)` layout), `clearToasts()`, a stack container carrying `data-toast-stack`, and an offer button whose visible text is `Undo`.
  - Task 9 — `src/lib/components/dose-writes/dose-write.svelte.ts`:
    ```ts
    export interface DoseWriteOptions {
      staleGuard?: DashboardClock;
      undo?: { kind: UndoKind; focusTarget: () => HTMLElement | null };
      withdrawsUndoFor?: string;
      buildToast?: (doseId: string | null, respondedAt: Date) => string | null;
      focusAfter?: () => HTMLElement | null;
      busyContainer?: () => HTMLElement | null;
      onSuccess?: () => void;
    }
    export interface DoseWrite {
      submit: SubmitFunction;
      readonly pending: boolean;
      readonly busy: boolean;
      onkeydown: (e: KeyboardEvent) => void;
    }
    export function createDoseWrite(getOptions: () => DoseWriteOptions): DoseWrite; // call during component init; reads getDoseWriteLock()
    ```
    It reads `getOptions()` at submit time; on success it first records `const respondedAt = Date.now()`, then runs `reloadAfterWrite()`, `tick()`, `clearUndo()`, then `offerUndo({ message: buildToast(doseId, new Date(respondedAt)), doseId, kind, deletedAt: data.restore?.deletedAt, expiresInMs: data.restore?.expiresInMs, respondedAt, focusTarget })`, then focuses `focusAfter()`. The offer's deadline counts from `respondedAt`, not from the end of the reload; `expiresInMs` is passed through as the server sent it. A `buildToast` that takes fewer arguments (this task's `() => message`) stays valid.
- Produces:
  - `TimelineEntry` props: `{ dose: DoseLogWithMedication; timezone: string; timeFormat?: TimeFormat; dayLabel: string | null; onedit?: (dose: DoseLogWithMedication) => void }`. `dayLabel` is the day group's heading, `null` for Today.
  - DOM contract on /log: each row is `[role="listitem"][data-dose-id="<id>"]`; its ✎ carries `data-edit`; × keeps `aria-label="Delete dose of {name} at {time}"` (e2e selects it with the substring "Delete dose"); the delete form is `method="POST" action="?/deleteDose"` with a hidden `doseId`.
  - Undo copy: `Dose removed: <label> at <time>` (Today), `Dose removed: <label> yesterday at <time>`, `Dose removed: <label> on <dayLabel> at <time>`. `<label>` is `formatDoseLabel(name, dosageAmount, dosageUnit)`; `<time>` is `formatUserTime`, which renders single-digit hours unpadded ("8:00").
  - The /log `h1` is `tabindex="-1"`.

---

#### Cycle A — the row: one tap, the layout's lock, the offer, and focus

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/timeline-entry-delete.test.ts`:

```ts
// The /log row's × really mounted (jsdom, client svelte) and driven through
// the shared dose-write primitive and the real Toast. What matters here is
// which tap sends a delete, which one the (app) layout's one lock refuses,
// what the Undo offer says, and where focus lands after the reload — none of
// which SSR markup can show. The markup half (names, sizes, the
// pre-hydration type="button") is in tests/unit/timeline-entry-ssr.test.ts;
// the page's own grouping and h1 are in tests/unit/log-page-mount.svelte.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DoseLogWithMedication } from "$lib/types";

const h = vi.hoisted(() => ({
  /** Every submit that reached `enhance` and was not cancelled, waiting for the test to answer it. */
  sent: [] as Array<{
    action: string | null;
    fields: Record<string, FormDataEntryValue>;
    finish: (result: ActionResult) => Promise<void>;
  }>,
  /** Submits the primitive cancelled before anything was sent. */
  cancelled: 0,
  /** SvelteKit's `update`. No dose write may call it. */
  update: vi.fn(async () => {}),
  /** The reload `reloadAfterWrite` runs. Each test decides what it does to the DOM. */
  invalidateAll: vi.fn(async () => {}),
}));

// The Undo registry and Toast's list are no-ops outside the browser.
vi.mock("$app/environment", () => ({
  browser: true,
  dev: false,
  building: false,
  version: "test",
}));
// The real idle shapes: reloadAfterWrite reads `navigating` before it reloads.
vi.mock("$app/state", () => ({
  page: { url: new URL("https://medtracker.test/log"), data: {} },
  navigating: { from: null, to: null, type: null, willUnload: null, delta: null, complete: null },
  updated: { current: false, check: async () => false },
}));
vi.mock("$app/navigation", () => ({
  invalidateAll: () => h.invalidateAll(),
  afterNavigate: () => {},
  beforeNavigate: () => {},
  goto: async () => {},
}));
// SvelteKit's `enhance`, reduced to its two-phase contract: the submit
// function runs when the form submits, and the callback it returns runs when
// the test answers. A cancelled submit sends nothing, as in SvelteKit.
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    const onSubmit = async (e: SubmitEvent) => {
      e.preventDefault();
      const formData = new FormData(form);
      const action = new URL(form.getAttribute("action") ?? "", "https://medtracker.test/log");
      let cancelled = false;
      const callback = await submit({
        action,
        formData,
        formElement: form,
        controller: new AbortController(),
        submitter: e.submitter,
        cancel: () => {
          cancelled = true;
        },
      });
      if (cancelled) {
        h.cancelled++;
        return;
      }
      h.sent.push({
        action: form.getAttribute("action"),
        fields: Object.fromEntries(formData),
        finish: async (result) => {
          if (typeof callback === "function") {
            await callback({ action, formData, formElement: form, result, update: h.update });
          }
        },
      });
    };
    form.addEventListener("submit", onSubmit);
    return { destroy: () => form.removeEventListener("submit", onSubmit) };
  },
  applyAction: async () => {},
  deserialize: (text: string) => JSON.parse(text),
}));

import TimelineEntry from "$lib/components/TimelineEntry.svelte";
import Toast, { clearToasts } from "$lib/components/ui/Toast.svelte";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
} from "$lib/components/dose-writes/undo-registry.svelte";
import {
  RESTORE_ACTION,
  RESTORED_TOAST,
  STILL_SAVING_TOAST,
} from "$lib/components/dose-writes/copy";
import { doseWriteContext } from "./helpers/dashboard-context";

function makeDose(
  id: string,
  name: string,
  dosageAmount: string,
  dosageUnit: string,
  takenAt: string,
): DoseLogWithMedication {
  return {
    id,
    userId: "user-1",
    medicationId: `med-${id}`,
    quantity: 1,
    takenAt: new Date(takenAt),
    loggedAt: new Date(takenAt),
    updatedAt: new Date(takenAt),
    notes: null,
    sideEffects: null,
    status: "taken",
    medication: {
      name,
      dosageAmount,
      dosageUnit,
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
  };
}

// Newest first, as the page lists them: two today, two yesterday.
const A = makeDose("a", "Vitamin D", "1000", "IU", "2026-04-16T08:00:00Z");
const B = makeDose("b", "Magnesium", "400", "mg", "2026-04-16T07:00:00Z");
const C = makeDose("c", "Omega-3", "1000", "mg", "2026-04-15T21:30:00Z");
const D = makeDose("d", "Iron", "14", "mg", "2026-04-15T08:00:00Z");

const DELETED_AT = "2026-04-16T09:00:00.000Z";

/** What `deleteDoseAction` answers for a delete it kept for Undo. */
function deleted(id: string): ActionResult {
  return {
    type: "success",
    status: 200,
    data: { success: true, doseId: id, restore: { deletedAt: DELETED_AT, expiresInMs: 600_000 } },
  };
}

const onedit = vi.fn();
let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.sent.length = 0;
  h.cancelled = 0;
  h.update.mockClear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockImplementation(async () => {});
  onedit.mockClear();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  resetUndoRegistry();
  clearToasts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Group = { dayLabel: string | null; doses: DoseLogWithMedication[] };
type MountedRow = {
  component: ReturnType<typeof mount>;
  list: HTMLElement;
  index: number;
  dose: DoseLogWithMedication;
  dayLabel: string | null;
};

/**
 * The /log page's structure by hand: an h1 that takes focus, one role="list"
 * per day group, a row per dose, and the real Toast, all under one layout
 * lock. `drop` and `restore` are what the reload does after a delete and
 * after its Undo: the row goes, then the same id comes back where it was.
 */
function renderLog(groups: Group[], lock: DoseWriteLock = createDoseWriteLock()) {
  const context = doseWriteContext(lock);
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  heading.textContent = "Dose History";
  document.body.append(heading);

  const live = new Map<string, MountedRow>();
  const gone = new Map<string, MountedRow>();

  function mountRow(
    list: HTMLElement,
    index: number,
    dose: DoseLogWithMedication,
    dayLabel: string | null,
  ) {
    const component = mount(TimelineEntry, {
      target: list,
      anchor: list.children[index] ?? undefined,
      props: { dose, timezone: "UTC", timeFormat: "24h", dayLabel, onedit },
      context,
    });
    live.set(dose.id, { component, list, index, dose, dayLabel });
  }

  for (const group of groups) {
    const list = document.createElement("div");
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", group.dayLabel ?? "Today");
    document.body.append(list);
    group.doses.forEach((dose, index) => mountRow(list, index, dose, group.dayLabel));
  }
  const toast = mount(Toast, { target: document.body, context });
  flushSync();

  cleanup = () => {
    for (const row of live.values()) unmount(row.component);
    unmount(toast);
    document.body.innerHTML = "";
  };

  return {
    heading,
    drop(id: string) {
      const row = live.get(id);
      if (!row) throw new Error(`no row ${id} to drop`);
      unmount(row.component);
      live.delete(id);
      gone.set(id, row);
      flushSync();
    },
    restore(id: string) {
      const row = gone.get(id);
      if (!row) throw new Error(`no dropped row ${id} to restore`);
      gone.delete(id);
      mountRow(row.list, row.index, row.dose, row.dayLabel);
      flushSync();
    },
  };
}
type Log = ReturnType<typeof renderLog>;

const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-dose-id="${id}"]`);
const editButton = (id: string) =>
  document.querySelector<HTMLElement>(`[data-dose-id="${id}"] [data-edit]`);
const stackText = () => document.querySelector("[data-toast-stack]")?.textContent ?? "";

function deleteButton(id: string): HTMLButtonElement {
  const x = document.querySelector<HTMLButtonElement>(
    `[data-dose-id="${id}"] button[aria-label^="Delete dose of"]`,
  );
  if (!x) throw new Error(`no × for ${id}`);
  return x;
}

function undoButton(): HTMLButtonElement {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-toast-stack] button")];
  const undo = buttons.find((b) => b.textContent?.trim() === "Undo");
  if (!undo) throw new Error("no Undo button in the toast stack");
  return undo;
}

/** Let the component's awaits and the enhance mock's finish. */
async function settle() {
  flushSync();
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
}

/** Focus × and activate it, the way a keyboard or a pointer does. */
async function pressDelete(id: string) {
  const x = deleteButton(id);
  x.focus();
  x.click();
  await settle();
}

/** Press ×, answer the delete as the server does, and reload as the page would. */
async function deleteAndReload(log: Log, id: string) {
  h.invalidateAll.mockImplementationOnce(async () => log.drop(id));
  const before = h.sent.length;
  await pressDelete(id);
  expect(h.sent, `× on ${id} sent nothing`).toHaveLength(before + 1);
  const sent = h.sent[before];
  expect(sent.fields).toEqual({ doseId: id });
  await sent.finish(deleted(id));
  await settle();
}

describe("× deletes on the first tap", () => {
  it("is a submit once mounted, and one tap sends ?/deleteDose with this dose's id, asking nothing first", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    const x = deleteButton("a");
    expect(x.type).toBe("submit");
    // e2e selects × by the substring "Delete dose"; the name must not change.
    expect(x.getAttribute("aria-label")).toBe("Delete dose of Vitamin D at 8:00");
    expect(x.hasAttribute("aria-expanded")).toBe(false);

    await pressDelete("a");

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].action).toBe("?/deleteDose");
    expect(h.sent[0].fields).toEqual({ doseId: "a" });
    expect(document.querySelector('[role="group"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/can't be undone/i);
  });

  it("does not open the edit dialog from ×, or from the gap beside it; the row itself still does", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    await pressDelete("a");
    // The wrapper around ✎ and ×'s form: a click on it is one in the gap.
    deleteButton("a").closest("form")!.parentElement!.click();
    expect(onedit).not.toHaveBeenCalled();

    rowOf("a")!.click();
    expect(onedit).toHaveBeenCalledTimes(1);
    expect(onedit).toHaveBeenCalledWith(A);
  });

  it("swallows a held Enter on ×, so holding the key cannot run on into the next row", () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    const x = deleteButton("a");
    const first = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const held = new KeyboardEvent("keydown", {
      key: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    x.dispatchEvent(first);
    x.dispatchEvent(held);
    expect(first.defaultPrevented).toBe(false);
    expect(held.defaultPrevented).toBe(true);
  });

  it("shows it is busy with aria-disabled, a spinner and aria-busy on the row, never `disabled`", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    const x = deleteButton("a");
    await pressDelete("a");

    expect(x.getAttribute("aria-disabled")).toBe("true");
    expect(x.disabled).toBe(false);
    expect(x.querySelector(".animate-spin")).not.toBeNull();
    expect(rowOf("a")!.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(x);

    await h.sent[0].finish({ type: "failure", status: 404, data: { error: "Dose not found" } });
    await settle();

    expect(x.querySelector(".animate-spin")).toBeNull();
    expect(rowOf("a")!.hasAttribute("aria-busy")).toBe(false);
    expect(stackText()).toContain("Dose not found");
    // Focus was never lost, so a failure leaves it where the user put it.
    expect(document.activeElement).toBe(x);
  });
});

describe("the (app) layout's one lock", () => {
  it("refuses another row's × while a delete is in flight, and says so", async () => {
    renderLog([{ dayLabel: null, doses: [A, B] }]);
    await pressDelete("a");
    await pressDelete("b");

    expect(h.sent).toHaveLength(1);
    expect(h.cancelled).toBe(1);
    expect(stackText()).toContain(STILL_SAVING_TOAST);
  });

  it("refuses another row's × inside the cooldown after a delete, and takes it once the cooldown ends", async () => {
    const log = renderLog([{ dayLabel: null, doses: [A, B] }]);
    await deleteAndReload(log, "a");
    // Past a zero-length cooldown, well inside the real one.
    await vi.advanceTimersByTimeAsync(1);

    await pressDelete("b");
    expect(h.sent).toHaveLength(1);
    expect(h.cancelled).toBe(1);
    expect(deleteButton("b").getAttribute("aria-disabled")).toBe("true");
    // The cooldown alone is not "still saving", so it says nothing.
    expect(stackText()).not.toContain(STILL_SAVING_TOAST);

    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    await settle();
    expect(deleteButton("b").hasAttribute("aria-disabled")).toBe(false);
    await pressDelete("b");
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].fields).toEqual({ doseId: "b" });
  });
});

describe("the Undo offer", () => {
  it.each<[string | null, string]>([
    [null, "Dose removed: Vitamin D 1000IU at 8:00"],
    ["Yesterday", "Dose removed: Vitamin D 1000IU yesterday at 8:00"],
    ["Wed 15 Apr", "Dose removed: Vitamin D 1000IU on Wed 15 Apr at 8:00"],
  ])(
    "offers a restore carrying the server's handle, placing a row under %s by its day",
    async (dayLabel, message) => {
      const log = renderLog([{ dayLabel, doses: [A] }]);
      await deleteAndReload(log, "a");

      expect(currentUndo()).toMatchObject({
        kind: "restore",
        doseId: "a",
        deletedAt: DELETED_AT,
        message,
      });
      expect(stackText()).toContain(message);
    },
  );

  it("withdraws an offer for this dose as soon as × sends", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    offerUndo({
      message: "Vitamin D 1000IU logged at 8:00",
      doseId: "a",
      kind: "delete",
      focusTarget: () => null,
    });

    await pressDelete("a");

    expect(h.sent).toHaveLength(1);
    expect(currentUndo()).toBeNull();
  });

  it("leaves an offer for a different dose alone", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    offerUndo({
      message: "Omega-3 1000mg logged at 21:30",
      doseId: "c",
      kind: "delete",
      focusTarget: () => null,
    });

    await pressDelete("a");

    expect(currentUndo()?.doseId).toBe("c");
  });
});

describe("focus after a delete, and after its Undo (Review Focus #4)", () => {
  it("moves from the last dose of a day to the next day's first ✎, and Undo brings it to the restored row's ✎", async () => {
    const log = renderLog([
      { dayLabel: null, doses: [A] },
      { dayLabel: "Yesterday", doses: [C, D] },
    ]);

    await deleteAndReload(log, "a");

    expect(rowOf("a")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(editButton("c"));

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ type: "success", status: 200, data: { success: true, doseId: "a" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    h.invalidateAll.mockImplementationOnce(async () => log.restore("a"));

    // The keyboard user tabs into the toast stack and presses Undo there.
    const undo = undoButton();
    undo.focus();
    undo.click();
    await vi.waitFor(() => expect(stackText()).toContain(RESTORED_TOAST));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESTORE_ACTION);
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("doseId")).toBe("a");
    expect((init?.body as FormData).get("deletedAt")).toBe(DELETED_AT);
    expect(rowOf("a")).not.toBeNull();
    expect(document.activeElement).toBe(editButton("a"));
    expect(h.update).not.toHaveBeenCalled();
  });

  it("goes below first, crossing day groups, then above, then to the h1, never to a ×", async () => {
    const log = renderLog([
      { dayLabel: null, doses: [A, B] },
      { dayLabel: "Yesterday", doses: [C] },
    ]);

    // B is the last of today: the next row down is yesterday's C.
    await deleteAndReload(log, "b");
    expect(document.activeElement).toBe(editButton("c"));

    // C is the last row on the page: nothing is below it, so the nearest row above.
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    await deleteAndReload(log, "c");
    expect(document.activeElement).toBe(editButton("a"));

    // A was the only row left.
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    await deleteAndReload(log, "a");
    expect(document.activeElement).toBe(log.heading);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/timeline-entry-delete.test.ts`
Expected: FAIL. Every case throws `Error: no × for a` (or `no × for b`): today's rows carry no `data-dose-id`, so `deleteButton` finds nothing. If the file fails to import instead, a Task 7–9 export named in the **Interfaces** above is missing; fix that before going on.

- [ ] **Step 3: Write the failing SSR markup tests**

In `tests/unit/timeline-entry-ssr.test.ts`:

Replace the header comment:

```ts
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom the component is compiled for the client, so `render()`
// from `svelte/server` runs client code and throws `effect_orphan` before an
// assertion runs. How the `svelte` specifier itself resolves there is
// explained in tests/unit/timeline-entry-delete-confirm.test.ts.
//
// Covers the dose row's static markup: what a skipped or missed row dims, when
// the hover-revealed controls are allowed to hide, and how big they are. The
// two-step delete is interactive and lives in
// tests/unit/timeline-entry-delete-confirm.test.ts.
```

with:

```ts
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom the component is compiled for the client, so `render()`
// from `svelte/server` runs client code and throws `effect_orphan` before an
// assertion runs. How the `svelte` specifier itself resolves there is
// explained in vite.config.ts.
//
// Covers the dose row's static markup: what a skipped or missed row dims, when
// the hover-revealed controls are allowed to hide, how big they are, and what
// × is before the page is live. The one-tap delete, its Undo and focus are
// interactive and live in tests/unit/timeline-entry-delete.test.ts.
```

Replace:

```ts
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: TimelineEntry } = await import("../../src/lib/components/TimelineEntry.svelte");
```

with:

```ts
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));
// The dose-write primitive's reload path imports these; nothing here reloads.
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { from: null, to: null, type: null, willUnload: null, delta: null, complete: null },
  updated: { current: false, check: async () => false },
}));

const { default: TimelineEntry } = await import("../../src/lib/components/TimelineEntry.svelte");
// × is a dose write, and every dose write reads the (app) layout's lock.
const { doseWriteContext } = await import("./helpers/dashboard-context");
```

In `renderRow`, replace:

```ts
const { body } = render(TimelineEntry, {
  props: {
    dose: makeDose(status),
    timezone: "UTC",
    timeFormat: "24h" as const,
    onedit: () => {},
  },
});
```

with:

```ts
const { body } = render(TimelineEntry, {
  props: {
    dose: makeDose(status),
    timezone: "UTC",
    timeFormat: "24h" as const,
    dayLabel: null,
    onedit: () => {},
  },
  context: doseWriteContext(),
});
```

× now sits inside its own form, so the controls wrapper is the form's parent. In the `controls` helper, replace:

```ts
expect(x, "no delete button rendered").not.toBeNull();
return x!.parentElement!;
```

with:

```ts
expect(x, "no delete button rendered").not.toBeNull();
return x!.closest("form")!.parentElement!;
```

In `it("positions the controls so their overhang sits above the line below", …)`, replace:

```ts
const atRest = tokens(x!.parentElement!).filter((t) => !t.includes(":"));
```

with:

```ts
const atRest = tokens(x!.closest("form")!.parentElement!).filter((t) => !t.includes(":"));
```

Append at the end of the file:

```ts
describe("× before the page is live", () => {
  // onMount never runs during SSR, so this is exactly what a tap meets before
  // hydration. A native POST then would delete with no Undo toast to take it
  // back, so × must not be a submit yet.
  it("is an inert type=button inside the delete form, and never `disabled`", () => {
    const doc = renderRow("taken");
    const x = doc.querySelector<HTMLButtonElement>('button[aria-label^="Delete dose of"]');
    expect(x, "no delete button rendered").not.toBeNull();
    expect(x!.getAttribute("type")).toBe("button");
    expect(x!.hasAttribute("disabled")).toBe(false);

    const form = x!.closest("form");
    expect(form, "× is not inside a form").not.toBeNull();
    expect(form!.getAttribute("action")).toBe("?/deleteDose");
    expect(form!.getAttribute("method")?.toUpperCase()).toBe("POST");
    const doseId = form!.querySelector<HTMLInputElement>('input[type="hidden"][name="doseId"]');
    expect(doseId?.value).toBe("dose-taken");
  });

  it("marks the row with its dose id and its ✎ as the focus target", () => {
    const doc = renderRow("taken");
    const row = doc.querySelector('[role="listitem"]');
    expect(row?.getAttribute("data-dose-id")).toBe("dose-taken");
    const edit = row?.querySelector("[data-edit]");
    expect(edit?.tagName).toBe("BUTTON");
    expect(edit?.getAttribute("aria-label")).toBe("Edit dose of Vitamin D at 8:00");
  });

  it("asks nothing: no confirmation group, no 'can't be undone', no disclosure state on ×", () => {
    const doc = renderRow("taken");
    expect(doc.querySelector('[role="group"]')).toBeNull();
    expect(doc.body.textContent).not.toMatch(/can't be undone/i);
    const x = doc.querySelector('button[aria-label^="Delete dose of"]');
    expect(x?.hasAttribute("aria-expanded")).toBe(false);
    expect(x?.hasAttribute("aria-controls")).toBe(false);
  });
});
```

- [ ] **Step 4: Run the SSR test to verify it fails**

Run: `npx vitest run tests/unit/timeline-entry-ssr.test.ts`
Expected: FAIL.

- `is an inert type=button inside the delete form…` fails at `expect(form, "× is not inside a form").not.toBeNull()` — today's × sits outside any form.
- `marks the row with its dose id…` fails: `data-dose-id` is `undefined`.
- `asks nothing…` fails on `aria-expanded`: today's × renders `aria-expanded="false"` as the confirmation's toggle.
- The two tests that go through the `controls` helper, and the positioning test, throw `TypeError: Cannot read properties of null (reading 'parentElement')`, for the same reason as the first.

- [ ] **Step 5: Rewrite `TimelineEntry.svelte`**

Replace the whole of `src/lib/components/TimelineEntry.svelte` with:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { enhance } from "$app/forms";
  import TimeSince from "$components/TimeSince.svelte";
  import { createDoseWrite } from "$components/dose-writes/dose-write.svelte";
  import { focusTargetAfterResolve } from "$components/dose-writes/focus-after";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { formatDoseLabel } from "$lib/utils/dashboard-copy";
  import type { DoseLogWithMedication } from "$lib/types";
  import { getMedicationBackground } from "$lib/utils/medication-style";

  let {
    dose,
    timezone,
    timeFormat = "12h",
    dayLabel,
    onedit,
  }: {
    dose: DoseLogWithMedication;
    timezone: string;
    timeFormat?: TimeFormat;
    /**
     * This row's day-group heading ("Yesterday", "Tue 23 Sep"), or null for
     * Today. Only the Undo offer reads it, to say which day's dose went.
     */
    dayLabel: string | null;
    onedit?: (dose: DoseLogWithMedication) => void;
  } = $props();

  // × deletes on the first tap and the toast offers Undo, as every dose
  // control on the dashboard does. It used to open an inline "This can't be
  // undone" confirmation instead, which existed only because nothing could
  // put a deleted dose back. The server's trash now can, for ten minutes.
  //
  // × is a submit only once this row has mounted. Before hydration, or with
  // scripts off, a native POST would delete with no Undo toast to take it
  // back, so until then × is an inert type="button", as it always was
  // before JavaScript arrived.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });

  let row: HTMLDivElement | undefined = $state();

  // The log page renders one of these per dose — twenty on a default page — and
  // both controls were named by a bare constant, so the button list read
  // "Edit dose, Delete dose" twenty times over with no way to tell which row.
  const takenTime = $derived(formatUserTime(new Date(dose.takenAt), timezone, timeFormat));

  /** "Dose removed: Paracetamol 500mg at 8:00", "… yesterday at 8:00", "… on Tue 23 Sep at 8:00". */
  function removedMessage(label: string, time: string, day: string | null): string {
    if (day === null) return `Dose removed: ${label} at ${time}`;
    if (day === "Yesterday") return `Dose removed: ${label} yesterday at ${time}`;
    return `Dose removed: ${label} on ${day} at ${time}`;
  }

  // Which rows were rendered below and above this one when × was pressed,
  // nearest first, across every day group. After the reload this row is gone
  // and the DOM can no longer say. Taken in the capture phase on the row, so
  // it lands before enhance's own submit listener on the form reads the
  // options below.
  let neighbours: { following: string[]; preceding: string[] } = {
    following: [],
    preceding: [],
  };

  function snapshotNeighbours() {
    const ids = [...document.querySelectorAll<HTMLElement>("[data-dose-id]")].map(
      (el) => el.dataset.doseId ?? "",
    );
    const at = ids.indexOf(dose.id);
    neighbours =
      at === -1
        ? { following: [], preceding: [] }
        : { following: ids.slice(at + 1), preceding: ids.slice(0, at).reverse() };
  }

  const editButtonIn = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-edit]");

  const write = createDoseWrite(() => {
    // Every value the result handlers use is read NOW, at submit. They run
    // after the reload, which has usually unmounted this row, and must not
    // read the props of a destroyed component.
    const id = dose.id;
    const message = removedMessage(
      formatDoseLabel(
        dose.medication.name,
        dose.medication.dosageAmount,
        dose.medication.dosageUnit,
      ),
      takenTime,
      dayLabel,
    );
    const { following, preceding } = neighbours;
    return {
      undo: {
        kind: "restore",
        // A restore brings back the same id, so this finds the restored row.
        focusTarget: () =>
          document.querySelector<HTMLElement>(`[data-dose-id="${id}"] [data-edit]`),
      },
      withdrawsUndoFor: id,
      buildToast: () => message,
      busyContainer: () => row ?? null,
      // The next row BELOW first (the list is newest-first, so that is the
      // next dose back in time), crossing into the next day's group; then the
      // nearest row above; then the page's h1. Always a ✎, never a ×: Enter
      // on a focused × is another delete.
      focusAfter: () =>
        focusTargetAfterResolve(id, following, {
          attr: "doseId",
          precedingKeys: preceding,
          pick: editButtonIn,
        }) ?? document.querySelector<HTMLElement>("h1"),
    };
  });
</script>

<!-- Clicking the row is a redundant mouse shortcut for the ✎ button inside it,
     which is a real <button> with its own accessible name and is reachable by
     keyboard. A key handler here would be dead code: role="listitem" is not
     focusable, so it can never receive one.
     data-dose-id, and data-edit on the ✎, are what focus lands on after a
     delete or its Undo, here and in the rows around it. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={row}
  data-dose-id={dose.id}
  class="group border-glass-border bg-glass hover:bg-glass-hover rounded-lg border p-4 backdrop-blur-xl transition-colors {onedit
    ? 'cursor-pointer'
    : ''}"
  role="listitem"
  onclick={() => onedit?.(dose)}
  onsubmitcapture={snapshotNeighbours}
>
  <!-- Below sm the time drops to its own line under the name. Inline at 320px,
       the time and the controls left the name (a flex-1 item with a zero
       basis) a few pixels at most, and that was before the controls grew to
       touch size. -->
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
    <!-- A skipped or missed row used to carry opacity-60 on the WHOLE row, which
         pulled the badges, dosage and time to roughly 3:1 (WCAG 1.4.3). The
         line-through and the Skipped/Missed badges already say what the row is;
         this dot is the one decorative part, so it is the only thing dimmed. -->
    <div
      class="h-3 w-3 shrink-0 rounded-full {dose.status !== 'taken' ? 'opacity-50' : ''}"
      style="background: {getMedicationBackground(
        dose.medication.colour,
        dose.medication.colourSecondary,
        dose.medication.pattern,
        true,
      )}"
    ></div>

    <div class="min-w-0 flex-1">
      <!-- break-words because a long one-word name has no space to wrap at,
           and at 320px it ran on underneath the controls. -->
      <p class="font-medium break-words">
        <span class={dose.status === "skipped" ? "line-through decoration-1" : ""}>
          {dose.medication.name}
        </span>
        <span class="text-text-secondary text-sm">
          {dose.medication.dosageAmount}{dose.medication.dosageUnit}
          {#if dose.status === "taken" && dose.quantity > 1}&times; {dose.quantity}{/if}
        </span>
        {#if dose.status === "skipped"}
          <span
            class="bg-warning/15 text-warning ml-2 rounded-full px-2 py-0.5 text-xs font-semibold tracking-wider uppercase"
          >
            Skipped
          </span>
        {:else if dose.status === "missed"}
          <span
            class="bg-danger/15 text-danger-ink ml-2 rounded-full px-2 py-0.5 text-xs font-semibold tracking-wider uppercase"
          >
            Missed
          </span>
        {/if}
      </p>
    </div>

    <div
      class="order-last flex basis-full items-center gap-4 pl-7 text-sm sm:order-none sm:basis-auto sm:pl-0"
    >
      <span class="text-text-secondary"
        >{formatUserTime(new Date(dose.takenAt), timezone, timeFormat)}</span
      >
      <span class="text-accent-ink font-medium">
        <TimeSince date={new Date(dose.takenAt)} />
      </span>
    </div>

    <!-- group-focus-within matters as much as group-hover: opacity-0 keeps these
         buttons focusable and in the accessibility tree, so a sighted keyboard
         user was tabbing onto controls they could not see (WCAG 2.4.7).
         The hide is gated on (hover: hover), the same query Tailwind v4 wraps
         group-hover in. Gated on width alone, a touch tablet at md width hid
         the controls, and the hover that reveals them never happens there.
         They also stay shown while a delete is in flight, so its spinner does
         not vanish when focus and pointer leave the row.
         Targets are 32px for a mouse and 44px for touch (WCAG 2.5.8, and 2.5.5
         on touch); the negative margin lets them reach into the row's padding
         instead of making every row taller. Below sm on touch they also reach
         down onto the time's line, which is in flow and painted after them, so
         a tap on the bottom of × landed on that line and opened the edit modal.
         Positioning them (relative) lifts them above it.
         The click handler is a boundary: a tap in the gap between ✎ and × is a
         near miss of a control, not a tap on the row. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onclick={(e) => e.stopPropagation()}
      class="relative -my-1 flex items-center gap-1 opacity-100 transition-opacity pointer-coarse:-my-2.5 {write.pending
        ? ''
        : 'md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:[@media(hover:hover)]:opacity-0'}"
    >
      {#if onedit}
        <button
          type="button"
          data-edit
          onclick={(e) => {
            e.stopPropagation();
            onedit?.(dose);
          }}
          class="text-text-muted hover:text-accent-ink inline-flex size-8 items-center justify-center text-xs pointer-coarse:size-11"
          aria-label="Edit dose of {dose.medication.name} at {takenTime}"
        >
          ✎
        </button>
      {/if}
      <!-- The form wraps × alone, so no other button in the row can ever
           submit a delete. display: contents keeps × a flex item of this row
           of controls, with their size and gap. -->
      <form method="POST" action="?/deleteDose" class="contents" use:enhance={write.submit}>
        <input type="hidden" name="doseId" value={dose.id} />
        <!-- aria-disabled, never `disabled`, which drops keyboard focus to
             <body>; a busy tap is cancelled in the submit instead. -->
        <button
          type={mounted ? "submit" : "button"}
          onkeydown={write.onkeydown}
          aria-disabled={write.busy ? "true" : undefined}
          class="text-text-muted hover:text-danger-ink inline-flex size-8 items-center justify-center text-xs aria-disabled:cursor-not-allowed pointer-coarse:size-11"
          aria-label="Delete dose of {dose.medication.name} at {takenTime}"
        >
          {#if write.pending}
            <span
              class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            ></span>
          {:else}
            &times;
          {/if}
        </button>
      </form>
    </div>
  </div>

  {#if dose.sideEffects && dose.sideEffects.length > 0}
    <div class="mt-2 flex flex-wrap gap-1.5 pl-7">
      {#each dose.sideEffects as effect}
        <span
          class="rounded-full px-2 py-0.5 text-xs font-medium {effect.severity === 'severe'
            ? 'bg-danger/15 text-danger-ink'
            : effect.severity === 'moderate'
              ? 'bg-warning/15 text-warning'
              : 'bg-text-secondary/30 text-text-primary'}"
        >
          {effect.name}
        </span>
      {/each}
    </div>
  {/if}
</div>
```

Then run `npx prettier --write src/lib/components/TimelineEntry.svelte` so the Tailwind plugin orders the classes.

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npx vitest run tests/unit/timeline-entry-delete.test.ts tests/unit/timeline-entry-ssr.test.ts`
Expected: PASS, both files. (`tests/unit/log-page-mount.svelte.test.ts` and `tests/unit/log-pagination-ssr.test.ts` now fail with `No dose-write lock in context`; Cycle B fixes them.)

- [ ] **Step 7: Prove by mutation** (restore each change and re-run green before the next)

Run for each: `npx vitest run tests/unit/timeline-entry-delete.test.ts tests/unit/timeline-entry-ssr.test.ts`

1. In `TimelineEntry.svelte`, change `type={mounted ? "submit" : "button"}` to `type="button"`. Expected: FAIL in `is a submit once mounted, and one tap sends ?/deleteDose…` (the restored confirmation's defining property: one tap sends nothing).
2. Change it to `type="submit"`. Expected: FAIL in ``is an inert type=button inside the delete form, and never `disabled` `` (SSR).
3. Delete `onsubmitcapture={snapshotNeighbours}` from the row. Expected: FAIL in `moves from the last dose of a day to the next day's first ✎…` (the snapshot is empty, so focus falls to the h1).
4. In `snapshotNeighbours`, change `document.querySelectorAll<HTMLElement>("[data-dose-id]")` to `(row?.parentElement ?? document).querySelectorAll<HTMLElement>("[data-dose-id]")` — the old same-day-only lookup. Expected: FAIL in `moves from the last dose of a day to the next day's first ✎…` and in `goes below first, crossing day groups…`.
5. Change `precedingKeys: preceding,` to `precedingKeys: [],`. Expected: FAIL in `goes below first, crossing day groups…` (deleting C lands on the h1, not A's ✎).
6. Delete `pick: editButtonIn,`. Expected: FAIL in both focus tests (the row `div` is not focusable, so focus stays on `<body>`).
7. Change the undo `focusTarget` to `() => null`. Expected: FAIL in `moves from the last dose of a day…` at its last focus assertion (focus goes to C's ✎, remembered from before focus entered the toast stack, or to the h1 — never to the restored A's ✎).
8. Delete `withdrawsUndoFor: id,`. Expected: FAIL in `withdraws an offer for this dose as soon as × sends`.
9. Replace the whole body of `removedMessage` with the single line ``return `Dose removed: ${label} at ${time}`;``. Expected: FAIL in the `Yesterday` and `Wed 15 Apr` cases of `offers a restore carrying the server's handle…`.
10. Add `disabled={write.busy}` to ×. Expected: FAIL in `shows it is busy with aria-disabled…` (`x.disabled` is true).
11. Delete `busyContainer: () => row ?? null,`. Expected: FAIL in `shows it is busy…` (`aria-busy` is null).
12. Delete `onkeydown={write.onkeydown}`. Expected: FAIL in `swallows a held Enter on ×…`.
13. Delete `onclick={(e) => e.stopPropagation()}` from the controls wrapper. Expected: FAIL in `does not open the edit dialog from ×…`.
14. Delete `data-edit` from ✎. Expected: FAIL in `marks the row with its dose id and its ✎…` (SSR) and in both focus tests.
15. In `src/lib/components/dose-writes/dose-write-lock.svelte.ts`, change `export const DOSE_WRITE_COOLDOWN_MS = 700;` to `= 0;`. Expected: FAIL in `refuses another row's × inside the cooldown after a delete…` (B is sent after the 1ms advance).
16. In `src/lib/components/dose-writes/dose-write.svelte.ts`, replace the `getDoseWriteLock()` call that `createDoseWrite` makes during init with `createDoseWriteLock()` (a lock per component; add the import while mutating). Expected: FAIL in `refuses another row's × while a delete is in flight, and says so`.

---

#### Cycle B — the page: `dayLabel`, the `h1`, and focus across the real day groups

- [ ] **Step 8: Update the two page tests that now throw for want of a lock**

In `tests/unit/log-pagination-ssr.test.ts`, replace:

```ts
const { default: LogPage } = await import("../../src/routes/(app)/log/+page.svelte");
```

with:

```ts
const { default: LogPage } = await import("../../src/routes/(app)/log/+page.svelte");
// Every dose row's × is a dose write, which reads the (app) layout's lock.
const { doseWriteContext } = await import("./helpers/dashboard-context");
```

and in `renderAt`, replace:

```ts
        timezone: "UTC",
      },
    },
  }).body;
```

with:

```ts
        timezone: "UTC",
      },
    },
    context: doseWriteContext(),
  }).body;
```

Run: `npx vitest run tests/unit/log-pagination-ssr.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing page tests**

In `tests/unit/log-page-mount.svelte.test.ts`:

Replace:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
```

with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
```

Replace:

```ts
const pageState = $state({ url: new URL("https://medtracker.test/log") });
vi.mock("$app/state", () => ({ page: pageState }));
```

with:

```ts
const pageState = $state({ url: new URL("https://medtracker.test/log") });
vi.mock("$app/state", () => ({
  page: pageState,
  // The real idle shapes: reloadAfterWrite reads `navigating` before it
  // reloads, and a 409 reads `updated`.
  navigating: { from: null, to: null, type: null, willUnload: null, delta: null, complete: null },
  updated: { current: false, check: async () => false },
}));
```

Replace:

```ts
const hooks = { before: [] as NavigationHook[], after: [] as NavigationHook[] };
vi.mock("$app/navigation", () => ({
  beforeNavigate: (fn: NavigationHook) => hooks.before.push(fn),
  afterNavigate: (fn: NavigationHook) => hooks.after.push(fn),
}));

// Each dose row's delete form imports `enhance` and the toast store; neither
// is what these assertions are about.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: LogPage } = await import("../../src/routes/(app)/log/+page.svelte");
```

with:

```ts
const hooks = { before: [] as NavigationHook[], after: [] as NavigationHook[] };

// Every dose write that reached `enhance` and was not cancelled, waiting for
// the test to answer it; and the reload the write runs after its answer.
type SentWrite = {
  fields: Record<string, FormDataEntryValue>;
  finish: (result: ActionResult) => Promise<void>;
};
const writes = { sent: [] as SentWrite[], invalidateAll: vi.fn(async () => {}) };

vi.mock("$app/navigation", () => ({
  beforeNavigate: (fn: NavigationHook) => hooks.before.push(fn),
  afterNavigate: (fn: NavigationHook) => hooks.after.push(fn),
  invalidateAll: () => writes.invalidateAll(),
}));

// SvelteKit's `enhance`, reduced to its two-phase contract: the submit
// function runs when a form submits, and the callback it returns runs when
// the test answers. A cancelled submit sends nothing. The GET filter form is
// not enhanced, so only dose writes arrive here.
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    const onSubmit = async (e: SubmitEvent) => {
      e.preventDefault();
      const formData = new FormData(form);
      const action = new URL(form.getAttribute("action") ?? "", "https://medtracker.test/log");
      let cancelled = false;
      const callback = await submit({
        action,
        formData,
        formElement: form,
        controller: new AbortController(),
        submitter: e.submitter,
        cancel: () => {
          cancelled = true;
        },
      });
      if (cancelled) return;
      writes.sent.push({
        fields: Object.fromEntries(formData),
        finish: async (result) => {
          if (typeof callback === "function") {
            await callback({ action, formData, formElement: form, result, update: async () => {} });
          }
        },
      });
    };
    form.addEventListener("submit", onSubmit);
    return { destroy: () => form.removeEventListener("submit", onSubmit) };
  },
  applyAction: async () => {},
  deserialize: (text: string) => JSON.parse(text),
}));
// The Undo registry is a no-op outside the browser, like Toast's own list.
vi.mock("$app/environment", () => ({
  browser: true,
  dev: false,
  building: false,
  version: "test",
}));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: LogPage } = await import("../../src/routes/(app)/log/+page.svelte");
// Imported here, not statically at the top: a static import runs before
// `pageState` exists, and the registry's import chain reaches `$app/state`,
// whose factory reads it.
const { currentUndo, resetUndoRegistry } =
  await import("$lib/components/dose-writes/undo-registry.svelte");
const { doseWriteContext } = await import("./helpers/dashboard-context");
```

Replace:

```ts
function loadData({
  page = 1,
  hasMore = false,
  filters = NO_FILTERS,
}: { page?: number; hasMore?: boolean; filters?: Filters } = {}) {
  return {
    user,
    preferences,
    doses: [DOSE],
```

with:

```ts
function loadData({
  page = 1,
  hasMore = false,
  filters = NO_FILTERS,
  doses = [DOSE],
}: { page?: number; hasMore?: boolean; filters?: Filters; doses?: (typeof DOSE)[] } = {}) {
  return {
    user,
    preferences,
    doses,
```

In `mountAt`, replace:

```ts
app = mount(LogPage, { target, props });
```

with:

```ts
// The (app) layout's lock: every dose row's × reads it.
app = mount(LogPage, { target, props, context: doseWriteContext() });
```

Replace:

```ts
beforeEach(() => {
  hooks.before.length = 0;
  hooks.after.length = 0;
```

with:

```ts
beforeEach(() => {
  hooks.before.length = 0;
  hooks.after.length = 0;
  writes.sent.length = 0;
  writes.invalidateAll.mockReset();
  writes.invalidateAll.mockImplementation(async () => {});
```

Replace:

```ts
  window.removeEventListener("click", swallowNavigation);
  vi.useRealTimers();
  vi.restoreAllMocks();
});
```

with:

```ts
  window.removeEventListener("click", swallowNavigation);
  resetUndoRegistry();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Let the page's awaits and the enhance mock's finish. */
async function settle() {
  flushSync();
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
}
```

Append at the end of the file:

```ts
describe("× on the real page: the day it names, and where focus goes (Review Focus #4)", () => {
  // The page groups by the viewer's today, read from the clock. Only Date is
  // faked, so the lock's cooldown and the registry's timers stay real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-10T12:00:00Z"));
  });

  // DOSE is Ibuprofen 200mg on 10 Apr at 08:00 UTC: today.
  const YESTERDAY = {
    ...DOSE,
    id: "d2",
    takenAt: new Date("2026-04-09T21:30:00Z"),
    loggedAt: new Date("2026-04-09T21:30:00Z"),
    updatedAt: new Date("2026-04-09T21:30:00Z"),
    medication: { ...DOSE.medication, name: "Paracetamol", dosageAmount: "500" },
  };
  const OLDER = {
    ...DOSE,
    id: "d3",
    takenAt: new Date("2026-04-07T08:00:00Z"),
    loggedAt: new Date("2026-04-07T08:00:00Z"),
    updatedAt: new Date("2026-04-07T08:00:00Z"),
  };

  const editOf = (id: string) =>
    target.querySelector<HTMLElement>(`[data-dose-id="${id}"] [data-edit]`);

  /** Press ×, answer the delete, and reload to `remaining` as the server would. */
  async function deleteOnPage(id: string, remaining: (typeof DOSE)[]) {
    const x = target.querySelector<HTMLButtonElement>(
      `[data-dose-id="${id}"] button[aria-label^="Delete dose of"]`,
    );
    expect(x, `no × for ${id}`).not.toBeNull();
    expect(x!.type).toBe("submit");
    writes.invalidateAll.mockImplementationOnce(async () => {
      props.data = loadData({ doses: remaining });
      flushSync();
    });
    x!.focus();
    x!.click();
    await settle();
    expect(writes.sent).toHaveLength(1);
    expect(writes.sent[0].fields).toEqual({ doseId: id });
    await writes.sent[0].finish({
      type: "success",
      status: 200,
      data: {
        success: true,
        doseId: id,
        restore: { deletedAt: "2026-04-10T12:00:00.000Z", expiresInMs: 600_000 },
      },
    });
    await settle();
  }

  it("hands focus from the last dose of today to yesterday's first ✎, and names no day", async () => {
    mountAt("/log", loadData({ doses: [DOSE, YESTERDAY, OLDER] }));

    await deleteOnPage("d1", [YESTERDAY, OLDER]);

    expect(document.activeElement).toBe(editOf("d2"));
    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d1",
      message: "Dose removed: Ibuprofen 200mg at 8:00",
    });
  });

  it.each<[string, string]>([
    ["d2", "Dose removed: Paracetamol 500mg yesterday at 21:30"],
    ["d3", "Dose removed: Ibuprofen 200mg on Tue 7 Apr at 8:00"],
  ])("names the day of %s in its Undo offer", async (id, message) => {
    const all = [DOSE, YESTERDAY, OLDER];
    mountAt("/log", loadData({ doses: all }));

    await deleteOnPage(
      id,
      all.filter((d) => d.id !== id),
    );

    expect(currentUndo()?.message).toBe(message);
  });

  it("falls back to the page's h1 when the last dose on the page goes", async () => {
    mountAt("/log", loadData({ doses: [DOSE] }));

    await deleteOnPage("d1", []);

    const h1 = target.querySelector("h1");
    expect(h1?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(h1);
  });
});
```

- [ ] **Step 10: Run the page tests to verify they fail**

Run: `npx vitest run tests/unit/log-page-mount.svelte.test.ts`
Expected: FAIL in the four new cases, and PASS in every existing case (they now mount with the lock).

- `hands focus from the last dose of today…` fails on `message`: `"Dose removed: Ibuprofen 200mg on undefined at 8:00"` — the page does not pass `dayLabel` yet.
- The two `names the day of …` cases fail the same way (`on undefined at`).
- `falls back to the page's h1…` fails on `expect(h1?.getAttribute("tabindex")).toBe("-1")` (received `null`).

- [ ] **Step 11: Pass `dayLabel` and make the `h1` a focus target**

In `src/routes/(app)/log/+page.svelte`, replace:

```svelte
<h1 class="text-2xl font-bold">Dose History</h1>
```

with:

```svelte
<!-- tabindex="-1": the last resort for focus after a delete empties the
       list, and after an Undo whose row did not come back. -->
<h1 class="text-2xl font-bold" tabindex="-1">Dose History</h1>
```

Replace:

```ts
const groups: Array<{ dateKey: string; label: string; doses: typeof data.doses }> = [];
```

with:

```ts
const groups: Array<{
  dateKey: string;
  label: string;
  isToday: boolean;
  doses: typeof data.doses;
}> = [];
```

Replace:

```ts
      groups.push({
        dateKey,
        label: formatDateLabel(
```

with:

```ts
      groups.push({
        dateKey,
        // Today's rows pass no day to their Undo offer; every other group
        // passes its heading ("Yesterday", "Tue 7 Apr").
        isToday: dateKey === todayKey,
        label: formatDateLabel(
```

Replace:

```svelte
              timeFormat={data.preferences.timeFormat as "12h" | "24h"}
```

with:

```svelte
              timeFormat={data.preferences.timeFormat as "12h" | "24h"}
              dayLabel={group.isToday ? null : group.label}
```

- [ ] **Step 12: Run the page tests to verify they pass**

Run: `npx vitest run tests/unit/log-page-mount.svelte.test.ts tests/unit/log-pagination-ssr.test.ts`
Expected: PASS, both files.

- [ ] **Step 13: Prove by mutation** (restore each change and re-run green before the next)

Run for each: `npx vitest run tests/unit/log-page-mount.svelte.test.ts`

1. Change `dayLabel={group.isToday ? null : group.label}` to `dayLabel={group.label}`. Expected: FAIL in `hands focus from the last dose of today…` (`"Dose removed: Ibuprofen 200mg on Today at 8:00"`).
2. Change it to `dayLabel={null}`. Expected: FAIL in both `names the day of …` cases.
3. Remove `tabindex="-1"` from the `h1`. Expected: FAIL in `falls back to the page's h1…`.
4. Change `isToday: dateKey === todayKey,` to `isToday: false,`. Expected: FAIL in `hands focus from the last dose of today…`.

---

- [ ] **Step 14: Delete the confirmation's test file**

```bash
git rm tests/unit/timeline-entry-delete-confirm.test.ts
```

Its cases that still describe real behaviour now live in `tests/unit/timeline-entry-delete.test.ts`: the × name e2e depends on (`is a submit once mounted…`), the click boundary (`does not open the edit dialog…`), the busy state (`shows it is busy…`), `actionErrorMessage` on a failure (`shows it is busy…` asserts "Dose not found"), and focus after a delete (the two focus tests). The rest described the confirmation group, which no longer exists.

Then check nothing else still names it:

Run: `grep -rn "timeline-entry-delete-confirm" src tests CLAUDE.md docs/*.md`
Expected: no output.

- [ ] **Step 15: Run the task's full suite**

Run: `npx vitest run tests/unit/timeline-entry-delete.test.ts tests/unit/timeline-entry-ssr.test.ts tests/unit/log-page-mount.svelte.test.ts tests/unit/log-pagination-ssr.test.ts`
Expected: PASS, every file.

Run: `npx vitest run`
Expected: PASS: 0 failed test files and 0 failed tests. The file count is unchanged from before this task (one test file deleted, one created); the test count changes by the new cases minus the deleted file's.

Run: `npm run check 2>&1 | tail -3`
Expected: the same `svelte-check found N errors and M warnings` as before this task. In particular there is no missing-prop error for `dayLabel` in `src/routes/(app)/log/+page.svelte` or in any test, and no `a11y_*` warning for `TimelineEntry.svelte` (the row's `onsubmitcapture` is covered by its existing `svelte-ignore` comments, and the controls wrapper keeps its own).

Run: `npx prettier --write src/lib/components/TimelineEntry.svelte "src/routes/(app)/log/+page.svelte" tests/unit/timeline-entry-delete.test.ts tests/unit/timeline-entry-ssr.test.ts tests/unit/log-page-mount.svelte.test.ts tests/unit/log-pagination-ssr.test.ts`

Run: `npx eslint src/lib/components/TimelineEntry.svelte "src/routes/(app)/log/+page.svelte" tests/unit/timeline-entry-delete.test.ts tests/unit/timeline-entry-ssr.test.ts tests/unit/log-page-mount.svelte.test.ts tests/unit/log-pagination-ssr.test.ts`
Expected: 0 errors, and no warning in these files that was not there before.

If prettier reflowed anything, re-run the four test files above.

- [ ] **Step 16: Commit**

```bash
git add src/lib/components/TimelineEntry.svelte \
  "src/routes/(app)/log/+page.svelte" \
  tests/unit/timeline-entry-delete.test.ts \
  tests/unit/timeline-entry-ssr.test.ts \
  tests/unit/log-page-mount.svelte.test.ts \
  tests/unit/log-pagination-ssr.test.ts
git commit -m "feat(log): delete a dose in one tap and offer Undo instead of a confirmation

The /log x now deletes at once through the shared dose-write primitive,
and the toast offers a restore Undo. The inline 'This can't be undone'
confirmation existed only because nothing could put a dose back; the
server's trash now can, for ten minutes.

- x is a submit only once the row has mounted, so a tap before
  hydration still does nothing rather than deleting with no Undo.
- It uses the (app) layout's one write lock: a second row's x is
  refused while a delete is in flight or cooling down.
- The offer names the dose and, for an older row, its day: 'Dose
  removed: Paracetamol 500mg yesterday at 21:30'.
- Focus after a delete goes to the next row's edit button below,
  crossing day groups, else the nearest above, else the page h1 (now
  tabindex=-1), never a delete button. Undo returns it to the restored
  row's edit button."
```

`git rm` in Step 14 already staged the deleted file. The commit message carries no Claude/AI attribution, no `Co-Authored-By` and no session link.

---

### Task 13: /medications — the card's Log through the shared dose-write path

**Files:**

- Modify: `src/lib/components/MedicationCard.svelte` (the whole `<script lang="ts">…</script>` block, anchored on its first line `  import type { MedicationWithStats } from "$lib/types";` and `</script>`; the Log button block, anchored on `    aria-label="Log a dose of {medication.name}"` / `    onclick={quickLog}`). Tasks 7–12 do not touch this file, so it is still the `HEAD` version.
- Modify: `src/routes/(app)/medications/+page.svelte` (anchors: `  import { actionErrorMessage } from "$lib/utils/form-errors";`, `  let announcement = $state("");`, `            <MedicationCard {medication} />`, `    <h1 class="text-2xl font-bold">Medications</h1>`, and in the second cycle the whole `<script lang="ts">…</script>` block). Tasks 7–12 do not touch this file.
- Create: `tests/unit/medications-reorder-lock.test.ts`
- Test: `tests/unit/medication-card-targets-dom.test.ts` (whole-file replacement), `tests/unit/medication-card-targets-ssr.test.ts`

**Interfaces:**

- Consumes:
  - `$components/dose-writes/dose-write.svelte` (Task 9): `export function createDoseWrite(getOptions: () => DoseWriteOptions): DoseWrite`, with `interface DoseWrite { submit: SubmitFunction; readonly pending: boolean; readonly busy: boolean; onkeydown: (e: KeyboardEvent) => void }` and `interface DoseWriteOptions { staleGuard?: DashboardClock; undo?: { kind: UndoKind; focusTarget: () => HTMLElement | null }; withdrawsUndoFor?: string; buildToast?: (doseId: string | null, respondedAt: Date) => string | null; focusAfter?: () => HTMLElement | null; busyContainer?: () => HTMLElement | null; onSuccess?: () => void }`. Call it during component init; it reads `getDoseWriteLock()`. Options are read at submit time; `buildToast` runs after the reload, and its `respondedAt` is the time the response arrived, taken as the success branch's first line, before the reload (the primitive calls `options.buildToast?.(doseId, new Date(respondedAt))`). With no `focusAfter`, success focuses whatever held focus at the tap.
  - `$components/dose-writes/dose-write-lock.svelte` (Task 7): `getDoseWriteLock(): DoseWriteLock` (`acquire()`, `release()`, `busy`, `active`), `createDoseWriteLock()`, `DOSE_WRITE_COOLDOWN_MS`.
  - `$components/dose-writes/undo-registry.svelte` (Task 8): `currentUndo(): UndoOffer | null`, `resetUndoRegistry(): void` (tests).
  - `tests/unit/helpers/dashboard-context.ts` (Task 7): `doseWriteContext(lock: DoseWriteLock = createDoseWriteLock()): Map<symbol, unknown>`.
  - Existing: `formatDoseLabel(name, dosageAmount, dosageUnit)` (`$lib/utils/dashboard-copy`), `formatUserTime(date, timezone, timeFormat)` and `type TimeFormat` (`$lib/utils/time`), `startSubmit` / `finishSubmit` (`tests/unit/helpers/dose-action-form-harness.ts`), `BASE_MEDICATION_ROW` (`tests/unit/fixtures/medication-row.ts`).
  - The `(app)` layout's data: `data.user.timezone: string`, `data.preferences.timeFormat: string` (a `text` column, cast to `TimeFormat` as the dashboard does).
- Produces:
  - `MedicationCard` props: `{ medication: MedicationWithStats; timezone: string; timeFormat: TimeFormat }`.
  - The medications page's `h1` is `tabindex="-1"` (Task 8's Undo focuses `document.querySelector("h1")` as a last resort).
  - The medications reorder holds the layout's write lock for its whole round trip.

- [ ] **Step 1: Write the failing tests for the card**

Replace the whole of `tests/unit/medication-card-targets-dom.test.ts` with:

```ts
// Mounted in jsdom (the suite default) rather than rendered to a string,
// because these properties belong to a live DOM: where the card's Log posts
// once hydrated, which element holds focus while a log is in flight, the
// Undo it leaves behind, and the real parent chain between a row of the
// Medications list and the name inside its card. The class-level checks on
// the same controls are in medication-card-targets-ssr.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { MedicationWithStats } from "$lib/types";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  showToast: vi.fn(),
  invalidateAll: vi.fn(async () => {}),
}));

// SvelteKit's client runtime is not running here. `enhance` hands each
// form's submit function to the test, which drives it by hand; the rest is
// what the shared dose-write path reads.
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll(), goto: vi.fn() }));
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy: () => void h.submits.delete(form) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
// The Undo registry is a no-op unless `browser`, like Toast's list.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));

import MedicationCard from "../../src/lib/components/MedicationCard.svelte";
import MedicationsPage from "../../src/routes/(app)/medications/+page.svelte";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { currentUndo, resetUndoRegistry } from "$lib/components/dose-writes/undo-registry.svelte";
import { formatUserTime } from "$lib/utils/time";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

type ListedMedication = MedicationWithStats & {
  sparkline: number[];
  refillSeverity: "critical" | "warning" | "watch" | "ok";
};

function medication(overrides: Partial<ListedMedication> = {}): ListedMedication {
  return {
    ...BASE_MEDICATION_ROW,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    daysUntilRefill: 3,
    expectedDailyDoses: 3,
    sparkline: [1, 2, 3, 2, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3],
    refillSeverity: "critical",
    ...overrides,
  };
}

// The (app) layout adds these to every page's data; the medications page
// reads the zone and clock format from them for its cards.
const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};
const preferences = {
  userId: "u1",
  accentColor: "#6366f1",
  theme: "system",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: true,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "csv",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

const LOGGED: ActionResult = {
  type: "success",
  status: 200,
  data: { success: true, doseId: "d-new" },
};
// 01:31 UTC is 13:31 in Auckland (NZST, UTC+12, in May): a zone far enough
// from UTC that formatting in the wrong one cannot pass by accident.
const ARRIVAL = new Date("2026-05-01T01:31:00.000Z");
const ZONE = "Pacific/Auckland";

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let lock: DoseWriteLock;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ARRIVAL);
  h.submits.clear();
  h.showToast.mockReset();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  lock = createDoseWriteLock();
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  resetUndoRegistry();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountCard() {
  app = mount(MedicationCard, {
    target,
    props: { medication: medication(), timezone: ZONE, timeFormat: "24h" },
    context: doseWriteContext(lock),
  });
  flushSync();
  const button = target.querySelector<HTMLButtonElement>(
    'button[aria-label="Log a dose of Paracetamol"]',
  )!;
  const form = button.closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("the card's Log is not a use:enhance form");
  return { button, form, submit };
}

describe("the medication card's Log", () => {
  it("posts one dose to the dashboard's logDose through use:enhance, as a submit once hydrated", () => {
    const { button, form } = mountCard();
    expect(form.getAttribute("method")).toBe("POST");
    expect(form.getAttribute("action")).toBe("/dashboard?/logDose");
    expect(Object.fromEntries(new FormData(form))).toEqual({ medicationId: "m1", quantity: "1" });
    expect(button.type).toBe("submit");
  });

  it("keeps keyboard focus while a dose is in flight, refuses a second log, and keeps it after", async () => {
    // A native `disabled` for the duration of the request dropped a keyboard
    // user to <body>; aria-disabled says the same and leaves focus alone.
    const { button, form, submit } = mountCard();
    expect(button.getAttribute("aria-disabled")).toBe("false");

    button.focus();
    const first = await startSubmit(submit, form);
    flushSync();
    expect(first.cancel).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(button.querySelector("span")?.classList.contains("invisible")).toBe(true);

    // The shared lock, not a flag of the card's own, refuses the second tap.
    const second = await startSubmit(submit, form);
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(second.callback).toBeNull();

    await finishSubmit(first.callback!, form, LOGGED).done;
    flushSync();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);

    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    flushSync();
    expect(button.getAttribute("aria-disabled")).toBe("false");
  });

  it("offers an Undo that deletes the new dose, stating the log time in the user's zone", async () => {
    // The reload finishes a minute after the response arrived (a slow
    // invalidateAll, or one that waited out a navigation): 13:32 in Auckland.
    // The toast states when the log landed, 13:31, not when the page finished
    // reloading.
    const reloadedAt = ARRIVAL.getTime() + 60_000;
    h.invalidateAll.mockImplementationOnce(async () => {
      vi.setSystemTime(reloadedAt);
    });
    const { button, form, submit } = mountCard();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, LOGGED).done;
    flushSync();
    expect(Date.now(), "the stubbed reload moved the clock").toBe(reloadedAt);

    const message = `Paracetamol 500mg logged at ${formatUserTime(ARRIVAL, ZONE, "24h")}`;
    expect(message).toBe("Paracetamol 500mg logged at 13:31");
    expect(currentUndo()).toMatchObject({ kind: "delete", doseId: "d-new", message });
    // After the Undo, focus comes back to this Log.
    expect(currentUndo()!.focusTarget()).toBe(button);
    // The offer is the confirmation; the same sentence is not toasted twice.
    expect(h.showToast).not.toHaveBeenCalledWith(message, "success");
  });

  it("toasts the server's reason for a refused log and leaves no Undo", async () => {
    const { form, submit } = mountCard();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, {
      type: "failure",
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    }).done;

    expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
    expect(currentUndo()).toBeNull();
  });
});

describe("the medications list's card column", () => {
  it("lets a long name break inside the card instead of widening it", () => {
    // A flex item's automatic minimum width is its min-content width, and
    // `overflow-wrap: break-word` does not lower that. The page's wrapper
    // round the card had no min-w-0, so at 320px a name such as this one
    // widened the whole card past the screen and pushed the Log button off
    // its edge. Every flex item between the row and the name has to be
    // allowed to shrink, so the card is sized by the row, not its content.
    const LONG = "Hydrochlorothiazide";
    const data = {
      user,
      preferences,
      medications: [medication({ id: "m1", name: LONG })],
      archived: [],
    } as unknown as ComponentProps<typeof MedicationsPage>["data"];
    app = mount(MedicationsPage, { target, props: { data }, context: doseWriteContext(lock) });

    const name = [...target.querySelectorAll("p")].find((p) => p.textContent === LONG)!;
    const row = name.closest(".space-y-3 > div")!;
    expect(row).not.toBeNull();

    const unshrinkable: string[] = [];
    for (let el: Element | null = name; el && el !== row; el = el.parentElement) {
      const parent = el.parentElement!;
      const inFlexLayout =
        parent.classList.contains("flex") || parent.classList.contains("inline-flex");
      if (inFlexLayout && !el.classList.contains("min-w-0")) {
        unshrinkable.push(`<${el.tagName.toLowerCase()} class="${el.className}">`);
      }
    }
    expect(unshrinkable).toEqual([]);

    // The backstop: `overflow-wrap: anywhere` lowers min-content itself, so
    // the name still breaks if a later change drops one of those min-w-0s.
    expect(name.closest(".wrap-anywhere")).not.toBeNull();
  });
});
```

`BASE_MEDICATION_ROW` is Paracetamol, 500 mg, id `m1`, so the label is "Paracetamol 500mg". `13:31` is what `formatUserTime` renders for 01:31Z in Auckland on a 24h clock (two-digit hour, so no padding question); the stubbed reload moves the fake clock to 01:32Z, which renders `13:32`, so a toast formatted from the clock after the reload fails the message assertion. `h.invalidateAll.mockReset()` in `beforeEach` drops the one-off implementation, so no other test's reload moves the clock.

Edit `tests/unit/medication-card-targets-ssr.test.ts`.

Replace

```ts
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { JSDOM } from "jsdom";
```

with

```ts
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { JSDOM } from "jsdom";
```

Replace

```ts
describe("the medication card's quick-log button", () => {
  const html = render(MedicationCard, { props: { medication: medication() } }).body;
  const LABEL = 'aria-label="Log a dose of Paracetamol"';
```

with

```ts
describe("the medication card's quick-log button", () => {
  // The lock is the (app) layout's; every dose control reads it from context.
  const html = render(MedicationCard, {
    props: { medication: medication(), timezone: "UTC", timeFormat: "24h" },
    context: doseWriteContext(),
  }).body;
  const LABEL = 'aria-label="Log a dose of Paracetamol"';

  it("is a form posting one dose to the dashboard's logDose, the flex item above the card link", () => {
    // It used to `fetch` the action and ignore the doseId it returned, so it
    // had no Undo. A real form goes through use:enhance and the shared
    // dose-write path; the form is now what sits beside the link.
    const form = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(form).toContain('method="POST"');
    expect(form).toContain('action="/dashboard?/logDose"');
    expect(baseClasses(form)).toEqual(
      expect.arrayContaining(["relative", "z-10", "mt-4", "mr-4", "shrink-0", "self-start"]),
    );
    const doc = new JSDOM(html).window.document;
    const hidden = [...doc.querySelectorAll<HTMLInputElement>('form input[type="hidden"]')];
    expect(Object.fromEntries(hidden.map((i) => [i.name, i.value]))).toEqual({
      medicationId: "m1",
      quantity: "1",
    });
  });

  it("stays type=button until hydrated, so a tap before then cannot post without its Undo", () => {
    // Before hydration use:enhance is not attached: a native submit would log
    // a dose, navigate to /dashboard, and leave nothing to undo.
    expect(buttonTag(html, LABEL)).toContain('type="button"');
  });
```

Replace (in the reorder-buttons describe)

```ts
const html = render(MedicationsPage, {
  props: { data: { user, preferences, medications, archived: [] } },
}).body;
```

with

```ts
const html = render(MedicationsPage, {
  props: { data: { user, preferences, medications, archived: [] } },
  context: doseWriteContext(),
}).body;
```

The existing card tests ("names the action…", "is visible at rest…", "leaves the whole card opening the medication…" with its `relative`/`z-10` on the button, "says Log in text…", "sits in the flow…", "is a 44px touch target…", "draws its resting boundary…") stay as they are: they now run against the new markup, which is the "name and `relative z-10` kept" half of spec Section 5.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/medication-card-targets-dom.test.ts tests/unit/medication-card-targets-ssr.test.ts`
Expected: FAIL.

- DOM: every "the medication card's Log" test fails with `Error: the card's Log is not a use:enhance form` (the button is not in a form). The card-column test passes.
- SSR: "is a form posting one dose to the dashboard's logDose…" fails (`expected '' to contain 'method="POST"'`). "stays type=button until hydrated…" passes already (the old button is `type="button"` too; the DOM test's `button.type === "submit"` is what pins the hydrated half). Every other SSR test passes.

- [ ] **Step 3: Rebuild the card's Log as a form through `createDoseWrite`**

In `src/lib/components/MedicationCard.svelte`, replace the whole `<script lang="ts">` block (from `<script lang="ts">` through the first `</script>`) with:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { enhance } from "$app/forms";
  import type { MedicationWithStats } from "$lib/types";
  import { getMedicationBackground } from "$lib/utils/medication-style";
  import { expectedWeeklyDoses, adherencePercent } from "$lib/utils/adherence";
  import { formatDoseLabel } from "$lib/utils/dashboard-copy";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { createDoseWrite } from "$components/dose-writes/dose-write.svelte";
  import TimeSince from "$components/TimeSince.svelte";
  import Sparkline from "$components/Sparkline.svelte";

  let {
    medication,
    timezone,
    timeFormat,
  }: {
    medication: MedicationWithStats;
    /** The user's profile zone and clock: the toast says when the dose was logged. */
    timezone: string;
    timeFormat: TimeFormat;
  } = $props();

  function refillChipClass(severity: MedicationWithStats["refillSeverity"]): string {
    if (severity === "critical") return "bg-danger/15 text-danger-ink";
    if (severity === "warning") return "bg-warning/15 text-warning";
    if (severity === "watch") return "bg-info/15 text-info";
    return "";
  }

  const isScheduled = $derived(medication.scheduleType === "scheduled");
  const weeklyExpected = $derived(
    expectedWeeklyDoses(medication.expectedDailyDoses, medication.scheduleIntervalHours),
  );
  const adherence = $derived(
    isScheduled ? adherencePercent(medication.weeklyDoseCount, weeklyExpected) : 0,
  );

  // The status chips, decided here rather than inline so the header can tell
  // whether it has any. On a narrow card the chip group wraps onto a row of
  // its own under the name, and an empty group would still take that row and
  // open a gap there, so it is only rendered when it holds something.
  //
  // Explicit === false, not !medication.notificationsEnabled: a row that
  // reaches this component without the field (an older cached payload, or a
  // narrowed projection added later) would be undefined, and the falsy form
  // would render "Muted" on every medication. This fails safe instead.
  const muted = $derived(medication.notificationsEnabled === false);
  const refillChip = $derived(
    Boolean(medication.refillSeverity && medication.refillSeverity !== "ok"),
  );
  const lowStockChip = $derived(
    !refillChip &&
      medication.inventoryCount !== null &&
      medication.inventoryAlertThreshold !== null &&
      medication.inventoryCount <= medication.inventoryAlertThreshold,
  );

  let logButton = $state<HTMLButtonElement>();

  // `type="button"` until hydrated. Before then use:enhance is not attached,
  // and a native post would log a dose with no Undo and navigate the user to
  // the dashboard. A tap before hydration does nothing, as it always has.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });

  /**
   * Quick-log from the Medications list, through the same write path as every
   * dashboard dose control: the layout's write lock (a second tap, or a tap
   * during a reorder, is refused), the offline gate, a reload that waits out
   * a lost connection before anything can be retried, and an Undo that
   * deletes the dose it logged.
   *
   * It used to `fetch` the dashboard's action and ignore the `doseId` it
   * returned, so there was nothing to undo, and a network failure said only
   * "try again", which is exactly how a dose gets logged twice.
   *
   * No `focusAfter`: focus goes back to whatever held it at the tap, which
   * for a keyboard user is this button.
   */
  const write = createDoseWrite(() => {
    const label = formatDoseLabel(medication.name, medication.dosageAmount, medication.dosageUnit);
    const tz = timezone;
    const tf = timeFormat;
    return {
      undo: { kind: "delete", focusTarget: () => logButton ?? null },
      // Called after the reload, with the time the response arrived: the time
      // it states is when the log landed, in the user's own zone, never when
      // a slow reload happened to finish.
      buildToast: (_doseId, respondedAt) =>
        `${label} logged at ${formatUserTime(respondedAt, tz, tf)}`,
    };
  });
</script>
```

Replace the Log button block (the long comment above it, starting `  <!-- Quick log button. Visible text rather than a bare "+"`, stays as it is):

```svelte
<button
  type="button"
  class="border-border-strong text-accent-ink hover:bg-accent hover:text-accent-fg relative z-10 mt-4 mr-4 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center self-start rounded-lg border px-3 text-sm font-medium transition-colors"
  aria-label="Log a dose of {medication.name}"
  aria-disabled={logging}
  onclick={quickLog}
>
  <!-- The label only hides while the log is in flight, so the button keeps
         its width and the name column beside it does not reflow. -->
  <span class={logging ? "invisible" : ""}>Log</span>
  {#if logging}
    <span
      class="absolute inset-0 m-auto h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    ></span>
  {/if}
</button>
```

with

```svelte
<form
  method="POST"
  action="/dashboard?/logDose"
  use:enhance={write.submit}
  class="relative z-10 mt-4 mr-4 shrink-0 self-start"
>
  <input type="hidden" name="medicationId" value={medication.id} />
  <input type="hidden" name="quantity" value="1" />
  <!-- aria-disabled, never `disabled`: a disabled button cannot keep focus,
         so pressing it from the keyboard dropped focus to <body>. "false"
         rather than no attribute at rest, which the targets tests read. -->
  <button
    bind:this={logButton}
    type={mounted ? "submit" : "button"}
    class="border-border-strong text-accent-ink hover:bg-accent hover:text-accent-fg relative z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors aria-disabled:cursor-not-allowed"
    aria-label="Log a dose of {medication.name}"
    aria-disabled={write.busy ? "true" : "false"}
    onkeydown={write.onkeydown}
  >
    <!-- The label only hides while the log is in flight, so the button keeps
           its width and the name column beside it does not reflow. -->
    <span class={write.pending ? "invisible" : ""}>Log</span>
    {#if write.pending}
      <span
        class="absolute inset-0 m-auto h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      ></span>
    {/if}
  </button>
</form>
```

The form is now the card's flex item (`mt-4 mr-4 shrink-0 self-start` moved onto it); the button keeps `relative z-10` above the link's stretched `::after`, its name and its 44px size. The imports of `deserialize`, `invalidateAll`, `ActionResult`, `showToast` and `actionErrorMessage` are gone with `quickLog`: failures, toasts and the reload are the primitive's.

In `src/routes/(app)/medications/+page.svelte`, pass the zone and clock format to the card. Replace

```ts
import { actionErrorMessage } from "$lib/utils/form-errors";
```

with

```ts
import { actionErrorMessage } from "$lib/utils/form-errors";
import type { TimeFormat } from "$lib/utils/time";
```

Replace

```ts
let announcement = $state("");
```

with

```ts
const timeFormat = $derived(data.preferences.timeFormat as TimeFormat);

let announcement = $state("");
```

Replace

```svelte
<MedicationCard {medication} />
```

with

```svelte
<MedicationCard {medication} timezone={data.user.timezone} {timeFormat} />
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/unit/medication-card-targets-dom.test.ts tests/unit/medication-card-targets-ssr.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Prove the card tests by mutation**

1. The old fetch path. Keep the new card aside, put `HEAD`'s back, run, then restore:

   ```bash
   cp src/lib/components/MedicationCard.svelte "${TMPDIR:-/tmp}/MedicationCard.new.svelte"
   git show HEAD:src/lib/components/MedicationCard.svelte > src/lib/components/MedicationCard.svelte
   npx vitest run tests/unit/medication-card-targets-dom.test.ts tests/unit/medication-card-targets-ssr.test.ts
   cp "${TMPDIR:-/tmp}/MedicationCard.new.svelte" src/lib/components/MedicationCard.svelte
   ```

   Expected while `HEAD`'s card is in place: FAIL in "posts one dose to the dashboard's logDose through use:enhance, as a submit once hydrated", "keeps keyboard focus while a dose is in flight…", "offers an Undo that deletes the new dose…", "toasts the server's reason for a refused log…" and "is a form posting one dose to the dashboard's logDose, the flex item above the card link". After the second `cp`, re-run: PASS.

2. In `MedicationCard.svelte`, change `formatUserTime(respondedAt, tz, tf)` to `formatUserTime(respondedAt, "UTC", tf)` → FAIL: "offers an Undo that deletes the new dose, stating the log time in the user's zone" (the message reads "…logged at 1:31"). Restore, re-run green.
3. Change `formatUserTime(respondedAt, tz, tf)` to `formatUserTime(new Date(), tz, tf)` → FAIL: "offers an Undo that deletes the new dose, stating the log time in the user's zone" (the message reads "…logged at 13:32", the clock after the stubbed reload, not the arrival). Restore, re-run green.
4. Delete the line `      undo: { kind: "delete", focusTarget: () => logButton ?? null },` → FAIL: "offers an Undo that deletes the new dose…" (`expected null to match object`). Restore, re-run green.
5. Change `focusTarget: () => logButton ?? null` to `focusTarget: () => null` → FAIL: "offers an Undo…" (`expected null to be <button …>`). Restore, re-run green.
6. Change `type={mounted ? "submit" : "button"}` to `type="submit"` → FAIL: "stays type=button until hydrated, so a tap before then cannot post without its Undo". Restore, re-run green.
7. Change `type={mounted ? "submit" : "button"}` to `type="button"` → FAIL: "posts one dose to the dashboard's logDose through use:enhance, as a submit once hydrated". Restore, re-run green.
8. Delete `relative z-10 ` from the button's class → FAIL: "leaves the whole card opening the medication, not only the link's own box". Restore, re-run green.

- [ ] **Step 6: Write the failing tests for the page (reorder lock, heading)**

In `tests/unit/medication-card-targets-ssr.test.ts`, replace

```ts
it("still has the live region the move is announced through", () => {
  expect(html).toMatch(/<p class="sr-only" role="status">/);
});
```

with

```ts
it("still has the live region the move is announced through", () => {
  expect(html).toMatch(/<p class="sr-only" role="status">/);
});

it("gives the page heading tabindex=-1, the last place an Undo can put focus", () => {
  expect(html).toMatch(/<h1\b[^>]*\btabindex="-1"[^>]*>Medications<\/h1>/);
});
```

Create `tests/unit/medications-reorder-lock.test.ts`:

```ts
// The Medications list's ↑/↓ moves the keyed cards under the pointer, so it
// takes the (app) layout's dose-write lock: a Log tap cannot land on a card
// that has just moved, and a move cannot start while a log is in flight.
// Reorder is not a dose write, so it keeps `update()`; it only has to take the
// lock and give it back. Mounted for real (jsdom, client svelte) with each
// form's use:enhance callback driven by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";
import type { MedicationWithStats } from "$lib/types";

const h = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, SubmitFunction>() }));

vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy: () => void h.submits.delete(form) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: vi.fn(async () => {}), goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: vi.fn() }));

import MedicationsPage from "../../src/routes/(app)/medications/+page.svelte";
import {
  createDoseWriteLock,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

function medication(overrides: Partial<MedicationWithStats>) {
  return {
    ...BASE_MEDICATION_ROW,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    daysUntilRefill: 20,
    expectedDailyDoses: 3,
    sparkline: [],
    refillSeverity: "ok" as const,
    ...overrides,
  };
}

const data = {
  user: {
    id: "u1",
    email: "person@example.com",
    name: "Test Person",
    avatarUrl: null,
    timezone: "UTC",
    twoFactorEnabled: false,
    emailVerified: true,
  },
  preferences: { timeFormat: "24h" },
  medications: [
    medication({ id: "m1", name: "Paracetamol", sortOrder: 0 }),
    medication({ id: "m2", name: "Ibuprofen", sortOrder: 1 }),
  ],
  archived: [],
} as unknown as ComponentProps<typeof MedicationsPage>["data"];

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let lock: DoseWriteLock;

beforeEach(() => {
  vi.useFakeTimers();
  h.submits.clear();
  lock = createDoseWriteLock();
  target = document.body.appendChild(document.createElement("div"));
  app = mount(MedicationsPage, { target, props: { data }, context: doseWriteContext(lock) });
  flushSync();
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  vi.useRealTimers();
});

function enhancedFormOf(selector: string) {
  const form = target.querySelector<HTMLButtonElement>(selector)?.closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error(`${selector} is not in a use:enhance form`);
  return { form, submit };
}

const MOVE_IBUPROFEN_UP = "#move-m2-up";
const LOG_PARACETAMOL = 'button[aria-label="Log a dose of Paracetamol"]';

describe("the medications list's reorder under the dose-write lock", () => {
  it("refuses a move while a dose write holds the lock", async () => {
    const move = enhancedFormOf(MOVE_IBUPROFEN_UP);
    lock.acquire();

    const { cancel, callback } = await startSubmit(move.submit, move.form);

    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
  });

  it("holds the lock for the whole move, so a Log tap mid-move is refused, then lets go", async () => {
    const move = enhancedFormOf(MOVE_IBUPROFEN_UP);
    const log = enhancedFormOf(LOG_PARACETAMOL);

    const moving = await startSubmit(move.submit, move.form);
    expect(moving.cancel).not.toHaveBeenCalled();
    expect(lock.active).toBe(true);

    const tap = await startSubmit(log.submit, log.form);
    expect(tap.cancel).toHaveBeenCalledOnce();

    const { update, done } = finishSubmit(moving.callback!, move.form, {
      type: "success",
      status: 204,
    });
    await done;

    // Reorder is not a dose write: it still hands the result to update().
    expect(update).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `npx vitest run tests/unit/medications-reorder-lock.test.ts tests/unit/medication-card-targets-ssr.test.ts`
Expected: FAIL.

- "refuses a move while a dose write holds the lock": `expected "spy" to be called once, but got 0 times` (the reorder ignores the lock).
- "holds the lock for the whole move…": `expected false to be true` at `lock.active`.
- "gives the page heading tabindex=-1…": the `h1` has no `tabindex`.

- [ ] **Step 8: Put the reorder under the lock and make the heading focusable**

Replace the whole `<script lang="ts">` block of `src/routes/(app)/medications/+page.svelte` (from `<script lang="ts">` through `</script>`, which after Step 3 includes the `TimeFormat` import and `timeFormat`) with:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { enhance } from "$app/forms";
  import { actionErrorMessage } from "$lib/utils/form-errors";
  import type { TimeFormat } from "$lib/utils/time";
  import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
  import MedicationCard from "$lib/components/MedicationCard.svelte";
  import EmptyState from "$components/EmptyState.svelte";
  import emptyMedications from "$lib/assets/397d3a76-85b0-43ee-a0c2-981053e4040c.webp";

  let { data } = $props();

  // The (app) layout's dose-write lock. A move re-sorts the keyed cards, so it
  // takes the same lock as a card's Log: a Log tap cannot land on a card that
  // has just slid under the finger, and a move cannot start while a log is
  // still in flight. Reorder is not a dose write, so it keeps `update()`.
  const lock = getDoseWriteLock();

  const timeFormat = $derived(data.preferences.timeFormat as TimeFormat);

  let announcement = $state("");

  /**
   * Reordering succeeded silently: the list re-rendered with no announcement,
   * and when an item reached either end its own button became `disabled`, which
   * makes the browser drop focus to <body> — so a keyboard user lost both the
   * result and their place, mid-task.
   */
  function reorder(
    medication: { id: string; name: string },
    direction: "up" | "down",
  ): SubmitFunction {
    return ({ cancel }) => {
      if (!lock.acquire()) {
        cancel();
        return;
      }
      return async ({ result, update }) => {
        try {
          await update();
          // An expired session (the action's own error(401)) and a throw out of
          // swapSortOrder both land here. Announcing a position then would state a
          // move that did not happen — and on an error result `update()` has
          // already swapped the page for the error boundary, so the focus grab
          // would reach into a destroyed DOM. Report it through the live region
          // rather than returning silently, which CLAUDE.md calls out as its own
          // failure mode.
          if (result.type !== "success") {
            announcement = actionErrorMessage(result, "Could not reorder medications.");
            return;
          }
          const index = data.medications.findIndex((m: { id: string }) => m.id === medication.id);
          announcement = `${medication.name} moved to position ${index + 1} of ${data.medications.length}`;
          await tick();
          const same = document.getElementById(`move-${medication.id}-${direction}`);
          const opposite = document.getElementById(
            `move-${medication.id}-${direction === "up" ? "down" : "up"}`,
          );
          // Prefer the button just pressed; fall back to its sibling when the move
          // disabled it.
          const target = same && !(same as HTMLButtonElement).disabled ? same : opposite;
          target?.focus();
        } finally {
          // After the reload and the focus hand-off, so the cards are in their
          // new places before a Log tap is allowed again.
          lock.release();
        }
      };
    };
  }
</script>
```

The `ActionResult` import is gone: `SubmitFunction` types the callback's `result` and `update`. The two `use:enhance={reorder(medication, "up")}` / `"down"` forms need no change.

Replace

```svelte
<h1 class="text-2xl font-bold">Medications</h1>
```

with

```svelte
<!-- tabindex="-1": the last-resort focus target for an Undo whose card
         is gone. -->
<h1 tabindex="-1" class="text-2xl font-bold">Medications</h1>
```

- [ ] **Step 9: Run them to verify they pass**

Run: `npx vitest run tests/unit/medications-reorder-lock.test.ts tests/unit/medication-card-targets-ssr.test.ts tests/unit/medication-card-targets-dom.test.ts`
Expected: PASS, all three files.

- [ ] **Step 10: Prove the page tests by mutation**

In `src/routes/(app)/medications/+page.svelte`, break each, run `npx vitest run tests/unit/medications-reorder-lock.test.ts tests/unit/medication-card-targets-ssr.test.ts`, confirm the named failure, restore, re-run green.

1. Delete the block `if (!lock.acquire()) { cancel(); return; }` → FAIL: "refuses a move while a dose write holds the lock" and "holds the lock for the whole move, so a Log tap mid-move is refused, then lets go" (the Log tap is no longer refused).
2. Delete `          lock.release();` from the `finally` → FAIL: "holds the lock for the whole move…" (`expected true to be false` at the final `lock.active`).
3. Delete `tabindex="-1" ` from the `h1` → FAIL: "gives the page heading tabindex=-1, the last place an Undo can put focus".

- [ ] **Step 11: Update existing tests this change breaks**

- `tests/unit/medication-card-targets-dom.test.ts`: replaced in Step 1 (the `fetch` stub and the one-argument `showToast("Paracetamol logged", "success")` assertion are gone; the card-column test now passes `user`, `preferences` and `doseWriteContext()`, which the page needs for `data.user.timezone`, `data.preferences.timeFormat` and `getDoseWriteLock()`).
- `tests/unit/medication-card-targets-ssr.test.ts`: edited in Steps 1 and 6 (the card render passes `timezone`, `timeFormat` and `doseWriteContext()`; the page render passes `doseWriteContext()`).
- Nothing else renders `MedicationCard` or the medications page (`grep -rln "MedicationCard.svelte\|medications/+page.svelte" tests` lists only those two files and the new reorder test). `src/lib/components/walkthrough/scenes/MedicationsScene.svelte` is a separate static mock-up with no Log form, so it is untouched.

- [ ] **Step 12: Run the task's full suite**

Run: `npx vitest run tests/unit/medication-card-targets-dom.test.ts tests/unit/medication-card-targets-ssr.test.ts tests/unit/medications-reorder-lock.test.ts`
Expected: PASS, every file.

Run: `npx vitest run`
Expected: PASS, the whole unit suite.

Run: `npm run check`
Expected: no errors or warnings in `MedicationCard.svelte`, `medications/+page.svelte` or the three test files; the total count is unchanged from before this task. (`MedicationCard`'s `timezone` and `timeFormat` are required, so a missed call site would show here.)

Run: `npx prettier --check src/lib/components/MedicationCard.svelte "src/routes/(app)/medications/+page.svelte" tests/unit/medication-card-targets-dom.test.ts tests/unit/medication-card-targets-ssr.test.ts tests/unit/medications-reorder-lock.test.ts`
Expected: "All matched files use Prettier code style!"

- [ ] **Step 13: Commit**

```bash
git add src/lib/components/MedicationCard.svelte "src/routes/(app)/medications/+page.svelte" tests/unit/medication-card-targets-dom.test.ts tests/unit/medication-card-targets-ssr.test.ts tests/unit/medications-reorder-lock.test.ts
git commit -m "feat(medications): log from the card through the shared dose-write path, with Undo

The card's Log is now a form posting to /dashboard?/logDose through
createDoseWrite: the layout's write lock, the offline gate, a reload that
waits out a lost connection, and an Undo offer that deletes the new dose,
worded with the log time in the user's zone. It stays type=button until
hydrated. The reorder arrows take the same lock for their round trip, so
a Log tap cannot land on a card that just moved, and the page heading is
focusable as the Undo's last resort."
```

---

### Task 14: e2e, docs and final verification

This task changes no production code. It:

- rewrites the two /log delete e2e tests for the one-tap ×, and adds one that presses Undo and sees the same dose, and its stock, come back;
- records the decisions in the docs the spec names ("Docs to update in the same PR"): `CLAUDE.md`, a new `docs/adr/0008-undoable-deletes.md` linked from `docs/adr/README.md`, `docs/database.md`, `docs/RUNBOOK.md` and `docs/api-v1-contract.md`, plus the two stale sentences in `docs/architecture.md`;
- sweeps for names this plan retired, and runs the final verification.

**Files:**

- Modify: `tests/e2e/dose-logging.test.ts` (anchors: `test("deleting a taken dose restores inventory", async ({ page }) => {`, `test("deleting a skipped dose does not restore inventory", async ({ page }) => {`, `test("editing a dose's notes persists across reload", async ({ page }) => {`)
- Modify: `CLAUDE.md` (anchors quoted in Steps 9–14)
- Create: `docs/adr/0008-undoable-deletes.md`
- Modify: `docs/adr/README.md` (anchor: `- [0007 — One owner for wall-clock → instant resolution](./0007-wall-clock-resolution.md)`)
- Modify: `docs/database.md` (anchor: the line ``### `audit_logs` ``)
- Modify: `docs/RUNBOOK.md` (anchors: `If that diff is empty, roll back freely.`, `### 4b. A deploy cannot boot`)
- Modify: `docs/api-v1-contract.md` (anchors: ``(per the comment on `syncTombstones` in `schema.ts`; not DB-enforced).``, `  eventType: string; // "dose_taken" | "refill" | "dose_deleted" | "manual_adjustment" | "correction" (see InventoryEventType)`, `  action: string;`, `### Wipes bump the sync epoch`)
- Modify: `docs/architecture.md` (anchors: ``The dose paths (taken, deleted, quantity edited), `refillMedication` and``, ``the column, and readers fall back to `quantity`.``)
- Modify, only if Step 15's sweep finds them: stale comments such as `src/lib/components/dashboard/dom-ids.ts` (``/** DoneList's `<h2>`: focus lands here after Remove or Undo skip. Always rendered. */``)

**Interfaces:**

- Consumes (these docs describe them; every name is from the shared contract and must match the code Tasks 1–13 shipped):
  - Task 1: `dose_log_trash` / `doseLogTrash` (index `dose_log_trash_user_deleted_idx`), migration `drizzle/0021_*.sql`, `DOSE_UNDO_WINDOW_MS = 10 * 60_000` in `src/lib/utils/dose-undo.ts`, `InventoryEventType` `"dose_restored"`, audit action `"restore"`, `doseIdSchema` / `doseDeleteSchema` / `doseRestoreSchema`, `pgDb.seedTrash` / `pgDb.seedTombstone`.
  - Task 2: `deleteDose(userId, doseId, opts: { keepForUndo: boolean; now?: Date }): Promise<DeletedDose | null>`, `purgeExpiredTrash(executor, opts: { now: Date; userId?: string })`, `deleteDoseAction(event)` (`forUndo=1` → no trash, no `restore`), `/api/v1 delete_dose` → `deleteDose(userId, doseId, { keepForUndo: false })`.
  - Task 3: `restoreDose(userId, doseId, deletedAt, now?): Promise<"restored" | "already_restored" | "gone" | "logged_since">`, `takeFromStock`, `restoreDoseAction` at `/dashboard?/restoreDose`, `RESTORE_GONE_MESSAGE` (410), `RESTORE_LOGGED_SINCE_MESSAGE` (409).
  - Task 4: `updateDose`, `logDose`, `logSkippedDose`, `refillMedication`, `adjustInventory` lock the medication first.
  - Task 5: `wipeDoseHistory` (medications `FOR UPDATE` → `DELETE dose_logs` → trash delete), the `dose-log-trash` retention policy, `tests/unit/dose-log-trash-owners.test.ts`.
  - Task 6: `recomputeSlotActions`, `logDoseAtSlot`, `skipDoseForSlot`, Skip posting `forSlot`.
  - Task 7: `src/lib/components/dose-writes/` (`dose-write-lock.svelte.ts` with `active`, `copy.ts`, `reload-after-write.ts` with `HEALTH_PROBE_BACKOFF_MS`, `waitForServer`, `reloadAfterWrite`, `reloadDocumentIfUpdated`, `focus-after.ts` with `isFocusLost` / `focusIfLost`), the layout-owned lock, the seeded clock and `isExpired()`, `kit.version.pollInterval: 300_000`.
  - Task 8: `undo-registry.svelte.ts` (`offerUndo`, whose deadline counts from `UndoOfferInput.respondedAt`, `withdrawUndoFor`, `clearUndo`, `runUndo`, which posts both kinds of Undo itself, `resetUndoRegistry`), Toast's `data-toast-stack`, Dismiss and `clearToasts`, Toast reading the layout's lock once at init, the layout's `onDestroy`.
  - Task 9: `createDoseWrite` and its submit order, `respondedAt` read first on success and passed to `buildToast(doseId, respondedAt)` and `offerUndo`, and Toast's `showToast` restarting an identical (message, type) toast instead of stacking a second.
  - Tasks 10–13: "Remove skip", `KeyboardShortcuts` repeat and `aria-modal` checks, the `box-content` chip `li`, edit Save's exception, the one-tap /log × with `dayLabel`, the medications card's Log and the reorder lock.
- Produces: nothing later code relies on. Docs only, plus the e2e file.

---

#### Cycle A — e2e: one tap, then Undo

- [ ] **Step 1: Rewrite the two delete tests and add the Undo test**

In `tests/e2e/dose-logging.test.ts`, replace the whole of `test("deleting a taken dose restores inventory", …)` and `test("deleting a skipped dose does not restore inventory", …)` — every line from `  test("deleting a taken dose restores inventory", async ({ page }) => {` down to, but not including, `  test("editing a dose's notes persists across reload", async ({ page }) => {` — with:

```ts
test("deleting a taken dose restores inventory", async ({ page }) => {
  const userId = await getUserIdByEmail(SEEDED_EMAIL);
  expect(userId).not.toBeNull();
  const medId = await getMedIdByName(userId!, VITAMIN_D);

  await page.goto(`/log?status=taken&medication=${medId}`);

  const before = await getInventoryCount(userId!, VITAMIN_D);
  const beforeCount = await countDoseLogs(userId!, VITAMIN_D, "taken");
  expect(beforeCount).toBeGreaterThan(0);

  // One tap: × deletes at once and the toast offers Undo. It used to open
  // an inline confirmation, which existed only because nothing could put a
  // deleted dose back.
  await page.getByRole("button", { name: "Delete dose" }).first().click();
  await expect(page.getByText(/dose removed/i)).toBeVisible();

  const after = await getInventoryCount(userId!, VITAMIN_D);
  const afterCount = await countDoseLogs(userId!, VITAMIN_D, "taken");
  expect(afterCount).toBe(beforeCount - 1);
  expect(after).toBe((before ?? 0) + 1);
});

test("deleting a skipped dose does not restore inventory", async ({ page }) => {
  const userId = await getUserIdByEmail(SEEDED_EMAIL);
  expect(userId).not.toBeNull();
  const skippedBefore = await countDoseLogs(userId!, VITAMIN_D, "skipped");
  test.skip(skippedBefore === 0, "no skipped Vitamin D doses in seed");

  const medId = await getMedIdByName(userId!, VITAMIN_D);
  await page.goto(`/log?status=skipped&medication=${medId}`);

  const inventoryBefore = await getInventoryCount(userId!, VITAMIN_D);
  await page.getByRole("button", { name: "Delete dose" }).first().click();
  await expect(page.getByText(/dose removed/i)).toBeVisible();

  const inventoryAfter = await getInventoryCount(userId!, VITAMIN_D);
  const skippedAfter = await countDoseLogs(userId!, VITAMIN_D, "skipped");
  expect(skippedAfter).toBe(skippedBefore - 1);
  expect(inventoryAfter).toBe(inventoryBefore);
});

test("Undo after a one-tap delete brings the same dose, and its stock, back", async ({ page }) => {
  const userId = await getUserIdByEmail(SEEDED_EMAIL);
  expect(userId).not.toBeNull();
  const medId = await getMedIdByName(userId!, VITAMIN_D);

  await page.goto(`/log?status=taken&medication=${medId}`);

  const before = await getInventoryCount(userId!, VITAMIN_D);
  const beforeCount = await countDoseLogs(userId!, VITAMIN_D, "taken");
  expect(beforeCount).toBeGreaterThan(0);

  // By the row's own id: × is named by time of day only, and another day's
  // dose at the same time would satisfy a check by name.
  const row = page.locator("[data-dose-id]").first();
  const doseId = await row.getAttribute("data-dose-id");
  expect(doseId).not.toBeNull();

  await row.getByRole("button", { name: "Delete dose" }).click();
  await expect(page.getByText(/dose removed/i)).toBeVisible();
  await expect(page.locator(`[data-dose-id="${doseId}"]`)).toHaveCount(0);
  expect(await countDoseLogs(userId!, VITAMIN_D, "taken")).toBe(beforeCount - 1);

  // The offer's button is named "Undo" plus its message (aria-labelledby).
  await page.getByRole("button", { name: /^Undo Dose removed/ }).click();
  await expect(page.getByText("Dose restored")).toBeVisible();
  // A restore puts back the same id.
  await expect(page.locator(`[data-dose-id="${doseId}"]`)).toHaveCount(1);

  expect(await countDoseLogs(userId!, VITAMIN_D, "taken")).toBe(beforeCount);
  expect(await getInventoryCount(userId!, VITAMIN_D)).toBe(before);
});
```

(Keep the blank line before `test("editing a dose's notes persists across reload", …)`. The chip test above them and the edit test below are unchanged.)

- [ ] **Step 2: Type-check the e2e file, and run it where an e2e environment exists**

`tests/**` is inside svelte-check's `include`, so the e2e file is type-checked:

Run: `npm run check 2>&1 | grep -n "tests/e2e/dose-logging" || echo "no diagnostics in tests/e2e/dose-logging.test.ts"`
Expected: `no diagnostics in tests/e2e/dose-logging.test.ts`.

Only if an e2e environment is configured (`E2E_DATABASE_URL`, a seeded database, and a `.env` with which `npm run dev` boots):

Run: `npx playwright test tests/e2e/dose-logging.test.ts --project=authed`
Expected: 5 passed (the skipped-dose test may report as skipped if the seed has no skipped Vitamin D dose).

Otherwise skip the run. Local dev currently 500s everywhere because the worktree's `ENCRYPTION_KEY` is empty, and CI runs e2e only when the `RUN_E2E` repo variable is `true`, which it is not. The PR must say the e2e suite was not run (Step 18).

- [ ] **Step 3: Commit the e2e change**

```bash
git add tests/e2e/dose-logging.test.ts
git commit -m "test(e2e): delete a dose in one tap and take it back with Undo

The /log x deletes on the first tap now, so both delete tests lose their
confirmation click. A new test presses the toast's Undo and checks the
same dose id, the taken count and the stock all come back.

Not run in CI: the e2e job is gated on the RUN_E2E repo variable."
```

The commit message carries no Claude/AI attribution, no `Co-Authored-By` and no session link.

---

#### Cycle B — the architecture record and the reference docs

- [ ] **Step 4: Write ADR 0008 and link it**

Create `docs/adr/0008-undoable-deletes.md`:

```markdown
# ADR 0008: Undoable deletes through a trash table

- **Status**: Accepted
- **Date**: 2026-09-25
- **Deciders**: Jamie White

## Context

`deleteDose` hard-deleted the row, credited its stock back and wrote a
sync tombstone, all in one transaction. Nothing could put the dose back,
and every surface worked around that differently:

- the /log × opened an inline "Delete this dose? This can't be undone."
  confirmation, which existed only because there was no undo;
- the dashboard's _Remove this dose_ and Done's skip and missed-entry
  removal had neither a confirmation nor an Undo, so a mis-tap on a small
  target in a list of near-identical rows was permanent;
- the Undo offered after a log was itself a delete, and so could not be
  undone either.

A restore is harder than re-inserting a row, for three reasons.

**Stock.** A delete credits `inventoryApplied ?? quantity` back to
`medications.inventory_count`, but only while the count is not NULL. A
dose deleted while tracking was off credited nothing. If tracking is
switched back on before the Undo, a restore that "takes back what the dose
applied" takes stock that was never returned — and the `inventory_events`
ledger reconciles _with_ a mint like that, so it could not be caught
afterwards.

**Sync.** The Mac app applies a delta's upserts and then its tombstones,
in that order. A tombstone that survives a restore deletes the restored
dose on the next sync, for good.

**Staleness.** An Undo can arrive late or twice: from a second tab, after
navigating away, or after the same medication has been logged again.
Restoring then records two taken doses and takes stock twice.

## Decision

**A deleted dose moves into `dose_log_trash`**, in the same transaction as
its delete, its stock credit and its tombstone. The trash row holds every
`dose_logs` column except `updatedAt`, plus two of its own:

- `inventoryCredited`: what the delete **actually** gave back, which is 0
  whenever the count was NULL. It is not a copy of `inventoryApplied`.
- `deletedAt`: the app clock, read after the medication row is locked.

**Undo moves it back** (`restoreDose`), under this contract:

- the **same id** comes back, with its original `loggedAt`;
- it is keyed on **`(doseId, deletedAt)`**, so an out-of-date Undo cannot
  reverse a newer delete of the same dose;
- it is refused as `logged_since` when any dose of that medication has
  `loggedAt > deletedAt`;
- the window is **10 minutes** (`DOSE_UNDO_WINDOW_MS`), expired at
  `deleted_at <= now − window`;
- stock is taken back as `min(locked count, inventoryCredited)`, with the
  same `GREATEST(0, …)` clamp a log uses;
- **every** sync tombstone for the dose is deleted.

**Deletes nobody can undo skip the trash**: `/api/v1 delete_dose`, because
the Mac app has no Undo, and the delete behind a create's Undo. A trash
row there could only linger.

**Lock order.** Every per-dose write, and every writer of
`inventory_count`, locks the medication row first (ascending id when there
are several), then the dose or trash row. Trash purges use
`FOR UPDATE SKIP LOCKED` and never wait. `loggedAt` and `deletedAt` are
read after the medication lock, so their order matches commit order and
the `logged_since` guard compares like with like.

## Alternatives considered

Three designs were scored by a three-lens panel (spec D4). Higher is
better:

| Lens                  | Trash table | Signed client snapshot | Soft-delete column |
| --------------------- | ----------- | ---------------------- | ------------------ |
| Integrity             | 7.5         | 6                      | 6.5                |
| Sync, privacy and ops | 7           | 8.5                    | 4.5                |
| Cost and testability  | 8           | 6                      | 4                  |

**Signed client snapshot.** The delete response would carry a signed copy
of the deleted row, and Undo would post it back for the server to verify
and re-insert. The server keeps nothing, which is why it scored best on
privacy. What weighs against it: a signature proves a snapshot is genuine,
not that it is current — delete, restore, delete again, and the first
snapshot still verifies — so refusing a stale Undo needs server-side state
after all, the way the `preauth:` rows in `rate_limits` are the nonce
ledger behind the 2FA claim. The stock credit would have to travel inside
the token and be trusted on the way back, a dose's notes would round-trip
through the client, and a signing key is a new boot-required secret: a
change to the deployment contract in `env-contract.js`, not to a file.

**Soft-delete column** (`dose_logs.deleted_at`). Restore becomes a single
`UPDATE` and the row never moves. What weighs against it: every reader of
`dose_logs` — the dashboard window, both analytics denominators, reminder
due-ness, refill forecasting's 30-day history, the CSV, PDF and JSON
exports, the privacy counts and the sync delta — would need
`deleted_at IS NULL`, and a single missed predicate counts a deleted dose
as taken while reading as correct. The sync delta would also have to
decide whether a soft-deleted row is an upsert or a tombstone.

**The trash table** is the only one of the three where a restore exactly
reverses the delete's stock change in every tracking state, because
`inventoryCredited` records what happened rather than what the dose says.
No reader of `dose_logs` changes. The trash is never exported, which is
correct: re-importing a trashed dose would undo its delete.

## Consequences

**Deleted content stays on the server until it is purged.** This is the
accepted cost. A trash row goes when the same user next deletes or
restores a dose (the on-write purge), or when the `dose-log-trash`
retention policy runs. Retention rides the `reminder-tick` GitHub Actions
schedule (`*/30 6-22` UTC), so an overnight delete can linger for about
7.5 hours, and with both schedulers down it lingers until that user's next
delete or restore. Neon PR branches copy whatever trash exists when they
are created.

**Wipes and cascades.** `wipeDoseHistory` locks the user's medications,
deletes `dose_logs`, then deletes the user's trash. The archived-medication
wipe, import replace mode and account deletion reach the trash through
`ON DELETE CASCADE` on `user_id` and `medication_id`; each already locks
the medication before the cascade runs, so they follow the lock order with
no extra code. An Undo after any of them answers "Too late to undo."

**Same-id restore opens an ABA for edits, and it is closed rather than
accepted.** A Save that read applied 3, then a Remove and an Undo that
re-inserted the dose with a recomputed amount, would otherwise diff
against the stale 3. `updateDose` re-reads the dose under the medication
lock and returns null if it has gone.

**What the Mac app sees.** The wire shapes are unchanged:
`InventoryEventType` gains `"dose_restored"` and the audit `action` gains
`"restore"`, and both are decoded as strings. A restored dose arrives as
an upsert with a newer `updatedAt` and no tombstone, whichever side of the
delete the client's cursor sits.

**Known and accepted.**

- The `logged_since` guard sees only `loggedAt`. An edit that moves
  another dose onto the deleted one's slot is invisible to it, and so is
  an import, which writes old `loggedAt` values. On one device the client
  closes the common case, because any successful write clears the Undo
  offer.
- Clock skew between server instances can reorder `loggedAt` against
  `deletedAt` by that skew.
- A reminder sweep between a delete and its Undo can send one overdue
  reminder, and cannot unsend it. A delete's credit can close a
  low-inventory episode that the restore then reopens, sending one extra
  alert.
- Web dose writes do not bump `medications.updatedAt`, so the Mac app does
  not learn about stock changed by a web log, delete or restore. This
  predates this decision.

**Rollback is safe but not free.** The old code never reads the trash, so
nothing deleted comes back to life. But trash rows stop being purged, and
the old wipe does not clear them, until the release rolls forward again.
`docs/RUNBOOK.md` §3 has the procedure.
```

In `docs/adr/README.md`, replace:

```markdown
- [0007 — One owner for wall-clock → instant resolution](./0007-wall-clock-resolution.md)
```

with:

```markdown
- [0007 — One owner for wall-clock → instant resolution](./0007-wall-clock-resolution.md)
- [0008 — Undoable deletes through a trash table](./0008-undoable-deletes.md)
```

- [ ] **Step 5: Document the table in `docs/database.md`**

Insert immediately before the line ``### `audit_logs` ``:

```markdown
### `dose_log_trash`

Deleted doses waiting on an Undo, for ten minutes (`DOSE_UNDO_WINDOW_MS`
in `src/lib/utils/dose-undo.ts`). Added by migration `0021`; see
[ADR 0008](adr/0008-undoable-deletes.md).

- `id` is the deleted dose's own id, as the primary key, because a restore
  puts back the same id.
- Every `dose_logs` column except `updated_at` is copied, with the same
  type and nullability. `tests/unit/dose-log-trash-columns.test.ts` fails
  if the two tables drift.
- `inventory_credited` (not null) is what the delete actually gave back to
  `medications.inventory_count`: 0 for a skip or a missed entry, and 0
  when the count was NULL, because the credit is skipped then. It is
  **not** a copy of `inventory_applied`. A restore takes back
  `min(count, inventory_credited)`, so a dose deleted while tracking was
  off and restored after it came back on takes nothing.
- `deleted_at` (not null) is the app clock, read after the medication row
  is locked. The pair `(id, deleted_at)` is the Undo handle, and a restore
  must present it exactly.

`user_id` and `medication_id` reference their tables with
`ON DELETE CASCADE`, so account deletion, the archived-medication wipe and
import replace mode clean up with no extra code. Index
`dose_log_trash_user_deleted_idx (user_id, deleted_at)` serves the purges.

`src/lib/server/doses.ts` owns the table (`deleteDose`, `restoreDose`,
`purgeExpiredTrash`), and `src/lib/server/api/wipe.ts` clears it in
`wipeDoseHistory`. Nothing else may reference it:
`tests/unit/dose-log-trash-owners.test.ts` scans `src/` in both
directions. Every purge, on write or in the `dose-log-trash` retention
policy, is `DELETE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so it
never waits on a row a delete or restore holds. Nothing exports the trash.
```

(Keep one blank line between the new section and ``### `audit_logs` ``.)

- [ ] **Step 6: Add the rollback note and the preview case to `docs/RUNBOOK.md`**

Replace:

```markdown
If that diff is empty, roll back freely.
```

with:

````markdown
If that diff is empty, roll back freely.

**Rolling back past migration `0021` (undoable deletes).** The
`dose_log_trash` table is additive, so the rolled-back code runs, and
nothing deleted comes back to life: that code never reads the trash. Two
things stop until you roll forward again:

- **Trash rows are no longer purged.** The purge lives in the new code's
  deletes, its restores and its `dose-log-trash` retention policy, so
  deleted doses' notes and side effects stay on the server for the length
  of the rollback.
- **Delete dose history does not clear them.** The old `wipeDoseHistory`
  does not know the table.

Rolling forward purges every row past the ten-minute window on the next
`reminder-tick`. If a user deletes their dose history during a rollback,
clear their trash by hand as well:

```sql
DELETE FROM dose_log_trash WHERE user_id = '<user id>';
```
````

Then insert immediately before the line `### 4b. A deploy cannot boot`:

```markdown
**Preview deployments are a standing case of this since migration `0021`.**
Preview builds do not push the schema (`scripts/vercel-build.mjs` pushes
for production only, unless `MIGRATE_ON_BUILD=true`). On a preview whose
database lacks `dose_log_trash`, a web dose delete fails, restore is
unavailable, and Delete dose history fails on the web and through
`/api/v1 wipe_dose_history`; the `dose-log-trash` retention policy logs a
failure on every tick that reaches that database. The Mac app's
`delete_dose`, which skips the trash, and everything else are unaffected.
Redeploy the preview with `MIGRATE_ON_BUILD=true` to push the additive
table, never with `--force`.
```

- [ ] **Step 7: Update `docs/api-v1-contract.md`**

After the lines:

```markdown
`entityType` is one of `"medication" | "dose_log" | "medication_schedule" | "inventory_event"`
(per the comment on `syncTombstones` in `schema.ts`; not DB-enforced).
```

insert (one blank line before it):

```markdown
**A `dose_log` tombstone can be withdrawn.** The web app's Undo restores a deleted dose with
the **same id**, within ten minutes of the delete, and deletes every tombstone for it in the
same transaction. The restored row's `updatedAt` is the restore time, so a client whose
cursor predates the delete receives the dose and no tombstone, and a client that already
applied the tombstone receives the dose again in its next delta. Apply a delta's `doseLogs`
as upserts that can recreate a row the client deleted, then its tombstones, in that order;
the shipped Mac app already does.
```

Replace:

```ts
eventType: string; // "dose_taken" | "refill" | "dose_deleted" | "manual_adjustment" | "correction" (see InventoryEventType)
```

with:

```ts
eventType: string; // "dose_taken" | "dose_deleted" | "dose_quantity_updated" | "dose_restored" | "refill" | "manual_adjustment" | "correction" (see InventoryEventType)
```

(`dose_quantity_updated` was already a value of `InventoryEventType` and was missing from this list; `dose_restored` is new, written with a negative `quantityChange` by the web Undo only.)

In the `SerializedAuditLog` block, replace:

```ts
action: string;
```

with:

```ts
action: string; // "create" | "update" | "delete" | "restore" | "failed_login" (see logAudit)
```

Insert immediately before the line `### Wipes bump the sync epoch`:

```markdown
**`delete_dose` is not undoable.** Its wire shape is unchanged — `{ doseId }` in,
`{ deleted: boolean }` out — and it calls `deleteDose(userId, doseId, { keepForUndo: false })`.
Native clients have no Undo, so the deleted row is not kept in the server's trash. Deleting a
dose that is already gone returns `{ deleted: false }` and writes nothing, so a repeat can never
credit stock twice. There is no `/api/v1` restore command: only the web app's Undo, within ten
minutes of a web delete, brings a dose back (see Tombstones, §3).
```

- [ ] **Step 8: Correct the two stale sentences in `docs/architecture.md`**

Replace:

```markdown
The dose paths (taken, deleted, quantity edited), `refillMedication` and
```

with:

```markdown
The dose paths (taken, deleted, restored, quantity edited), `refillMedication` and
```

Replace:

```markdown
the column, and readers fall back to `quantity`.
```

with:

```markdown
the column, and readers fall back to `quantity`. A restore (the web Undo
after a delete) takes back `min(count, inventory_credited)`, where
`dose_log_trash.inventory_credited` records what the delete actually gave
back: 0 when the count was NULL. See
[ADR 0008](adr/0008-undoable-deletes.md).
```

---

#### Cycle C — `CLAUDE.md`

Every edit below is an exact replacement or insertion. `CLAUDE.md` keeps one bullet per line; do not wrap the new bullets.

- [ ] **Step 9: Rewrite the dashboard-clock bullet**

Replace the whole line that begins ``- **Dashboard time is server-relative, and `createDashboardClock` ``, which is exactly:

```markdown
- **Dashboard time is server-relative, and `createDashboardClock` (`components/dashboard/dashboard-clock.ts`) owns it.** `(app)/dashboard/+page.svelte` creates one clock, puts it in context with `setDashboardClock`, and calls `clock.sync({ now, nextRefreshAt })` once per payload. `sync` re-measures `skewMs = Date.parse(data.now) − Date.now()` (`skewFrom`) and arms the ONE refresh timer for `data.nextRefreshAt` (computed by `composeDashboardPageData`, clamped to at least `now + 5s`). `onVisible()` re-checks on `visibilitychange`, and the page re-renders durations from a 60s `clock.serverNow()` tick. Every payload instant is compared with `serverNow() = Date.now() + skewMs`, never raw `Date.now()`: a device clock minutes fast would otherwise reload the page in a loop, and `DoseActionForm`'s stale guard would refuse every tap near a boundary. Status, rows and buttons change only through the load; the client never re-derives them, and nothing else arms a refresh timer.
```

with:

```markdown
- **Dashboard time is server-relative, and `createDashboardClock` (`components/dashboard/dashboard-clock.ts`) owns it.** `(app)/dashboard/+page.svelte` creates one clock **seeded from the page payload** — `createDashboardClock(invalidateAll, { now: data.now, nextRefreshAt: data.nextRefreshAt })` — puts it in context with `setDashboardClock`, and calls `clock.sync({ now, nextRefreshAt })` once per payload. The seed sets the skew and the refresh instant **without arming the timer**: unseeded, the clock read `NaN` until the first `sync`, and arming at construction would leak a `setTimeout` out of SSR. `sync` re-measures `skewMs = Date.parse(data.now) − Date.now()` (`skewFrom`) and arms the ONE refresh timer for `data.nextRefreshAt` (computed by `composeDashboardPageData`, clamped to at least `now + 5s`). `onVisible()` re-checks on `visibilitychange`, and the page re-renders durations from a 60s `clock.serverNow()` tick. Every payload instant is compared with `serverNow() = Date.now() + skewMs`, never raw `Date.now()`: a device clock minutes fast would otherwise reload the page in a loop, and the stale guard would refuse every tap near a boundary. **The stale guard is `clock.isExpired()`** (`serverNow() >= nextRefreshAt`, false while the refresh instant is `NaN`), and only dashboard controls hand the clock to `createDoseWrite` as `staleGuard`, so /log and /medications have no guard by construction rather than by a check that could be wrong. Status, rows and buttons change only through the load; the client never re-derives them, and nothing else arms a refresh timer.
```

- [ ] **Step 10: Add the re-derivation bullet at the end of "Key Patterns"**

Insert immediately before the line `## Reusable Components` (keep one blank line between the new bullet and the heading):

```markdown
- **Log now, Took it at and Skip re-derive `slotActions` under the medication lock, through `recomputeSlotActions` in `doses.ts`**, which runs the same `projectFixedTimes` / `slotActions` the page load ran. A button is a claim about the page the user was looking at, and a second device makes it false: phone A's Log now at 08:40 resolves the 08:00 slot, and laptop B's stale "Took it at 08:00" used to insert a second taken dose and take stock again, because the only check was a row at the exact posted instant. `logDoseAtSlot` keeps that exact-instant check first, so a double tap still gets its specific message, then throws `SlotTargetChangedError` unless `rows.get(slot)?.tookItAt === slot`. That also refuses Took it at on a slot a skip has already resolved: remove the skip first. **Took it at and Log now are always ×1**, whatever quantity is posted: the simulation proves a probe of quantity 1, and a larger dose could resolve rows it never checked. Skip posts `forSlot`, and `skipDoseForSlot` writes at the server's `rows.get(forSlot).skipAt` — `min(slot, now)`, the instant the simulation proved — so no client clock picks it. A page loaded before this shipped posts `takenAt` only; for one release that goes through `skipDoseForSlot` too, which accepts it exactly when it names a past slot and otherwise answers 409. A tab loaded before this release runs the old client, which neither polls for a new version nor checks `updated.current`, so it keeps getting that 409 for a Skip on a slot still ahead until it is reloaded by hand. From this release on, `kit.version.pollInterval` and `reloadDocumentIfUpdated()` make a 409 reload a stale tab onto the new code. Delete the `takenAt` legacy path one release after it ships.
```

- [ ] **Step 11: Replace the `DoseActionForm` bullet with the three `dose-writes/` bullets**

Replace this block (from its first line to the paragraph ending ``because that component is shared with `/log`.``):

```markdown
- **`DoseActionForm` (`src/lib/components/dashboard/`) is the only `use:enhance` for a dashboard log, skip, undo or remove.** That covers the Due-card buttons, the chips, Undo skip and the Modal's _Remove this dose_. It owns:
  - the page-wide write lock (`createDoseWriteLock`, set in context by the page; `aria-disabled`, never `disabled`, which drops focus to `<body>`)
  - the stale guard
  - the toast, built from the RELOADED data, and its Undo (which takes the lock with `hold()`/`extend()`, so it is never refused and a concurrent write cannot free it early)
  - every failure path (`actionErrorMessage`; a 409 or `'error'` runs `invalidateAll()` before the lock releases)

  A second hand-rolled enhance on this page reopens the double-tap double-dose the lock exists to close. The 1–9 shortcuts go through it too: they `requestSubmit()` the chip form `findQuickLogForm` returns. That helper matches `form[data-quick-log]` only, because a Due card's _Took it at_ is also a `?/logDose` form and records a past instant. The Modal's edit stays on `DoseEditForm`'s own enhance because that component is shared with `/log`.
```

with:

```markdown
- **`src/lib/components/dose-writes/` is the single client path for every dose write, on every page.** `createDoseWrite` (`dose-write.svelte.ts`) is the only `SubmitFunction` for a log, a skip or a delete: the dashboard's `DoseActionForm` (Due cards, chips, the 1–9 shortcuts, Done's _Remove skip_ and _Remove_, the edit dialog's _Remove this dose_), the /log × in `TimelineEntry` and the /medications card's Log all sit on it. Neither kind of Undo is a form: a create's Undo (`/dashboard?/deleteDose` with `forUndo=1`) and a delete's restore (`/dashboard?/restoreDose`) are both posted by the Undo registry's `runUndo`, below. It reads its options at submit time and runs, in this order: the offline gate (`navigator.onLine === false` sends nothing and takes no lock), `acquire()` on the one write lock, the stale guard (dashboard only), withdrawal of any Undo offer naming this dose (only now, when the write is certain to be sent, so a refused tap never costs the user their Undo), then the POST. It handles every result itself — the toast or the Undo offer, focus, and every failure through `actionErrorMessage` — because nothing calls `update()` (next bullet). A success reads `respondedAt = Date.now()` before anything else, because the reload after it can wait out a navigation or an outage: `buildToast(doseId, respondedAt)` receives it, so a toast that names a time (the medications card's "logged at") names the response's arrival, and the Undo offer's deadline counts from it. **The lock belongs to the `(app)` layout**: `+layout.svelte` calls `setDoseWriteLock(createDoseWriteLock())` once per layout instance, never as module state, which is per-process during SSR. Toast, every page's dose controls and the medications ↑/↓ reorder (it moves the keyed cards, so a Log tap could otherwise land on a different card) read that same lock, so an Undo pressed after navigating holds the lock the new page reads. Controls signal it with `aria-disabled`, never `disabled`, which drops focus to `<body>`. A tap refused while a write is `active` (a holder exists; `busy` also covers the 700ms cooldown) toasts "Still saving your last change…", and however many taps are refused there is one such toast on screen: `showToast` restarts the timer of an identical (message, type) toast already showing instead of stacking a second. A tap refused by the cooldown alone says nothing. **Edit Save is the one exception**: `DoseEditForm` keeps its own enhance because its field errors render inline, but it takes the same lock and offline gate, withdraws and clears offers the same way and reloads through `reloadAfterWrite`, so Save and Remove exclude each other. A second hand-rolled enhance anywhere reopens the double-tap double-dose the lock exists to close. The /log × and the medications card's Log render `type="button"` until mounted, so a tap before hydration does nothing rather than posting natively with no Undo. The 1–9 shortcuts `requestSubmit()` the chip form `findQuickLogForm` returns, which matches `form[data-quick-log]` only because a Due card's _Took it at_ is also a `?/logDose` form and records a past instant; `KeyboardShortcuts` ignores `e.repeat` and does nothing while any `[aria-modal="true"]` is open, except `?` closing its own help overlay. A write button swallows a repeated Enter keydown, because Enter activates on keydown and repeats. Dose controls take their size from fixed `h-11` / `min-h-11` / `size-11` classes, never from padding (the /log row's ✎ and × are the one exception, per spec Section 3: `size-8 pointer-coarse:size-11`, 32px for a mouse and 44px on a coarse pointer), and the Quick Log `li` is `box-content` so its 1px border does not clip each chip segment to 42px.
- **No dose write calls enhance's `update()`; reloads go through `reloadAfterWrite()` (`dose-writes/reload-after-write.ts`).** `update()` applies a result only while the action's path matches the page the user is on when the result arrives, so once dose writes post across routes — the medications card's `/dashboard?/logDose`, an Undo pressed from any page — it dropped their failures silently, and it runs `reset_focus` on whichever page matches, which sent focus to `<body>` after the edit Modal had returned it. `reloadAfterWrite` does three things in order. It waits out a navigation in flight (`navigating.to !== null && !navigating.willUnload`, then `await navigating.complete`, whose rejection on an aborted navigation is swallowed), because an `invalidateAll()` issued mid-navigation aborts that navigation. After a write whose outcome is unknown — a network error, with no status — it waits for the server: for the `online` event while offline, and otherwise by probing `fetch("/api/health", { cache: "no-store" })` with 2/4/8/16s backoff and then every 30s (`HEALTH_PROBE_BACKOFF_MS`), re-probing early on `online` and on `visibilitychange` → visible, and counting anything but `res.ok` as unreachable, because the service worker answers a failed GET with a synthetic 503. `online` alone is not enough: after a reset connection, or a PWA backgrounded mid-request, it may never fire. Then it runs `invalidateAll()`. **The lock stays held until that reload lands**: a retry against data nobody has checked is how a duplicate dose happens. Navigation still works meanwhile. A 409 reloads the whole document instead when `updated.current` is true (`kit.version.pollInterval` is 300s), because `invalidateAll` refreshes data, not JavaScript, and an installed PWA can stay open for days running code that posts an old shape. `applyAction` runs only for a `redirect`. Focus belongs to the primitive alone: on success it goes to the caller's `focusAfter`, else back to what was focused at the tap; after a failure it moves only if focus was lost (`isFocusLost`: `<body>`, a disconnected node, or inside `[data-toast-stack]`), and never onto a different dose's write button.
- **The Undo offer lives in `dose-writes/undo-registry.svelte.ts`, which holds at most ONE, and `Toast.svelte` renders it above the plain toasts.** A successful log offers a delete, posted with `forUndo=1` so a create's Undo skips the trash (D8); a successful delete offers a restore carrying the server's `(doseId, deletedAt)` handle. The next successful dose write replaces the offer, which is what removed the "which Undo?" ambiguity and the double click that landed on an older toast's Undo. Otherwise it stays until Undo settles, Dismiss is pressed, a submit for the same dose withdraws it, or its deadline passes — `expiresInMs − 30s` for a restore and `DOSE_UNDO_WINDOW_MS` for a create, both counted from `respondedAt` (the response's arrival, passed to `offerUndo`), never from the end of the reload after it, which has no upper bound and would let the offer outlive the server's window — and never on the 5s timer plain toasts keep, which a keyboard user on /log could not beat and WCAG 2.2.1 counts as a time limit. **A running offer is never replaced or withdrawn, by construction**: Undo takes the layout's lock with `hold()`, so no `acquire()` can succeed until its `extend()`. Toast reads that lock from context once, at init: it is mounted once, in the layout, and lives exactly as long as it, and `getContext` cannot run in a click handler (it throws `lifecycle_outside_component`). An offer never captures a lock, so an Undo pressed after navigating holds the lock the new page's controls read. Undo is refused while another write is `active`; offline it sends nothing and the offer stays and says so; after a network error it stays and becomes usable again once `reloadAfterWrite` finds the server, which is safe because restoring a restored dose succeeds with no change and deleting a deleted one is a 404. When it settles, focus goes to the offer's `focusTarget` (the restored row's ✎ or Edit), else to what was focused before focus entered the toast stack, else to the page's `h1` (`tabindex="-1"` on /log and /medications). The button reads "Undo" and is named "Undo" plus the message through `aria-labelledby`, with no sr-only text inside the `role="status"` region, so nothing is announced twice. **The `(app)` layout's `onDestroy` clears the registry and every plain toast** (`resetUndoRegistry`, `clearToasts`): a sign-out leaves `(app)`, and the next person to sign in on a shared device must never see an offer naming the previous person's medication. Every mutator is a no-op when `!browser`, like Toast's list, because module state is per-process during SSR.
```

- [ ] **Step 12: Extend the retention bullet**

In the line that begins ``- **`src/lib/server/retention.ts` owns every scheduled delete, and they run independently.**``, replace its final sentence:

```markdown
What does matter is the `preauth:` carve-out: `rate_limits` doubles as the single-use nonce ledger, so deleting a **live** row would let a captured 2FA challenge token mint a second session.
```

with:

```markdown
What does matter is the `preauth:` carve-out: `rate_limits` doubles as the single-use nonce ledger, so deleting a **live** row would let a captured 2FA challenge token mint a second session. The `dose-log-trash` policy calls `purgeExpiredTrash(db, { now })` from `doses.ts` with no user scope rather than restating its SQL; it runs alongside the on-write purges in `deleteDose` and `restoreDose`, not instead of them, and like them it skips rows another transaction holds.
```

- [ ] **Step 13: Add the lock-order and trash bullets to "Gotchas"**

Insert immediately before the line that begins ``- `scheduleType` / `scheduleIntervalHours` columns are marked DEPRECATED``:

```markdown
- **Lock order for dose and stock writes: medication rows first (ascending `id` when there are several), then dose or trash rows.** Every per-dose write — `logDose`, `logDoseForSlot`, `logDoseAtSlot`, both skip paths, `updateDose`, `deleteDose`, `restoreDose` — and every other writer of `medications.inventory_count` — `refillMedication`, `adjustInventory`, and `wipeDoseHistory` with `SELECT id … ORDER BY id FOR UPDATE` — locks the medication with `SELECT … FOR UPDATE` before it locks or writes anything else. The one read allowed ahead of it is the unlocked `medication_id` lookup in `deleteDose`, `updateDose` and `restoreDose`, because a dose's medication never changes. Three rules come with it. **Trash purges never wait**: every purge, on write or in retention, is `DELETE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` (`purgeExpiredTrash`), because a user-wide purge otherwise locks other medications' trash rows without their medication locks and closes a cycle with a wipe, a cascade or a restore; Postgres aborts one side with 40P01 and the user gets a 500. Anything a purge skips is purged later. **Clocks that order writes are read AFTER the lock**: `loggedAt` and `deletedAt` come from `new Date()` once the medication row is held, while `takenAt` keeps the action's `now`, because restore's since-delete guard compares the two and only clocks read under the lock follow commit order. **A count that feeds a write is read under the lock**: `refillMedication` and `adjustInventory` used to compute an absolute count from an unlocked read, so a log, delete or restore committing in between was overwritten (a refill reads 6, a restore takes 1, the refill writes 16 and mints one), and unguarded `logDose` could record an `inventoryApplied` larger than what left the bottle, which a later delete then minted. PGlite serialises transactions, so none of this can be raced in a test: cover the losing side by seeding the state it would see, and pin each lock's SQL through `pgDb.queryLog`.
- **A deleted dose moves to `dose_log_trash`, and Undo moves it back; `doses.ts` owns both directions.** `tests/unit/dose-log-trash-owners.test.ts` allows the identifier `doseLogTrash` in exactly `db/schema.ts`, `doses.ts` and `api/wipe.ts`, checked in both directions; `retention.ts` reaches the table only by calling `purgeExpiredTrash`, so the SKIP LOCKED SQL exists once. `deleteDose(userId, doseId, { keepForUndo })` deletes with `RETURNING` and **writes nothing else when no row comes back**: that is what stops two overlapping deletes (Remove racing an Undo, a second tab, the Mac app) crediting stock twice, and `RETURNING`'s committed after-image is why a Save that landed first is credited at its edited amount. The trash row copies every `dose_logs` column except `updatedAt` (`tests/unit/dose-log-trash-columns.test.ts` fails the moment the two drift), plus `inventoryCredited` and `deletedAt`. **`inventoryCredited` is what the delete actually gave back, not a copy of `inventoryApplied`**: the credit is skipped while `inventory_count` is NULL, so it is 0 when tracking was off, and without it a dose deleted with tracking off and restored after tracking came back on would take stock that was never returned. Restore therefore takes back `min(locked count, inventoryCredited)` through `takeFromStock`, the same `GREATEST(0, …)` clamp `insertTakenDose` uses — never `inventoryApplied`, never `quantity`. **The restore contract (D6):** the same id comes back with its original `loggedAt`; it is keyed on `(doseId, deletedAt)`, so an out-of-date Undo cannot reverse a newer delete; it is refused as `logged_since` (409) when any dose of that medication has `loggedAt > deletedAt`, because Remove 08:00, Log now at 08:40, then Undo would otherwise record two taken doses; and it is `gone` (410) once `deleted_at <= now − DOSE_UNDO_WINDOW_MS` — ten minutes, in `utils/dose-undo.ts`, which has no imports so server and client share it. It deletes **every** sync tombstone for the dose: the Mac app applies a delta's upserts before its tombstones, so one surviving tombstone deletes the restored dose there for good. `updateDose` re-reads the dose under the lock and returns null if it has gone, which also closes the ABA a same-id restore opens (Save read applied 3; Remove and Undo re-inserted the dose with a recomputed amount). **Deletes nobody can undo skip the trash (D8)**: `/api/v1 delete_dose`, since the Mac app has no Undo, and the delete behind a create's Undo (`forUndo=1`). Neither the `delete` nor the `restore` audit row carries a diff, so no note text reaches the synced, never-purged audit log. The trash is never exported, which is correct because re-importing a trashed dose would undo its delete, and `ON DELETE CASCADE` from `users` and `medications` clears it through account deletion, the archived-medication wipe and import replace mode, each of which already locks the medication first. The accepted cost is that deleted content stays on the server until the same user's next delete or restore, or the `dose-log-trash` retention policy, purges it; see ADR 0008.
```

- [ ] **Step 14: Bring the two test-seam bullets up to date**

In the line that begins ``- **`tests/unit/helpers/pg-db.ts` is the second backing``, replace:

```markdown
and fixtures seeded via `pgDb.seedUser/seedMedication/seedDose` in that order, because real Postgres enforces the cascade foreign keys `fake-db` ignored.
```

with:

```markdown
and fixtures seeded via `pgDb.seedUser` → `seedMedication` → `seedDose` / `seedTrash` / `seedTombstone`, in that order, because real Postgres enforces the cascade foreign keys `fake-db` ignored. PGlite runs one backend and serialises transactions, so no test there exercises a race; the lock-order gotcha says how the losing side is covered instead.
```

Then check whether the fake-db bullet's example file still exists:

Run: `test -f tests/unit/doses-inventory.test.ts && grep -c "fakeDb.attempted" tests/unit/doses-inventory.test.ts || echo "gone"`

- If it prints `gone` or `0` (Tasks 2 and 4 moved its cases to PGlite), then in the line that begins ``- **`tests/unit/helpers/fake-db.ts` owns the database seam for unit tests.**`` replace `` `doses-inventory` asserts on the first`` with `` `import-apply` asserts on the first``. `tests/unit/import-apply.test.ts` reads `fakeDb.attempted` and is untouched by this plan.
- If it prints a number above 0, leave the bullet as it is.

- [ ] **Step 15: Sweep for names this plan retired**

Run:

```bash
grep -rn -e "Undo skip" -e "UNDO_ACTION" -e "NETWORK_FAILURE_TOAST" -e "dashboard/dose-write-lock" -e "dashboard/focus-after" -e "dashboard/dose-action" -e "undoable" -e "can't be undone" -e "Confirm delete dose" -e "timeline-entry-delete-confirm" src tests | grep -v -e 'not "Undo skip"' -e 'Not "Undo skip"' -e "can't be undone/i" -e "no 'can't be undone'"
grep -rn -e "Undo skip" -e "is the only \`use:enhance\`" -e "Confirm delete dose" -e "DoseActionForm\`'s stale guard" CLAUDE.md docs/*.md docs/adr
```

Expected: no output from either. The first command's `grep -v` drops five lines on purpose: Task 10's reason for renaming Undo skip (the `// "Remove skip", not "Undo skip"` comment in `DoneList.svelte` and the `// Not "Undo skip"` comment in `tests/unit/done-list-ssr.test.ts`), and Task 12's assertions that the delete confirmation stays gone (`not.toMatch(/can't be undone/i)` in `tests/unit/timeline-entry-delete.test.ts`, and the `asks nothing: no confirmation group, no 'can't be undone', …` test with its `not.toMatch` in `tests/unit/timeline-entry-ssr.test.ts`). Never edit those lines. Fix anything else found in place. The one hit known at planning time is the comment in `src/lib/components/dashboard/dom-ids.ts`, which Task 10 Step 3 rewrites; if it still reads

```ts
/** DoneList's `<h2>`: focus lands here after Remove or Undo skip. Always rendered. */
```

replace it with Task 10's text:

```ts
/** DoneList's `<h2>`: focus lands here after Remove or Remove skip, and after an Undo restores a row with no Edit. Always rendered. */
```

`docs/superpowers/` holds dated plans and specs; leave its history alone.

- [ ] **Step 16: Commit the docs**

```bash
git add CLAUDE.md docs/adr/0008-undoable-deletes.md docs/adr/README.md docs/database.md docs/RUNBOOK.md docs/api-v1-contract.md docs/architecture.md
git add -u src tests
git commit -m "docs: record undoable deletes and the one client path for dose writes

- ADR 0008: the trash table over a signed client snapshot and a
  soft-delete column, with the panel's scores and the accepted cost.
- database.md: dose_log_trash, its owners and why inventory_credited
  exists. RUNBOOK: rolling back past migration 0021, and previews
  without the table.
- api-v1-contract: delete_dose is unchanged on the wire and not
  undoable; a dose tombstone can be withdrawn by a web Undo; eventType
  gains dose_restored (and the missing dose_quantity_updated); audit
  action gains restore.
- CLAUDE.md: the lock order, the trash and restore contract, the
  dose-writes single path with edit Save's exception, the Undo-offer
  rules, reloadAfterWrite instead of update(), and Took it at / Skip
  re-derived under the lock."
```

(`git add -u src tests` stages only the stale-comment fixes from Step 15, if there were any.) The commit message carries no Claude/AI attribution, no `Co-Authored-By` and no session link.

---

#### Cycle D — final verification

- [ ] **Step 17: Run every gate**

The baselines are the ones Task 1 Step 0 measured at `a9ad7d8`, which differs from `main`'s `a45ae5f` only by the spec document (`git diff --stat a45ae5f a9ad7d8` lists that one file): svelte-check `0 errors and 28 warnings`, eslint `0 errors, 115 warnings`.

Run: `npm run check 2>&1 | tail -3`
Expected: `svelte-check found 0 errors and M warnings in K files`, with M no higher than 28. Report both numbers — this branch's and the baseline's — in the PR. If you want to re-measure `main` independently:

```bash
git worktree add --detach /Users/jamiewhite/Documents/Personal/Projects/medication-tracker/.claude/worktrees/check-baseline a45ae5f
npm --prefix /Users/jamiewhite/Documents/Personal/Projects/medication-tracker/.claude/worktrees/check-baseline run check 2>&1 | tail -3
git worktree remove --force /Users/jamiewhite/Documents/Personal/Projects/medication-tracker/.claude/worktrees/check-baseline
```

(The temporary worktree sits beside this one, so it resolves packages from the main checkout's `node_modules` the same way.)

Run: `npm run lint`
Expected: exit 0, `0 errors`, and no more than 115 warnings. A new warning in a file this plan touched is fixed, not counted.

Run: `npx prettier --write CLAUDE.md docs/adr/0008-undoable-deletes.md docs/adr/README.md docs/database.md docs/RUNBOOK.md docs/api-v1-contract.md docs/architecture.md tests/e2e/dose-logging.test.ts`
Then run: `npm run format:check`
Expected: `All matched files use Prettier code style!` If the only files it still flags are under `docs/superpowers/` (this plan and its spec ship in the same PR), run `npx prettier --write` on those too and include them in the fix-up commit below.

Run: `npx vitest run`
Expected: PASS, 0 failed test files and 0 failed tests. Every PGlite file runs (the parent checkout's `node_modules` has `@electric-sql/pglite` 0.5.5); if one reports a failed import, run `npm install --no-save @electric-sql/pglite` outside the sandbox and re-run.

Run: `npm run build`
Expected: exit 0 (`✓ built` for client and server, then the Vercel adapter's output). A build failure that names a missing environment variable is environmental: confirm `main` fails the same way before treating it as this plan's.

If any gate needed a fix, commit it:

```bash
git add -A -- src tests docs CLAUDE.md
git commit -m "chore: fix lint, format and type findings for undoable dose actions"
```

(No Claude/AI attribution, no `Co-Authored-By`, no session link.)

- [ ] **Step 18: PR description (use when the PR is opened; do not push or open it unless asked)**

The body carries no Claude/AI attribution of any kind, including no "Generated with" line. Its testing section must say:

```markdown
## Not verified here

- **Browser.** Local dev 500s without `ENCRYPTION_KEY`, so none of this ran in a browser. Phone checklist:
  - one-tap delete on /log, then Undo;
  - Remove skip on the dashboard, then Undo;
  - the medications card's Log, then Undo;
  - Undo after navigating to another page;
  - Undo while offline, and again after airplane mode is switched off;
  - 1–9 with the edit dialog open (nothing should log);
  - holding a digit (one dose, not several).
- **e2e.** `tests/e2e/dose-logging.test.ts` was rewritten for the one-tap delete and gained an Undo test, but CI runs e2e only when the `RUN_E2E` repo variable is `true`, and it is not.

## Checks

- `npm run check`: 0 errors, M warnings (baseline at `a45ae5f`: 0 errors, 28 warnings).
- `npm run lint`, `npm run format:check`, `npx vitest run`, `npm run build`: all pass.

## Rollout

- Production's build runs `drizzle-kit push`, which only adds `dose_log_trash`, its index and two foreign keys.
- Preview deploys do not push the schema: on a preview without the table, web deletes, restore and Delete dose history fail, and the `dose-log-trash` retention policy logs a failure each tick (see RUNBOOK §4a).
- Rolling back leaves trash rows unpurged until the release rolls forward (RUNBOOK §3).
- Tabs loaded before this release run the old client, which neither polls for a new version nor checks `updated.current`. They keep getting a 409 for a Skip on a slot still ahead until they are reloaded by hand. Only tabs loaded from this release on reload themselves onto new code after a deploy (`kit.version.pollInterval`, `reloadDocumentIfUpdated()`).
```

Replace `M` with the measured warning count.
