// @vitest-environment node
//
// `node` is load-bearing: under jsdom, `render()` from `svelte/server`
// throws `effect_orphan` before an assertion runs (same reason as
// analytics-page-ssr.test.ts).
//
// The three pages that hold a deletion nothing can undo, server-rendered:
// Privacy, Data and Import. Each opens its deletion from a neutral button
// into one confirmation dialog (DestructiveConfirm) whose form sits outside
// every GlassCard; each page's colours follow the status-tone rules, with
// red kept for the irreversible action inside the dialog.
import { describe, it, expect } from "vitest";
import type { Component } from "svelte";
import { render } from "svelte/server";
import { ssrDocument, runAxe, evaluatedRules } from "./helpers/axe-ssr";
import { STATUS_TOKEN } from "./helpers/status-token";

const { default: PrivacyPage } =
  await import("../../src/routes/(app)/settings/privacy/+page.svelte");

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "system",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
};

const PRIVACY = {
  user,
  preferences,
  hasPassword: true,
  counts: {
    activeMedications: 4,
    archivedMedications: 2,
    doseLogs: 1204,
    doseMedications: 6,
    archivedDoses: 340,
    sessions: 3,
    auditLogs: 9,
  },
};

const AXE_RULES = [
  "button-name",
  "link-name",
  "label",
  "aria-allowed-attr",
  "aria-prohibited-attr",
];

/** Render a page and parse it. The pages type `data` from their own PageData; fixtures carry what the markup reads. */
function page(Page: unknown, data: unknown, form: unknown): Document {
  const { body } = render(Page as Component<{ data: unknown; form: unknown }>, {
    props: { data, form },
  });
  return ssrDocument(body);
}

