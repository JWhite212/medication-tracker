// The `.svelte.test.ts` name is load-bearing: vite-plugin-svelte compiles any
// module with a `.svelte.` infix, which is what lets this file use `$state` to
// stand in for SvelteKit's reactive `page` and for the props the router
// replaces on every navigation. The SSR suite beside it
// (tests/unit/log-pagination-ssr.test.ts) cannot see anything that happens
// after the first render: focus, timers, or a value that fails to update.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";

// Mocked ONCE, with reactive objects the tests repoint, for the same reason as
// the SSR suite: re-mocking per case reloads svelte's internals.
const pageState = $state({ url: new URL("https://medtracker.test/log") });
vi.mock("$app/state", () => ({
  page: pageState,
  // The real idle shapes: reloadAfterWrite reads `navigating` before it
  // reloads, and a 409 reads `updated`.
  navigating: { from: null, to: null, type: null, willUnload: null, delta: null, complete: null },
  updated: { current: false, check: async () => false },
}));

// There is no router in jsdom, so the page's navigation hooks are collected
// here and `navigate()` below runs them in the order SvelteKit does: before
// callbacks, then the new URL and data, then after callbacks.
type NavigationHook = (navigation: { type: string; to: { url: URL } | null }) => void;
const hooks = { before: [] as NavigationHook[], after: [] as NavigationHook[] };

// Every dose write that reached `enhance` and was not cancelled, waiting for
// the test to answer it; and the reload the write runs after its answer.
type SentWrite = {
  fields: Record<string, FormDataEntryValue>;
  finish: (result: ActionResult) => Promise<void>;
};
const writes = { sent: [] as SentWrite[], invalidateAll: vi.fn(async () => {}) };

vi.mock("$app/navigation", () => ({
  beforeNavigate: (fn: NavigationHook) => hooks.before.push(fn),
  afterNavigate: (fn: NavigationHook) => hooks.after.push(fn),
  invalidateAll: () => writes.invalidateAll(),
}));

// SvelteKit's `enhance`, reduced to its two-phase contract: the submit
// function runs when a form submits, and the callback it returns runs when
// the test answers. A cancelled submit sends nothing. The GET filter form is
// not enhanced, so only dose writes arrive here.
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    const onSubmit = async (e: SubmitEvent) => {
      e.preventDefault();
      const formData = new FormData(form);
      const action = new URL(form.getAttribute("action") ?? "", "https://medtracker.test/log");
      let cancelled = false;
      const callback = await submit({
        action,
        formData,
        formElement: form,
        controller: new AbortController(),
        submitter: e.submitter,
        cancel: () => {
          cancelled = true;
        },
      });
      if (cancelled) return;
      writes.sent.push({
        fields: Object.fromEntries(formData),
        finish: async (result) => {
          if (typeof callback === "function") {
            await callback({ action, formData, formElement: form, result, update: async () => {} });
          }
        },
      });
    };
    form.addEventListener("submit", onSubmit);
    return { destroy: () => form.removeEventListener("submit", onSubmit) };
  },
  applyAction: async () => {},
  deserialize: (text: string) => JSON.parse(text),
}));
// The Undo registry is a no-op outside the browser, like Toast's own list.
vi.mock("$app/environment", () => ({
  browser: true,
  dev: false,
  building: false,
  version: "test",
}));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: LogPage } = await import("../../src/routes/(app)/log/+page.svelte");
// Imported here, not statically at the top: a static import runs before
// `pageState` exists, and the registry's import chain reaches `$app/state`,
// whose factory reads it.
const { currentUndo, resetUndoRegistry } =
  await import("$lib/components/dose-writes/undo-registry.svelte");
const { doseWriteContext } = await import("./helpers/dashboard-context");

const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "dark",
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
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

type Filters = {
  medication: string | null;
  from: string | null;
  to: string | null;
  status: "any" | "taken" | "skipped" | "missed";
  withSideEffects: boolean;
  q: string;
};

const NO_FILTERS: Filters = {
  medication: null,
  from: null,
  to: null,
  status: "any",
  withSideEffects: false,
  q: "",
};

const DOSE = {
  id: "d1",
  userId: "u1",
  medicationId: "m1",
  quantity: 1,
  takenAt: new Date("2026-04-10T08:00:00Z"),
  loggedAt: new Date("2026-04-10T08:00:00Z"),
  updatedAt: new Date("2026-04-10T08:00:00Z"),
  notes: null,
  sideEffects: null,
  status: "taken" as const,
  medication: {
    name: "Ibuprofen",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    colour: "#ffffff",
    colourSecondary: null,
    pattern: "solid",
  },
};

