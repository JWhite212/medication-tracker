import { describe, it, expect } from "vitest";
import { medicationSchema } from "$lib/utils/validation";

const BASE = {
  name: "Test",
  dosageAmount: "1",
  dosageUnit: "mg",
  form: "tablet",
  category: "otc",
  colour: "#6366f1",
};

describe("medicationSchema — notification fields", () => {
  it("defaults to enabled with every override unset", () => {
    const parsed = medicationSchema.parse({ ...BASE });
    expect(parsed.notificationsEnabled).toBe(true);
    expect(parsed.notifyOverdueEmail).toBeNull();
    expect(parsed.notifyOverduePush).toBeNull();
    expect(parsed.notifyLowInventoryEmail).toBeNull();
    expect(parsed.notifyLowInventoryPush).toBeNull();
  });

  it('maps "inherit" to null, not false', () => {
    // null and false are different states. Collapsing them would freeze
    // the medication at whatever the global happened to be.
    const parsed = medicationSchema.parse({ ...BASE, notifyOverdueEmail: "inherit" });
    expect(parsed.notifyOverdueEmail).toBeNull();
  });

  it('maps "on" to true and "off" to false', () => {
    const on = medicationSchema.parse({ ...BASE, notifyOverduePush: "on" });
    const off = medicationSchema.parse({ ...BASE, notifyOverduePush: "off" });
    expect(on.notifyOverduePush).toBe(true);
    expect(off.notifyOverduePush).toBe(false);
  });

  it("rejects a value outside the tri-state", () => {
    const res = medicationSchema.safeParse({ ...BASE, notifyOverdueEmail: "maybe" });
    expect(res.success).toBe(false);
  });

  it("treats an absent notificationsEnabled as enabled, not muted", () => {
    // Absence means "an API client omitted the field", NOT "the user
    // unchecked a box". checkboxField maps absence to false and is
    // deliberately not reused here: reusing it would mute every
    // medication created through /api/v1 by a client that never heard
    // of this field. The web form never relies on absence — it submits
    // an explicit "off" via a hidden companion input.
    expect(medicationSchema.parse({ ...BASE }).notificationsEnabled).toBe(true);
    expect(
      medicationSchema.parse({ ...BASE, notificationsEnabled: undefined }).notificationsEnabled,
    ).toBe(true);
    expect(
      medicationSchema.parse({ ...BASE, notificationsEnabled: "on" }).notificationsEnabled,
    ).toBe(true);
  });

  it("an explicit off mutes the medication", () => {
    // The form's hidden companion input submits this. Without it the kill
    // switch would be unreachable from the UI: an unchecked checkbox
    // submits nothing, and absence means enabled.
    expect(
      medicationSchema.parse({ ...BASE, notificationsEnabled: "off" }).notificationsEnabled,
    ).toBe(false);
  });
});
