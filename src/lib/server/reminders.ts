import { sql, eq, or, and, isNotNull, ne, inArray, max } from "drizzle-orm";
import { db } from "$lib/server/db";
import {
  medications,
  doseLogs,
  users,
  userPreferences,
  medicationSchedules,
} from "$lib/server/db/schema";
import { sendReminderEmail, sendLowInventoryEmail, isEmailConfigured } from "./email";
import { sendPushNotification, hasPushSubscriptions } from "./push";
import { formatTimeSince } from "$lib/utils/time";
import { lowInventoryTag, overdueTag } from "$lib/utils/push-payload";
import {
  computeOverdueSlot,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
} from "./reminders/domain";
import { withReminderClaim } from "./reminders/dispatch";
import { resolveChannels } from "./notifications/resolve";

export {
  computeOverdueSlot,
  isScheduleOverdue,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
} from "./reminders/domain";

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
      userLowInventoryEmailAlerts: userPreferences.lowInventoryEmailAlerts,
      userLowInventoryPushAlerts: userPreferences.lowInventoryPushAlerts,
      medNotificationsEnabled: medications.notificationsEnabled,
      medNotifyOverdueEmail: medications.notifyOverdueEmail,
      medNotifyOverduePush: medications.notifyOverduePush,
      medNotifyLowInventoryEmail: medications.notifyLowInventoryEmail,
      medNotifyLowInventoryPush: medications.notifyLowInventoryPush,
    })
    .from(medicationSchedules)
    .innerJoin(medications, eq(medicationSchedules.medicationId, medications.id))
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        ne(medicationSchedules.scheduleKind, "prn"),
        eq(medications.notificationsEnabled, true),
        // coalesce, not a bare column test. `m.notify_overdue_email = true`
        // is false for every medication that has never been configured,
        // which is almost all of them — the same shape of mistake as
        // putting a child predicate in the WHERE of a LEFT JOIN.
        or(
          sql`coalesce(${medications.notifyOverdueEmail}, ${userPreferences.overdueEmailReminders})`,
          sql`coalesce(${medications.notifyOverduePush}, ${userPreferences.overduePushReminders})`,
        ),
      ),
    );

  // Fetch the most recent HANDLED dose per medication in one grouped query
  // instead of running a correlated subquery per schedule row.
  //
  // "Handled" means taken OR skipped. `getLastDoseTimes` in doses.ts already
  // documents this as the anchor that drives overdue timing — "taken and
  // skipped advance the clock so the user can dismiss an overdue slot by
  // skipping it" — and the dashboard has always honoured it. This scan did
  // not, so skipping a dose cleared the dashboard badge and still sent a
  // push. `missed` is deliberately excluded: it records that a dose was not
  // consumed, so the slot is still outstanding.
  const medicationIds = Array.from(new Set(scheduleRows.map((r) => r.medicationId)));
  const lastEventByMedication = new Map<string, Date>();
  if (medicationIds.length > 0) {
    const lastEventRows = await db
      .select({
        medicationId: doseLogs.medicationId,
        lastEventAt: max(doseLogs.takenAt),
      })
      .from(doseLogs)
      .where(
        and(
          inArray(doseLogs.medicationId, medicationIds),
          inArray(doseLogs.status, ["taken", "skipped"]),
        ),
      )
      .groupBy(doseLogs.medicationId);

    for (const r of lastEventRows) {
      if (r.lastEventAt !== null) {
        lastEventByMedication.set(r.medicationId, new Date(r.lastEventAt));
      }
    }
  }

  const now = new Date();
  const emailGloballyConfigured = isEmailConfigured();

  for (const scheduleRow of scheduleRows) {
    const row = {
      ...scheduleRow,
      lastEventAt: lastEventByMedication.get(scheduleRow.medicationId) ?? null,
    };
    const slot = computeOverdueSlot(row, now);
    if (!slot) continue;

    const channels = resolveChannels(
      {
        notificationsEnabled: row.medNotificationsEnabled,
        notifyOverdueEmail: row.medNotifyOverdueEmail,
        notifyOverduePush: row.medNotifyOverduePush,
        notifyLowInventoryEmail: row.medNotifyLowInventoryEmail,
        notifyLowInventoryPush: row.medNotifyLowInventoryPush,
      },
      {
        overdueEmailReminders: row.userOverdueEmailReminders,
        overduePushReminders: row.userOverduePushReminders,
        lowInventoryEmailAlerts: row.userLowInventoryEmailAlerts,
        lowInventoryPushAlerts: row.userLowInventoryPushAlerts,
      },
    );

    const dedupeKey = buildOverdueDedupeKey(
      row.userId,
      row.medicationId,
      row.scheduleKind,
      row.scheduleId,
      slot,
    );

    const emailConfigured =
      channels.overdueEmail && emailGloballyConfigured && row.userEmailVerified;
    // "logged", not "taken": the anchor now counts skips, so a reminder can
    // follow a skip and asserting the dose was taken would be false.
    const sinceLabel = row.lastEventAt ? formatTimeSince(new Date(row.lastEventAt)) : "never";

    // Intent passes the raw push opt-in, NOT the post-probe value: the
    // probe runs inside the callback below and may itself throw. Using
    // the post-probe flag would let a probe-time DB blip resolve the row
    // to status=sent with both channels not_configured, consuming the
    // dedupe slot for that overdue window with nothing delivered.
    await withReminderClaim(
      {
        userId: row.userId,
        medicationId: row.medicationId,
        reminderType: "overdue",
        dedupeKey,
      },
      { email: emailConfigured, push: channels.overduePush },
      async (out) => {
        // Email first so a transient failure inside the push channel
        // (e.g. the subscription lookup hitting a DB blip) doesn't
        // poison an already-successful email send.
        if (emailConfigured) {
          out.email = await sendReminderEmail(row.userEmail, row.medicationName, sinceLabel);
        }
        // Push is configured when the user has opted in AND has an
        // active subscription on at least one device.
        let pushConfigured = false;
        if (channels.overduePush) {
          pushConfigured = await hasPushSubscriptions(row.userId);
        }
        if (pushConfigured) {
          out.push = await sendPushNotification(row.userId, {
            title: `${row.medicationName} overdue`,
            body: row.lastEventAt
              ? `Last logged ${formatTimeSince(new Date(row.lastEventAt))} ago`
              : "Not yet logged",
            url: "/dashboard",
            tag: overdueTag(row.medicationId),
          });
        }
      },
    );
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
    //
    // This gate is kept in the caller rather than in withReminderClaim
    // because it is specific to this sweep: the overdue sweep's dedupe
    // key includes the slot, so a stale suppression self-heals on the
    // next slot, and it deliberately has no equivalent gate.
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
    await withReminderClaim(
      {
        userId: med.userId,
        medicationId: med.medicationId,
        reminderType: "low_inventory",
        dedupeKey,
      },
      // Post-probe values, not raw opt-in: unlike the overdue sweep the
      // probe already ran and succeeded before the claim, so pushWillFire
      // is the accurate intent here.
      { email: emailWillFire, push: pushWillFire },
      async (out) => {
        // Email first so a transient push failure can't poison an
        // already-sent email.
        if (emailWillFire) {
          out.email = await sendLowInventoryEmail(
            med.userEmail,
            med.medicationName,
            med.inventoryCount!,
            med.inventoryAlertThreshold!,
          );
        }
        if (pushWillFire) {
          out.push = await sendPushNotification(med.userId, {
            title: `Low inventory: ${med.medicationName}`,
            body: `${med.inventoryCount} doses remaining (threshold ${med.inventoryAlertThreshold}).`,
            url: "/medications",
            tag: lowInventoryTag(med.medicationId),
          });
        }
      },
    );
  }
}
