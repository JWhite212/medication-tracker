import { sql, type SQL } from "drizzle-orm";
import { medications } from "$lib/server/db/schema";

/**
 * The predicate for a bulk `DELETE FROM medications` that takes its row locks
 * in ascending id order, which is D7's order for any multi-row medication
 * lock (CLAUDE.md, lock order).
 *
 * A plain `DELETE … WHERE user_id = $1` locks rows in whatever order its scan
 * meets them. `wipeDoseHistory` locks every one of the same user's medications
 * `ORDER BY id FOR UPDATE`, so two such deletes overlapping it can each hold a
 * row the other wants next, and Postgres aborts one with 40P01.
 *
 * The rows are selected `ORDER BY id FOR UPDATE` inside the delete itself:
 * the sort sits below the lock, so locks are taken in id order, and the
 * delete only reaches rows the subquery has already locked. Cascades to the
 * dependent tables run as AFTER triggers at the end of the statement, so
 * every medication lock is held before any child row is touched.
 *
 * It is one statement rather than a separate `SELECT … FOR UPDATE` so the
 * fake-db unit tests of both callers, which have no select `.for()` and must
 * not grow one, still see exactly one delete. The lock itself is pinned on
 * PGlite by `tests/unit/pg/medication-delete-lock-order.test.ts`.
 */
export function medicationIdsLockedInOrder(where: SQL): SQL {
  return sql`${medications.id} in (select ${medications.id} from ${medications} where ${where} order by ${medications.id} asc for update)`;
}
