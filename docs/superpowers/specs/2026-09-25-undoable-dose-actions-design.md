# Undoable, Single-Fire Dose Actions — Design

Priority 2 of the 2026-09-24 design critique:

> Make every dose action undoable and single-fire. Wire the existing Undo into log, skip and
> delete; disable buttons while they submit; reset Quick Log to 1 after logging; make the
> card's quick-log button visible.

The dashboard rebuild (#170) already did much of this for the dashboard. A 2026-09-25 audit
of `main` at a45ae5f found what is still missing:

- **Deletes cannot be undone anywhere.** Undo covers creates only.
- **The /medications card's Log has no Undo.**
- **Some dose writes can still fire twice**, and several paths can mint stock.

This spec closes those gaps and four #170 follow-ups from the same family. The largest piece
is a server-side **restore**, since `deleteDose` hard-deletes the row.

## What is broken, with evidence

**Already done on `main`:**

- Undo on Log now, Took it at, Skip, the Quick Log chips and the 1–9 shortcuts
  (`DueCard.svelte:125,140,153`, `QuickLogBar.svelte:98`).
- A page-wide write lock on the dashboard (`dose-write-lock.svelte.ts`, 700ms cooldown).
- Quick Log resets to 1 after a successful log (`QuickLogBar.svelte:100`).
- The medication card's Log button is always visible and 44px (`MedicationCard.svelte:223-251`).

**Still open:**

1. **No delete can be undone.**
   - `deleteDose` hard-deletes the row and writes a sync tombstone (`doses.ts:467-533`).
     Nothing can put it back.
   - The affected controls:
     - the dashboard edit dialog's **Remove this dose** (`dashboard/+page.svelte:205-214`);
     - Done's **Undo skip** and missed-entry **Remove** (`DoneList.svelte:110-120`);
     - the /log **×** (`TimelineEntry.svelte`).
   - The /log × guards itself with an inline "Delete this dose? This can't be undone."
     confirmation. That confirmation exists only because there is no undo
     (`TimelineEntry.svelte:25-36`).
   - The dashboard's Remove paths have neither a confirmation nor an Undo.
2. **The medications card's Log has no Undo.**
   - It `fetch`es `/dashboard?/logDose` and ignores the `doseId` the action returns
     (`MedicationCard.svelte:70-101`).
   - A network failure shows a generic "try again", which invites a duplicate log.
3. **A double delete gives stock back twice.**
   - `deleteDose` reads the row outside its transaction, without a lock (`doses.ts:468-472`).
   - It deletes without checking the row count (`:481`), then always credits
     `inventoryApplied ?? quantity` (`:496-509`).
   - So two overlapping deletes of one dose both credit the stock. Ways in: Remove racing
     the toast's Undo (Undo takes the lock unconditionally), a second tab, or the Mac app's
     `delete_dose` (`api/commands.ts:88-91`).
   - Afterwards the ledger reconciles _with_ the mint, so it can't be detected later.
4. **Edit Save races Remove.**
   - `DoseEditForm` has its own enhance and sits outside the lock.
   - `updateDose` also reads the dose outside its transaction (`doses.ts:545-549`).
   - If Remove commits inside Save's transaction, `computeChanges(existing, undefined)` throws
     and the request 500s.
   - If Save commits first, Remove's stale read gives back the pre-edit applied amount.
5. **Unguarded `logDose` reads stock without a lock** (`doses.ts:219-230`). The chips and the
   Mac app use this path.
   - A concurrent stock writer can make a dose record an `inventoryApplied` larger than what
     actually left the bottle, and a later delete then mints the difference.
6. **Stale second device (#170 follow-up).**
   - Took it at and Skip refuse only a row at the _exact_ posted instant (`doses.ts:233-261`,
     `:292-330`).
   - Example: phone A presses Log now at 08:40 for the 08:00 slot. Laptop B's stale page
     still offers "Took it at 08:00". B's tap inserts a second taken dose and decrements stock
     again.
   - For a slot still ahead, Skip posts the page's render-time "now", so two devices never
     collide on the instant.
7. **The error branch reloads while offline (#170 follow-up).**
   - `DoseActionForm`'s `error` branch and Undo's network catch both call `invalidateAll`
     (`DoseActionForm.svelte:113-117,183-186`).
   - Offline, that falls back to a native navigation. The service worker answers it with the
     "Offline" page, and the toast is lost with the page.
8. **Focus is lost (#170 follow-up).**
   - Undo: clicking it removes the focused button (`Toast.svelte:128-136`).
   - A 409 or error result: `DoseActionForm.svelte:177-186` never moves focus.
   - The last dose of a day on /log: after it is deleted, focus stays on `<body>`.
   - Edit Save: `update()`'s `reset_focus` sends focus to `<body>` after the Modal has
     restored it.
9. **Keys fire twice or through a dialog.**
   - `KeyboardShortcuts` has no `e.repeat` check, so holding a digit logs again once the
     700ms cooldown ends.
   - Its only guard is `isControlFocused`, which excludes `[tabindex="-1"]`. The Modal panel
     is `tabindex="-1"` (`Modal.svelte:77-80`), so 1–9 and `n` fire behind the open edit
     dialog (`KeyboardShortcuts.svelte:20-27,59,84-97`).
10. **An Undo after navigating holds a dead lock.**
    - The toast outlives the page, but `undoDose` holds the lock of the dashboard instance
      that rendered it (`DoseActionForm.svelte:61,100`).
    - The page navigated to has a different lock, so its controls stay live while that Undo
      is in flight.
11. **Several Undo toasts are indistinguishable.**
    - Every Undo button is named "Undo".
    - A double click can land on an older toast's Undo once the newer toast is dismissed.
    - The 5s timer runs out before a keyboard user on /log can tab past the page to reach it.
12. **Chip segments are 42px (#170 follow-up).** The Quick Log `li` is `h-11` with a 1px
    border under `border-box` and `overflow-hidden`, so its 44px segments are clipped to 42px
    (`QuickLogBar.svelte:73`).
13. **Refill and adjust overwrite concurrent stock changes.**
    - `refillMedication` and `adjustInventory` read `inventory_count` without a lock, then
      write an absolute value (`inventory-events.ts:113-130,166-186`).
    - A log, delete or restore that commits between the read and the write is lost. For
      example: a refill reads 6; a restore takes 1, leaving 5; the refill writes 16, minting
      one unit.
    - The web Refill/Adjust UI and the Mac app's `refill` / `adjust_inventory` commands both
      use these paths, and the restore below adds another writer they can race.

## Decisions

Made with the user on 2026-09-25. Each constrains everything below.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Scope: the core items plus the #170 follow-ups.**<br>• Undo for every delete (dashboard Remove, Done's skip/missed removal, the /log ×) and for the medications card's Log.<br>• The single-fire and stock-integrity gaps: items 3, 4, 5, 9, 10, 11 and 13.<br>• The four #170 follow-ups: items 6, 7, 8 and 12.<br>• **Two small additions found during design**, each needed for a guarantee made here:<br> – The medications ↑/↓ reorder takes the write lock, so a Log tap cannot land on a card that just moved.<br> – Version polling, so a tab running pre-deploy code reloads itself instead of repeating a refused Skip (Section 2).<br>Settings wipes, import and account deletion are **not** in scope. |
| D2  | **/log: Undo replaces the confirmation.** × deletes at once and the toast offers Undo, the same as the dashboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D3  | **Edits get no Undo.** An edit can simply be edited again, and reverting one has a lost-update hazard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D4  | **Restore mechanism: a trash table.** It was chosen over a signed client snapshot and a soft-delete column by a three-lens judge panel (integrity 7.5 / 6 / 6.5; sync-privacy-ops 7 / 8.5 / 4.5; cost-testability 8 / 6 / 4).<br>• It is the only design where restoring exactly reverses the delete's stock change in every tracking state.<br>• No reader of `dose_logs` changes.<br>• Accepted cost: deleted content stays on the server until it is purged.                                                                                                                                                                                                                                                      |
| D5  | **An Undo offer stays until you act on it.** It goes when you press Undo, dismiss it, make another dose write (which replaces it), or it is withdrawn, with a 10-minute cap. Only one offer exists at a time. Plain toasts keep 5s. This meets WCAG 2.2.1 without depending on the hover/focus hold.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D6  | **Restore contract.**<br>• A restore puts back the **same id**.<br>• It is keyed on `(doseId, deletedAt)`, so an out-of-date Undo cannot reverse a newer delete.<br>• It is refused if anything was logged for that medication after the delete.<br>• The server-side window is **10 minutes**.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D7  | **Lock order.** Every per-dose write, and every writer of `medications.inventory_count`, takes **medication rows first (ascending id when more than one), then dose or trash rows**.<br>• Trash purges never wait: they skip locked rows.<br>• Clocks that order writes (`loggedAt`, `deletedAt`) are read **after** the medication lock is taken.                                                                                                                                                                                                                                                                                                                                                                   |
| D8  | **Deletes nobody can undo skip the trash.** That covers the Mac app's `delete_dose` (it has no Undo) and the delete behind a _create's_ Undo (the result is a plain "Undone"). A trash row there would only linger. The Mac wire shape is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D9  | **Took it at, Skip and Log now all re-derive `slotActions` under the medication lock.**<br>• Skip posts `forSlot`.<br>• For one release, a pre-deploy page's `takenAt`-only Skip is still accepted when it names a past slot; otherwise it gets a 409.<br>• Version polling reloads a stale tab on a 409.                                                                                                                                                                                                                                                                                                                                                                                                            |
| D10 | **One write lock, owned by the `(app)` layout.**<br>• A shared client primitive, `createDoseWrite`, is the only path for dose writes on every page. The exception is edit Save, which keeps its own enhance for inline field errors but takes the same lock, the same offline gate, the same Undo withdrawal and the same reload.<br>• Nothing calls enhance's `update()`.                                                                                                                                                                                                                                                                                                                                           |

## Section 1 — Delete, trash and restore (server)

### The table

`dose_log_trash`, added by migration `0021` from `drizzle-kit generate`. That produces the
SQL, the `_journal.json` entry and the snapshot; PGlite skips any migration with no journal
entry.

- **Every `dose_logs` column except `updatedAt`:**
  - `id` (primary key: the deleted dose's own id);
  - `userId`, `medicationId`, `quantity`, `inventoryApplied`, `takenAt`, `loggedAt`, `notes`,
    `sideEffects`, `status`.
- **`inventoryCredited integer NOT NULL`:** what the delete actually gave back to stock. It
  is **not** a copy of `inventoryApplied`. The credit is skipped when
  `medications.inventory_count` is NULL (`doses.ts:507`), so it is 0 when tracking was off.
  Without this column, a dose deleted while tracking was off and restored after tracking came
  back on would take stock that was never given back.
- **`deletedAt timestamptz NOT NULL`:** written from the **app clock**, read after the
  medication lock (D7). Tests can control it, and it compares correctly with `loggedAt`.
- **Foreign keys:** `userId` and `medicationId` both reference their tables with
  `ON DELETE CASCADE`. Three paths then clean up with no extra code, and they already lock the
  medication before the cascade reaches the trash, so they follow D7:
  - the archived-medication wipe (`api/wipe.ts:42`);
  - import replace mode (`import/apply.ts:58`);
  - account deletion.
- **Index:** `(user_id, deleted_at)`, for the purges.

**What production and the Mac app see:**

- The `drizzle-kit push` in the production build only adds a table, an index and two foreign
  keys. There is no backfill and nothing destructive.
- `InventoryEventType` gains `"dose_restored"`. That value has four homes:
  - the TS union in `schema.ts`;
  - the import zod enum (`validation.ts:608-615`), without which a re-imported backup skips
    those events;
  - the history labels (`medications/[id]/+page.svelte:14-21`);
  - the `eventType` list in `docs/api-v1-contract.md:351`.
- `logAudit`'s action union gains `"restore"`.
- The Mac app decodes both fields as `String`, so its wire format does not change.

`DOSE_UNDO_WINDOW_MS = 10 * 60_000` lives in `src/lib/utils/dose-undo.ts`. The module has no
imports, so both the server and the client can read the one constant.

**Validation.** `src/lib/utils/validation.ts` gains two schemas:

- `doseIdSchema = z.object({ doseId: z.string().min(1).max(64) })`;
- `doseRestoreSchema = doseIdSchema.extend({ deletedAt: z.string().datetime() })`.

### Deleting a dose

```ts
deleteDose(
  userId: string,
  doseId: string,
  opts: { keepForUndo: boolean; now?: Date },
): Promise<{ doseId: string; medicationId: string; deletedAt: Date } | null>
```

All steps run in one transaction:

1. **Read the dose's `medication_id`.** No lock is needed, because `medicationId` never
   changes. If there is no row, return `null`.
2. **Lock the medication:** `SELECT inventory_count … FOR UPDATE`. That gives the exact
   `previousCount`. Then read the clock: `now = opts.now ?? new Date()`.
3. **Delete the dose:** `DELETE FROM dose_logs WHERE id = $d AND user_id = $u RETURNING *`.
   - **If no row comes back, return `null` and write nothing else.**
   - This is the fix for item 3. A second, overlapping delete waits on the first one's
     locks, then finds nothing to delete.
   - `RETURNING` gives the committed after-image, so a Save that committed first is credited
     at its edited applied amount (item 4).
4. **Give the stock back** (taken doses only), with `applied = inventoryApplied ?? quantity`:
   - Increment `inventory_count` by `applied`, only where the count is not NULL.
   - If `previousCount` is not NULL: `credited = applied`, and write the `dose_deleted`
     event as today.
   - Otherwise `credited = 0`.
5. **Put the row in the trash**, if `keepForUndo` is set:
   - run the non-blocking purge of this user's expired trash rows (below);
   - insert the trash row, with `inventoryCredited: credited` and `deletedAt: now`.
6. **Tombstone and audit:** write the sync tombstone and the `delete` audit row, as today.
   The audit row carries no diff.

**The non-blocking purge.** Every on-write and retention purge is:

```sql
DELETE FROM dose_log_trash
WHERE id IN (
  SELECT id FROM dose_log_trash
  WHERE user_id = $u AND deleted_at <= $cutoff
  FOR UPDATE SKIP LOCKED
)
```

Retention runs it with no `user_id` predicate. A purge that never waits cannot close a lock
cycle with a restore, a wipe or a cascade. Anything it skips is purged later.

**Callers.** One shared helper, `deleteDoseAction(locals, request)` in
`src/lib/server/dose-actions.ts`, serves both the dashboard and /log delete actions:

- It opens with the 401 guard, then parses `doseIdSchema`.
- A parse failure keeps today's `fail(400, { error: "Missing dose ID" })`.
- An optional `forUndo=1` field means "this delete is a create's Undo", which gets
  `keepForUndo: false` (D8). Otherwise it is `keepForUndo: true`.
- Its responses:
  - `keepForUndo: true` →
    `{ success: true, doseId, restore: { deletedAt: <iso>, expiresInMs: DOSE_UNDO_WINDOW_MS } }`;
  - `forUndo` → `{ success: true, doseId }`, with no `restore`;
  - `null` → `fail(404, { error: "Dose not found" })`.

`/api/v1 delete_dose` passes `keepForUndo: false` and returns `{ deleted: result !== null }`.
Its frozen wire shape is unchanged.

### Restoring a dose

```ts
restoreDose(
  userId: string,
  doseId: string,
  deletedAt: Date,
  now?: Date,
): Promise<"restored" | "already_restored" | "gone" | "logged_since">
```

All steps run in one transaction:

1. **Find the trash row.** Read `medication_id` from `dose_log_trash`
   `WHERE id AND user_id AND deleted_at = $deletedAt`, without a lock.
   - If there is none: return `already_restored` if `(id, user)` is live in `dose_logs`,
     otherwise `gone`.
   - `deletedAt` round-trips exactly. It was written from a JS `Date`, so it carries
     milliseconds and zero microseconds, and the client posts the ISO string it was sent.
2. **Lock the medication**, reading `inventory_count`. Read the clock after the lock:
   `now = now ?? new Date()`.
3. **Lock the trash row:** `SELECT … FOR UPDATE` with the same predicate.
   - If there is none (a concurrent restore took it), apply step 1's rule again.
4. **Check the window.** If `deleted_at <= now − window`, delete the row and return `gone`.
5. **Since-delete guard.** If any `dose_logs` row for this user and medication has
   `logged_at > trash.deleted_at`, return `logged_since` and leave the trash row in place.
   - Both clocks are the app clock, and both are read after the medication lock (D7). Writes
     to one medication are serialised, so clock order matches commit order. The only
     exception is clock skew between server instances.
   - This refuses the case where you Remove 08:00, press Log now at 08:40, then press Undo.
     Restoring there would record two taken doses and take stock twice.
   - Two deletes undone newest-first both restore. A restored row keeps its original
     `loggedAt`, so the first restore does not block the second.
6. **Delete the trash row.**
7. **Take the stock again** (taken doses only), using the count read in step 2:
   - `reapplied = count === null ? 0 : min(count, inventoryCredited)`.
   - `UPDATE … SET inventory_count = GREATEST(0, inventory_count − reapplied)` where the
     count is not NULL.
   - If the count was not NULL, write a `dose_restored` event with `−reapplied`.
   - This clamp is the same as `insertTakenDose`'s (`doses.ts:145-146`). Extract it into one
     helper that both functions call.
8. **Re-insert the dose** into `dose_logs`:
   - the same `id` and every stored field, including the original `loggedAt`;
   - `inventoryApplied`: `reapplied` for a taken dose, or the stored value for a skip or a
     missed entry;
   - `updatedAt: now`.
9. **Delete every sync tombstone** for `(userId, 'dose_log', id)`. The table has no
   uniqueness (`schema.ts:423-435`), so there may be more than one.
10. **Purge and audit:** run the non-blocking purge for this user, then write a `restore`
    audit row with no diff, so no note text reaches the synced, never-purged audit log.

**Why the Mac app ends up correct.** It upserts doses, then applies tombstones, within one
delta (`SyncApplier.swift:103-134`).

- **It has already pulled the tombstone:** the next delta carries the dose (its `updatedAt`
  is after the cursor) and no tombstone, so the dose comes back.
- **Its cursor predates the delete:** it receives the dose and no tombstone. It never
  deletes the dose locally.
- **A tombstone survived the restore:** the upsert-then-delete order would lose the dose
  permanently. That is why step 9 deletes all of them.

**The `restoreDose` action** is a new action on the dashboard route, posted to the absolute
`/dashboard?/restoreDose` so it works from any page and after navigating away, like the
existing Undo.

- It opens with the 401 guard.
- It parses `doseRestoreSchema`.
- It maps each outcome:
  - `restored` / `already_restored` → `{ success: true, doseId }`;
  - `gone` → `fail(410, { error: "Too late to undo. Log it again if you need it." })`;
  - `logged_since` →
    `fail(409, { error: "A newer entry exists for this medication, so Undo wasn't applied." })`.

### Other writers of doses and stock

- **`updateDose`:**
  1. Read `medication_id` without a lock (it never changes). If there is none, return `null`.
  2. Lock the medication.
  3. `SELECT … FROM dose_logs … FOR UPDATE`. If the dose is gone, return `null` before
     `inventoryWrite` or `computeChanges` run.
  4. Continue as today, computing from this locked read.
  - This closes both orderings of item 4. It also closes an ABA case that same-id restore
    would otherwise open: Save reads applied 3; Remove and Undo re-insert the dose with a
    recomputed applied amount; Save then diffs against the stale 3.
- **Every dose insert reads the clock after the lock.** Unguarded `logDose` (the chips and the
  Mac app) always locks the medication before reading the count (item 5). All inserts
  (`logDose`, `logDoseForSlot`, `logDoseAtSlot`, both skip paths) set `loggedAt` from a clock
  read after the lock. `takenAt` keeps the action's `now`.
- **`refillMedication` and `adjustInventory`** read the medication `FOR UPDATE` before
  computing the new count (item 13).
- **The fake-db cases that cover these paths move to PGlite.** That means
  `doses-inventory.test.ts` for `deleteDose`, `updateDose` and `logDose`, and
  `inventory-events.test.ts` for refill and adjust. The fake has no select `.for()` and must
  not grow one.

### Privacy and retention

- **`wipeDoseHistory`** follows D7:
  1. It first locks the user's medications (`SELECT id … ORDER BY id FOR UPDATE`). That
     serialises it against every in-flight delete and restore.
  2. `DELETE dose_logs`.
  3. It deletes the user's trash rows.

  A `queryLog` test pins that order.

- **Retention:** a new `dose-log-trash` policy in `RETENTION_POLICIES` runs the non-blocking
  purge for rows older than the window. It runs in addition to the on-write purges.
- **Exports:** the JSON backup, CSV, PDF and privacy-page counts read only `dose_logs`, so the
  trash is never exported. That is correct, because re-importing a trashed dose would undo
  its delete.
- **Accepted cost:** after a delete, the content stays on the server until one of these runs:
  the user's next delete, their next restore, or the retention sweep. The GitHub
  `reminder-tick` schedule is `*/30 6-22` UTC, so an overnight delete can linger for about
  7.5h. With both schedulers down, it lingers until the next delete or restore. Neon PR
  branches copy whatever trash exists when they are created.

### Known and accepted

- **Reminders during an undo gap.** A reminder sweep that runs between a delete and its Undo
  can send one overdue reminder, and cannot unsend it. Or the delete's credit can close a
  low-inventory episode that the restore then reopens, sending one extra alert.
- **Edits and imports during the window.** The since-delete guard looks only at `loggedAt`.
  - An edit that moves another dose onto the deleted one's slot is invisible to it. The
    client closes the common case, because any successful write clears the current offer
    (Section 3), but a second device can still do it.
  - An import writes rows with old `loggedAt` values, so the guard cannot see those either.
- **Clock skew between server instances** can reorder `loggedAt` against `deletedAt` by that
  skew.
- **Stock on the Mac app.** Web dose writes do not bump `medications.updatedAt`, so the Mac
  app never learns about stock changed by a web log, delete or restore. This predates this
  work; see Follow-ups.
- **Sync cursor race.** The cursor is read before non-snapshot queries (`sync.ts:62`), so a
  restore that commits during a sync can be missed until a full resync. This predates this
  work and affects every write.

## Section 2 — Took it at and Skip are re-derived under the lock

Log now's in-transaction recompute (`doses.ts:381-452`) becomes one helper:

```ts
recomputeSlotActions(
  tx,
  med,               // the row read under FOR UPDATE
  userId: string,
  now: Date,
  timezone: string,
): Promise<SlotActions>
```

It reads the schedules, the window's doses and the all-time last taken dose, then runs the
same `projectFixedTimes` / `slotActions` the page load ran. The three guarded dashboard
writes all use it:

- **Log now** (`logDoseForSlot`): unchanged apart from the extraction.
- **Took it at**, a new
  `logDoseAtSlot(userId, medicationId, slot, notes, sideEffects, now, timezone)`:
  1. Lock the medication. Not found → `MedicationNotFoundError`; archived →
     `SlotTargetChangedError`.
  2. **Exact-instant check** (today's check, kept so a double tap still gets the specific
     message): if a taken dose already exists at `slot`, throw `SlotAlreadyTakenError`.
  3. **Recompute** the slot actions.
  4. Unless `rows.get(slotIso)?.tookItAt === slotIso`, throw `SlotTargetChangedError`.
  5. Otherwise call `insertTakenDose` at `slot`, with the locked count.
  - **Always ×1**, like Log now. The simulation proves a probe of quantity 1, and a larger
    dose could resolve rows it never checked. The Due card already posts `quantity=1`; the
    action ignores the posted value on this path.
  - **One behaviour changes:** Took it at on a slot a skip has already resolved is now
    refused, because a resolved slot is not in `rows`. To take it, remove the skip first.
    Today the insert goes through: taken beats skip.
  - The client does not change: it already posts the slot's own instant as `takenAt`.
  - The action's `checkSlotActionTime` pre-check stays, and still answers "future" with a 400.
- **Skip**, a new `skipDoseForSlot(userId, medicationId, forSlot, now, timezone)`:
  1. Lock the medication (the same not-found and archived rules apply).
  2. Recompute, and take `skipAt = rows.get(forSlotIso)?.skipAt`.
  3. If it is `null`, throw `SlotTargetChangedError`.
  4. Otherwise insert the skip at `skipAt`: the **server's** `min(slot, now)`, which is the
     instant the simulation proved.
  - A slot that is not open, or is off the dashboard, is not in `rows`, so no separate
    pre-check is needed. `checkSlotActionTime` would wrongly answer "future" for a due-now
    slot that is still ahead.
- **The Skip client:** `DueCard` posts `{ medicationId, forSlot: row.expectedTime }` instead
  of `{ medicationId, takenAt: row.skipAt }`. It still renders Skip only when
  `row.skipAt !== null`.
- **`doseSkipSchema`** gains `forSlot: z.string().datetime().optional()` and
  `.refine(d => !(d.takenAt && d.forSlot), { path: ["forSlot"] })`, mirroring `doseLogSchema`.
- **The `skipDose` action:**
  - with `forSlot` → `skipDoseForSlot`;
  - with `takenAt` and no `forSlot` → this is a page loaded before the deploy. For one
    release, recompute under the lock and accept it when
    `rows.get(takenAt)?.skipAt === takenAt`. That is the past-slot case, where the old page's
    `skipAt` is exactly the slot instant. Otherwise return a 409 with `SLOT_TARGET_CHANGED`.
  - with neither → the legacy skip-at-now, unchanged.
- **Version polling.**
  - `svelte.config.js` sets `kit.version.pollInterval: 300_000`.
  - When the client gets a 409 and `updated.current` (from `$app/state`) is true, it calls
    `location.reload()` instead of `invalidateAll`.
  - A tab running old code otherwise keeps posting the old shape. `invalidateAll` refreshes
    data, not JavaScript, and an installed PWA can stay open for days.

`exactInstantGuard` is removed from `logDose` and `logSkippedDose`, because the new functions
replace it. `/api/v1 log_dose` / `skip_dose` never used it.

## Section 3 — One dose-write path on every page (client)

### The lock moves to the layout

- `(app)/+layout.svelte` creates the lock with `createDoseWriteLock()`, **once per layout
  instance**, and calls `setDoseWriteLock`. It must not be module state: that is per-process
  during SSR (`Toast.svelte:11-19`). The dashboard stops creating its own.
- Every dose control on every page reads this lock: the dashboard's forms, the /log ×, the
  medications card's Log, edit Save and the toast's Undo. Toast reads it from the layout's
  context **at press time**, and offers never capture a lock. An Undo pressed after
  navigating therefore holds the lock the current page reads (item 10).
- The medications page's ↑/↓ reorder takes the lock too: the `reorder` enhance callback at
  `medications/+page.svelte:20-47` and the forms at `:84-109`. It moves the keyed cards, so a
  tap on Log could otherwise land on a different card.
- **A new `readonly active: boolean` on `DoseWriteLock`** means `holders > 0`, as distinct
  from `busy`, which is also true during the cooldown.
- **A write still in flight at navigation** keeps the next page's controls `aria-disabled`
  until it settles. There is no watchdog: freeing the lock under an unresolved write is
  exactly the double write the lock prevents.
- **Refused taps.** When `acquire()` is refused while `lock.active` is true, show one polite
  toast per write: "Still saving your last change…". A refused 1–9 press otherwise gives no
  feedback, because that button is not focused. A tap refused during the cooldown alone
  shows nothing.

### The primitive

DoseActionForm's `submit` and `undoDose` move out into
`src/lib/components/dose-writes/dose-write.svelte.ts`, together with the lock, copy and focus
modules:

```ts
createDoseWrite(getOptions: () => DoseWriteOptions): {
  submit: SubmitFunction;
  readonly pending: boolean;
  readonly busy: boolean;
  onkeydown: (e: KeyboardEvent) => void; // held Enter fires once
}

interface DoseWriteOptions {
  staleGuard?: DashboardClock;
  undo?: { kind: "delete" | "restore"; focusTarget: () => HTMLElement | null };
  withdrawsUndoFor?: string; // the doseId this write acts on
  buildToast?: (doseId: string | null) => string | null;
  focusAfter?: () => HTMLElement | null;
  busyContainer?: HTMLElement | null;
  onSuccess?: () => void;
}
```

The options are read **at submit time**, the same rule as today
(`DoseActionForm.svelte:141-147`).

- **`staleGuard`.** Only dashboard controls pass it, so /log and /medications have no guard
  by construction.
  - `createDashboardClock` is seeded from the page payload **without arming its timer**.
    It then can't be silently `NaN`, and it can't leak an SSR `setTimeout`.
  - The guard becomes `clock.isExpired()`.
- **`undo`** replaces `undoable`.
  - A create's Undo deletes the new dose, posting `forUndo=1` (D8).
  - A delete's Undo restores it, using the `restore` handle from the response.
  - `focusTarget` is where focus goes after the Undo (Section 4). Each surface supplies its
    own.

**Submit order.** Each step can stop the write:

1. **Offline gate.** If `navigator.onLine === false`: cancel, toast "You're offline —
   nothing was saved.", take no lock.
2. **`acquire()`.** If it is refused: cancel, and show the "Still saving…" toast when
   `lock.active`.
3. **Stale guard**, when there is one. On a hit it keeps its existing "hold the lock
   through the refresh" behaviour, but the refresh goes through `reloadAfterWrite`.
4. **Withdraw** the current Undo offer if it names `withdrawsUndoFor`. This runs only after
   the write is certain to be sent, so a refused tap never deletes the user's Undo.
5. **POST.**

**On the result:**

- **Success.**
  1. `reloadAfterWrite()`.
  2. The toast. Any remaining offer is cleared first; a create or a delete then puts up its
     own offer.
  3. Focus.
  4. `onSuccess`.
  5. Release.
- **Failure (4xx).**
  1. Toast `actionErrorMessage(result)`.
  2. A 409 reloads through `reloadAfterWrite()` (or reloads the document when
     `updated.current`).
  3. `focusAfter` under the only-if-lost rule.
  4. Release.
- **`error` with a status (5xx, 401).**
  1. Toast `actionErrorMessage(result)`.
  2. `reloadAfterWrite()`.
  3. Focus.
  4. Release.
- **`error` with no status (a network error).** The outcome is unknown.
  1. Toast "Couldn't confirm that saved — this page will update when the connection is
     back." One sentence for every page, because the page now does update itself.
  2. `reloadAfterWrite()` defers until the server is reachable, **and the lock stays held
     until that reload lands**. A retry against data nobody has checked is how a
     duplicate dose happens. Navigation still works while it waits.

**`reloadAfterWrite()`.** Nothing calls `update()`.

1. **Wait for a navigation in flight.** If one is running
   (`navigating.to !== null && !navigating.willUnload`, from `$app/state`),
   `await navigating.complete?.catch(() => {})`. An aborted navigation rejects, which is not
   an error here. Any `invalidateAll` issued mid-navigation aborts that navigation
   (kit `client.js:425` sets a new token; `:1809` aborts on the mismatch).
2. **Wait for the server, if the write failed on the network.**
   - If `navigator.onLine === false`, wait for the `online` event.
   - After a network error while `navigator.onLine` is true, the `online` event may never
     fire (a reset connection, a PWA backgrounded mid-request). So poll
     `fetch("/api/health", { cache: "no-store" })` with backoff: 2s, 4s, 8s, 16s, then every
     30s. Also re-check on `online` and on `visibilitychange` → visible.
   - Treat anything but `res.ok` as unreachable. The service worker answers a failed GET with
     a synthetic `503 Offline` (`service-worker.ts:50-53`).
3. **Reload.** `await invalidateAll()`.
4. **Redirects.** Call `applyAction(result)` only for a `redirect`.

Why not `update()`?

- `update()` applies a result only while the action's path matches the page the user is on
  when the result arrives (kit `forms.js:109-116`). Once dose writes post across routes (the
  card's form, a restore from any page), it would drop off-route failures silently.
- It would also run `reset_focus` on whichever page matches.
- None of these pages reads `form` for a dose action, so nothing is lost.

The primitive therefore **shows every failure itself** and **owns focus entirely**.

### Per surface

- **Dashboard Due cards, chips and 1–9.**
  - The markup is unchanged apart from Skip's fields (Section 2). `DoseActionForm` becomes
    the dashboard's markup over the primitive.
  - Creates pass `undo: { kind: "delete", focusTarget }`:
    - a chip's target is its own button, if it is still connected;
    - a Due card's target is `focusTargetAfterResolve(key, following)`, or the `h1`.
  - `QuickLogBar`'s `onSuccess` reset to 1 is unchanged. It never depended on `update()`.
- **Dashboard Remove (edit dialog) and Done's skip and missed-entry removal.**
  - These pass `undo: { kind: "restore", focusTarget }`.
  - Done's `<li>` gains `data-dose-id`. The target is the restored row's Edit, or the Done
    heading when that row's only control is a write.
  - Done's "Undo skip" is renamed **"Remove skip"**. With an Undo button on every offer,
    "click Undo" would otherwise be ambiguous for voice control.
  - Toasts:
    - "Metformin 500mg: skip removed"
    - "Metformin 500mg: missed entry removed"
    - "Dose removed: Metformin 500mg at 08:00"
- **/log `TimelineEntry`.**
  - **Deleted:**
    - the `deleting`/`confirming` state;
    - the confirm button and group refs, and `confirmId`;
    - `openConfirm`, `closeConfirm`, `onConfirmKeydown` and `neighbourRow`;
    - the `{#if confirming}` block (`TimelineEntry.svelte:218-303`).
  - **Kept:** `takenTime` (`:45-48`), which builds the ✎ and × names.
  - × becomes a submit inside `<form action="?/deleteDose">`, through the primitive:
    - its name stays "Delete dose of X at T";
    - its targets stay 32px, or 44px on touch;
    - it uses `aria-disabled` instead of `disabled`.
  - × renders `type="button"` until the component mounts. A tap before hydration still does
    nothing, as today, instead of deleting with no Undo.
  - **A new prop, `dayLabel: string | null`,** carries the group label from
    `log/+page.svelte:150-178` (null for today). The toast is "Dose removed: Paracetamol
    500mg at 08:00", or "…on Tue 23 Sep at 08:00" for an older day. The e2e `/dose removed/i`
    still matches.
  - Rows carry `data-dose-id`. The ✎ carries `data-edit`.
  - The undo target is the restored row's ✎.
- **/medications `MedicationCard`.**
  - The `fetch` becomes `<form method="POST" action="/dashboard?/logDose">`, through the
    primitive, with `undo: { kind: "delete", focusTarget: () => logButton }`.
  - The form is the flex item: `mt-4 mr-4 shrink-0 self-start`.
  - The button keeps:
    - `relative z-10`, which keeps it above the card link's stretched `::after`;
    - `aria-label="Log a dose of X"`;
    - the 44px size;
    - the invisible-label spinner, now driven by `pending`.
  - It is also `type="button"` until mounted.
  - **New props: `timezone` and `timeFormat`,** passed from the layout data's
    `data.user.timezone` and `data.preferences.timeFormat`. The toast formats the response
    arrival time with `formatUserTime`: "Paracetamol 500mg logged at 13:31".
- **Edit dialog Save (`DoseEditForm`, shared by /log and the dashboard).**
  - It keeps its own enhance, because of its inline field errors.
  - It gets the same offline gate and `acquire()` as the primitive: it cancels if the lock is
    busy, and releases after the reload. Save and Remove therefore exclude each other.
  - It uses `aria-disabled` instead of `disabled={loading}`.
  - At submit it withdraws the offer if that offer names this dose. On success it clears
    any remaining offer, because an edit can move a dose onto a deleted one's slot.
  - It swaps `update()` for `reloadAfterWrite()`, so focus stays where the Modal returned it
    (the ✎/Edit button) instead of being reset to `<body>`.

## Section 4 — Undo offers, focus, offline and keys (client)

### The Undo registry

`src/lib/components/dose-writes/undo-registry.svelte.ts` is module state. Like Toast's list,
every mutator is a no-op when `!browser`. It holds **at most one** offer:

- an offer `id`;
- the message;
- the dose id, the kind and the restore token;
- `focusTarget`;
- the deadline;
- a running flag;
- the element that was focused before focus entered the toast stack.

`Toast.svelte` renders the registry's offer above its plain toasts. The existing
`showToast(message, type)` is unchanged for plain toasts, so every suite that mocks Toast as
`{ showToast }` stays valid.

**Clearing on sign-out.** When the `(app)` layout unmounts, the registry is cleared, and so
are plain toasts. A sign-out leaves `(app)`, so the next person to sign in on a shared device
never sees the previous person's offer. That offer would name their medication.

**Lifetime.**

- **One offer at a time.** The next successful dose write replaces it. That removes the
  "which Undo?" ambiguity and the double click onto an older toast's Undo.
- **It stays until one of these happens:**
  - Undo is pressed and settles;
  - the new **Dismiss** button (×, named "Dismiss") is pressed;
  - another successful dose write clears or replaces it;
  - a submit for the same dose withdraws it;
  - its deadline passes. For a restore, the deadline is `expiresInMs − 30s` after the
    response arrives. For a create's Undo it is `DOSE_UNDO_WINDOW_MS`.
- **A running offer is never replaced or withdrawn.** This holds by construction: an Undo
  holds the lock, so no `acquire()` can succeed and no write can produce a replacement.
- **Plain toasts** keep the 5s timer and today's hover/focus hold.

**Name.** The button's visible text is "Undo". Its accessible name comes from
`aria-labelledby="<undo-word-id> <message-id>"`, e.g. "Undo Dose removed: Paracetamol 500mg
at 08:00". No sr-only text is added inside the `role="status"` region, so nothing is
announced twice.

**Pressing Undo:**

1. **If another write is in flight** (`lock.active`), refuse with "Still saving your last
   change…". The offer stays.
2. **Take the lock:** `lock.hold()`. The lock is read from Toast's layout context. The
   button reads "Undoing…" and is `aria-disabled`; a second press does nothing.
3. **POST:**
   - a create's Undo: `doseId` and `forUndo=1` to `/dashboard?/deleteDose`;
   - a delete's Undo: `doseId` and `deletedAt` to `/dashboard?/restoreDose`.
4. **Reload.** On `success`, a `failure`, or an `error` with a status, run
   `reloadAfterWrite()`, then `await tick()`.
5. **Move focus** (below). The offer is still mounted at this point, so focus can still be
   inside it.
6. **Settle this offer**, matched by its `id`:
   - success → a plain toast, "Undone" for a create or "Dose restored" for a delete;
   - `failure` or `error` with a status → `actionErrorMessage(result)`, the server's 410,
     409 or 404 copy. A 404 on a create's Undo reads "Dose not found". A 5xx leaves the offer
     in place and retryable.
7. **Release:** `lock.extend()`.

**A network failure, or an Undo pressed offline, leaves the offer in place.**

- Offline, nothing is sent: the offer reads "You're offline — Undo will still be here when
  you're back."
- After a network error it reads "Couldn't reach the server. The undo may not have gone
  through." The button becomes usable again once `reloadAfterWrite()` finds the server
  reachable and the page has reloaded.
- Retrying is safe: restoring something already restored succeeds with no change, and
  deleting something already deleted returns 404.

### Focus

**The rule: move focus only if it was lost.** "Lost" means it is on `<body>`, on a
disconnected node, or inside the toast stack. Never move it onto a _different_ dose's write
button.

- **After Undo** (step 5 above), focus goes to the first of these that exists:
  1. the offer's `focusTarget()`, now that the reload has rendered the restored row;
  2. the element that was focused before focus entered the stack, if it is still connected;
  3. the page's `h1`. /log and /medications give it `tabindex="-1"`; the dashboard already
     has `DASHBOARD_HEADING_ID`.
- **After a 409 or an error.** Once the reload lands, run the caller's `focusAfter` under the
  same rule. DueCard: the same card, then the next, then the `h1`.
- **After a /log delete.**
  1. Snapshot every `[data-dose-id]` at submit.
  2. After the reload, focus the ✎ of the next surviving row **below** it in the DOM,
     crossing day groups. The list is newest-first, so "below" means earlier in time.
  3. Otherwise, the ✎ of the nearest surviving row **above** it.
  4. Otherwise, the `h1`. Never a ×.
- **The shared helper** becomes
  `focusTargetAfterResolve(key, followingKeys, opts?: { attr?: "cardKey" | "doseId"; precedingKeys?: readonly string[]; pick?: (row: HTMLElement) => HTMLElement | null }, root = document)`.
  - DueCard passes no `opts`, so its "next card, else the `h1`" rule is unchanged.
  - /log passes
    `{ attr: "doseId", precedingKeys, pick: (row) => row.querySelector("[data-edit]") }`.

### Keys

- **`KeyboardShortcuts`** (`:30-98`) gains two checks, both **after** the help-overlay block,
  so the overlay keeps its Escape and Tab handling:
  - `if (e.repeat) return;`
  - `if (document.querySelector('[aria-modal="true"]') && !(showHelp && e.key === "?")) return;`

  The edit Modal, the help overlay and the mobile menu all set `aria-modal="true"`
  (`Modal.svelte:77`, `KeyboardShortcuts.svelte:128`, `(app)/+layout.svelte:158`).
  `isControlFocused` is kept: a Due card `li` is `tabindex="-1"`, and 1–9 must still work
  from it after Log now.

- **The primitive's `onkeydown`** calls `preventDefault()` on a repeated `Enter` keydown on a
  write button. Enter activates on keydown and repeats; Space activates on keyup and does not
  repeat.

### Chips

The Quick Log `li` gets `box-content`: 44px inside, so each segment is a full 44px, and 46px
outside with the `border-strong` edge.

## Section 5 — Testing

Every test is proven by mutation: break the production line it guards and watch it fail. The
mutation is named beside each test below.

**PGlite runs one backend and serialises transactions**, so two `Promise.all` calls never
overlap. Concurrency is therefore covered two ways:

- by **seeding the state the losing side would see** and calling it sequentially;
- by pinning each lock's **SQL** in `queryLog`.

No test claims to exercise a real race.

### PGlite (`tests/unit/pg/`, `// @vitest-environment node`, `toFake: ["Date"]`)

Needs `seedTrash` and `seedTombstone` fixtures on `pg-db`.

- **Round trip.** Delete, then restore, gives back every column (notes, side effects, status,
  `loggedAt`), the same id, and the pre-delete stock. _Mutation:_ drop `notes` from the trash
  insert.
- **Double delete.** A second, sequential delete returns `null`: stock is credited once, with
  one `dose_deleted` event and one tombstone. _Mutation:_ ignore `RETURNING`'s row count.
- **Double restore.** A second restore returns `already_restored`, and stock drops once.
  _Mutation:_ skip step 6.
- **Out-of-date token.** Delete, restore, delete again, then replay the first token: `gone`,
  and nothing is written. _Mutation:_ match the trash row by id only.
- **Window boundary.** One ms inside the window restores; exactly at the window it is `gone`.
  _Mutation:_ `gt` → `gte`.
- **Since-delete guard.**
  - A log of the same medication after the delete → `logged_since`, and the trash row stays.
  - A log of another medication → restores.
  - Two deletes undone newest-first → both restore.
  - _Mutation:_ remove the guard, or compare `updatedAt` instead of `loggedAt`.
- **Stock.**
  - Stock 1, log 3 (applied 1, stock 0), delete (stock 1), adjust to 0, restore: reapplied 0,
    count 0.
  - Tracking off at restore: reapplied 0, count NULL, no event.
  - Tracking off at delete, on at restore: credited 0, so nothing is taken.
  - _Mutation:_ use `inventoryApplied` or `quantity` instead of `inventoryCredited`, or drop
    the NULL branch.
- **Edit after a delete.** `updateDose` on a deleted dose returns `null`: no 500, no stock
  write. After a delete and restore, `updateDose` computes from the locked re-read.
  _Mutation:_ restore the pre-read outside the transaction.
- **Create's Undo leaves no trash.** The dashboard delete action with `forUndo=1` writes no
  trash row and returns no `restore`. _Mutation:_ ignore `forUndo`.
- **Mac delete.** `/api/v1 delete_dose` writes no trash row and returns `{ deleted }`.
  _Mutation:_ pass `keepForUndo: true`.
- **Wipe.**
  - `queryLog` shows the medications `for update`, then `DELETE dose_logs`, then the trash
    delete.
  - A restore after a wipe returns `gone`.
  - The archived-medication wipe and account deletion cascade to trash rows.
  - _Mutation:_ drop the medication lock or the trash delete, or `ON DELETE CASCADE` from the
    `0021` SQL (PGlite applies migrations, not `schema.ts`).
- **Purges.**
  - Retention and the on-write purges remove only expired rows, and the on-write purges only
    that user's.
  - Every purge's SQL contains `skip locked`.
  - _Mutation:_ flip the comparison, drop the `userId` scope, or drop `SKIP LOCKED`.
- **Audit.** After deleting and restoring a dose that has a note, no audit row contains the
  note text, and there is exactly one `restore` row. _Mutation:_ pass a `computeChanges` diff.
- **Sync.** `buildSyncResponse` with a cursor from before the delete, and with one between
  the delete and the restore, both return the dose and no tombstone. A duplicate tombstone is
  seeded. _Mutation:_ delete one tombstone, or keep the old `updatedAt`.
- **Locks.** `queryLog` shows the medication `for update` before the first **locking or
  writing** statement on `dose_logs` or `dose_log_trash`, in:
  - delete, restore, `updateDose`;
  - every dose insert;
  - `refillMedication` and `adjustInventory`.

  The unlocked step-1 reads are exempt. _Mutation:_ drop or reorder a lock.

- **Clock after lock.** `loggedAt` and `deletedAt` come from a clock read after the lock. A
  fake `Date` advanced inside a spy on the lock query shows up in the written value.
  _Mutation:_ read `now` before the transaction.
- **Slot re-check.**
  - A stale Took it at is refused when the slot was resolved at another instant.
  - Took it at over a skip-resolved slot is refused.
  - A stale Skip is refused.
  - A skip ahead of its slot is written at the server's `min(slot, now)`.
  - A legacy `takenAt`-only Skip on a past slot is accepted; on a future slot it gets a 409.
  - Took it at ignores a posted quantity above 1.
  - _Mutation:_ remove the `tookItAt` or `skipAt` comparison, or pass the posted quantity.

### Plain unit tests

- **Column match.** Every `dose_logs` column except `updatedAt` exists in `dose_log_trash`
  with the same type. _Mutation:_ add a column to `dose_logs` only.
- **Owner scan.** `doseLogTrash` is referenced only by `db/schema.ts` (its definition),
  `doses.ts`, `api/wipe.ts` and `retention.ts`, checked in both directions, like
  `server-log.test.ts`. _Mutation:_ read it from anywhere else.
- **Auth guard.** `app-action-auth-guard.test.ts`:
  - a `restoreDose` case whose body passes Zod;
  - `never(...)` doses mocks for `restoreDose`, `logDoseAtSlot` and `skipDoseForSlot`.
- **Actions.**
  - Both delete actions return the `restore` handle, and omit it for `forUndo`.
  - `restoreDose` maps its four outcomes to 200 / 200 / 410 / 409.
  - `skipDose` routes `forSlot`, `takenAt`-only, and neither.

### Component tests

- **Primitive** (`dose-write.svelte.test.ts`):
  - Two components under one context: a write in one cancels the other's submit.
    _Mutation:_ a lock per component.
  - With no `staleGuard`, a submit goes ahead. _Mutation:_ read the clock from context.
  - Offline at submit: cancelled, with no lock taken. _Mutation:_ remove the gate.
  - A network error while `navigator.onLine` is true:
    - the lock stays `active`;
    - `/api/health` is probed;
    - after the first `ok` probe there is exactly one `invalidateAll`, and then the lock is
      released.
    - _Mutation:_ wait only for `online`, or release before the reload.
  - A network error while offline makes no `invalidateAll` until `online`. _Mutation:_
    remove the online check.
  - A result that arrives during a navigation waits for `navigating.complete` before
    reloading. The `$app/state` mock exposes `to`, `willUnload` and `complete`, the real
    shape. _Mutation:_ reload without waiting.
  - No success path calls `update()`, and a cross-route failure still toasts. _Mutation:_
    call `update()`.
  - After a 409 with focus on `<body>`, `focusAfter` gets focus; if focus is elsewhere it is
    left alone. _Mutation:_ remove the call, or remove the "only if lost" check.
  - A 409 with `updated.current` true reloads the document. _Mutation:_ always
    `invalidateAll`.
  - A repeated Enter is `defaultPrevented`; a first press is not. _Mutation:_ remove the
    guard.
  - A delete withdraws the offer for its dose at submit. A submit the lock refuses withdraws
    nothing. _Mutation:_ withdraw before `acquire()`.
  - A refused tap while `active` toasts "Still saving…"; a tap refused during the cooldown
    does not. _Mutation:_ test `busy`.
- **Lock.** `active` is true only while a holder exists. _Mutation:_ return `busy`.
- **Clock.** Seeded with an already-expired payload, `isExpired()` is true immediately, and
  no timer is pending after SSR render. _Mutation:_ seed through `sync()`.
- **Undo registry and Toast.** This is the first DOM test of Toast. It mocks
  `$app/environment` with `browser: true`.
  - A second offer replaces the first. _Mutation:_ append instead.
  - The name is "Undo" plus the message, through `aria-labelledby`, with no extra live-region
    text. _Mutation:_ sr-only text inside the region.
  - A double press runs once. _Mutation:_ remove the running flag.
  - An Undo pressed while a write is `active` sends nothing. _Mutation:_ `hold()` without the
    check.
  - After a /log restore, focus lands on that row's ✎. _Mutation:_ focus before the reload.
  - After Undo settles, focus is never on `<body>`. _Mutation:_ dismiss before focusing.
  - An offline press sends nothing and the offer stays. _Mutation:_ remove the gate.
  - An Undo offer outlives 5s; a plain toast does not. _Mutation:_ give offers the 5s timer.
  - Unmounting and remounting the layout leaves no offer. _Mutation:_ drop the clear.
  - A withdrawal removes only an offer naming that dose.
- **`KeyboardShortcuts`:**
  - `repeat: true` does not submit. _Mutation:_ remove the `e.repeat` check.
  - With `[aria-modal="true"]` present, neither `1` nor `n` fires; with the help overlay
    open, `?` still closes it. _Mutation:_ remove the modal check, or drop its `?`
    exemption.
- **`DoseEditForm`.**
  - With the lock busy, Save is cancelled. With Save in flight, Remove is cancelled.
    _Mutation:_ save without `acquire()`.
  - A successful Save clears the current offer. _Mutation:_ withdraw only the edited dose.
- **`TimelineEntry`**, rewritten from `timeline-entry-delete-confirm.test.ts`:
  - One tap on × submits. _Mutation:_ restore the confirmation.
  - Before mount, × is `type="button"`. _Mutation:_ render the submit unconditionally.
  - A second row's × within the cooldown is cancelled. _Mutation:_ zero cooldown.
  - The success toast offers a restore Undo, and names the day for an older row.
  - Focus after a delete follows the /log order in Section 4: below, then above, then the
    `h1`, crossing day groups, never a ×. _Mutation:_ the old same-day-only lookup.
- **`MedicationCard`.**
  - It posts through the primitive to `/dashboard?/logDose`.
  - Focus stays on Log.
  - The toast is formatted in the user's zone and offers a delete Undo.
  - Its name and `relative z-10` are kept.
  - _Mutation:_ the old `fetch` path.
- **`QuickLogBar`.** The `li` has `box-content`. _Mutation:_ remove it.
- **`DoneList`.** "Remove skip" posts `?/deleteDose` with `{ doseId }`, carries
  `data-dose-id`, and offers a restore Undo.
- **`DueCard`.** Skip posts `{ medicationId, forSlot }`. _Mutation:_ post `takenAt`.

### Tests this change breaks, which must be updated rather than deleted

- **`pg/dose-slot-writes.test.ts`:**
  - Every `GUARD` case (`GUARD` at `:49`, used across `:114-230`, `:415-435` and `:472-488`)
    is rewritten against `logDoseAtSlot` / `skipDoseForSlot`, with a fixed-time schedule
    seeded.
  - `:140` becomes the stale-device case.
  - `:150-164` ("taken beats skip") becomes "Took it at over a skip-resolved slot is
    refused".
  - `:490-498` ("a chip's dose takes no lock") is inverted to assert one medication lock.
- **`dashboard-dose-actions.test.ts`:**
  - The `deleteDose` mock returns the new object or `null` (`:16`, `:20`, `:102`, `:110-116`).
  - Took it at (`:196-231`) moves to a `logDoseAtSlot` mock.
  - Skip (`:296-348`) is rewritten for `forSlot` → `skipDoseForSlot`, `takenAt`-only →
    recompute or 409 (replacing the 400 at `:305-311`), and neither → legacy.
  - The doses mock gains `logDoseAtSlot`, `skipDoseForSlot` and `restoreDose`.
- **`log-dose-actions.test.ts`** (`:7`, `:11`, `:66-74`): the `deleteDose` mock shape and the
  `restore` handle.
- **`api/commands.test.ts`** (`:49`, `:368-376`): the mock returns an object or `null`, and
  the call carries `{ keepForUndo: false }`.
- **`pg/dose-inventory-symmetry.test.ts`** (`:74-207`): every `deleteDose` call passes
  `{ keepForUndo: … }`.
- **`api/wipe.test.ts`** (`:94-100`): the ops now start with the medication lock and end with
  the trash delete.
- **`doses-inventory.test.ts` and `inventory-events.test.ts`:** the `deleteDose`, `updateDose`,
  `logDose`, refill and adjust inventory cases move to PGlite.
- **`dose-action-form.test.ts`:**
  - Undo is now driven through the registry.
  - The network-failure copy changes.
  - The stale-guard override moves to `isExpired`.
  - The success, 409 and error tests (`:198-280`, `:415-483`) assert `invalidateAll` through
    `reloadAfterWrite`, not the injected `update`.
- **`due-card-focus.test.ts`** (`:135-148`): the card removal moves from the injected `update`
  into the `invalidateAll` mock.
- **`due-card-ssr.test.ts`** (`:173-176`): Skip's fields become `{ medicationId, forSlot }`.
- **`done-list-ssr.test.ts`** (`:167-172`): the "Remove skip" name.
- **`form-errors-enhance-callbacks.test.ts`** (`:192`, `:256`): assert that `update` is **not**
  called and `invalidateAll` is. The file also needs `doseWriteContext()`.
- **`dose-write-lock.test.ts`, `helpers/dose-action-form-harness.ts`:** the import path moves.
- **`helpers/dashboard-context.ts`:** `fixedClock` gains `isExpired`; add
  `doseWriteContext()`.
- **`dashboard-clock.test.ts`:** the seeded constructor.
- **`timeline-entry-delete-confirm.test.ts`:** the whole file.
- **`medication-card-targets-dom.test.ts`:** the `fetch` mock and the two-argument toast.
- **`dashboard-chrome-copy.test.ts`** (`:19-26`): the source regex on the Undo button.
- **Tests that render a dose control without a lock context** now throw at mount and need
  `doseWriteContext()`:
  - `timeline-entry-ssr`
  - `medication-card-targets-ssr`
  - `log-page-mount`
  - `log-pagination-ssr`
  - `dashboard-page-ssr`
- **`tests/e2e/dose-logging.test.ts`:** delete becomes one click, followed by Undo. CI still
  does not run e2e (`RUN_E2E`), and the PR will say so.

## Rollout

- **Production:** the build's `drizzle-kit push` creates the table before the new code goes
  live.
- **Preview deploys don't push schema.** On a preview whose database lacks the table:
  - a web delete fails;
  - restore is unavailable;
  - Delete dose history fails, on the web and through `/api/v1 wipe_dose_history`;
  - the `dose-log-trash` retention policy logs a failure on every tick.

  The Mac `delete_dose` (which skips the trash) and everything else are unaffected.

- **Rollback:** the old code ignores the trash, so nothing comes back to life. But trash rows
  stop being purged, and the old wipe doesn't clear them, until we roll forward again. The
  RUNBOOK gets this note.
- **Pre-deploy tabs:**
  - A dashboard page loaded before the deploy keeps working for past-slot Skips (Section 2).
  - A future-slot Skip gets a 409.
  - Once version polling notices the deploy, the next 409 reloads the tab.
- **Not verified in a browser.** Local dev 500s without `ENCRYPTION_KEY`. The PR carries a
  phone checklist:
  - one-tap delete on /log, then Undo;
  - Remove skip, then Undo;
  - card Log, then Undo;
  - Undo after navigating;
  - Undo while offline, and after airplane mode is switched off;
  - 1–9 with the edit dialog open;
  - holding a digit.

## Out of scope

- **Undo for:** edits (D3), settings wipes, import and account deletion.
- **A `/api/v1` restore command, or Undo in the Mac app.**
- **Submit guards on Settings → Delete dose history / Delete archived medications.** The user
  chose "Core + #170 follow-ups" over the option that included them.
- **Making reminder sends aware of the undo window.**

## Follow-ups

- **Bump `medications.updatedAt` on every dose-driven stock change**, so the Mac app sees web
  stock changes.
- **The sync cursor race:** `serverTime` is read before non-snapshot queries.
- **Submit guards on the Settings wipe forms.** A double submit runs a wipe twice and reports
  "Removed 0".
- **Run retention outside `reminder-tick`'s 06:00–22:59 UTC window**, so overnight trash
  purges within about 30 minutes.
- **Guard edits and imports during an undo window:** the since-delete guard can't see them.
- **Plain-toast hold fixes:**
  - A touch tap pins the stack, because `mouseenter` fires on tap. Make the hold mouse-only.
  - A toast created during a hold still starts its 5s timer (`Toast.svelte:31`).
- **Drop the legacy `takenAt`-only Skip path** one release after this ships.

## Docs to update in the same PR

- **CLAUDE.md:**
  - the lock-order rule (D7), including skip-locked purges and reading clocks after the lock;
  - the trash, its owners, and the restore contract (D6), with the reason
    `inventoryCredited` exists;
  - `dose-writes/` as the single client path for dose writes, with edit Save's stated
    exception, replacing the "`DoseActionForm` is the single path" wording;
  - the Undo-offer rules (D5), including clearing on sign-out;
  - `reloadAfterWrite` instead of `update()`, with the navigation wait and the reachability
    probe;
  - Took it at and Skip re-derived under the lock, ×1.
- **`docs/adr/0008-undoable-deletes.md`:** trash vs signed snapshot vs soft delete, with the
  judges' reasons. Link it from `docs/adr/README.md`.
- **`docs/database.md`:** the new table.
- **`docs/RUNBOOK.md`:** the rollback note.
- **`docs/api-v1-contract.md`:**
  - `delete_dose` is unchanged on the wire, and Mac deletes are not undoable;
  - the `eventType` list (`:351`) gains `dose_restored`;
  - the audit `action` list gains `restore`.
