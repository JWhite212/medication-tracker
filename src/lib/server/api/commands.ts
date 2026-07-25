import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { apiCommands } from "$lib/server/db/schema";
import { logDose, logSkippedDose, updateDose, deleteDose } from "$lib/server/doses";
import { refillMedication, adjustInventory } from "$lib/server/inventory-events";
import {
  logDosePayload,
  skipDosePayload,
  editDosePayload,
  deleteDosePayload,
  refillPayload,
  adjustInventoryPayload,
} from "$lib/utils/validation";

export class UnknownCommandError extends Error {
  constructor(type: string) {
    super(`Unknown command: ${type}`);
    this.name = "UnknownCommandError";
  }
}

export type Command = { id: string; type: string; payload: unknown };

type Handler = (userId: string, payload: unknown) => Promise<unknown>;

// Each handler validates its own JSON-native payload and delegates to an
// existing domain function — no business logic is reimplemented here.
// Tasks 12-13 register more command types into this same map.
//
// INVARIANT: every command handler's domain function MUST be all-or-nothing
// — no durable side effect after its transaction commits — so that a thrown
// error guarantees nothing was committed (runCommands releases the
// reservation and allows retry on throw; see the reserve-first algorithm
// documented on runCommands below). Handlers MUST also return a NON-NULL,
// NON-UNDEFINED result: the idempotency ledger uses a null `result` to mean
// "in progress", so a null/undefined handler result would make a completed
// command indistinguishable from pending and block replay forever.
const handlers: Record<string, Handler> = {
  log_dose: async (userId, payload) => {
    const p = logDosePayload.parse(payload);
    const row = await logDose(
      userId,
      p.medicationId,
      p.quantity,
      p.takenAt ? new Date(p.takenAt) : undefined,
      p.notes,
      p.sideEffects,
    );
    return { id: (row as { id: string }).id };
  },
  skip_dose: async (userId, payload) => {
    const p = skipDosePayload.parse(payload);
    return { id: await logSkippedDose(userId, p.medicationId) };
  },
  edit_dose: async (userId, payload) => {
    const p = editDosePayload.parse(payload);
    const row = await updateDose(userId, p.doseId, {
      takenAt: p.takenAt ? new Date(p.takenAt) : undefined,
      quantity: p.quantity,
      notes: p.notes,
      sideEffects: p.sideEffects ?? undefined,
    });
    return { updated: row !== null };
  },
  delete_dose: async (userId, payload) => {
    const p = deleteDosePayload.parse(payload);
    return { deleted: await deleteDose(userId, p.doseId) };
  },
  refill: async (userId, payload) => {
    const p = refillPayload.parse(payload);
    return refillMedication(userId, p.medicationId, p.quantity, p.note ?? null);
  },
  adjust_inventory: async (userId, payload) => {
    const p = adjustInventoryPayload.parse(payload);
    return adjustInventory(userId, p.medicationId, p.newCount, p.note ?? null);
  },
};

export async function dispatchCommand(
  userId: string,
  type: string,
  payload: unknown,
): Promise<unknown> {
  const handler = handlers[type];
  if (!handler) throw new UnknownCommandError(type);
  return handler(userId, payload);
}

// Idempotent per (userId, command.id) via the apiCommands ledger — reserve-first.
//
// The domain mutation (dispatchCommand, committed via dbTx) and the ledger row
// (written via the separate HTTP `db` connection) can never be made atomic with
// each other. So instead of writing the ledger row *after* the mutation succeeds
// (which leaves a window where the mutation committed but the ledger insert
// hasn't — a retry in that window would re-run the mutation), we reserve the
// idempotency key *before* dispatching, using the (userId, idempotencyKey)
// primary key as an atomic lock:
//
//   1. INSERT ... ON CONFLICT DO NOTHING with result: null. Only one caller can
//      ever win this for a given (userId, id) — concurrent/duplicate requests
//      lose the insert and fall through to the cached-or-in-progress branch
//      without ever calling dispatchCommand.
//   2. The winner dispatches. If dispatch throws, the domain transaction rolled
//      back (nothing to undo), so we delete our reservation and the id is safe
//      to retry.
//   3. If dispatch succeeds, the mutation is durably committed. We then try to
//      record the result on the reservation. If that write fails, we deliberately
//      leave the row's result as null rather than delete it — the mutation
//      already happened, so a retry must NOT re-execute it. A future replay of
//      this id finds result === null and reports "in_progress" (fail closed);
//      the client reconciles the true state via sync rather than double-applying.
export async function runCommands(
  userId: string,
  commands: Command[],
): Promise<Array<{ id: string; ok: boolean; result?: unknown; error?: string }>> {
  const results: Array<{ id: string; ok: boolean; result?: unknown; error?: string }> = [];
  for (const cmd of commands) {
    const reserved = await db
      .insert(apiCommands)
      .values({ userId, idempotencyKey: cmd.id, result: null })
      .onConflictDoNothing()
      .returning({ idempotencyKey: apiCommands.idempotencyKey });

    if (reserved.length === 0) {
      // Key already exists: either completed (result set) or reserved by a
      // concurrent/prior attempt whose outcome is unknown (result null).
      const [existing] = await db
        .select()
        .from(apiCommands)
        .where(and(eq(apiCommands.userId, userId), eq(apiCommands.idempotencyKey, cmd.id)))
        .limit(1);
      if (existing && existing.result !== null) {
        results.push({ id: cmd.id, ok: true, result: existing.result });
      } else {
        // Do NOT re-execute — fail closed against duplicate mutations.
        // The client reconciles actual state via sync.
        results.push({ id: cmd.id, ok: false, error: "in_progress" });
      }
      continue;
    }

    // We hold the reservation. A throw here means the domain tx rolled back,
    // so it's safe to release the reservation and let the id be retried.
    let result: unknown;
    try {
      result = await dispatchCommand(userId, cmd.type, cmd.payload);
    } catch (e) {
      await db
        .delete(apiCommands)
        .where(and(eq(apiCommands.userId, userId), eq(apiCommands.idempotencyKey, cmd.id)));
      results.push({
        id: cmd.id,
        ok: false,
        error: e instanceof Error ? e.message : "command failed",
      });
      continue;
    }

    // Dispatch committed durably. Record the result (best-effort): if this
    // write fails, the null-result reservation stays in place so a retry is
    // treated as in_progress and never re-executes the already-applied mutation.
    try {
      await db
        .update(apiCommands)
        .set({ result })
        .where(and(eq(apiCommands.userId, userId), eq(apiCommands.idempotencyKey, cmd.id)));
    } catch {
      // swallow: reservation stays as null-result; client reconciles via sync
    }
    results.push({ id: cmd.id, ok: true, result });
  }
  return results;
}

export { handlers };