/** What the server load returns for one URL; the router hands the page a new object each time. */
function loadData({
  page = 1,
  hasMore = false,
  filters = NO_FILTERS,
  doses = [DOSE],
  timezone = "UTC",
}: {
  page?: number;
  hasMore?: boolean;
  filters?: Filters;
  doses?: (typeof DOSE)[];
  timezone?: string;
} = {}) {
  return {
    user: { ...user, timezone },
    preferences,
    doses,
    medications: [{ id: "m1", name: "Ibuprofen", colour: "#ffffff" }],
    page,
    hasMore,
    filters,
    timezone,
  };
}

type Data = ReturnType<typeof loadData>;

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let props: { data: Data };

function mountAt(pathAndQuery: string, data: Data) {
  pageState.url = new URL(pathAndQuery, "https://medtracker.test");
  const reactiveProps = $state({ data });
  props = reactiveProps;
  // The (app) layout's lock: every dose row's × reads it.
  app = mount(LogPage, { target, props, context: doseWriteContext() });
  flushSync();
}

/** One client-side navigation, with its hooks in SvelteKit's order. */
function navigate(pathAndQuery: string, data: Data, type = "link") {
  const url = new URL(pathAndQuery, "https://medtracker.test");
  for (const fn of hooks.before) fn({ type, to: { url } });
  pageState.url = url;
  props.data = data;
  flushSync();
  for (const fn of hooks.after) fn({ type, to: { url } });
}

/** A click the way the browser dispatches one; `init` adds modifiers or another button. */
function click(el: Element, init: MouseEventInit = {}) {
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
  );
}

/** The filter bar's own Clear filters link, not the empty state's. */
function filterBarClearLink(): HTMLAnchorElement | null {
  return target.querySelector<HTMLAnchorElement>('form[method="GET"] a[href="/log"]');
}

function control<T extends Element>(selector: string): T {
  const el = target.querySelector<T>(selector);
  expect(el, `no ${selector}`).not.toBeNull();
  return el!;
}

/**
 * Stops jsdom following a link, which it reports as "Not implemented:
 * navigation". In a browser the router prevents the default itself.
 */
function swallowNavigation(e: Event) {
  if ((e.target as Element).closest?.("a")) e.preventDefault();
}

