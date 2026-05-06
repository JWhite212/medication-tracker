# P8 - Inventory Event History + Refill Workflow

> **Status:** in progress
> **Branch:** `feat/inventory-event-history`
> **Owner:** Jamie

**Goal:** Treat every change to `medications.inventoryCount` as a first-class event. Today the count is mutated in place by dose-log writes and deletes; there is no audit trail and no way to refill stock through the UI. After this PR every adjustment writes a row to `inventory_events`, the medication detail page shows a timeline of recent events, and a "Mark as refilled" form lets the user log a stock top-up.

**Architecture:** A new `inventoryEvents` table records `(eventType, quantityChange, previousCount, newCount, note)` per change. A small service exposes `recordInventoryEvent(tx, ...)` so the existing `dbTx.transaction` blocks in `doses.ts` can append the event in the same transaction as the inventory mutation — partial failures roll back both. A new `refillMedication(userId, medicationId, quantity, note)` service runs the read-update-event cycle in its own transaction. Skipped doses do not decrement inventory today; they do not record an event either.

---

## Schema

```sql
CREATE TABLE inventory_events (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication_id text NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- dose_taken | dose_deleted | dose_quantity_updated | manual_adjustment | refill | correction
  quantity_change integer NOT NULL,
  previous_count integer,
  new_count integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_events_user_created_idx ON inventory_events (user_id, created_at DESC);
CREATE INDEX inventory_events_med_created_idx ON inventory_events (medication_id, created_at DESC);
```

No backfill: there is no historical event data to recover, and the medications table already has the current count.

## File structure

- Modify: `src/lib/server/db/schema.ts` (new `inventoryEvents` table)
- New: `drizzle/00XX_phase_8_inventory_events.sql`
- New: `src/lib/server/inventory-events.ts` (service)
- Modify: `src/lib/server/doses.ts` (integrate into the 3 dose flows)
- Modify: `src/routes/(app)/medications/[id]/+page.server.ts` (load history, add `?/refill` action)
- Modify: `src/routes/(app)/medications/[id]/+page.svelte` (refill form + history timeline)
- New: `tests/unit/inventory-events.test.ts`
- Modify: `tests/unit/doses-inventory.test.ts` (assert events recorded for taken/deleted/updated, none for skipped)

## Risks / notes

- `manual_adjustment` is supported in the schema/event type but not exposed via UI in this PR; refill covers the most important user-initiated adjustment. A follow-up can add the UI affordance.
- Inventory events are append-only. We never delete or update a row.
- The existing run-out-date forecast lives in `src/lib/server/inventory.ts:getRefillForecast`; the page can surface it without new server code.
