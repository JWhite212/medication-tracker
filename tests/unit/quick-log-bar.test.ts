// The chip's quantity is a per-tap choice, not a sticky setting. It resets to
// 1 after a SUCCESSFUL log and is kept after a failure, so a retry sends what
// the user chose. Live, a chip still read "3×" after a ×3 log.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({ submit: null as SubmitFunction | null }));

vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    h.submit = submit;
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
// A realistic reloaded payload, so whichever dose-toasts helper the chip's
// toast builder calls finds the keys it reads and falls back cleanly.
vi.mock("$app/state", () => ({
  page: {
    data: {
      done: [],
      todayStart: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
      preferences: { timeFormat: "24h" },
    },
  },
}));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import QuickLogBar from "$lib/components/QuickLogBar.svelte";
import type { Medication } from "$lib/types";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";
import { accessibleName } from "./helpers/dom-names";

const METFORMIN: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m1",
  name: "Metformin",
  lowInventoryEpisodeAt: null,
};

const SUCCESS: ActionResult = {
  type: "success",
  status: 200,
  data: { success: true, doseId: "d-new" },
};
const NOT_FOUND: ActionResult = {
  type: "failure",
  status: 404,
  data: { errors: { form: ["Medication not found"] } },
};

let destroy: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.submit = null;
});

afterEach(() => {
  destroy?.();
  destroy = null;
  vi.useRealTimers();
});

function setup() {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(QuickLogBar, {
    target,
    props: {
      medications: [METFORMIN],
      todayStart: new Date("2026-04-16T00:00:00Z"),
      timezone: "UTC",
      timeFormat: "24h",
    },
    context: dashboardContext(),
  });
  flushSync();
  destroy = () => {
    unmount(component);
    target.remove();
  };
  const form = target.querySelector<HTMLFormElement>("form[data-quick-log]");
  const plus = target.querySelector<HTMLButtonElement>(
    'button[aria-label="Increase quantity for Metformin"]',
  );
  const submit = h.submit;
  if (!form || !plus || !submit) {
    throw new Error("no chip form, no + segment, or use:enhance never attached");
  }
  const chip = () => form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const quantity = () => new FormData(form).get("quantity");
  return { form, plus, submit, chip, quantity };
}

describe("QuickLogBar quantity", () => {
  it("resets to 1 after a successful log", async () => {
    const { form, plus, submit, chip, quantity } = setup();
    plus.click();
    flushSync();
    expect(quantity()).toBe("2");
    expect(accessibleName(chip())).toContain("×2");

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;
    flushSync();

    expect(quantity()).toBe("1");
    expect(accessibleName(chip())).not.toContain("×");
  });

  it("keeps the chosen quantity after a failed log, so a retry sends it again", async () => {
    const { form, plus, submit, chip, quantity } = setup();
    plus.click();
    flushSync();
    plus.click();
    flushSync();
    expect(quantity()).toBe("3");

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, NOT_FOUND).done;
    flushSync();

    expect(quantity()).toBe("3");
    expect(accessibleName(chip())).toContain("×3");
  });
});
