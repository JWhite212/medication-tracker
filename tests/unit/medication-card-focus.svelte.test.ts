// Where focus goes when the Medications list's Log is refused for a
// medication deleted elsewhere. The card's Log passes no focusAfter, and the
// reload every refusal runs drops the card, and the Log with it, so the
// primitive had nothing left to hand focus to and it stayed on <body>. The
// page's h1 is the last resort, focused without scrolling.
//
// Mounted as the whole page (jsdom, client svelte), as a `.svelte.test.ts` so
// the page's `data` is a `$state` that the reload really replaces. The card's
// other DOM behaviour is in medication-card-targets-dom.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";
import type { MedicationWithStats } from "$lib/types";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  showToast: vi.fn(),
  invalidateAll: vi.fn(async () => {}),
}));

vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll(), goto: vi.fn() }));
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy: () => void h.submits.delete(form) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));

import MedicationsPage from "../../src/routes/(app)/medications/+page.svelte";
import { createDoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";
import { resetUndoRegistry } from "$lib/components/dose-writes/undo-registry.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

type PageData = ComponentProps<typeof MedicationsPage>["data"];

function medication(id: string, name: string) {
  return {
    ...BASE_MEDICATION_ROW,
    id,
    name,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    daysUntilRefill: 30,
    expectedDailyDoses: 2,
    sparkline: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    refillSeverity: "ok" as const,
  } satisfies MedicationWithStats & { sparkline: number[]; refillSeverity: string };
}

// The (app) layout adds these to every page's data.
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
  timeFormat: "24h",
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

const PARACETAMOL = medication("m1", "Paracetamol");
const IBUPROFEN = medication("m2", "Ibuprofen");

function pageData(meds: ReturnType<typeof medication>[]): PageData {
  return { user, preferences, medications: meds, archived: [] } as unknown as PageData;
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  h.submits.clear();
  h.showToast.mockReset();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  resetUndoRegistry();
  vi.restoreAllMocks();
});

const spyOnFocus = () => vi.spyOn(HTMLElement.prototype, "focus");
/** Every focus() call on `el`, by its arguments. jsdom ignores preventScroll, so only the argument says. */
function focusCallsOn(spy: ReturnType<typeof spyOnFocus>, el: Element): unknown[][] {
  return spy.mock.calls.filter((_, i) => spy.mock.contexts[i] === el);
}

describe("the medications card's Log, refused for a medication deleted elsewhere", () => {
  it.each([
    ["another card is left", [PARACETAMOL]],
    ["the list is now empty", []],
  ])(
    "focus parks on the page's h1, without scrolling, once the reload drops the card (%s)",
    async (_case, after) => {
      const props = $state({ data: pageData([PARACETAMOL, IBUPROFEN]) });
      app = mount(MedicationsPage, {
        target,
        props,
        context: doseWriteContext(createDoseWriteLock()),
      });
      flushSync();

      const log = target.querySelector<HTMLButtonElement>(
        'button[aria-label="Log a dose of Ibuprofen"]',
      );
      const form = log?.closest("form");
      const submit = form ? h.submits.get(form) : undefined;
      if (!log || !form || !submit) throw new Error("Ibuprofen's Log is not a use:enhance form");
      log.focus();
      h.invalidateAll.mockImplementationOnce(async () => {
        props.data = pageData(after);
      });
      const focus = spyOnFocus();

      const { callback } = await startSubmit(submit, form);
      await finishSubmit(callback!, form, {
        type: "failure",
        status: 404,
        data: { errors: { form: ["Medication not found"] } },
      }).done;
      flushSync();

      expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
      expect(log.isConnected, "the reload drops the card").toBe(false);
      const heading = target.querySelector("h1")!;
      expect(heading.textContent).toBe("Medications");
      expect(document.activeElement).toBe(heading);
      expect(document.activeElement).not.toBe(document.body);
      expect(focusCallsOn(focus, heading)).toEqual([[{ preventScroll: true }]]);
    },
  );
});
