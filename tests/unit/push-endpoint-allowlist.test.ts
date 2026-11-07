import { describe, it, expect } from "vitest";
import { pushSubscriptionSchema } from "$lib/utils/validation";

// The allowlist is decided on the PARSED hostname, never on the raw string.
// A `startsWith` check accepted every look-alike below and rejected the real
// per-region Windows endpoints, which is why both halves are pinned here.
const keys = { p256dh: "BNcRdreALRFX", auth: "tBHItJ" };
const accepts = (endpoint: string) => pushSubscriptionSchema.safeParse({ endpoint, keys }).success;

describe("push endpoint allowlist", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://fcm.googleapis.com/wp/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk",
    "https://web.push.apple.com/QH0pVQ",
    // Real WNS endpoints live on per-region subdomains.
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://db5p.notify.windows.com/w/?token=abc",
    // An explicit default port is the same origin; URL folds it away.
    "https://fcm.googleapis.com:443/fcm/send/abc123",
    // Hostnames are case-insensitive.
    "https://FCM.GoogleAPIs.com/fcm/send/abc123",
  ])("accepts %s", (endpoint) => {
    expect(accepts(endpoint)).toBe(true);
  });

  it.each([
    // Suffix look-alikes: the allowlisted name is a prefix of a foreign host.
    "https://fcm.googleapis.com.evil.example/collect",
    "https://web.push.apple.com.evil.example/collect",
    "https://notify.windows.com.evil.example/collect",
    // Userinfo: the allowlisted name is a username; the host is elsewhere.
    "https://fcm.googleapis.com@127.0.0.1/x",
    "https://fcm.googleapis.com@169.254.169.254/latest/meta-data",
    "https://user:pass@fcm.googleapis.com/fcm/send/abc",
    // Subdomain matching is on a dot boundary only.
    "https://evilnotify.windows.com/w/?token=abc",
    // Subdomains are allowed only where the service publishes them.
    "https://evil.fcm.googleapis.com/fcm/send/abc",
    // Not https, or not the published port.
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
  ])("rejects %s", (endpoint) => {
    expect(accepts(endpoint)).toBe(false);
  });

  it("keeps the 2048-character bound", () => {
    const base = "https://fcm.googleapis.com/fcm/send/";
    expect(accepts(base + "a".repeat(2048 - base.length))).toBe(true);
    expect(accepts(base + "a".repeat(2049 - base.length))).toBe(false);
  });
});
