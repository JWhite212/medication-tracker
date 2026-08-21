import { describe, it, expect } from "vitest";
import {
  resolveChannels,
  type MedicationNotificationOverrides,
  type GlobalNotificationPreferences,
} from "$lib/server/notifications/resolve";

const ALL_GLOBAL_ON: GlobalNotificationPreferences = {
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: true,
};

const ALL_GLOBAL_OFF: GlobalNotificationPreferences = {
  overdueEmailReminders: false,
  overduePushReminders: false,
  lowInventoryEmailAlerts: false,
  lowInventoryPushAlerts: false,
};

const NO_OVERRIDES: MedicationNotificationOverrides = {
  notificationsEnabled: true,
  notifyOverdueEmail: null,
  notifyOverduePush: null,
  notifyLowInventoryEmail: null,
  notifyLowInventoryPush: null,
};

describe("resolveChannels", () => {
  it("inherits every global when no override is set", () => {
    expect(resolveChannels(NO_OVERRIDES, ALL_GLOBAL_ON)).toEqual({
      overdueEmail: true,
      overduePush: true,
      lowInventoryEmail: true,
      lowInventoryPush: true,
    });
  });

  it("inherits a false global just as faithfully", () => {
    expect(resolveChannels(NO_OVERRIDES, ALL_GLOBAL_OFF)).toEqual({
      overdueEmail: false,
      overduePush: false,
      lowInventoryEmail: false,
      lowInventoryPush: false,
    });
  });

  it("an explicit false override beats a true global", () => {
    // The `||` bug. `false || true` is true, which would silently ignore
    // every "mute this medication's email" the user ever sets. This is the
    // single most likely defect in the feature.
    const med = { ...NO_OVERRIDES, notifyOverdueEmail: false };
    expect(resolveChannels(med, ALL_GLOBAL_ON).overdueEmail).toBe(false);
  });

  it("an explicit true override beats a false global", () => {
    const med = { ...NO_OVERRIDES, notifyOverduePush: true };
    expect(resolveChannels(med, ALL_GLOBAL_OFF).overduePush).toBe(true);
  });

  it("overrides are independent — one does not leak into another", () => {
    const med = { ...NO_OVERRIDES, notifyOverdueEmail: false };
    const out = resolveChannels(med, ALL_GLOBAL_ON);
    expect(out.overdueEmail).toBe(false);
    expect(out.overduePush).toBe(true);
    expect(out.lowInventoryEmail).toBe(true);
    expect(out.lowInventoryPush).toBe(true);
  });

  it("the kill switch forces all four off regardless of overrides", () => {
    const med: MedicationNotificationOverrides = {
      notificationsEnabled: false,
      notifyOverdueEmail: true,
      notifyOverduePush: true,
      notifyLowInventoryEmail: true,
      notifyLowInventoryPush: true,
    };
    expect(resolveChannels(med, ALL_GLOBAL_ON)).toEqual({
      overdueEmail: false,
      overduePush: false,
      lowInventoryEmail: false,
      lowInventoryPush: false,
    });
  });

  it("returns a fresh object each call", () => {
    // Callers must not be able to mutate a shared constant into every
    // other medication's result.
    const a = resolveChannels({ ...NO_OVERRIDES, notificationsEnabled: false }, ALL_GLOBAL_ON);
    const b = resolveChannels({ ...NO_OVERRIDES, notificationsEnabled: false }, ALL_GLOBAL_ON);
    expect(a).not.toBe(b);
  });
});
