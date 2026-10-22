import { error, fail } from "@sveltejs/kit";
import { eq, and, count, countDistinct, ne } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications, sessions, auditLogs } from "$lib/server/db/schema";
import { lucia } from "$lib/server/auth/lucia";
import { confirmReauth, reauthMessage } from "$lib/server/auth/reauth";
import { accountHasPassword, checkDestructiveGuard } from "$lib/server/auth/destructive-guard";
import { logAudit } from "$lib/server/audit";
import {
  wipeArchivedMedications as wipeArchivedMedicationsForUser,
  wipeDoseHistory as wipeDoseHistoryForUser,
} from "$lib/server/api/wipe";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;

  const [
    doseCountRow,
    archivedDoseRow,
    activeMedRow,
    archivedMedRow,
    sessionRow,
    auditRow,
    hasPassword,
  ] = await Promise.all([
    // One query for both numbers the dose-history dialog states: how many
    // doses, and how many medications they span.
    db
      .select({ value: count(), medications: countDistinct(doseLogs.medicationId) })
      .from(doseLogs)
      .where(eq(doseLogs.userId, userId)),
    // What "Delete archived medications" takes with it.
    db
      .select({ value: count() })
      .from(doseLogs)
      .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
      .where(and(eq(doseLogs.userId, userId), eq(medications.isArchived, true))),
    db
      .select({ value: count() })
      .from(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isArchived, false))),
    db
      .select({ value: count() })
      .from(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isArchived, true))),
    db.select({ value: count() }).from(sessions).where(eq(sessions.userId, userId)),
    db.select({ value: count() }).from(auditLogs).where(eq(auditLogs.userId, userId)),
    accountHasPassword(userId),
  ]);

  return {
    counts: {
      doseLogs: doseCountRow[0]?.value ?? 0,
      doseMedications: doseCountRow[0]?.medications ?? 0,
      activeMedications: activeMedRow[0]?.value ?? 0,
      archivedMedications: archivedMedRow[0]?.value ?? 0,
      archivedDoses: archivedDoseRow[0]?.value ?? 0,
      sessions: sessionRow[0]?.value ?? 0,
      auditLogs: auditRow[0]?.value ?? 0,
    },
    hasPassword,
  };
};

// Revoking sessions is not one of the four deletions nothing can undo, so it
// keeps this password-only gate rather than checkDestructiveGuard. An account
// with no password still cannot use it; that is a separate follow-up.
async function requirePassword(
  userId: string,
  formData: FormData,
  purpose: Parameters<typeof confirmReauth>[2],
): Promise<{ ok: boolean; error?: string }> {
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Password is required to confirm this action." };
  const reauth = await confirmReauth(userId, password, purpose);
  if (!reauth.ok) return { ok: false, error: reauthMessage(reauth) };
  return { ok: true };
}

export const actions: Actions = {
  // Both wipes delegate to src/lib/server/api/wipe.ts rather than
  // deleting inline. That module does the delete, the `users.syncEpoch`
  // bump and the audit row in one transaction. The epoch bump is the
  // part that matters: a bulk delete writes no per-row tombstone, so
  // without it a native client keeps showing rows that are gone from the
  // server — which is exactly what the inline version here used to do.
  wipeDoseHistory: async ({ request, locals }) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user!.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");
    const userId = locals.user.id;
    const formData = await request.formData();
    const guard = await checkDestructiveGuard(userId, formData, {
      word: "DELETE",
      purpose: "wipe_dose_history",
    });
    if (!guard.ok) return fail(400, { error: guard.error });

    const { deleted } = await wipeDoseHistoryForUser(userId);
    return { wipeDosesOk: true, removed: deleted };
  },

  wipeArchivedMedications: async ({ request, locals }) => {
    if (!locals.user) error(401, "Unauthorized");
    const userId = locals.user.id;
    const formData = await request.formData();
    const guard = await checkDestructiveGuard(userId, formData, {
      word: "DELETE",
      purpose: "wipe_archived_medications",
    });
    if (!guard.ok) return fail(400, { error: guard.error });

    const { deleted } = await wipeArchivedMedicationsForUser(userId);
    return { wipeArchivedOk: true, removed: deleted };
  },

  revokeOtherSessions: async ({ request, locals }) => {
    if (!locals.user) error(401, "Unauthorized");
    const userId = locals.user.id;
    const formData = await request.formData();
    const reauth = await requirePassword(userId, formData, "revoke_all_sessions");
    if (!reauth.ok) return fail(400, { revokeError: reauth.error });

    const currentSessionId = locals.session!.id;
    const others = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));

    for (const s of others) {
      await lucia.invalidateSession(s.id);
    }
    await logAudit(userId, "session", "*", "delete", {
      revoked: { from: others.length, to: 0 },
    });
    return { revokeOk: true, removed: others.length };
  },
};