beforeEach(() => {
  hooks.before.length = 0;
  hooks.after.length = 0;
  writes.sent.length = 0;
  writes.invalidateAll.mockReset();
  writes.invalidateAll.mockImplementation(async () => {});
  target = document.body.appendChild(document.createElement("div"));
  window.addEventListener("click", swallowNavigation);
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  window.removeEventListener("click", swallowNavigation);
  resetUndoRegistry();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Let the page's awaits and the enhance mock's finish. */
async function settle() {
  flushSync();
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
}

describe("the filter bar's Clear filters link keeps the user's place", () => {
  // It sits inside the GET form and so inherits data-sveltekit-keepfocus.
  // Following it clears every filter, which unmounts the link while it holds
  // focus; the browser drops focus to <body> and keepfocus tells SvelteKit to
  // leave it there.
  const MISSED: Filters = { ...NO_FILTERS, status: "missed" };

  it("moves focus to the first filter once the link has removed itself", () => {
    mountAt("/log?status=missed", loadData({ filters: MISSED }));
    const link = filterBarClearLink();
    expect(link, "no Clear filters link in the filter bar").not.toBeNull();

    link!.focus();
    click(link!);
    navigate("/log", loadData());

    expect(filterBarClearLink(), "the link should unmount with no filter active").toBeNull();
    expect(document.activeElement).toBe(control('select[name="medication"]'));
  });

  it.each<[string, MouseEventInit]>([
    ["Ctrl held", { ctrlKey: true }],
    ["Cmd held", { metaKey: true }],
    ["Shift held", { shiftKey: true }],
    ["Alt held", { altKey: true }],
    ["the middle button", { button: 1 }],
  ])("is not armed by a click with %s, which opens a new tab instead", (_label, init) => {
    // This page does not navigate on such a click, so a flag set by it would
    // fire on some later, unrelated navigation and pull focus away from the
    // control the user was actually using.
    mountAt("/log?status=missed", loadData({ filters: MISSED }));
    click(filterBarClearLink()!, init);

    const status = control<HTMLSelectElement>('select[name="status"]');
    status.focus();
    navigate(
      "/log?status=taken",
      loadData({ filters: { ...NO_FILTERS, status: "taken" } }),
      "form",
    );

    expect(document.activeElement).toBe(status);
  });

  it("moves focus once, not on every navigation after", () => {
    mountAt("/log?status=missed", loadData({ filters: MISSED }));
    click(filterBarClearLink()!);
    navigate("/log", loadData());

    const status = control<HTMLSelectElement>('select[name="status"]');
    status.focus();
    navigate(
      "/log?status=taken",
      loadData({ filters: { ...NO_FILTERS, status: "taken" } }),
      "form",
    );

    expect(document.activeElement).toBe(status);
  });
});

describe("a search still waiting out its debounce", () => {
  function typeSearch(text: string) {
    const input = control<HTMLInputElement>('input[name="q"]');
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  it("submits on its own when nothing else happens", () => {
    // The control case: without it, a spy that never fires would make the
    // next test pass for the wrong reason.
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    mountAt("/log?status=missed", loadData({ filters: { ...NO_FILTERS, status: "missed" } }));

    typeSearch("dizz");
    vi.advanceTimersByTime(300);

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("does not override Clear filters", () => {
    // Left running, the timer fires after the link has been followed and its
    // form submission, carrying the other filters too, replaces the navigation
    // the user asked for.
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    mountAt("/log?status=missed", loadData({ filters: { ...NO_FILTERS, status: "missed" } }));

    typeSearch("dizz");
    click(filterBarClearLink()!);
    navigate("/log", loadData());
    vi.advanceTimersByTime(1000);

    expect(submit).not.toHaveBeenCalled();
  });

  it("does not leave the unsent text in the box once the filters are cleared", () => {
    // The loaded query had no search, so `data.filters.q` is "" both before
    // and after; the input still has to follow the new `data`, or it would
    // show a search that is not applied.
    vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    mountAt("/log?status=missed", loadData({ filters: { ...NO_FILTERS, status: "missed" } }));

    typeSearch("dizz");
    click(filterBarClearLink()!);
    navigate("/log", loadData());

    expect(control<HTMLInputElement>('input[name="q"]').value).toBe("");
  });
});

describe("pagination hrefs follow the page they are on", () => {
  it("moves Previous and Next when the router moves the page, keeping the filters", () => {
    // Pins reactivity: an href captured once at mount would still pass every
    // SSR assertion, because SSR only ever renders once.
    const filters: Filters = { ...NO_FILTERS, status: "taken", q: "felt ok" };
    mountAt("/log?status=taken&q=felt+ok", loadData({ hasMore: true, filters }));
    navigate("/log?status=taken&q=felt+ok&page=2", loadData({ page: 2, hasMore: true, filters }));

    const next = new URL(control<HTMLAnchorElement>('a[rel="next"]').href);
    const prev = new URL(control<HTMLAnchorElement>('a[rel="prev"]').href);

    expect(next.searchParams.get("page")).toBe("3");
    expect(next.searchParams.get("status")).toBe("taken");
    expect(next.searchParams.get("q")).toBe("felt ok");
    expect(prev.searchParams.has("page")).toBe(false);
    expect(prev.searchParams.get("q")).toBe("felt ok");
  });
});

describe("× on the real page: the day it names, and where focus goes (Review Focus #4)", () => {
  // The page groups by the viewer's today, read from the clock. Only Date is
  // faked, so the lock's cooldown and the registry's timers stay real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-10T12:00:00Z"));
  });

  // DOSE is Ibuprofen 200mg on 10 Apr at 08:00 UTC: today.
  const YESTERDAY = {
    ...DOSE,
    id: "d2",
    takenAt: new Date("2026-04-09T21:30:00Z"),
    loggedAt: new Date("2026-04-09T21:30:00Z"),
    updatedAt: new Date("2026-04-09T21:30:00Z"),
    medication: { ...DOSE.medication, name: "Paracetamol", dosageAmount: "500" },
  };
  const OLDER = {
    ...DOSE,
    id: "d3",
    takenAt: new Date("2026-04-07T08:00:00Z"),
    loggedAt: new Date("2026-04-07T08:00:00Z"),
    updatedAt: new Date("2026-04-07T08:00:00Z"),
  };

  const editOf = (id: string) =>
    target.querySelector<HTMLElement>(`[data-dose-id="${id}"] [data-edit]`);

  /** Press ×, answer the delete, and reload to `remaining` as the server would. */
  async function deleteOnPage(id: string, remaining: (typeof DOSE)[], timezone = "UTC") {
    const x = target.querySelector<HTMLButtonElement>(
      `[data-dose-id="${id}"] button[aria-label^="Delete dose of"]`,
    );
    expect(x, `no × for ${id}`).not.toBeNull();
    expect(x!.type).toBe("submit");
    writes.invalidateAll.mockImplementationOnce(async () => {
      props.data = loadData({ doses: remaining, timezone });
      flushSync();
    });
    x!.focus();
    x!.click();
    await settle();
    expect(writes.sent).toHaveLength(1);
    expect(writes.sent[0].fields).toEqual({ doseId: id });
    await writes.sent[0].finish({
      type: "success",
      status: 200,
      data: {
        success: true,
        doseId: id,
        restore: { deletedAt: "2026-04-10T12:00:00.000Z", expiresInMs: 600_000 },
      },
    });
    await settle();
  }

  it("hands focus from the last dose of today to yesterday's first ✎, and names no day", async () => {
    mountAt("/log", loadData({ doses: [DOSE, YESTERDAY, OLDER] }));

    await deleteOnPage("d1", [YESTERDAY, OLDER]);

    expect(document.activeElement).toBe(editOf("d2"));
    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d1",
      message: "Dose removed: Ibuprofen 200mg at 8:00",
    });
  });

  it.each<[string, string]>([
    ["d2", "Dose removed: Paracetamol 500mg yesterday at 21:30"],
    ["d3", "Dose removed: Ibuprofen 200mg on Tue 7 Apr at 8:00"],
  ])("names the day of %s in its Undo offer", async (id, message) => {
    const all = [DOSE, YESTERDAY, OLDER];
    mountAt("/log", loadData({ doses: all }));

    await deleteOnPage(
      id,
      all.filter((d) => d.id !== id),
    );

    expect(currentUndo()?.message).toBe(message);
  });

  it("falls back to the page's h1 when the last dose on the page goes", async () => {
    mountAt("/log", loadData({ doses: [DOSE] }));

    await deleteOnPage("d1", []);

    const h1 = target.querySelector("h1");
    expect(h1?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(h1);
  });

  // A civil day is 23 or 25 hours on a transition day. "Yesterday" is the
  // previous day KEY (shiftDayKey), never `now − 24h`: in London that
  // instant is the day before yesterday for the first hour after the
  // spring-forward day, and today itself in the last hour of the fall-back
  // day.
  describe("across a DST transition (Europe/London)", () => {
    const LONDON = "Europe/London";
    const dose = (id: string, takenAt: string, name = "Ibuprofen") => ({
      ...DOSE,
      id,
      takenAt: new Date(takenAt),
      loggedAt: new Date(takenAt),
      updatedAt: new Date(takenAt),
      medication: { ...DOSE.medication, name },
    });
    const headings = () => [...target.querySelectorAll("h3")].map((h) => h.textContent?.trim());

    it("in the first hour after the spring-forward day, Sunday is yesterday and Saturday is not", async () => {
      // Mon 30 Mar 00:30 BST. Sunday 29 Mar was 23 hours long.
      vi.setSystemTime(new Date("2026-03-29T23:30:00Z"));
      const sunday = dose("sun", "2026-03-29T08:00:00Z"); // 09:00 BST
      const saturday = dose("sat", "2026-03-28T08:00:00Z", "Paracetamol"); // 08:00 GMT
      mountAt("/log", loadData({ doses: [sunday, saturday], timezone: LONDON }));
      expect(headings()).toEqual(["Yesterday", "Sat 28 Mar"]);

      await deleteOnPage("sun", [saturday], LONDON);
      expect(currentUndo()?.message).toBe("Dose removed: Ibuprofen 200mg yesterday at 9:00");
    });

    it("in the first hour after the spring-forward day, Saturday is named by its date", async () => {
      vi.setSystemTime(new Date("2026-03-29T23:30:00Z"));
      const sunday = dose("sun", "2026-03-29T08:00:00Z");
      const saturday = dose("sat", "2026-03-28T08:00:00Z", "Paracetamol");
      mountAt("/log", loadData({ doses: [sunday, saturday], timezone: LONDON }));

      await deleteOnPage("sat", [sunday], LONDON);
      expect(currentUndo()?.message).toBe("Dose removed: Paracetamol 200mg on Sat 28 Mar at 8:00");
    });

    it("in the last hour of the fall-back day, Saturday is still yesterday", async () => {
      // Sun 25 Oct 23:30 GMT. Sunday was 25 hours long, so now − 24h is
      // still Sunday.
      vi.setSystemTime(new Date("2026-10-25T23:30:00Z"));
      const saturday = dose("sat", "2026-10-24T08:00:00Z"); // 09:00 BST
      mountAt("/log", loadData({ doses: [saturday], timezone: LONDON }));
      expect(headings()).toEqual(["Yesterday"]);

      await deleteOnPage("sat", [], LONDON);
      expect(currentUndo()?.message).toBe("Dose removed: Ibuprofen 200mg yesterday at 9:00");
    });
  });
});
