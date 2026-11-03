// @vitest-environment node
//
// The dashboard's Refills card and the /medications card answer "does this
// need reordering?" with one rule, `refillChip` (RefillsCard.svelte). They
// used to feed it different inputs: the medications card passed the user's
// low-stock alert threshold, the dashboard passed none, and getRefillForecast
// dropped every ok-tier medication. So a medication at its threshold with
// weeks of supply was amber on /medications, and was what the low-stock email
// or push was about, yet absent from the dashboard.
//
// Both pages' real loads run here, and the real components render what they
// return. PGlite because both halves of a row's words come from SQL: the
// forecast's rate is a 30-day aggregate, and the card's days are computed
// from a separate query. Every medication must draw the same words in the
// same tone on both pages, or nothing on both.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render } from "svelte/server";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import RefillsCard from "../../../src/lib/components/RefillsCard.svelte";
import MedicationCard from "../../../src/lib/components/MedicationCard.svelte";
import { toneClass, type Tone, type ToneElement } from "$lib/utils/status-tone";
import type { DashboardPageData, MedicationWithStats, RefillSeverity } from "$lib/types";
import { doseWriteContext } from "../helpers/dashboard-context";
import { ssrDocument } from "../helpers/axe-ssr";
import { accessibleName, textOf } from "../helpers/dom-names";

const { load: dashboardLoad } = await import("../../../src/routes/(app)/dashboard/+page.server");
const { load: medicationsLoad } =
  await import("../../../src/routes/(app)/medications/+page.server");

type Listed = MedicationWithStats & { sparkline: number[]; refillSeverity: RefillSeverity };
type Drawn = { tone: Tone; text: string; name: string };

// One dose a day through the legacy interval column, so the count reads as
// days left. The PRN one has no history, so it has no forecast at all.
const SEEDS = [
  { id: "m-critical", inventoryCount: 2, inventoryAlertThreshold: null },
  { id: "m-watch", inventoryCount: 10, inventoryAlertThreshold: null },
  { id: "m-watch-low", inventoryCount: 10, inventoryAlertThreshold: 12 },
  { id: "m-at-threshold", inventoryCount: 20, inventoryAlertThreshold: 20 },
  { id: "m-above-threshold", inventoryCount: 21, inventoryAlertThreshold: 20 },
  {
    id: "m-prn-low",
    inventoryCount: 4,
    inventoryAlertThreshold: 5,
    scheduleType: "prn",
    scheduleIntervalHours: null,
  },
];

// Written out, not derived, so the two pages cannot agree on the wrong words.
const EXPECTED: Record<string, Drawn | null> = {
  "m-critical": drawn("needs-you", "Reorder soon · 2 days left"),
  "m-watch": { tone: "neutral", text: "10 days left", name: "10 days left" },
  "m-watch-low": drawn("needs-you", "Reorder soon · 10 days left"),
  "m-at-threshold": drawn("needs-you", "Reorder soon · 20 days left"),
  "m-above-threshold": null,
  "m-prn-low": drawn("needs-you", "Reorder soon · 4 doses left"),
};

function drawn(tone: Tone, words: string): Drawn {
  return { tone, text: `▲ ${words}`, name: words };
}

const TONES: Tone[] = ["needs-you", "wrong", "happened", "neutral"];
function toneOfElement(el: Element, element: ToneElement): Tone[] {
  return TONES.filter((t) =>
    toneClass(t, element)
      .split(" ")
      .every((c) => el.classList.contains(c)),
  );
}

let dashboard: Document;
let medications: Listed[];

beforeAll(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  for (const [i, seed] of SEEDS.entries()) {
    await pgDb.seedMedication({
      name: seed.id,
      sortOrder: i,
      scheduleType: "scheduled",
      scheduleIntervalHours: "24",
      ...seed,
    });
  }
  const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } };
  const dash = (await dashboardLoad({ locals } as never)) as DashboardPageData;
  medications = ((await medicationsLoad({ locals } as never)) as { medications: Listed[] })
    .medications;
  dashboard = ssrDocument(render(RefillsCard, { props: { entries: dash.refillForecast } }).body);
});

/** The dashboard row's label for a medication, or null when the card lists none. */
function onDashboard(id: string): Drawn | null {
  const row = dashboard.querySelector(`section a[href="/medications/${id}"]`);
  if (!row) return null;
  const label = row.querySelector(":scope > span:last-child")!;
  const tones = toneOfElement(label, "text");
  expect(tones, id).toHaveLength(1);
  return { tone: tones[0], text: textOf(label), name: accessibleName(label) };
}

/** The medications card's stock chip, or null when it draws none. */
function onMedications(id: string): Drawn | null {
  const medication = medications.find((m) => m.id === id)!;
  const doc = ssrDocument(
    render(MedicationCard, {
      props: { medication, timezone: "UTC", timeFormat: "24h", timeSinceDaysFromHours: 48 },
      context: doseWriteContext(),
    }).body,
  );
  const chip = doc.querySelector("[data-stock-chip]");
  if (!chip) return null;
  const tones = toneOfElement(chip, "chip");
  expect(tones, id).toHaveLength(1);
  return { tone: tones[0], text: textOf(chip), name: accessibleName(chip) };
}

describe("the dashboard's Refills card and the medications card", () => {
  it.each(SEEDS.map((s) => s.id))("draw %s the same, in the same tone", (id) => {
    expect(medications.map((m) => m.id)).toContain(id);
    expect(onMedications(id), "/medications").toEqual(EXPECTED[id]);
    expect(onDashboard(id), "dashboard").toEqual(EXPECTED[id]);
  });

  it("tints an amber row's box, not only its label, whatever the forecast tier", () => {
    for (const id of ["m-watch-low", "m-at-threshold", "m-prn-low"]) {
      const row = dashboard.querySelector(`section a[href="/medications/${id}"]`)!;
      expect(toneOfElement(row, "alert"), id).toEqual(["needs-you"]);
    }
  });

  // Amber before neutral, then fewest days left: a row asking for a reorder
  // is read before one that only counts days.
  it("lists the amber rows first, then by days left", () => {
    const order = [...dashboard.querySelectorAll("section a")].map((a) =>
      a.getAttribute("href")!.replace("/medications/", ""),
    );
    expect(order).toEqual(["m-critical", "m-watch-low", "m-at-threshold", "m-prn-low", "m-watch"]);
  });
});
