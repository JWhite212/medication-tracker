// The `.svelte.test.ts` name is load-bearing: vite-plugin-svelte compiles any
// module with a `.svelte.` infix, which is what lets this file use `$state` to
// stand in for SvelteKit's reactive `page` and for the props the router
// replaces on every navigation. The SSR suite beside it
// (tests/unit/log-pagination-ssr.test.ts) cannot see anything that happens
// after the first render: focus, timers, or a value that fails to update.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";

// Mocked ONCE, with reactive objects the tests repoint, for the same reason as
// the SSR suite: re-mocking per case reloads svelte's internals.
const pageState = $state({ url: new URL("https://medtracker.test/log") });
vi.mock("$app/state", () => ({ page: pageState }));

// There is no router in jsdom, so the page's navigation hooks are collected
// here and `navigate()` below runs them in the order SvelteKit does: before
// callbacks, then the new URL and data, then after callbacks.
type NavigationHook = (navigation: { type: string; to: { url: URL } | null }) => void;
const hooks = { before: [] as NavigationHook[], after: [] as NavigationHook[] };
vi.mock("$app/navigation", () => ({
  beforeNavigate: (fn: NavigationHook) => hooks.before.push(fn),
  afterNavigate: (fn: NavigationHook) => hooks.after.push(fn),
}));

// Each dose row's delete form imports `enhance` and the toast store; neither
// is what these assertions are about.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: LogPage } = await import("../../src/routes/(app)/log/+page.svelte");

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
}: { page?: number; hasMore?: boolean; filters?: Filters } = {}) {
  return {
    user,
    preferences,
    doses: [DOSE],
    medications: [{ id: "m1", name: "Ibuprofen", colour: "#ffffff" }],
    page,
    hasMore,
    filters,
    timezone: "UTC",
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
  app = mount(LogPage, { target, props });
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
  target = document.body.appendChild(document.createElement("div"));
  window.addEventListener("click", swallowNavigation);
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  window.removeEventListener("click", swallowNavigation);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
