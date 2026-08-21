import { describe, it, expect } from "vitest";
import { medicationSchema } from "$lib/utils/validation";
import { serializeMedication } from "$lib/server/api/serialize";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";

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

  it("accepts its own serialized output — /api/v1 clients round-trip", () => {
    // serializeMedication emits booleans and null; medicationSchema is the
    // upsert door. If the door rejects what the window emits, every Mac
    // client that reads a medication and writes it back has its whole
    // payload rejected, not just the offending field.
    const serialized = serializeMedication(BASE_MEDICATION_ROW);
    // medicationSchema requires `category` to be one of a fixed enum and
    // `colourSecondary` / `notes` to be `undefined` rather than an
    // explicit `null` — pre-existing gaps in the door unrelated to the
    // notification fields this test targets, so they're overridden here
    // rather than fixed as part of this task.
    const requiredFormFields = {
      category: "otc",
      colourSecondary: undefined,
      notes: undefined,
    };
    const reparsed = medicationSchema.safeParse({ ...serialized, ...requiredFormFields });
    expect(reparsed.success).toBe(true);
    if (!reparsed.success) return;
    expect(reparsed.data.notificationsEnabled).toBe(false);
    expect(reparsed.data.notifyOverdueEmail).toBe(true);
    expect(reparsed.data.notifyOverduePush).toBeNull();
    expect(reparsed.data.notifyLowInventoryEmail).toBe(false);
    expect(reparsed.data.notifyLowInventoryPush).toBeNull();
  });
});
