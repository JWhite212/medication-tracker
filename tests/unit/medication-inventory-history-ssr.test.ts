// @vitest-environment node
//
// The medication page's inventory history. A refill is not "good" and a dose
// is not "bad": every delta is neutral and the sign carries the direction.
// `node` is load-bearing: see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";

// MedicationForm and the page's two inventory forms use:enhance, which is
// SvelteKit client runtime and not what this asserts.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));

import Page from "../../src/routes/(app)/medications/[id]/+page.svelte";
import { toneClass } from "$lib/utils/status-tone";
import type { InventoryEventType } from "$lib/server/db/schema";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

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
const MEDICATION = { ...BASE_MEDICATION_ROW, lowInventoryEpisodeAt: null };

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
