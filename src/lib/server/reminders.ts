import { sql, eq, or, and, isNotNull, isNull, ne, inArray, max } from "drizzle-orm";
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
  computeNagIndex,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
  LOW_INVENTORY_NAG_POLICY,
} from "./reminders/domain";
import { withReminderClaim } from "./reminders/dispatch";
import { resolveChannels } from "./notifications/resolve";
import { logWarn } from "$lib/server/log";

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
      medNotifyOffsetMinutes: medications.notifyOffsetMinutes,
      medNotifyRepeatEveryMinutes: medications.notifyRepeatEveryMinutes,
      medNotifyMaxRepeats: medications.notifyMaxRepeats,
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

    const nagIndex = computeNagIndex(
      slot,
      {
        offsetMinutes: row.medNotifyOffsetMinutes,
        repeatEveryMinutes: row.medNotifyRepeatEveryMinutes,
        maxRepeats: row.medNotifyMaxRepeats,
      },
      now,
    );
    // null means the offset has not elapsed yet — the slot is due but the
    // user asked to be told later.
    if (nagIndex === null) continue;

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
      nagIndex,
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
            // Same tag as the previous nag, so the tray holds one entry
            // per medication rather than N. That means each nag REPLACES
            // the last, which is why the re-alert has to be explicit.
            renotify: nagIndex > 0,
          });
        }
      },
    );
  }
}

