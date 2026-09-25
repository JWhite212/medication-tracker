// @vitest-environment node
//
// "Later today": read-only lines for today's slots more than an hour ahead.
// `node` is load-bearing — see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import type { LaterRow } from "$lib/types";
import { formatSlotTime } from "$lib/utils/dashboard-copy";
import { formatDuration } from "$lib/utils/time";
import LaterList from "$lib/components/dashboard/LaterList.svelte";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");

const ROW: LaterRow = {
  key: "m1@20:00",
  medicationId: "m1",
  name: "Lisinopril",
  dosageAmount: "10",
  dosageUnit: "mg",
  colour: "#10b981",
  colourSecondary: null,
  pattern: "solid",
  expectedTime: "2026-05-01T20:00:00.000Z",
};

function renderList(rows: LaterRow[]): string {
  return render(LaterList, {
    props: { rows, serverNow: NOW, todayStart: TODAY_START, timezone: "UTC", timeFormat: "24h" },
  }).body;
}

describe("LaterList", () => {
  it("renders nothing when nothing is later today", () => {
    expect(
      renderList([])
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim(),
    ).toBe("");
  });

  it("renders one 40px line per slot: time, hollow marker, glyph, name, dose, and how far off", () => {
    const doc = ssrDocument(renderList([ROW]));
    const section = doc.querySelector("section");
    expect(section?.getAttribute("aria-labelledby")).toBe("later-heading");
    expect(textOf(doc.getElementById("later-heading")!)).toBe("Later today");
    const li = doc.querySelector("li");
    expect(li?.classList.contains("h-10")).toBe(true);
    expect(li?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Upcoming");
    expect(
      li?.querySelector("[data-medication-glyph]")?.getAttribute("data-medication-glyph"),
    ).toBe("sm");
    const text = textOf(li!);
    expect(text).toContain(formatSlotTime(new Date(ROW.expectedTime), TODAY_START, "UTC", "24h"));
    expect(text).toContain("Lisinopril");
    expect(text).toContain("10mg");
    expect(text).toContain(`in ${formatDuration(7 * 3_600_000, { style: "long", maxUnits: 1 })}`);
  });

  it("offers no actions and takes no focus", () => {
    const html = renderList([ROW]);
    expect(html).not.toMatch(/<(button|form|a)\b/);
    expect(html).not.toContain("tabindex");
  });
});
