import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { apiCommands } from "$lib/server/db/schema";
import { logDose } from "$lib/server/doses";
import { logDosePayload } from "$lib/utils/validation";

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

// Idempotent per (userId, command.id) via the apiCommands ledger: a
// replayed id short-circuits to the cached result without re-invoking the
// handler. A per-command failure is captured as { ok: false, error } so
// one bad command in a batch never aborts the rest.
export async function runCommands(
  userId: string,
  commands: Command[],
): Promise<Array<{ id: string; ok: boolean; result?: unknown; error?: string }>> {
  const results: Array<{ id: string; ok: boolean; result?: unknown; error?: string }> = [];
  for (const cmd of commands) {
    const [cached] = await db
      .select()
      .from(apiCommands)
      .where(and(eq(apiCommands.userId, userId), eq(apiCommands.idempotencyKey, cmd.id)))
      .limit(1);
    if (cached) {
      results.push({ id: cmd.id, ok: true, result: cached.result });
      continue;
    }
    try {
      const result = await dispatchCommand(userId, cmd.type, cmd.payload);
      await db.insert(apiCommands).values({ userId, idempotencyKey: cmd.id, result });
      results.push({ id: cmd.id, ok: true, result });
    } catch (e) {
      results.push({
        id: cmd.id,
        ok: false,
        error: e instanceof Error ? e.message : "command failed",
      });
    }
  }
  return results;
}

export { handlers };