export async function checkLowInventoryMedications() {
  // ONE clock for the whole tick, and deliberately the application's rather
  // than the database's. The episode instant is written here and then read
  // back by `computeNagIndex` to decide which nudge is due; sourcing the
  // write from `sql`now()`` and the comparison from `new Date()` puts two
  // clocks either side of one subtraction, so any skew between them
  // silently shifts the nudge schedule — and under a frozen test clock it
  // suppresses every alert outright.
  const sweepStartedAt = new Date();

  // Step 0 — close every episode whose stock has recovered, before reading
  // anything. This one statement is the ONLY thing that re-arms a
  // low-inventory alert, and it is a column predicate rather than a key
  // comparison so it is correct for all six writers of `inventoryCount` —
  // including the three (`updateMedicationWithSchedules`,
  // `createMedicationWithSchedules`, `import/apply.ts`) that append no
  // inventory event, i.e. the user who "refills" by typing a new number
  // into the edit form.
  //
  // Strictly `>`: a count sitting exactly AT the threshold is still low, and
  // `>=` would clear the episode and re-alert on every tick.
  //
  // Global, because the sweep is (the cron handler passes no user).
  await db
    .update(medications)
    .set({ lowInventoryEpisodeAt: null })
    .where(
      and(
        isNotNull(medications.lowInventoryEpisodeAt),
        or(
          isNull(medications.inventoryCount),
          isNull(medications.inventoryAlertThreshold),
          sql`${medications.inventoryCount} > ${medications.inventoryAlertThreshold}`,
        ),
      ),
    );

  const lowMeds = await db
    .select({
      medicationId: medications.id,
      medicationName: medications.name,
      userId: medications.userId,
      inventoryCount: medications.inventoryCount,
      inventoryAlertThreshold: medications.inventoryAlertThreshold,
      lowInventoryEpisodeAt: medications.lowInventoryEpisodeAt,
      userEmail: users.email,
      userEmailVerified: users.emailVerified,
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
    .from(medications)
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        isNotNull(medications.inventoryCount),
        isNotNull(medications.inventoryAlertThreshold),
        eq(medications.notificationsEnabled, true),
        // coalesce, not a bare column test — see the identical note on
        // the overdue sweep's WHERE above.
        or(
          sql`coalesce(${medications.notifyLowInventoryEmail}, ${userPreferences.lowInventoryEmailAlerts})`,
          sql`coalesce(${medications.notifyLowInventoryPush}, ${userPreferences.lowInventoryPushAlerts})`,
        ),
        sql`${medications.inventoryCount} <= ${medications.inventoryAlertThreshold}`,
      ),
    );

  const emailGloballyConfigured = isEmailConfigured();

  for (const med of lowMeds) {
    const channels = resolveChannels(
      {
        notificationsEnabled: med.medNotificationsEnabled,
        notifyOverdueEmail: med.medNotifyOverdueEmail,
        notifyOverduePush: med.medNotifyOverduePush,
        notifyLowInventoryEmail: med.medNotifyLowInventoryEmail,
        notifyLowInventoryPush: med.medNotifyLowInventoryPush,
      },
      {
        overdueEmailReminders: med.userOverdueEmailReminders,
        overduePushReminders: med.userOverduePushReminders,
        lowInventoryEmailAlerts: med.userLowInventoryEmailAlerts,
        lowInventoryPushAlerts: med.userLowInventoryPushAlerts,
      },
    );

    const emailWillFire =
      channels.lowInventoryEmail && emailGloballyConfigured && med.userEmailVerified;
    const pushOptIn = channels.lowInventoryPush;

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
        logWarn(
          "low-inventory push probe failed",
          { scope: "reminders.lowInventory", medicationId: med.medicationId, userId: med.userId },
          err,
        );
        continue;
      }
    }

    if (!emailWillFire && !pushWillFire) {
      logWarn("low-inventory skipped — no enabled channel can fire", {
        scope: "reminders.lowInventory",
        medicationId: med.medicationId,
        userId: med.userId,
      });
      continue;
    }

    // Open the episode if this is the first alert of one.
    //
    // AFTER the channel gates deliberately: opening it above them would
    // burn the episode for a user who can receive nothing, and under an
    // episode-scoped key a burned episode is silent until the count
    // recovers — not just until the count next moves, as it was when the
    // key held the count.
    //
    // Compare-and-set on `isNull`, so two overlapping ticks agree on one
    // episode instant instead of minting two keys and alerting twice. The
    // loser re-reads rather than assuming its own instant.
    //
    // NO TEST CAN FAIL ON THAT GUARD, and it is kept deliberately: it only
    // discriminates when two sweeps race, and PGlite is a single backend —
    // the same reason CLAUDE.md records that `.for("update")` is
    // unexercisable here. Deleting it survives the whole suite. It stays
    // because the two schedulers (the Vercel cron and the every-30-minutes
    // GitHub Action) genuinely can overlap, and because without it a
    // projection that ever dropped the column would silently reset a live
    // episode's nudge schedule instead of re-reading it.
    // Truthiness, not `=== null`: a projection that ever omits the column
    // yields `undefined`, which a strict null check waves through and which
    // then reaches computeNagIndex as a missing Date.
    let episodeAt = med.lowInventoryEpisodeAt;
    if (!episodeAt) {
      const [opened] = await db
        .update(medications)
        .set({ lowInventoryEpisodeAt: sweepStartedAt })
        .where(
          and(
            eq(medications.id, med.medicationId),
            eq(medications.userId, med.userId),
            isNull(medications.lowInventoryEpisodeAt),
          ),
        )
        .returning({ at: medications.lowInventoryEpisodeAt });

      if (opened?.at) {
        episodeAt = opened.at;
      } else {
        const [current] = await db
          .select({ at: medications.lowInventoryEpisodeAt })
          .from(medications)
          .where(eq(medications.id, med.medicationId))
          .limit(1);
        // Another tick opened it between our select and our update. If it
        // has since been closed (stock recovered in the gap) there is
        // nothing to alert about; the next tick will re-open if needed.
        if (!current?.at) continue;
        episodeAt = current.at;
      }
    }

    // Which nudge of this episode is due, if any. Bounded by
    // LOW_INVENTORY_NAG_POLICY, so an episode is at most three alerts and
    // then silent until the count recovers above the threshold.
    const nagIndex = computeNagIndex(episodeAt, LOW_INVENTORY_NAG_POLICY, sweepStartedAt);
    if (nagIndex === null) continue;

    const dedupeKey = buildLowInventoryDedupeKey(med.userId, med.medicationId, episodeAt, nagIndex);
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
