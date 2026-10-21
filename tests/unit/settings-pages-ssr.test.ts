// @vitest-environment node
//
// `node` is load-bearing for the reason tests/unit/appearance-page-ssr.test.ts
// gives: under jsdom vite resolves `svelte` to its client entry and `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs.
//
// The settings pages (profile, security, notifications), server-rendered, to
// pin what each draws and how it is announced: a save or a revoke from a
// status region that was mounted before the result arrived, a failure from an
// assertive Alert outside every polite region, and a state that is only a
// state (2FA enabled, push configured) in neutral words rather than green.
// The no-JS appearance page is pinned in appearance-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import type { Component } from "svelte";
import { render } from "svelte/server";
import { toneClass } from "../../src/lib/utils/status-tone";
import { alertTitled, expectClasses } from "./helpers/alert-dom";
import { expectAxeClean, ssrDocument } from "./helpers/axe-ssr";
import { accessibleName, textOf } from "./helpers/dom-names";

const { default: Profile } = await import("../../src/routes/(app)/settings/+page.svelte");
const { default: Security } = await import("../../src/routes/(app)/settings/security/+page.svelte");

// The (app) layout contributes `user` and `preferences` to every settings
// page's merged PageData; the pages type `data` from their own PageData, so
// the fixtures carry only what the markup reads.
const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "Europe/London",
  twoFactorEnabled: false,
  emailVerified: true,
};

const preferences = {
  userId: "u1",
  accentColor: "#6366f1",
  theme: "system",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: true,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

const page = (Page: unknown, data: unknown, form: unknown = null) =>
  ssrDocument(
    render(Page as Component<{ data: unknown; form: unknown }>, { props: { data, form } }).body,
  );

const submitOf = (doc: Document, action: string) =>
  doc.querySelector<HTMLButtonElement>(`form[action="${action}"] button[type="submit"]`)!;

describe("/settings (profile)", () => {
  const data = { user, preferences };

  it("announces a save from the status region that was already mounted", () => {
    const idle = page(Profile, data).querySelector('[role="status"]');
    expect(idle, "the region must exist before the result does").not.toBeNull();
    expect(textOf(idle!)).toBe("");
    const alert = alertTitled(
      page(Profile, data, { success: true }),
      "Settings saved successfully.",
    );
    expect(alert).not.toBeNull();
    expect(alert!.closest('[role="status"]')).not.toBeNull();
    expect(alert!.getAttribute("role")).toBeNull();
    expectClasses(alert!, toneClass("happened", "alert"));
  });

  it("draws Save Changes as a fixed-height primary submit, not padding", () => {
    const save = page(Profile, data).querySelector<HTMLButtonElement>(
      'form button[type="submit"]',
    )!;
    expect(accessibleName(save)).toBe("Save Changes");
    expectClasses(save, "h-11 bg-accent text-accent-fg");
    expect(save.classList.contains("py-2.5")).toBe(false);
  });

  it("passes axe after a save", async () => {
    await expectAxeClean(page(Profile, data, { success: true }), [
      "button-name",
      "link-name",
      "aria-hidden-focus",
      "aria-allowed-role",
    ]);
  });
});

describe("/settings/security", () => {
  const SESSIONS = [
    { id: "s1", expiresAt: new Date("2026-11-01T00:00:00Z") },
    { id: "s2", expiresAt: new Date("2026-11-02T00:00:00Z") },
  ];
  const base = {
    user,
    preferences,
    sessions: SESSIONS,
    currentSessionId: "s1",
    twoFactorEnabled: false,
  };
  /** GlassCard's root: the parent of the card's h2. */
  const sessionsCard = (doc: Document) =>
    [...doc.querySelectorAll("h2")].find((h) => textOf(h) === "Active Sessions")!.parentElement!;

  it.each([
    ["Password updated successfully.", { passwordSuccess: true }],
    ["Two-factor authentication enabled successfully.", { totpEnabled: true }],
    ["Two-factor authentication disabled.", { totpDisabled: true }],
  ])("announces %s from its card's persistent status region", (title, form) => {
    const alert = alertTitled(page(Security, base, form), title)!;
    expect(alert.closest('[role="status"]')).not.toBeNull();
    expect(alert.getAttribute("role")).toBeNull();
    expectClasses(alert, toneClass("happened", "alert"));
  });

  it.each([
    // [name, action, variant classes, height, data override, form]
    ["Update Password", "?/changePassword", "bg-accent text-accent-fg", "h-11", {}, null],
    ["Set Up 2FA", "?/setupTwoFactor", "bg-accent text-accent-fg", "h-11", {}, null],
    [
      "Verify",
      "?/verifyTwoFactor",
      "bg-accent text-accent-fg",
      "h-11",
      {},
      { totpSetup: { qrCode: "data:image/png;base64,AA==", secret: "ABC" } },
    ],
    [
      "Disable 2FA",
      "?/disableTwoFactor",
      "border-border-strong text-text-primary",
      "h-11",
      { twoFactorEnabled: true },
      null,
    ],
    ["Sign Out", "?/logout", "border-border-strong text-text-primary", "h-11", {}, null],
  ])("draws %s as a Button of the right kind", (name, action, variant, height, over, form) => {
    const submit = submitOf(page(Security, { ...base, ...over }, form), action);
    expect(accessibleName(submit)).toBe(name);
    expectClasses(submit, `${variant} ${height}`);
  });

  it("names each Revoke by its session and draws it as a 36px secondary", () => {
    const revoke = submitOf(page(Security, base), "?/revokeSession");
    expect(revoke.getAttribute("aria-label")).toBe("Revoke session 2");
    expect(textOf(revoke)).toBe("Revoke");
    expectClasses(revoke, "h-9 border-border-strong text-text-primary");
  });

  it("shows 2FA 'Enabled' as a neutral state chip", () => {
    const doc = page(Security, { ...base, twoFactorEnabled: true });
    const chip = [...doc.querySelectorAll("span")].find((s) => textOf(s) === "Enabled")!;
    expectClasses(chip, toneClass("neutral", "chip"));
  });

  it("reports a refused revoke, which the action returned and the page never drew", () => {
    const doc = page(Security, base, { sessionError: "Session not found" });
    const alert = alertTitled(doc, "Session not found")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.closest('[role="status"]'), "an error never sits in the polite region").toBeNull();
    expect(sessionsCard(doc).contains(alert)).toBe(true);
  });

  it("announces a revoke from a region the Active Sessions card always renders", () => {
    expect(sessionsCard(page(Security, base)).querySelector('[role="status"]')).not.toBeNull();
    const doc = page(Security, base, { sessionRevoked: true });
    const alert = alertTitled(sessionsCard(doc), "Session revoked.")!;
    expect(alert.closest('[role="status"]')).not.toBeNull();
  });

  it("passes axe with 2FA on and a refused revoke", async () => {
    await expectAxeClean(
      page(Security, { ...base, twoFactorEnabled: true }, { sessionError: "Session not found" }),
      ["button-name", "link-name", "aria-hidden-focus", "aria-allowed-role", "nested-interactive"],
    );
  });
});
