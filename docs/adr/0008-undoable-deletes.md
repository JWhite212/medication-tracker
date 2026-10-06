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

**Lock order.** Every per-dose write, plus refill and adjust, locks the
medication row first (ascending id when there are several), then the dose
or trash row. Two writers stay outside it on purpose: `import/apply.ts`'s
bulk insert (named under Known and accepted below) and the medication
form's absolute `inventoryCount` write, which overwrites the count with a
value the user typed rather than moving it by a delta. Trash purges use
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
accepted cost. A trash row goes when the same user next makes an undoable
delete or a successful restore (the on-write purge), or when the
`dose-log-trash` retention policy runs. Retention rides the
`reminder-tick` GitHub Actions schedule (`*/30 6-22` UTC), so an overnight
delete can linger for about 7.5 hours, and with both schedulers down it
lingers until that user's next undoable delete or successful restore. Neon
PR branches copy whatever trash exists when they are created.

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
