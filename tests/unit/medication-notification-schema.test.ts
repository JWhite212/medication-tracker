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
    // BASE_MEDICATION_ROW's notifyRepeatEveryMinutes is null (the column
    // default, "do not repeat") — the realistic majority case, and the
    // one that exposed the gap this round trip exists to catch.
    // notifyOffsetMinutes/notifyMaxRepeats round-trip through their own
    // z.coerce.number() arm regardless, so this pins the field that
    // actually needed the fix.
    expect(BASE_MEDICATION_ROW.notifyRepeatEveryMinutes).toBeNull();
    expect(reparsed.data.notifyOffsetMinutes).toBe(0);
    expect(reparsed.data.notifyRepeatEveryMinutes).toBeNull();
    expect(reparsed.data.notifyMaxRepeats).toBe(3);
  });
});

describe("medicationSchema — round-trips an unset medication", () => {
  it("accepts its own serialized output when colourSecondary, notes, scheduleIntervalHours, inventoryCount, and inventoryAlertThreshold are all unset", () => {
    // BASE_MEDICATION_ROW already carries colourSecondary/notes as null,
    // but scheduleIntervalHours/inventoryCount/inventoryAlertThreshold are
    // non-null there — the "PRN medication with no inventory tracking"
    // case isn't covered by spreading the fixture as-is, so construct it
    // explicitly. `category` is overridden the same way the notification
    // round-trip test above does, for the same pre-existing, unrelated
    // reason (BASE_MEDICATION_ROW's "pain relief" isn't in the enum).
    const unsetRow = {
      ...BASE_MEDICATION_ROW,
      category: "otc",
      scheduleIntervalHours: null,
      inventoryCount: null,
      inventoryAlertThreshold: null,
    };
    const serialized = serializeMedication(unsetRow);
    expect(serialized.colourSecondary).toBeNull();
    expect(serialized.notes).toBeNull();
    expect(serialized.scheduleIntervalHours).toBeNull();
    expect(serialized.inventoryCount).toBeNull();
    expect(serialized.inventoryAlertThreshold).toBeNull();

    const reparsed = medicationSchema.safeParse(serialized);
    expect(reparsed.success).toBe(true);
    if (!reparsed.success) return;
    expect(reparsed.data.colourSecondary).toBeNull();
    expect(reparsed.data.notes).toBeNull();
    expect(reparsed.data.scheduleIntervalHours).toBeNull();
    // The defect this test exists to catch: null must stay null, never
    // silently become 0.
    expect(reparsed.data.inventoryCount).toBeNull();
    expect(reparsed.data.inventoryCount).not.toBe(0);
    expect(reparsed.data.inventoryAlertThreshold).toBeNull();
    expect(reparsed.data.inventoryAlertThreshold).not.toBe(0);
  });
});

describe("medicationSchema — timing fields", () => {
  it("defaults to no offset, no repeat, three max repeats", () => {
    const parsed = medicationSchema.parse({ ...BASE });
    expect(parsed.notifyOffsetMinutes).toBe(0);
    expect(parsed.notifyRepeatEveryMinutes).toBeNull();
    expect(parsed.notifyMaxRepeats).toBe(3);
  });

  it("treats a blank repeat interval as null, NOT as zero", () => {
    // z.coerce.number() turns "" into 0, which is the trap that already
    // mis-stores inventoryAlertThreshold. Zero here would mean an
    // interval of zero minutes, not "no repeat".
    const parsed = medicationSchema.parse({ ...BASE, notifyRepeatEveryMinutes: "" });
    expect(parsed.notifyRepeatEveryMinutes).toBeNull();
  });

  it("accepts a valid repeat interval", () => {
    const parsed = medicationSchema.parse({ ...BASE, notifyRepeatEveryMinutes: "30" });
    expect(parsed.notifyRepeatEveryMinutes).toBe(30);
  });

  it("rejects a sub-minute repeat interval", () => {
    // #110 blocker (4): no lower bound meant a fractional interval
    // allocated ~390k Dates per row.
    expect(medicationSchema.safeParse({ ...BASE, notifyRepeatEveryMinutes: "0" }).success).toBe(
      false,
    );
    expect(medicationSchema.safeParse({ ...BASE, notifyRepeatEveryMinutes: "0.001" }).success).toBe(
      false,
    );
  });

  it("rejects an interval beyond a day and an offset beyond twelve hours", () => {
    expect(medicationSchema.safeParse({ ...BASE, notifyRepeatEveryMinutes: "1441" }).success).toBe(
      false,
    );
    expect(medicationSchema.safeParse({ ...BASE, notifyOffsetMinutes: "721" }).success).toBe(false);
  });

  it("rejects a negative offset", () => {
    // The sweep only sees slots that have already elapsed, so a negative
    // offset could never fire early — it would be a setting that does
    // not mean what it says.
    expect(medicationSchema.safeParse({ ...BASE, notifyOffsetMinutes: "-15" }).success).toBe(false);
  });

  it("bounds maxRepeats", () => {
    expect(medicationSchema.safeParse({ ...BASE, notifyMaxRepeats: "11" }).success).toBe(false);
    expect(medicationSchema.parse({ ...BASE, notifyMaxRepeats: "0" }).notifyMaxRepeats).toBe(0);
  });

  it("rejects a non-numeric repeat interval instead of coercing to NaN", () => {
    // Number("abc") is NaN, and z.number() rejects NaN — but that's an
    // easy thing to get wrong when hand-rolling a transform+pipe, so pin
    // it with a test rather than assuming the pipe catches it.
    expect(medicationSchema.safeParse({ ...BASE, notifyRepeatEveryMinutes: "abc" }).success).toBe(
      false,
    );
  });

  // The tests above pin every reject-side edge (1441, -15, 721, 11) but
  // left most accept-side edges unpinned — a bound that quietly narrowed
  // by one step (e.g. min(2) instead of min(1)) would pass a suite full
  // of mid-range values without ever going red.
  it("accepts a repeat interval at both bounds", () => {
    expect(
      medicationSchema.parse({ ...BASE, notifyRepeatEveryMinutes: "1" }).notifyRepeatEveryMinutes,
    ).toBe(1);
    expect(
      medicationSchema.parse({ ...BASE, notifyRepeatEveryMinutes: "1440" })
        .notifyRepeatEveryMinutes,
    ).toBe(1440);
  });

  it("accepts an offset at both bounds", () => {
    expect(medicationSchema.parse({ ...BASE, notifyOffsetMinutes: "0" }).notifyOffsetMinutes).toBe(
      0,
    );
    expect(
      medicationSchema.parse({ ...BASE, notifyOffsetMinutes: "720" }).notifyOffsetMinutes,
    ).toBe(720);
  });

  it("accepts maxRepeats at both bounds", () => {
    expect(medicationSchema.parse({ ...BASE, notifyMaxRepeats: "0" }).notifyMaxRepeats).toBe(0);
    expect(medicationSchema.parse({ ...BASE, notifyMaxRepeats: "10" }).notifyMaxRepeats).toBe(10);
  });
});
