// @vitest-environment node
//
// The medication page's inventory history. A refill is not "good" and a dose
// is not "bad": every delta is neutral and the sign carries the direction.
// `node` is load-bearing: see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "svelte";
import { render } from "svelte/server";

// MedicationForm and the page's two inventory forms use:enhance, which is
// SvelteKit client runtime and not what this asserts.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));

import Page from "../../src/routes/(app)/medications/[id]/+page.svelte";
import ListPage from "../../src/routes/(app)/medications/+page.svelte";
import { toneClass, type Tone } from "$lib/utils/status-tone";
import type { InventoryEventType } from "$lib/server/db/schema";
import type { Medication } from "$lib/types";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { evaluatedRules, expectAxeClean, runAxe, ssrDocument } from "./helpers/axe-ssr";
import { buttonNamed, textOf } from "./helpers/dom-names";

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
  accentColor: "#6366f1",
  theme: "system",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: true,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "csv",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};
// `Medication` is drizzle-inferred and has `lowInventoryEpisodeAt`, which
// BASE_MEDICATION_ROW lacks; tests are type-checked, so `npm run check` needs it.
// Typed as `Medication`, not left to inference: inferred, `archivedAt` is the
// literal `null` and a test that archives the medication cannot spread a Date in.
const MEDICATION: Medication = { ...BASE_MEDICATION_ROW, lowInventoryEpisodeAt: null };

const event = (id: string, eventType: InventoryEventType, quantityChange: number) => ({
  id,
  eventType,
  quantityChange,
  previousCount: 10,
  newCount: 10 + quantityChange,
  note: null,
  createdAt: new Date("2026-05-01T08:00:00.000Z"),
});

function page(): Document {
  return ssrDocument(
    render(Page, {
      props: {
        data: {
          user,
          preferences,
          medication: MEDICATION,
          schedules: [],
          inventoryHistory: [
            event("e1", "refill", 30),
            event("e2", "dose_taken", -1),
            event("e3", "correction", 0),
          ],
        },
        form: null,
      },
    }).body,
  );
}

describe("inventory history", () => {
  const doc = page();
  const deltas = [...doc.querySelectorAll('ol[role="list"] > li p.font-medium > span')];

  it("prints every change in neutral text, with its sign", () => {
    expect(deltas.map(textOf)).toEqual(["+30", "-1", "0"]);
    for (const delta of deltas) {
      expect([...delta.classList]).toEqual(
        expect.arrayContaining(toneClass("neutral", "text").split(" ")),
      );
      expect(delta.className).not.toMatch(/success|warning|text-text-muted/);
    }
  });

  it("passes axe on the history list", async () => {
    // jsdom has no layout or CSS, so colour-contrast is measured in
    // theme-tokens.test.ts instead.
    const rules = ["listitem", "aria-allowed-role"];
    const results = await runAxe(doc, rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });
});

const FOCUS_RING = "focus-visible:outline-accent-ink";
const classes = (el: Element | null | undefined) => [...(el?.classList ?? [])];
const toneTokens = (tone: Tone) => toneClass(tone, "alert").split(" ");

function detail(form: ComponentProps<typeof Page>["form"] = null, medication = MEDICATION) {
  return ssrDocument(
    render(Page, {
      props: { data: { user, preferences, medication, schedules: [], inventoryHistory: [] }, form },
    }).body,
  );
}
const inventoryCard = (doc: Document) =>
  [...doc.querySelectorAll("h2")].find((h) => textOf(h) === "Inventory")!.parentElement!;

describe("a medication's inventory and archive actions", () => {
  it("makes Mark as refilled the one primary action, 44px with the focus ring", () => {
    const refill = buttonNamed(detail(), "Mark as refilled");
    expect(refill.getAttribute("type")).toBe("submit");
    expect(classes(refill)).toEqual(
      expect.arrayContaining(["bg-accent", "text-accent-fg", "h-11", FOCUS_RING]),
    );
  });

  it.each(["Adjust", "Archive"])(
    "draws %s as a neutral secondary Button, never amber or red",
    (name) => {
      const button = buttonNamed(detail(), name);
      expect(classes(button)).toEqual(
        expect.arrayContaining(["border-border-strong", "text-text-primary", "h-11", FOCUS_RING]),
      );
      expect(button.className).not.toMatch(/warning|danger/);
    },
  );

  it("draws Unarchive the same way on an archived medication", () => {
    const doc = detail(null, {
      ...MEDICATION,
      isArchived: true,
      archivedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    const button = buttonNamed(doc, "Unarchive");
    expect(classes(button)).toEqual(expect.arrayContaining(["border-border-strong", "h-11"]));
    expect(classes(button)).not.toContain("border-accent-ink");
    expect(classes(button)).not.toContain("text-accent-ink");
  });
});

describe("the refill and adjustment outcomes", () => {
  it("keeps both status regions mounted, and silent, when there is nothing to report", () => {
    const regions = inventoryCard(detail()).querySelectorAll('[role="status"]');
    expect(regions).toHaveLength(2);
    for (const region of regions) expect(textOf(region)).toBe("");
  });

  it.each([
    ["refill", { refillOk: true, newCount: 40 }, "Refill recorded. New count: 40."],
    [
      "adjustment",
      { adjustOk: true, newCount: 12, quantityChange: -3 },
      "Adjustment recorded. New count: 12 (-3).",
    ],
  ] as const)(
    "reports a recorded %s as a success Alert inside its status region",
    (_kind, form, message) => {
      const doc = detail(form);
      const region = [...inventoryCard(doc).querySelectorAll('[role="status"]')].find(
        (r) => textOf(r) === message,
      );
      expect(region, `no status region says "${message}"`).toBeDefined();
      const box = region!.firstElementChild!;
      expect(classes(box)).toEqual(expect.arrayContaining(toneTokens("happened")));
      expect(box.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(doc.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it.each([
    ["refill", { refillError: "Quantity must be a positive whole number." }],
    ["adjustment", { adjustError: "New count must be a whole number, 0 or greater." }],
  ] as const)(
    "states a refused %s as an error Alert, outside the status regions",
    (_kind, form) => {
      const alerts = detail(form).querySelectorAll('[role="alert"]');
      expect(alerts).toHaveLength(1);
      expect(textOf(alerts[0])).toBe(Object.values(form)[0]);
      expect(alerts[0].closest('[role="status"]')).toBeNull();
      expect(classes(alerts[0])).toEqual(expect.arrayContaining(toneTokens("wrong")));
    },
  );

  it("passes axe: button-name, aria-allowed-attr", async () => {
    await expectAxeClean(detail({ refillError: "Quantity must be a positive whole number." }), [
      "button-name",
      "aria-allowed-attr",
    ]);
  });
});

describe("the medications list header", () => {
  it("makes + Add Medication the page's primary action: a 36px link with the focus ring", () => {
    const doc = ssrDocument(
      render(ListPage, {
        props: { data: { user, preferences, medications: [], archived: [] } },
        context: doseWriteContext(),
      }).body,
    );
    const add = [...doc.querySelectorAll('a[href="/medications/new"]')].find(
      (a) => textOf(a) === "+ Add Medication",
    );
    expect(add, "no + Add Medication link").toBeDefined();
    expect(classes(add)).toEqual(
      expect.arrayContaining(["bg-accent", "text-accent-fg", "h-9", FOCUS_RING]),
    );
  });
});
