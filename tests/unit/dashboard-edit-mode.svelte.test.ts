// The dashboard's in-place edit mode (spec §5b, §5d, §5f; tests 11 and 12),
// mounted as the whole page in jsdom, because only there do the footer
// control, the real sections, the write lock and the keyboard shortcuts meet.
// The draft's own write queue is pinned in dashboard-editor.svelte.test.ts;
// this file pins the page around it.
//
// `enhance` is mocked to behave like SvelteKit's at the one point that
// matters here: it listens for `submit` on the form itself and records a
// post. So "a dose form posts nothing while editing" is a real event-path
// question: the page's capture-phase guard on an ancestor either stops the
// event before the form's listener or it does not.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import type { DashboardPageData, DoneRow, DueCard, LaterRow, Medication } from "$lib/types";
import type { RefillForecastEntry, UserPreferences } from "$lib/types";

const h = vi.hoisted(() => ({
  posted: [] as HTMLFormElement[],
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement) => {
    const onSubmit = (event: Event) => {
      event.preventDefault();
      h.posted.push(form);
    };
    form.addEventListener("submit", onSubmit);
    return { destroy: () => form.removeEventListener("submit", onSubmit) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll(), goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: { data: {}, url: new URL("http://localhost/dashboard") },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import Page from "../../src/routes/(app)/dashboard/+page.svelte";
import { URGENT_REFILLS_NOTE } from "$lib/components/RefillsCard.svelte";
import { STILL_SAVING_TOAST } from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { resetUndoRegistry } from "$lib/components/dose-writes/undo-registry.svelte";
import { CUSTOMISE_HEADING_ID, DASHBOARD_EDITOR_ID } from "$lib/components/dashboard/dom-ids";
import { findQuickLogForm } from "$lib/utils/quick-log";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { preferencesFixture } from "./helpers/preferences-fixture";

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const basePreferences: UserPreferences = { ...preferencesFixture, timeFormat: "24h" };

const metformin: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m1",
  name: "Metformin",
  lowInventoryEpisodeAt: null,
};
const ibuprofen: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m2",
  name: "Ibuprofen",
  dosageAmount: "200",
  sortOrder: 1,
  lowInventoryEpisodeAt: null,
};

const TAKEN_AT = new Date("2026-05-01T09:00:00.000Z");

const done: DoneRow = {
  key: "d1",
  dose: {
    id: "d1",
    userId: "u1",
    medicationId: "m2",
    quantity: 1,
    status: "taken",
    takenAt: TAKEN_AT,
    loggedAt: TAKEN_AT,
    updatedAt: TAKEN_AT,
    notes: null,
    sideEffects: null,
    medication: {
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#ff0000",
      colourSecondary: null,
      pattern: "solid",
    },
  },
  covers: [],
  dayLabel: null,
};

const dueNow: DueCard = {
  key: "today:m1",
  medicationId: "m1",
  name: "Metformin",
  dosageAmount: "500",
  dosageUnit: "mg",
  colour: "#ff0000",
  colourSecondary: null,
  pattern: "solid",
  rows: [
    {
      key: "m1:2026-05-01T13:30:00.000Z",
      kind: "fixed_time",
      expectedTime: "2026-05-01T13:30:00.000Z",
      state: "due-now",
      logNow: true,
      tookItAt: null,
      skipAt: "2026-05-01T13:30:00.000Z",
    },
  ],
};

const later: LaterRow = {
  key: "later:m2:2026-05-01T19:00:00.000Z",
  medicationId: "m2",
  name: "Ibuprofen",
  dosageAmount: "200",
  dosageUnit: "mg",
  colour: "#ff0000",
  colourSecondary: null,
  pattern: "solid",
  expectedTime: "2026-05-01T19:00:00.000Z",
};

/** Critical: the Refills card draws it as needing you, so a hidden Refills keeps it. */
const urgentRefill: RefillForecastEntry = {
  medicationId: "m1",
  medicationName: "Metformin",
  colour: "#ff0000",
  inventoryCount: 2,
  inventoryAlertThreshold: null,
  dailyRate: 1,
  daysUntilRefill: 2,
  severity: "critical",
};

const SCHEDULED: DashboardPageData = {
  now: "2026-05-01T14:00:00.000Z",
  nextRefreshAt: "2026-05-01T15:00:00.000Z",
  timezone: "UTC",
  todayStart: "2026-05-01T00:00:00.000Z",
  status: { kind: "due", dueCount: 1, doneToday: 1, totalToday: 2, loggedToday: 1, next: null },
  earlier: [],
  today: [dueNow],
  done: [done],
  later: [later],
  medications: [metformin, ibuprofen],
  refillForecast: [urgentRefill],
};

const AS_NEEDED_ONLY: DashboardPageData = {
  ...SCHEDULED,
  status: {
    kind: "as-needed-only",
    dueCount: 0,
    doneToday: 0,
    totalToday: 0,
    loggedToday: 1,
    next: null,
  },
  today: [],
  later: [],
};

type Props = {
  data: DashboardPageData & { user: typeof user; preferences: UserPreferences };
};

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let props: Props;
let lock: DoseWriteLock;
type Post = { url: string; fields: Record<string, string>; resolve: () => void };
let posts: Post[];

function liveProps(data: DashboardPageData, prefs: Partial<UserPreferences>): Props {
  const live = $state({ data: { ...data, user, preferences: { ...basePreferences, ...prefs } } });
  return live;
}

function mountPage(data: DashboardPageData = SCHEDULED, prefs: Partial<UserPreferences> = {}) {
  props = liveProps(data, prefs);
  app = mount(Page, { target, props, context: doseWriteContext(lock) });
  flushSync();
}

/** A post's answer is the test's to give, so "in flight" is a state the test holds. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          const body = init.body as FormData;
          posts.push({
            url,
            fields: Object.fromEntries([...body.entries()].map(([k, v]) => [k, String(v)])),
            resolve: () =>
              resolve(
                new Response(JSON.stringify({ type: "success", status: 200, data: {} }), {
                  status: 200,
                }),
              ),
          });
        }),
    ),
  );
}

beforeEach(() => {
  h.posted.length = 0;
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
  posts = [];
  stubFetch();
  lock = createDoseWriteLock();
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  resetUndoRegistry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  flushSync();
  for (let i = 0; i < 4; i++) await tick();
  flushSync();
}

const footer = () =>
  target.querySelector<HTMLButtonElement>(`button[aria-controls="${DASHBOARD_EDITOR_ID}"]`);
const region = () => document.getElementById(DASHBOARD_EDITOR_ID);
const heading = () => document.getElementById(CUSTOMISE_HEADING_ID);
const bar = (id: string) => target.querySelector<HTMLElement>(`[data-section-bar="${id}"]`);
const editOrder = () =>
  [...target.querySelectorAll<HTMLElement>("[data-edit-section]")].map(
    (el) => el.dataset.editSection,
  );
const moveButton = (id: string, dir: "up" | "down") =>
  document.getElementById(`editor-move-${id}-${dir}`) as HTMLButtonElement;
const shownToggle = (id: string) =>
  bar(id)!.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
const toolbarButton = (name: string) =>
  [...target.querySelectorAll<HTMLButtonElement>("[data-edit-toolbar] button")].find(
    (b) => b.textContent?.trim() === name,
  )!;

async function enter() {
  footer()!.click();
  await settle();
}

describe("the footer control", () => {
  it("once mounted is a type=button that controls the editor and starts collapsed", () => {
    mountPage();
    const control = target.querySelector(
      `button[type="button"][aria-expanded="false"][aria-controls="${DASHBOARD_EDITOR_ID}"]`,
    );
    expect(control).not.toBeNull();
    expect(control!.textContent).toContain("Customise this page");
    expect(target.querySelector('a[href="/settings/dashboard?from=dashboard"]')).toBeNull();
    expect(region(), "aria-controls must resolve").not.toBeNull();
  });
});

describe("entering and leaving", () => {
  it("entering focuses the customise heading and expands the footer control", async () => {
    mountPage();
    await enter();
    expect(heading()).not.toBeNull();
    expect(heading()!.textContent).toContain("Customising your dashboard");
    expect(document.activeElement).toBe(heading());
    expect(footer()!.getAttribute("aria-expanded")).toBe("true");
    expect(region()!.getAttribute("role")).toBe("region");
    expect(region()!.getAttribute("aria-labelledby")).toBe(CUSTOMISE_HEADING_ID);
    expect(target.querySelector('[role="status"]')!.textContent).toContain(
      "Customising. Changes save as you make them.",
    );
  });

  it("Escape on the region leaves and returns focus to the footer control", async () => {
    mountPage();
    await enter();
    heading()!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await settle();
    expect(heading()).toBeNull();
    expect(target.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(footer());
    expect(footer()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("Done leaves, returns focus to the footer control, and reloads once", async () => {
    mountPage();
    await enter();
    toolbarButton("Done").click();
    await settle();
    expect(heading()).toBeNull();
    expect(document.activeElement).toBe(footer());
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("Done waits for a held write before reloading, and keeps the change on screen meanwhile", async () => {
    mountPage();
    await enter();
    shownToggle("later").click();
    await settle();
    expect(posts.at(-1)!.fields).toEqual({ dashboardShowLater: "off" });
    toolbarButton("Done").click();
    await settle();
    // Out of edit mode and focus returned at once ...
    expect(heading()).toBeNull();
    expect(document.activeElement).toBe(footer());
    // ... but no reload while the hide is uncommitted: one served now would
    // carry the old value, and Later would reappear.
    expect(h.invalidateAll).not.toHaveBeenCalled();
    expect(document.getElementById("later-heading")).toBeNull();

    posts.at(-1)!.resolve();
    await settle();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("re-entering while a write settles keeps the draft, and only the last Done reloads", async () => {
    mountPage();
    await enter();
    shownToggle("later").click();
    await settle();
    toolbarButton("Done").click();
    await settle();
    await enter();
    expect(bar("later")!.textContent).toContain("Hidden");
    expect(shownToggle("later").getAttribute("aria-pressed")).toBe("false");
    toolbarButton("Done").click();
    await settle();
    expect(h.invalidateAll).not.toHaveBeenCalled();

    posts.at(-1)!.resolve();
    await settle();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("is refused while a dose write is active, with the coalesced still-saving toast", async () => {
    mountPage();
    lock.acquire();
    await enter();
    expect(heading()).toBeNull();
    expect(target.querySelector("[inert]")).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error", { coalesce: true });
  });

  it("a remount starts out of edit mode", async () => {
    mountPage();
    await enter();
    expect(target.querySelector("[inert]")).not.toBeNull();
    unmount(app!);
    app = mount(Page, { target, props, context: doseWriteContext(lock) });
    flushSync();
    expect(target.querySelector("[inert]")).toBeNull();
    expect(heading()).toBeNull();
    expect(footer()!.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("while editing", () => {
  it("renders the sections in the draft's order", async () => {
    mountPage();
    await enter();
    expect(editOrder()).toEqual(["done", "later", "quickLog", "refills"]);
    moveButton("refills", "up").click();
    await settle();
    expect(editOrder()).toEqual(["done", "later", "refills", "quickLog"]);
    expect(posts.at(-1)!.url).toBe("/settings/dashboard?/dashboardSectionOrder");
    expect(posts.at(-1)!.fields).toEqual({
      dashboardSectionOrder: "done,later,refills,quickLog",
    });
  });

  it("shows a hidden section under [inert] with Hidden in its bar, only while editing", async () => {
    mountPage(SCHEDULED, { dashboardShowLater: false });
    expect(document.getElementById("later-heading")).toBeNull();
    await enter();
    const laterHeading = document.getElementById("later-heading");
    expect(laterHeading, "a hidden section is visible while editing").not.toBeNull();
    expect(laterHeading!.closest("[inert]")).not.toBeNull();
    expect(bar("later")!.textContent).toContain("Hidden");
    expect(bar("done")!.textContent).not.toContain("Hidden");
    toolbarButton("Done").click();
    await settle();
    expect(document.getElementById("later-heading")).toBeNull();
  });

  it("keeps every id unique with every section hidden and then shown", async () => {
    mountPage(SCHEDULED, { dashboardShowRefills: true });
    await enter();
    const assertUnique = () => {
      const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
      expect(ids.length).toBeGreaterThan(5);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    };
    assertUnique();
    for (const id of ["later", "quickLog", "refills"]) shownToggle(id).click();
    await settle();
    expect(shownToggle("later").getAttribute("aria-pressed")).toBe("false");
    assertUnique();
    for (const id of ["later", "quickLog", "refills"]) shownToggle(id).click();
    await settle();
    expect(shownToggle("later").getAttribute("aria-pressed")).toBe("true");
    assertUnique();
  });

  it("leaves nothing focusable outside the bars and the toolbar that is not under [inert]", async () => {
    mountPage(SCHEDULED, { dashboardShowLater: false });
    await enter();
    const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const all = [...region()!.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const controls = all.filter((el) => el.closest("[data-section-bar], [data-edit-toolbar]"));
    const content = all.filter((el) => !el.closest("[data-section-bar], [data-edit-toolbar]"));
    expect(content.length, "the sections carry real dose controls").toBeGreaterThan(3);
    expect(content.filter((el) => !el.closest("[inert]"))).toEqual([]);
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.filter((el) => el.closest("[inert]"))).toEqual([]);
  });

  it("cancels a dose form's submit even with inert removed (the capture-phase guard)", async () => {
    mountPage();
    await enter();
    for (const el of target.querySelectorAll("[inert]")) el.removeAttribute("inert");
    const chip = findQuickLogForm(document, "m1");
    expect(chip).not.toBeNull();
    chip!.requestSubmit();
    const dueForm = target.querySelector<HTMLFormElement>(
      '[data-due-list] form[action="?/logDose"]',
    );
    expect(dueForm).not.toBeNull();
    dueForm!.requestSubmit();
    await settle();
    expect(h.posted).toEqual([]);
  });

  it("the guard is lifted once editing ends", async () => {
    mountPage();
    await enter();
    toolbarButton("Done").click();
    await settle();
    findQuickLogForm(document, "m1")!.requestSubmit();
    expect(h.posted).toHaveLength(1);
  });

  it("a 1–9 keydown submits nothing", async () => {
    mountPage();
    await enter();
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit");
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true }),
    );
    await settle();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(h.posted).toEqual([]);
  });

  it("keeps focus on the pressed arrow after a move, and moves it to the opposite arrow at an end", async () => {
    mountPage();
    await enter();
    moveButton("refills", "up").focus();
    moveButton("refills", "up").click();
    await settle();
    expect(document.activeElement?.id).toBe("editor-move-refills-up");

    moveButton("later", "up").focus();
    moveButton("later", "up").click();
    await settle();
    expect(editOrder()[0]).toBe("later");
    expect(moveButton("later", "up").getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement?.id).toBe("editor-move-later-down");
    expect(target.querySelector('[role="status"]')!.textContent).toContain(
      "Later today moved to position 1 of 4",
    );
  });

  it("a move refused offline changes nothing and announces no move", async () => {
    mountPage();
    await enter();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    moveButton("refills", "up").click();
    await settle();
    expect(posts).toEqual([]);
    expect(editOrder()).toEqual(["done", "later", "quickLog", "refills"]);
    expect(target.querySelector('[role="status"]')!.textContent).not.toContain("moved");
    expect(h.showToast).toHaveBeenCalledWith("You're offline — that change wasn't saved.", "error");
  });

  it("an arrow at an end does nothing", async () => {
    mountPage();
    await enter();
    moveButton("done", "up").click();
    await settle();
    expect(posts).toEqual([]);
    expect(editOrder()).toEqual(["done", "later", "quickLog", "refills"]);
  });

  it("pins Due with a fixed bar on a scheduled account with something due", async () => {
    mountPage();
    await enter();
    expect(bar("due")!.textContent).toContain("Due now · always first while something is due");
    expect(bar("due")!.querySelector("button")).toBeNull();
    expect(document.getElementById("due-heading")!.closest("[inert]")).not.toBeNull();
  });

  it("pins Log a dose on an as-needed-only account, and a move keeps the stored places", async () => {
    mountPage(AS_NEEDED_ONLY, { dashboardSectionOrder: ["later", "done", "quickLog", "refills"] });
    await enter();
    expect(bar("quickLog")!.textContent).toContain("Log a dose · always first on your account");
    expect(bar("quickLog")!.querySelector("button")).toBeNull();
    expect(editOrder()).toEqual(["done", "refills"]);
    moveButton("refills", "up").click();
    await settle();
    expect(editOrder()).toEqual(["refills", "done"]);
    expect(posts.at(-1)!.fields).toEqual({
      dashboardSectionOrder: "later,refills,quickLog,done",
    });
  });

  it("shows the urgent-floor note in the Refills bar when Refills is hidden but urgent", async () => {
    mountPage(SCHEDULED, { dashboardShowRefills: false });
    await enter();
    expect(bar("refills")!.textContent).toContain(URGENT_REFILLS_NOTE);
    expect(shownToggle("refills").getAttribute("aria-pressed")).toBe("false");
  });

  it("Done's bar says it is always shown and offers no toggle", async () => {
    mountPage();
    await enter();
    expect(bar("done")!.textContent).toContain("Always shown");
    expect(bar("done")!.querySelector("button[aria-pressed]")).toBeNull();
  });

  it("a preset applies to the page and is announced; a move makes it Custom", async () => {
    mountPage();
    await enter();
    expect(toolbarButton("Standard").getAttribute("aria-pressed")).toBe("true");
    toolbarButton("Focused").click();
    await settle();
    expect(toolbarButton("Focused").getAttribute("aria-pressed")).toBe("true");
    expect(posts.at(-1)!.url).toBe("/settings/dashboard?/applyPreset");
    expect(posts.at(-1)!.fields).toEqual({ preset: "focused" });
    expect(bar("later")!.textContent).toContain("Hidden");
    expect(target.querySelector('[role="status"]')!.textContent).toContain("Focused applied");
    posts.at(-1)!.resolve();
    await settle();
    moveButton("refills", "up").click();
    await settle();
    expect(target.querySelector("[data-edit-toolbar]")!.textContent).toContain("Custom");
    const pressed = target.querySelectorAll('[data-edit-toolbar] button[aria-pressed="true"]');
    expect(pressed).toHaveLength(0);
    const more = target.querySelector<HTMLAnchorElement>("[data-edit-toolbar] a");
    expect(more!.getAttribute("href")).toBe("/settings/dashboard");
    expect(more!.textContent).toContain("More options");
  });

  it("keeps a just-moved section through a refresh that predates the write", async () => {
    mountPage();
    await enter();
    moveButton("refills", "up").click();
    await settle();
    // The clock's refresh lands while the move is in flight, carrying the old order.
    props.data = { ...props.data, now: "2026-05-01T14:01:00.000Z" };
    await settle();
    expect(editOrder()).toEqual(["done", "later", "refills", "quickLog"]);
  });
});
