# P4 - Atomic Medication + Schedule Creation

> **Status:** in progress
> **Branch:** `feat/atomic-medication-creation`
> **Owner:** Jamie

**Goal:** A failed schedule insert during new-medication creation should leave NO row in `medications` either. Today the page-server calls `createMedication` and then `replaceSchedulesForMedication` in sequence, so a transient insert failure can leave a medication row with no schedules — invisible to analytics, broken in the UI.

**Architecture:** Add `createMedicationWithSchedules(userId, input, schedules)` that runs the medication insert, the schedule inserts, and the audit-log insert inside a single `dbTx.transaction`. To support this, `logAudit` and `createMedication` are parameterised on an optional `tx` argument that defaults to the global `db` client, and a shared `buildScheduleRows(userId, medicationId, schedules)` helper produces the schedule row payload for both new and replace flows.

---

## File structure

- Modify: `src/lib/server/audit.ts` — `logAudit` accepts an optional `tx`.
- Modify: `src/lib/server/medications.ts` — `createMedication` accepts an optional `tx`. Add `createMedicationWithSchedules`.
- Modify: `src/lib/server/schedules.ts` — extract `buildScheduleRows` helper; `replaceSchedulesForMedication` reuses it.
- Modify: `src/routes/(app)/medications/new/+page.server.ts` — call the new service instead of two helpers in sequence.
- New: `tests/unit/createMedicationWithSchedules.test.ts` — happy path, rollback when schedule insert throws, audit log written inside the transaction.

## Risks / notes

- The Neon HTTP driver doesn't support transactions; we already use `dbTx` (websocket pool) for transactional flows. Same pattern as `doses.ts:logDose`.
- `replaceSchedulesForMedication` is unchanged in semantics — it still does delete-then-insert in its own transaction. The shared `buildScheduleRows` helper is a refactor, not a behaviour change.
- The new service inserts the audit row directly using the transaction, sidestepping the `logAudit` indirection. We still parameterise `logAudit` because future flows (atomic dose update, etc.) will benefit.
