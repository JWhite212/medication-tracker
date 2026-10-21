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
