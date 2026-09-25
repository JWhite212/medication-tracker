// @vitest-environment node
//
// The header is the ONLY place a count appears. Its copy is
// dashboardHeaderCopy's (T6); this pins that the component renders it, the
// eyebrow date, the stable h1, and that it is not a live region.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import type { DashboardStatus } from "$lib/types";
import { dashboardHeaderCopy } from "$lib/utils/dashboard-copy";
import { formatUserDate } from "$lib/utils/time";
import DashboardHeader from "$lib/components/dashboard/DashboardHeader.svelte";
import { DASHBOARD_HEADING_ID } from "$lib/components/dashboard/dom-ids";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const TZ = "Europe/London";
const EYEBROW = formatUserDate(NOW, TZ, "DD/MM/YYYY", { weekday: true, year: false });

const STATUSES: DashboardStatus[] = [
  { kind: "due", dueCount: 5, doneToday: 2, totalToday: 7, loggedToday: 3, next: null },
  {
    kind: "caught-up",
    dueCount: 0,
    doneToday: 3,
    totalToday: 5,
    loggedToday: 3,
    next: {
      name: "Lisinopril",
      dosageAmount: "10",
      dosageUnit: "mg",
      expectedTime: "2026-09-24T19:00:00.000Z",
      alsoCount: 2,
    },
  },
  { kind: "all-done", dueCount: 0, doneToday: 7, totalToday: 7, loggedToday: 7, next: null },
  { kind: "none-today", dueCount: 0, doneToday: 0, totalToday: 0, loggedToday: 0, next: null },
  { kind: "as-needed-only", dueCount: 0, doneToday: 0, totalToday: 0, loggedToday: 2, next: null },
];

function renderHeader(status: DashboardStatus): Document {
  const { body } = render(DashboardHeader, {
    props: { status, serverNow: NOW, timezone: TZ, timeFormat: "24h", dateFormat: "DD/MM/YYYY" },
  });
  return ssrDocument(body);
}

describe("DashboardHeader", () => {
  it("heads the page 'Today' with a stable h1 that focus can be sent to", () => {
    const h1 = renderHeader(STATUSES[0]).querySelector("h1");
    expect(h1?.id).toBe(DASHBOARD_HEADING_ID);
    expect(h1?.getAttribute("tabindex")).toBe("-1");
    expect(textOf(h1!)).toBe("Today");
  });

  for (const status of STATUSES) {
    it(`renders the eyebrow date and dashboardHeaderCopy for "${status.kind}", supporting line only when there is one`, () => {
      const copy = dashboardHeaderCopy(status, NOW, TZ, "24h");
      const lines = [...renderHeader(status).querySelectorAll("p")].map(textOf);
      expect(lines).toEqual([
        EYEBROW,
        copy.sentence,
        ...(copy.supporting ? [copy.supporting] : []),
      ]);
    });
  }

  it("styles the sentence as the status and the supporting line as secondary", () => {
    const [, sentence, supporting] = [...renderHeader(STATUSES[0]).querySelectorAll("p")];
    expect([...sentence.classList]).toEqual(expect.arrayContaining(["text-lg", "font-semibold"]));
    expect([...supporting.classList]).toEqual(
      expect.arrayContaining(["text-sm", "text-text-secondary"]),
    );
  });

  it("is not a live region: the page's only live region is the Toast", () => {
    const doc = renderHeader(STATUSES[0]);
    expect(doc.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });
});
