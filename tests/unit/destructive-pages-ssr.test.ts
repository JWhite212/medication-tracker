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
const { default: DataPage } = await import("../../src/routes/(app)/settings/data/+page.svelte");
const { default: ImportPage } =
  await import("../../src/routes/(app)/settings/data/import/+page.svelte");

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

describe("data page", () => {
  const DATA = { user, preferences, counts: { medications: 6, doses: 1204 }, hasPassword: false };

  it("Save Format is the primary submit", () => {
    const doc = page(DataPage, DATA, null);
    const submits = [...doc.querySelectorAll('button[type="submit"]')];
    expect(submits.map((b) => b.textContent!.trim())).toEqual(["Save Format"]);
    expect([...submits[0].classList]).toEqual(expect.arrayContaining(["bg-accent", "h-11"]));
  });

  it("the downloads and Import Data are secondary links", () => {
    const doc = page(DataPage, DATA, null);
    for (const href of ["/api/export", "/api/export/full", "/settings/data/import"]) {
      expectSecondary(link(doc, href), href);
    }
  });

  it("Delete My Account is a secondary button in no form, described by its paragraph", () => {
    const doc = page(DataPage, DATA, null);
    const b = button(doc, "Delete My Account");
    expect(b.getAttribute("type")).toBe("button");
    expectSecondary(b, "Delete My Account");
    expect(b.closest("form")).toBeNull();
    const id = b.getAttribute("aria-describedby");
    expect(doc.getElementById(id!)?.textContent).toContain(
      "Permanently delete your account and all associated data.",
    );
  });

  it("the Danger Zone heading is neutral", () => {
    const h = [...page(DataPage, DATA, null).querySelectorAll("h2")].find(
      (e) => e.textContent === "Danger Zone",
    )!;
    expect(h).toBeDefined();
    expect(statusTokens(h)).toEqual([]);
  });

  it("holds no status colour anywhere while nothing has happened", () => {
    const doc = page(DataPage, DATA, null);
    expect([...doc.querySelectorAll("[class]")].flatMap(statusTokens)).toEqual([]);
  });

  it("the account dialog's form is empty while closed and outside every GlassCard", () => {
    const f = page(DataPage, DATA, null).querySelector('form[action="?/deleteAccount"]');
    expect(f).not.toBeNull();
    expect(f!.querySelector("input, button")).toBeNull();
    expect(f!.closest(".backdrop-blur-xl")).toBeNull();
  });

  it("Settings saved. is a happened Alert in the persistent status region", () => {
    const empty = page(DataPage, DATA, null).querySelector('[role="status"]')!;
    expect(empty).not.toBeNull();
    expect(empty.textContent!.trim()).toBe("");

    const region = page(DataPage, DATA, { success: true }).querySelector('[role="status"]')!;
    expect(region.textContent).toContain("Settings saved.");
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull(); // the Alert's icon
    expect(region.querySelector('[role="alert"]')).toBeNull();
  });

  it("passes axe's structural rules", async () => {
    // The page's one form control is a <select>, which axe checks under
    // select-name, not label (label has no candidate here while the dialog is
    // closed, and an unevaluated rule would pass vacuously).
    const rules = AXE_RULES.map((r) => (r === "label" ? "select-name" : r));
    const results = await runAxe(page(DataPage, DATA, { success: true }), rules);
    expect(results.violations).toEqual([]);
    for (const r of rules) expect(evaluatedRules(results).has(r), r).toBe(true);
  });
});

