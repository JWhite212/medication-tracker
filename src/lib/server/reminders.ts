import { sql, eq, or, and, isNotNull, ne, inArray, max } from "drizzle-orm";
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
  // SQL filter: include rows where at least one channel is enabled.
  // Per-channel gating happens inside the loop below so a user with
  // email-only or push-only still gets exactly the channels they
  // asked for.
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
      userOverdueEmailReminders: userPreferences.overdueEmailReminders,
      userOverduePushReminders: userPreferences.overduePushReminders,
    })
    .from(medicationSchedules)
    .innerJoin(medications, eq(medicationSchedules.medicationId, medications.id))
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        ne(medicationSchedules.scheduleKind, "prn"),
        or(
          eq(userPreferences.overdueEmailReminders, true),
          eq(userPreferences.overduePushReminders, true),
        ),
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

    const emailConfigured =
      row.userOverdueEmailReminders && emailGloballyConfigured && row.userEmailVerified;
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
      // Push channel is configured when the user has opted in AND has
      // an active subscription on at least one device.
      pushConfigured = row.userOverduePushReminders && (await hasPushSubscriptions(row.userId));
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
      userLowInventoryEmailAlerts: userPreferences.lowInventoryEmailAlerts,
      userLowInventoryPushAlerts: userPreferences.lowInventoryPushAlerts,
    })
    .from(medications)
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        isNotNull(medications.inventoryCount),
        isNotNull(medications.inventoryAlertThreshold),
        or(
          eq(userPreferences.lowInventoryEmailAlerts, true),
          eq(userPreferences.lowInventoryPushAlerts, true),
        ),
        sql`${medications.inventoryCount} <= ${medications.inventoryAlertThreshold}`,
      ),
    );

  const emailGloballyConfigured = isEmailConfigured();

  for (const med of lowMeds) {
    const emailWillFire =
      med.userLowInventoryEmailAlerts && emailGloballyConfigured && med.userEmailVerified;
    const pushOptIn = med.userLowInventoryPushAlerts;

    // Determine whether push CAN actually fire (opt-in AND active
    // subscription) BEFORE the pre-claim gate. Treating opt-in alone
    // as sufficient would let us claim the row, send nothing, and
    // complete as 'sent' — and because the dedupe key is (user,
    // medication, inventoryCount), the user re-subscribing later
    // would still hit the suppressed key for that count.
    //
    // If hasPushSubscriptions itself throws, skip the iteration: no
    // row is claimed, and the next cron tick retries cleanly.
    let pushWillFire = false;
    if (pushOptIn) {
      try {
        pushWillFire = await hasPushSubscriptions(med.userId);
      } catch (err) {
        console.warn(
          `low-inventory push probe failed for med=${med.medicationId}: ${err instanceof Error ? err.message : "non-Error"}`,
        );
        continue;
      }
    }

    if (!emailWillFire && !pushWillFire) {
      console.warn(
        `low-inventory skipped for med=${med.medicationId}: no enabled channel can fire`,
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
    let pushResult: PushResult | null = null;
    let dispatchError: string | null = null;

    // Same try/catch contract as the overdue path. Email goes first so
    // a transient push failure can't poison an already-sent email.
    try {
      if (emailWillFire) {
        emailResult = await sendLowInventoryEmail(
          med.userEmail,
          med.medicationName,
          med.inventoryCount!,
          med.inventoryAlertThreshold!,
        );
      }
      if (pushWillFire) {
        pushResult = await sendPushNotification(med.userId, {
          title: `Low inventory: ${med.medicationName}`,
          body: `${med.inventoryCount} doses remaining (threshold ${med.inventoryAlertThreshold}).`,
          url: "/medications",
          tag: `low-inventory-${med.medicationId}`,
        });
      }
    } catch (err) {
      dispatchError = err instanceof Error ? err.message : "non-Error thrown during dispatch";
      if (emailWillFire && emailResult === null) {
        emailResult = { ok: false, reason: "provider_error", message: dispatchError };
      }
      if (pushWillFire && pushResult === null) {
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
