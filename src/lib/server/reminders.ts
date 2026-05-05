import { sql, eq, and, isNotNull, ne, inArray, max } from "drizzle-orm";
import { db } from "$lib/server/db";
import {
  medications,
  doseLogs,
  users,
  userPreferences,
  medicationSchedules,
  type ReminderChannelStatus,
} from "$lib/server/db/schema";
import {
  sendReminderEmail,
  sendLowInventoryEmail,
  isEmailConfigured,
  type EmailResult,
} from "./email";
import { sendPushNotification, hasPushSubscriptions, type PushResult } from "./push";
import { formatTimeSince } from "$lib/utils/time";
import {
  computeOverdueSlot,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
} from "./reminders/domain";
import { claimReminderSlot, completeReminder } from "./reminders/dispatch";

export {
  computeOverdueSlot,
  isScheduleOverdue,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
} from "./reminders/domain";

function emailStatusFromResult(result: EmailResult | null): ReminderChannelStatus {
  if (result === null) return "not_configured";
  return result.ok ? "sent" : "failed";
}

function pushStatusFromResult(result: PushResult | null): ReminderChannelStatus {
  if (result === null) return "not_configured";
  if (result.ok) return "sent";
  // The push module reports `not_configured` when VAPID is unset and
  // `no_subscriptions` when the user has none — neither is a "send
  // attempt that failed", so they shouldn't be marked as failed.
  if (result.reason === "not_configured" || result.reason === "no_subscriptions") {
    return "not_configured";
  }
  return "failed";
}

