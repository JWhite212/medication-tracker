/**
 * Sole owner of "does this medication actually notify on this channel?".
 *
 * Both reminder sweeps consume this; neither re-derives it. The same
 * discipline as expectedPerDayFor and dailyRateFor — the quantity has one
 * owner precisely because two independent spellings of it drifted apart
 * once already.
 *
 * Pure. No I/O, no database, no clock.
 */

/** Only the medication columns resolution reads. */
export type MedicationNotificationOverrides = {
  notificationsEnabled: boolean;
  notifyOverdueEmail: boolean | null;
  notifyOverduePush: boolean | null;
  notifyLowInventoryEmail: boolean | null;
  notifyLowInventoryPush: boolean | null;
};

/** Only the user_preferences columns resolution reads. */
export type GlobalNotificationPreferences = {
  overdueEmailReminders: boolean;
  overduePushReminders: boolean;
  lowInventoryEmailAlerts: boolean;
  lowInventoryPushAlerts: boolean;
};

export type EffectiveChannels = {
  overdueEmail: boolean;
  overduePush: boolean;
  lowInventoryEmail: boolean;
  lowInventoryPush: boolean;
};

/**
 * Resolve one medication's effective channels.
 *
 * `??` is load-bearing and `||` is a bug: a column is `null` when the user
 * has expressed no preference and `false` when they have explicitly muted
 * the channel. `false || global` returns the global, silently discarding
 * the mute. `false ?? global` returns false, which is the whole feature.
 */
export function resolveChannels(
  med: MedicationNotificationOverrides,
  prefs: GlobalNotificationPreferences,
): EffectiveChannels {
  if (!med.notificationsEnabled) {
    return {
      overdueEmail: false,
      overduePush: false,
      lowInventoryEmail: false,
      lowInventoryPush: false,
    };
  }
  return {
    overdueEmail: med.notifyOverdueEmail ?? prefs.overdueEmailReminders,
    overduePush: med.notifyOverduePush ?? prefs.overduePushReminders,
    lowInventoryEmail: med.notifyLowInventoryEmail ?? prefs.lowInventoryEmailAlerts,
    lowInventoryPush: med.notifyLowInventoryPush ?? prefs.lowInventoryPushAlerts,
  };
}