describe("import page", () => {
  const IMPORT = {
    user,
    preferences,
    medications: [],
    hasPassword: true,
    maxBytes: 5_242_880,
    timezone: "UTC",
  };
  const IMPORTED = {
    medicationsCreated: 2,
    medicationsReused: 1,
    dosesCreated: 1204,
    dosesSkipped: 3,
    inventoryEventsCreated: 0,
    medicationsDeleted: 4,
    dosesDeleted: 900,
  };
  const SUMMARY = {
    medicationsCreated: 2,
    medicationsReused: 0,
    dosesCreated: 10,
    dosesSkipped: 0,
    inventoryEventsCreated: 0,
    medicationsDeleted: 0,
    dosesDeleted: 0,
  };
  const preview = (over: Record<string, unknown> = {}) => ({
    format: "json",
    mode: "merge",
    summary: SUMMARY,
    warnings: [],
    unmatchedNames: [],
    createdNames: [],
    reusedNames: [],
    empty: false,
    ...over,
  });
  const REPLACE_PREVIEW = preview({
    mode: "replace",
    summary: { ...SUMMARY, medicationsDeleted: 6, dosesDeleted: 1204 },
    warnings: ["1 row was skipped (bad date)."],
  });

  it("announces Import complete from a status region that is always there", () => {
    const before = page(ImportPage, IMPORT, null).querySelector("#import-outcome");
    expect(before).not.toBeNull();
    expect(before!.getAttribute("role")).toBe("status");
    expect(before!.textContent!.trim()).toBe("");
    expect(before!.closest("form")).toBeNull();

    const doc = page(ImportPage, IMPORT, { imported: IMPORTED, importId: "i1" });
    const region = doc.querySelector('#import-outcome[role="status"]')!;
    expect(region.textContent).toContain("Import complete");
    expect(region.textContent).toContain("1204 dose entries added");
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull(); // the Alert's icon
    const replaced = [...region.querySelectorAll("li")].find((li) =>
      li
        .textContent!.replace(/\s+/g, " ")
        .includes("4 medications and 900 dose entries were replaced"),
    )!;
    expect(replaced).toBeDefined();
    expect(statusTokens(replaced)).toEqual([]);
  });

  it("after an import, View medications is primary and Back to Data is ghost", () => {
    const doc = page(ImportPage, IMPORT, { imported: IMPORTED, importId: "i1" });
    expect([...link(doc, "/medications").classList]).toEqual(
      expect.arrayContaining(["bg-accent", "h-11"]),
    );
    const back = [...doc.querySelectorAll("a")].find(
      (a) => a.textContent!.trim() === "Back to Data",
    )!;
    expect(back).toBeDefined();
    expect(back.classList).toContain("h-11");
    expect(back.classList).not.toContain("border");
    // The page's own form is gone once the outcome is shown.
    expect(doc.querySelector("form")).toBeNull();
  });

  it("a failure is a role=alert outside the preview-ready status region", () => {
    const doc = page(ImportPage, IMPORT, { error: "That file is over the 5 MB limit." });
    const alert = doc.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("That file is over the 5 MB limit.");
    expect(alert.closest('[role="status"]')).toBeNull();
  });

  it("says the preview is ready inside its status region, and stops saying it on a failure", () => {
    const ready = page(ImportPage, IMPORT, { preview: preview() });
    const regions = [...ready.querySelectorAll('[role="status"]')].filter((r) =>
      r.textContent!.includes("Import preview ready"),
    );
    expect(regions).toHaveLength(1);
    const failed = page(ImportPage, IMPORT, { error: "Nope.", preview: preview() });
    expect(failed.body.textContent).not.toContain("Import preview ready");
  });

  it("the Replace everything card is neutral and still says it can't be undone", () => {
    const doc = page(ImportPage, IMPORT, null);
    const card = [...doc.querySelectorAll("label")].find((l) =>
      l.textContent!.includes("Replace everything"),
    )!;
    expect(card).toBeDefined();
    expect(card.classList).toContain("border-glass-border");
    for (const el of [card, ...card.querySelectorAll("[class]")]) {
      expect(statusTokens(el), el.outerHTML).toEqual([]);
    }
    expect(card.textContent).toContain("Cannot be undone.");
  });

  it("holds no status colour anywhere before a preview", () => {
    const doc = page(ImportPage, IMPORT, null);
    expect([...doc.querySelectorAll("[class]")].flatMap(statusTokens)).toEqual([]);
  });

  it("a replace preview flags its deletions and its warnings as needs-you Alerts, not alerts", () => {
    const doc = page(ImportPage, IMPORT, { preview: REPLACE_PREVIEW });
    const text = doc.body.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("Replace mode will first delete 6 medications and");
    expect(text).toContain("Check before importing");
    expect(text).toContain("1 row was skipped (bad date).");
    expect(doc.querySelector('[role="alert"]')).toBeNull();
    // Amber, and an icon: the needs-you tone carries a word and a glyph, not colour alone.
    const deletes = [...doc.querySelectorAll("p")].find((p) =>
      p.textContent!.includes("Replace mode will first delete"),
    )!;
    expect(statusTokens(deletes)).toEqual(["text-warning"]);
    expect(deletes.closest("div.flex")!.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it("Preview is a secondary submit and Import is a primary submit, in merge mode", () => {
    const doc = page(ImportPage, IMPORT, { preview: preview() });
    const submits = [...doc.querySelectorAll('button[type="submit"]')];
    expect(submits.map((b) => b.getAttribute("formaction"))).toEqual(["?/preview", "?/commit"]);
    expect(submits[0].classList).toContain("border-border-strong");
    expect(submits[1].classList).toContain("bg-accent");
    expect(submits[1].textContent!.trim()).toBe("Import");
    for (const b of submits) expect(b.classList).toContain("h-11");
  });

  it("passes axe's structural rules", async () => {
    const results = await runAxe(page(ImportPage, IMPORT, { preview: REPLACE_PREVIEW }), AXE_RULES);
    expect(results.violations).toEqual([]);
    for (const r of AXE_RULES) expect(evaluatedRules(results).has(r), r).toBe(true);
  });
});
