import { fail } from "@sveltejs/kit";
import { eq, and, count, ne } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications, sessions, auditLogs } from "$lib/server/db/schema";
import { lucia } from "$lib/server/auth/lucia";
import { confirmReauth } from "$lib/server/auth/reauth";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;

  const [doseCountRow, activeMedRow, archivedMedRow, sessionRow, auditRow] = await Promise.all([
    db.select({ value: count() }).from(doseLogs).where(eq(doseLogs.userId, userId)),
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
  ]);

  return {
    counts: {
      doseLogs: doseCountRow[0]?.value ?? 0,
      activeMedications: activeMedRow[0]?.value ?? 0,
      archivedMedications: archivedMedRow[0]?.value ?? 0,
      sessions: sessionRow[0]?.value ?? 0,
      auditLogs: auditRow[0]?.value ?? 0,
    },
  };
};

async function requirePassword(
  userId: string,
  formData: FormData,
  purpose: Parameters<typeof confirmReauth>[2],
): Promise<{ ok: boolean; error?: string }> {
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Password is required to confirm this action." };
  const reauth = await confirmReauth(userId, password, purpose);
  if (!reauth.ok) return { ok: false, error: "Incorrect password." };
  return { ok: true };
}

export const actions: Actions = {
  wipeDoseHistory: async ({ request, locals }) => {
    const userId = locals.user!.id;
    const formData = await request.formData();
    const reauth = await requirePassword(userId, formData, "wipe_dose_history");
    if (!reauth.ok) return fail(400, { wipeDosesError: reauth.error });

    const deleted = await db
      .delete(doseLogs)
      .where(eq(doseLogs.userId, userId))
      .returning({ id: doseLogs.id });
    await logAudit(userId, "dose_log", "*", "delete", {
      deleted: { from: deleted.length, to: 0 },
    });
    return { wipeDosesOk: true, removed: deleted.length };
  },

  wipeArchivedMedications: async ({ request, locals }) => {
    const userId = locals.user!.id;
    const formData = await request.formData();
    const reauth = await requirePassword(userId, formData, "wipe_archived_medications");
    if (!reauth.ok) return fail(400, { wipeArchivedError: reauth.error });

    // Cascading FKs on dose_logs and medication_schedules drop the
    // dependent rows when the medication row goes.
    const deleted = await db
      .delete(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isArchived, true)))
      .returning({ id: medications.id });
    await logAudit(userId, "medication", "*", "delete", {
      deleted: { from: deleted.length, to: 0 },
      filter: { from: null, to: "archived" },
    });
    return { wipeArchivedOk: true, removed: deleted.length };
  },

  revokeOtherSessions: async ({ request, locals }) => {
    const userId = locals.user!.id;
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