function button(doc: Document, text: string): HTMLButtonElement {
  const found = [...doc.querySelectorAll("button")].find((b) => b.textContent!.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

function link(doc: Document, href: string): HTMLAnchorElement {
  const found = doc.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
  if (!found) throw new Error(`no link to ${href}`);
  return found;
}

/** The status colour tokens on one element. STATUS_TOKEN is global: read it with match, never test. */
const statusTokens = (el: Element) => el.getAttribute("class")?.match(STATUS_TOKEN) ?? [];

/** A secondary Button: the fixed 44px height and the control boundary, and no status colour. */
function expectSecondary(el: Element, label: string) {
  expect([...el.classList], label).toEqual(
    expect.arrayContaining(["h-11", "border-border-strong"]),
  );
  expect(statusTokens(el), label).toEqual([]);
}

describe("privacy page", () => {
  it("opens each wipe from a secondary button that is in no form", () => {
    const doc = page(PrivacyPage, PRIVACY, null);
    for (const label of ["Delete dose history", "Delete archived medications"]) {
      const b = button(doc, label);
      expect(b.getAttribute("type"), label).toBe("button");
      expectSecondary(b, label);
      expect(b.closest("form"), label).toBeNull();
    }
  });

  it("describes each Danger zone control by its own section's paragraph", () => {
    const doc = page(PrivacyPage, PRIVACY, null);
    for (const [control, words] of [
      [button(doc, "Delete dose history"), "Removes every dose log permanently."],
      [
        button(doc, "Delete archived medications"),
        "Permanently removes medications you've archived",
      ],
      [link(doc, "/settings/data"), "Permanently deletes your account"],
    ] as const) {
      const id = control.getAttribute("aria-describedby");
      expect(id, words).toBeTruthy();
      expect(doc.getElementById(id!)?.textContent, words).toContain(words);
    }
  });

  it("offers no wipe when there is nothing to wipe, and says so", () => {
    const doc = page(
      PrivacyPage,
      {
        ...PRIVACY,
        counts: {
          ...PRIVACY.counts,
          doseLogs: 0,
          doseMedications: 0,
          archivedMedications: 0,
          archivedDoses: 0,
        },
      },
      null,
    );
    expect(doc.body.textContent).toContain("There is no dose history to delete.");
    expect(doc.body.textContent).toContain("There are no archived medications to delete.");
    expect([...doc.querySelectorAll("button")].map((b) => b.textContent!.trim())).toEqual([
      "Revoke other sessions",
    ]);
  });

  it("keeps each dialog's form empty while closed and outside every GlassCard", () => {
    const doc = page(PrivacyPage, PRIVACY, null);
    for (const action of ["?/wipeDoseHistory", "?/wipeArchivedMedications"]) {
      const f = doc.querySelector(`form[action="${action}"]`);
      expect(f, action).not.toBeNull();
      expect(f!.querySelector("input, button"), action).toBeNull();
      expect(f!.closest(".backdrop-blur-xl"), action).toBeNull();
    }
  });

  it("draws the Danger zone heading neutral", () => {
    const h = [...page(PrivacyPage, PRIVACY, null).querySelectorAll("h2")].find(
      (e) => e.textContent === "Danger zone",
    )!;
    expect(h).toBeDefined();
    expect(statusTokens(h)).toEqual([]);
  });

  it("makes the exports, Revoke and 'Go to delete account' secondary", () => {
    const doc = page(PrivacyPage, PRIVACY, null);
    for (const href of [
      "/api/export?format=pdf",
      "/api/export?format=csv",
      "/api/audit",
      "/settings/data",
    ]) {
      expectSecondary(link(doc, href), href);
    }
    const revoke = button(doc, "Revoke other sessions");
    expect(revoke.getAttribute("type")).toBe("submit");
    expectSecondary(revoke, "Revoke other sessions");
  });

  it("holds no status colour anywhere while nothing has happened", () => {
    const doc = page(PrivacyPage, PRIVACY, null);
    const tokens = [...doc.querySelectorAll("[class]")].flatMap(statusTokens);
    expect(tokens).toEqual([]);
  });

  it("announces a wipe's outcome as a happened Alert in its persistent status region", () => {
    const doc = page(PrivacyPage, PRIVACY, { wipeDosesOk: true, removed: 1204 });
    const region = [...doc.querySelectorAll('[role="status"]')].find((r) =>
      r.textContent!.includes("Removed"),
    )!;
    expect(region).toBeDefined();
    expect(region.textContent).toContain("Removed 1,204 dose log entries.");
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull(); // the Alert's icon
    expect(region.querySelector('[role="alert"]')).toBeNull();

    const one = page(PrivacyPage, PRIVACY, { wipeArchivedOk: true, removed: 1 });
    expect(one.body.textContent).toContain("Removed 1 archived medication.");
    const oneDose = page(PrivacyPage, PRIVACY, { wipeDosesOk: true, removed: 1 });
    expect(oneDose.body.textContent).toContain("Removed 1 dose log entry.");
    const two = page(PrivacyPage, PRIVACY, { wipeArchivedOk: true, removed: 2 });
    expect(two.body.textContent).toContain("Removed 2 archived medications.");
  });

  it("each wipe's status region is there before anything happens", () => {
    const doc = page(PrivacyPage, PRIVACY, null);
    // Revoke's region plus one per wipe section, each present and empty.
    const regions = [...doc.querySelectorAll('[role="status"]')];
    expect(regions).toHaveLength(3);
    for (const r of regions) expect(r.textContent!.trim()).toBe("");
  });

  it("renders a Revoke failure as role=alert outside any status region", () => {
    const doc = page(PrivacyPage, PRIVACY, { revokeError: "Incorrect password." });
    const alert = doc.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("Incorrect password.");
    expect(alert.closest('[role="status"]')).toBeNull();
  });

  it("announces a Revoke success as a happened Alert in its status region", () => {
    const doc = page(PrivacyPage, PRIVACY, { revokeOk: true, removed: 3 });
    const region = [...doc.querySelectorAll('[role="status"]')].find((r) =>
      r.textContent!.includes("Revoked"),
    )!;
    expect(region.textContent).toContain("Revoked 3 sessions.");
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it("passes axe's structural rules", async () => {
    const results = await runAxe(
      page(PrivacyPage, PRIVACY, { wipeDosesOk: true, removed: 3 }),
      AXE_RULES,
    );
    expect(results.violations).toEqual([]);
    for (const r of AXE_RULES) expect(evaluatedRules(results).has(r), r).toBe(true);
  });
});