function summariseError(email: EmailResult | null, push: PushResult | null): string | null {
  const parts: string[] = [];
  if (email && !email.ok) parts.push(`email:${email.reason}=${email.message}`);
  if (push && !push.ok && push.reason === "all_failed") {
    parts.push(`push:all_failed=${push.message}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

export async function checkOverdueMedications() {
  // P3 will split email/push prefs; for now the existing
  // `emailReminders` toggle gates this entire pipeline. emailVerified
  // is selected so the email channel can be skipped for unverified
  // users while push still attempts.
  const scheduleRows = await db
    .select({
      scheduleId: medicationSchedules.id,
      scheduleKind: medicationSchedules.scheduleKind,
      intervalHours: medicationSchedules.intervalHours,
      timeOfDay: medicationSchedules.timeOfDay,
      daysOfWeek: medicationSchedules.daysOfWeek,
      medicationId: medications.id,
      medicationName: medications.name,
      userId: medications.userId,
      userEmail: users.email,
      userEmailVerified: users.emailVerified,
      userTimezone: users.timezone,
    })
    .from(medicationSchedules)
    .innerJoin(medications, eq(medicationSchedules.medicationId, medications.id))
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        ne(medicationSchedules.scheduleKind, "prn"),
        eq(userPreferences.emailReminders, true),
      ),
    );

  // Fetch the most recent taken dose per medication in one grouped query
  // instead of running a correlated subquery per schedule row.
  const medicationIds = Array.from(new Set(scheduleRows.map((r) => r.medicationId)));
  const lastTakenByMedication = new Map<string, Date>();
  if (medicationIds.length > 0) {
    const lastTakenRows = await db
      .select({
        medicationId: doseLogs.medicationId,
        lastTakenAt: max(doseLogs.takenAt),
      })
      .from(doseLogs)
      .where(and(inArray(doseLogs.medicationId, medicationIds), eq(doseLogs.status, "taken")))
      .groupBy(doseLogs.medicationId);

    for (const r of lastTakenRows) {
      if (r.lastTakenAt !== null) {
        lastTakenByMedication.set(r.medicationId, new Date(r.lastTakenAt));
      }
    }
  }

  const now = new Date();
  const emailGloballyConfigured = isEmailConfigured();

  for (const scheduleRow of scheduleRows) {
    const row = {
      ...scheduleRow,
      lastTakenAt: lastTakenByMedication.get(scheduleRow.medicationId) ?? null,
    };
    const slot = computeOverdueSlot(row, now);
    if (!slot) continue;

    const dedupeKey = buildOverdueDedupeKey(
      row.userId,
      row.medicationId,
      row.scheduleKind,
      row.scheduleId,
      slot,
    );

    const claim = await claimReminderSlot({
      userId: row.userId,
      medicationId: row.medicationId,
      reminderType: "overdue",
      dedupeKey,
    });
    if (!claim) continue;

    const emailConfigured = emailGloballyConfigured && row.userEmailVerified;
    const sinceLabel = row.lastTakenAt ? formatTimeSince(new Date(row.lastTakenAt)) : "never";

    let emailResult: EmailResult | null = null;
    let pushResult: PushResult | null = null;
    let pushConfigured = false;
    let dispatchError: string | null = null;

    // After a successful claim, every code path MUST reach
    // completeReminder — otherwise the row stays at status='pending'
    // and the retry predicate (which targets 'failed' or stale
    // 'pending') won't pick it up promptly. A thrown error from
    // hasPushSubscriptions, the email senders, or sendPushNotification
    // is converted into a failed channel result here.
    //
    // Email is dispatched first so a transient failure inside the
    // push channel (e.g. the subscription lookup hitting a DB blip)
    // doesn't poison an already-successful email send.
    try {
      if (emailConfigured) {
        emailResult = await sendReminderEmail(row.userEmail, row.medicationName, sinceLabel);
      }
      pushConfigured = await hasPushSubscriptions(row.userId);
      if (pushConfigured) {
        pushResult = await sendPushNotification(row.userId, {
          title: `${row.medicationName} overdue`,
          body: row.lastTakenAt
            ? `Last taken ${formatTimeSince(new Date(row.lastTakenAt))} ago`
            : "Not yet taken",
          url: "/dashboard",
          tag: `overdue-${row.medicationId}`,
        });
      }
    } catch (err) {
      dispatchError = err instanceof Error ? err.message : "non-Error thrown during dispatch";
      if (emailConfigured && emailResult === null) {
        emailResult = { ok: false, reason: "provider_error", message: dispatchError };
      }
      if (pushConfigured && pushResult === null) {
        pushResult = { ok: false, reason: "all_failed", message: dispatchError };
      }
    }

    await completeReminder(claim.id, {
      emailStatus: emailStatusFromResult(emailResult),
      pushStatus: pushStatusFromResult(pushResult),
      lastError: dispatchError ?? summariseError(emailResult, pushResult),
    });
  }
}

export async function checkLowInventoryMedications() {
  const lowMeds = await db
    .select({
      medicationId: medications.id,
      medicationName: medications.name,
      userId: medications.userId,
      inventoryCount: medications.inventoryCount,
      inventoryAlertThreshold: medications.inventoryAlertThreshold,
      userEmail: users.email,
      userEmailVerified: users.emailVerified,
    })
    .from(medications)
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        isNotNull(medications.inventoryCount),
        isNotNull(medications.inventoryAlertThreshold),
        eq(userPreferences.lowInventoryAlerts, true),
        sql`${medications.inventoryCount} <= ${medications.inventoryAlertThreshold}`,
      ),
    );

  const emailGloballyConfigured = isEmailConfigured();

  for (const med of lowMeds) {
    // Skip BEFORE claiming when no channel would fire. Low-inventory's
    // dedupe key is (user, medication, inventoryCount), so a row
    // claimed with no configured channels would resolve to status=sent
    // and suppress the alert forever (same count, same key, no
    // retry). Skipping the claim means the next cron tick after the
    // user verifies (or after the operator configures email) records
    // and sends.
    if (!med.userEmailVerified) {
      console.warn(`low-inventory skipped for med=${med.medicationId}: user email not verified`);
      continue;
    }
    if (!emailGloballyConfigured) {
      console.warn(
        `low-inventory skipped for med=${med.medicationId}: email not configured on this deployment`,
      );
      continue;
    }

    const dedupeKey = buildLowInventoryDedupeKey(med.userId, med.medicationId, med.inventoryCount!);
    const claim = await claimReminderSlot({
      userId: med.userId,
      medicationId: med.medicationId,
      reminderType: "low_inventory",
      dedupeKey,
    });
    if (!claim) continue;

    let emailResult: EmailResult | null = null;
    let dispatchError: string | null = null;

    // Same try/catch contract as the overdue path: if the email send
    // throws (the typed result already absorbs Resend errors, but DB
    // dependencies inside the path could still throw), promote to a
    // failed result so completeReminder still runs and the row can
    // retry.
    try {
      emailResult = await sendLowInventoryEmail(
        med.userEmail,
        med.medicationName,
        med.inventoryCount!,
        med.inventoryAlertThreshold!,
      );
    } catch (err) {
      dispatchError = err instanceof Error ? err.message : "non-Error thrown during dispatch";
      // The check mirrors the overdue path's pattern. The throw must
      // have happened before the assignment landed, so emailResult is
      // null here — but explicit-is-better-than-implicit and it
      // satisfies no-useless-assignment.
      if (emailResult === null) {
        emailResult = { ok: false, reason: "provider_error", message: dispatchError };
      }
    }

    // Low-inventory does not currently send push. Push channel stays
    // not_configured for these rows.
    await completeReminder(claim.id, {
      emailStatus: emailStatusFromResult(emailResult),
      pushStatus: "not_configured",
      lastError: dispatchError ?? summariseError(emailResult, null),
    });
  }
}
