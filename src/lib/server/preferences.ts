import { eq, getTableColumns } from "drizzle-orm";
import { db } from "$lib/server/db";
import { userPreferences } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "$lib/server/audit";
import type { UserPreferences } from "$lib/types";

export async function getOrCreatePreferences(userId: string): Promise<UserPreferences> {
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (existing) return existing;

  // Two concurrent first-touches (e.g. a page load racing an import)
  // would both miss the select and both insert, and the second would
  // fail the primary-key constraint. onConflictDoNothing makes the loser
  // return no row instead of throwing; it then re-reads the winner's.
  const [created] = await db
    .insert(userPreferences)
    .values({ userId })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [raced] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return raced;
}

/**
 * The single audited write path for user preferences.
 *
 * Every door — the three settings forms and the `/api/v1` command
 * handler — goes through here, so none of them can change a preference
 * without leaving an audit row. The audit used to be the caller's job,
 * restated at each web door over a hand-picked field subset, and the API
 * door simply never did it.
 */
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
  //
  // That test runs on PGlite, a single in-process backend, so it can never
  // produce two overlapping *statements* -- it only reproduces the
  // JS-level interleaving (both calls' getOrCreatePreferences reads
  // landing before either UPDATE), which moving the read inside the write
  // fixes on its own, lock or no lock. `for update` itself is only
  // exercisable with two real Postgres backends, so this suite gives it no
  // coverage; the READ COMMITTED reasoning above is the only reason to
  // keep it.
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
      // `_.selectedFields` is drizzle's private namespace (the leading
      // underscore is the only marker) -- it carries no compatibility
      // promise across version bumps, and there is no public API for a
      // CTE's field list to reach for instead. If a `drizzle-orm` update
      // breaks this, expect a type error here first and a runtime
      // `undefined` after that.
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
