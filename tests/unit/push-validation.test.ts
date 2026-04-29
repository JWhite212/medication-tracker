import { describe, it, expect } from "vitest";
import { pushSubscriptionSchema } from "$lib/utils/validation";

describe("pushSubscriptionSchema", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "BNcRdreALRFX", auth: "tBHItJ" },
  };

  it("accepts valid FCM subscription", () => {
    expect(pushSubscriptionSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts Mozilla push endpoint", () => {
    const sub = {
      ...valid,
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk",
    };
    expect(pushSubscriptionSchema.safeParse(sub).success).toBe(true);
  });

  it("accepts Windows push endpoint", () => {
    const sub = {
      ...valid,
      endpoint: "https://notify.windows.com/push/abc",
    };
    expect(pushSubscriptionSchema.safeParse(sub).success).toBe(true);
  });

  it("accepts Apple push endpoint", () => {
    const sub = {
      ...valid,
      endpoint: "https://web.push.apple.com/push/abc",
    };
    expect(pushSubscriptionSchema.safeParse(sub).success).toBe(true);
  });

  it("rejects non-push-service URL", () => {
    const sub = { ...valid, endpoint: "https://evil.com/collect" };
    expect(pushSubscriptionSchema.safeParse(sub).success).toBe(false);
  });

  it("rejects non-URL endpoint", () => {
    const sub = { ...valid, endpoint: "not-a-url" };
    expect(pushSubscriptionSchema.safeParse(sub).success).toBe(false);
  });

  it("rejects missing keys object", () => {
    expect(pushSubscriptionSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(false);
  });

  it("rejects empty p256dh", () => {
    const sub = { ...valid, keys: { p256dh: "", auth: "x" } };
    expect(pushSubscriptionSchema.safeParse(sub).success).toBe(false);
  });

  it("rejects empty auth", () => {
    const sub = { ...valid, keys: { p256dh: "x", auth: "" } };
    expect(pushSubscriptionSchema.safeParse(sub).success).toBe(false);
  });
});
