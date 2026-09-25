// Mounted in jsdom (the suite default) rather than rendered to a string,
// because both properties here belong to a live DOM: which element holds
// focus while a quick log is in flight, and the real parent chain between a
// row of the Medications list and the name inside its card. The class-level
// checks on the same controls are in medication-card-targets-ssr.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { MedicationWithStats } from "$lib/types";
import MedicationCard from "../../src/lib/components/MedicationCard.svelte";
import MedicationsPage from "../../src/routes/(app)/medications/+page.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";

const { showToast, invalidateAll } = vi.hoisted(() => ({
  showToast: vi.fn(),
  invalidateAll: vi.fn(async () => {}),
}));

// SvelteKit's client runtime is not running here; the card only needs the
// three calls it makes, and the page only needs `enhance` to be inert.
vi.mock("$components/ui/Toast.svelte", () => ({ showToast }));
vi.mock("$app/navigation", () => ({ invalidateAll }));
vi.mock("$app/forms", () => ({
  deserialize: (text: string) => JSON.parse(text),
  enhance: () => ({ destroy() {} }),
}));

type ListedMedication = MedicationWithStats & {
  sparkline: number[];
  refillSeverity: "critical" | "warning" | "watch" | "ok";
};

function medication(overrides: Partial<ListedMedication> = {}): ListedMedication {
  return {
    ...BASE_MEDICATION_ROW,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    daysUntilRefill: 3,
    expectedDailyDoses: 3,
    sparkline: [1, 2, 3, 2, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3],
    refillSeverity: "critical",
    ...overrides,
  };
}

let target: HTMLElement;
let app: Record<string, unknown> | undefined;

beforeEach(() => {
  target = document.body.appendChild(document.createElement("div"));
  showToast.mockClear();
  invalidateAll.mockClear();
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  vi.unstubAllGlobals();
});

describe("the medication card's Log button while a dose is in flight", () => {
  it("keeps keyboard focus, and still refuses a second log", async () => {
    // It used to take a native `disabled` for the duration of the request. A
    // disabled button cannot hold focus, so a keyboard user who pressed it
    // was dropped to <body> and had to find their place in the list again.
    let respond!: (result: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          respond = (result) => resolve({ text: async () => JSON.stringify(result) });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    app = mount(MedicationCard, { target, props: { medication: medication() } });
    const button = target.querySelector<HTMLButtonElement>(
      'button[aria-label="Log a dose of Paracetamol"]',
    )!;
    expect(button.getAttribute("aria-disabled")).toBe("false");

    button.focus();
    button.click();
    flushSync();

    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);

    // The guard moved from the attribute into the handler, so a second press
    // mid-flight must still be a no-op rather than a second dose.
    button.click();
    flushSync();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    respond({ type: "success", status: 200 });
    await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("false"));
    expect(showToast).toHaveBeenCalledWith("Paracetamol logged", "success");
    expect(invalidateAll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
  });
});

describe("the medications list's card column", () => {
  it("lets a long name break inside the card instead of widening it", () => {
    // A flex item's automatic minimum width is its min-content width, and
    // `overflow-wrap: break-word` does not lower that. The page's wrapper
    // round the card had no min-w-0, so at 320px a name such as this one
    // widened the whole card past the screen and pushed the Log button off
    // its edge. Every flex item between the row and the name has to be
    // allowed to shrink, so the card is sized by the row, not its content.
    const LONG = "Hydrochlorothiazide";
    const data = {
      medications: [medication({ id: "m1", name: LONG })],
      archived: [],
    } as unknown as ComponentProps<typeof MedicationsPage>["data"];
    app = mount(MedicationsPage, { target, props: { data } });

    const name = [...target.querySelectorAll("p")].find((p) => p.textContent === LONG)!;
    const row = name.closest(".space-y-3 > div")!;
    expect(row).not.toBeNull();

    const unshrinkable: string[] = [];
    for (let el: Element | null = name; el && el !== row; el = el.parentElement) {
      const parent = el.parentElement!;
      const inFlexLayout =
        parent.classList.contains("flex") || parent.classList.contains("inline-flex");
      if (inFlexLayout && !el.classList.contains("min-w-0")) {
        unshrinkable.push(`<${el.tagName.toLowerCase()} class="${el.className}">`);
      }
    }
    expect(unshrinkable).toEqual([]);

    // The backstop: `overflow-wrap: anywhere` lowers min-content itself, so
    // the name still breaks if a later change drops one of those min-w-0s.
    expect(name.closest(".wrap-anywhere")).not.toBeNull();
  });
});
