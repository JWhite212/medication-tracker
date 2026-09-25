// Covers: the mobile navigation menu's focus contract in
// src/routes/(app)/+layout.svelte, mounted for real under the suite's default
// jsdom environment -- where focus goes on open, the window-level Escape and
// Tab trap, where focus goes on each kind of close, and the `inert` state of
// the page behind the menu.
//
// Does NOT cover: anything jsdom does not model. It has no layout, so the
// md:hidden breakpoint is simulated through a stubbed matchMedia, and it does
// not implement `inert` at all, so an inert element still takes focus there.
// That is why the focus-return case below records inertness at the instant
// focus ARRIVES rather than trusting where focus ends up: in a browser,
// focusing the toggle while its header is still inert silently does nothing,
// and only the ordering distinguishes the two.
//
// The `svelte` mock is load-bearing. This suite resolves bare `svelte` without
// the "browser" export condition, so it gets the SERVER entry even under jsdom:
// there `mount()` throws and `tick()` is an empty async function, which would
// let the layout's awaited tick() "pass" without flushing a thing. The .svelte
// files themselves already compile against `svelte/internal/client`, so
// pointing `svelte` at the client entry puts the test, the layout and Sidebar
// on the one runtime a browser would give them.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync, createRawSnippet } from "svelte";
import { readable } from "svelte/store";

// Named by path because svelte's export map offers this file only under the
// "browser" condition. The specifier has to stay a literal: computed at
// runtime, it skips vite's import analysis and is handed to Node unresolved.
vi.mock(
  "svelte",
  // @ts-expect-error -- svelte ships no declarations for its src/ tree; the
  // module's shape is the public "svelte" API, which is how the test uses it.
  () => import("../../node_modules/svelte/src/index-client.js"),
);

const nav = vi.hoisted(() => ({ afterNavigate: [] as Array<() => void> }));

// Sidebar reads $page for aria-current, and the layout registers an
// afterNavigate callback; both need a running SvelteKit client otherwise.
// The callback is captured so a test can play the router's part.
vi.mock("$app/navigation", () => ({
  afterNavigate: (fn: () => void) => nav.afterNavigate.push(fn),
}));
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));

const { default: Layout } = await import("../../src/routes/(app)/+layout.svelte");

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
  accentColor: "#4f46e5",
  theme: "system",
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
} as const;

/** One stubbed MediaQueryList per query, so a test can fire its change event. */
let media: { query: string; listeners: Set<(e: { matches: boolean }) => void> }[] = [];

function stubMatchMedia() {
  media = [];
  vi.stubGlobal("matchMedia", (query: string) => {
    const entry = { query, listeners: new Set<(e: { matches: boolean }) => void>() };
    media.push(entry);
    return {
      matches: false,
      media: query,
      addEventListener: (_type: string, fn: (e: { matches: boolean }) => void) =>
        entry.listeners.add(fn),
      removeEventListener: (_type: string, fn: (e: { matches: boolean }) => void) =>
        entry.listeners.delete(fn),
    };
  });
}

let app: ReturnType<typeof mount> | undefined;
let target: HTMLElement;

function mountLayout() {
  target = document.createElement("div");
  document.body.appendChild(target);
  const children = createRawSnippet(() => ({
    render: () => `<p><a href="/elsewhere" data-id="page-link">A link on the page</a></p>`,
  }));
  app = mount(Layout, { target, props: { data: { user, preferences }, children } });
  flushSync();
}

/**
 * Let every pending microtask run. openMenu and closeMenu each await a tick()
 * before touching focus, so a single `await tick()` here races them; a
 * macrotask boundary does not.
 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function toggle(): HTMLButtonElement {
  const el = target.querySelector<HTMLButtonElement>('button[aria-label="Toggle menu"]');
  if (!el) throw new Error("menu toggle not rendered");
  return el;
}

function dialog(): HTMLElement | null {
  return target.querySelector<HTMLElement>('[role="dialog"]');
}

/** The panel inside the overlay that holds the mobile Sidebar. */
function panelLinks(): HTMLAnchorElement[] {
  const d = dialog();
  if (!d) throw new Error("menu is not open");
  return [...d.querySelectorAll<HTMLAnchorElement>("aside a[href]")];
}

function header(): HTMLElement {
  const el = target.querySelector("header")?.parentElement;
  if (!el) throw new Error("header not rendered");
  return el;
}

function main(): HTMLElement {
  const el = target.querySelector("main")?.parentElement;
  if (!el) throw new Error("main not rendered");
  return el;
}

/**
 * Whether `el` itself is inert. Svelte writes `el.inert = open`, which a browser
 * reflects onto the attribute; jsdom has no such IDL attribute, so there the
 * write lands as a plain property and the attribute never appears. Reading
 * both keeps the assertion honest in either engine.
 */
function isInert(el: Element): boolean {
  return (el as HTMLElement).inert === true || el.hasAttribute("inert");
}

/** Whether `el` or any ancestor is inert, i.e. whether a browser would refuse it focus. */
function insideInert(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (isInert(node)) return true;
  }
  return false;
}

function press(key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  (document.activeElement ?? document.body).dispatchEvent(event);
  flushSync();
  return event;
}

async function openMenu() {
  toggle().focus();
  toggle().click();
  await settle();
}

beforeEach(() => {
  nav.afterNavigate.length = 0;
  stubMatchMedia();
  mountLayout();
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  vi.unstubAllGlobals();
});

describe("mobile nav toggle", () => {
  it("reports its state and names the overlay it controls", async () => {
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    const controls = toggle().getAttribute("aria-controls");
    expect(controls).toBeTruthy();

    await openMenu();

    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    // The reference has to resolve to the dialog itself once it exists,
    // not merely be present on the button.
    expect(document.getElementById(controls!)).toBe(dialog());
  });
});

describe("opening the mobile nav", () => {
  it("moves focus to the first link in the menu", async () => {
    await openMenu();

    const [first] = panelLinks();
    expect(first).toBeDefined();
    expect(document.activeElement).toBe(first);
  });

  it("makes the header and the page behind the scrim inert, and only while open", async () => {
    expect(isInert(header())).toBe(false);
    expect(isInert(main())).toBe(false);

    await openMenu();

    expect(isInert(header())).toBe(true);
    expect(isInert(main())).toBe(true);
    // The overlay itself must stay outside both subtrees, or nothing could
    // close it.
    expect(insideInert(dialog()!)).toBe(false);
  });
});

describe("the Tab trap", () => {
  it("wraps forward from the last link to the first", async () => {
    await openMenu();
    const links = panelLinks();
    links[links.length - 1].focus();

    const event = press("Tab");

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links[0]);
  });

  it("wraps backward from the first link to the last", async () => {
    await openMenu();
    const links = panelLinks();

    const event = press("Tab", { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links[links.length - 1]);
  });

  it("pulls focus back into the menu when it has escaped behind the scrim", async () => {
    await openMenu();
    // jsdom ignores `inert`, so this reproduces the pre-fix state: focus
    // sitting on page content behind an open aria-modal menu.
    target.querySelector<HTMLAnchorElement>('[data-id="page-link"]')!.focus();

    press("Tab");

    expect(document.activeElement).toBe(panelLinks()[0]);
  });

  it("leaves Tab alone while the menu is closed", () => {
    const pageLink = target.querySelector<HTMLAnchorElement>('[data-id="page-link"]')!;
    pageLink.focus();

    const event = press("Tab");

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(pageLink);
  });
});

describe("closing the mobile nav", () => {
  it("closes on Escape pressed anywhere and returns focus to the toggle", async () => {
    await openMenu();
    // Focus deliberately NOT inside the overlay: the old handler sat on the
    // overlay div, so Escape only worked once focus was already in it.
    (document.activeElement as HTMLElement).blur();

    press("Escape");
    await settle();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("clears inert before focus returns, so the browser can honour it", async () => {
    await openMenu();
    let inertWhenFocused: boolean | null = null;
    toggle().addEventListener("focus", () => {
      inertWhenFocused = insideInert(toggle());
    });

    press("Escape");
    await settle();

    expect(inertWhenFocused).toBe(false);
  });

  it("closes from the scrim and returns focus to the toggle", async () => {
    await openMenu();
    // Most engines focus a button on press, and closing unmounts this one, so
    // that focus is what used to fall through to <body>.
    const scrim = target.querySelector<HTMLButtonElement>('button[aria-label="Close navigation"]')!;
    scrim.focus();

    scrim.click();
    await settle();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(toggle());
    expect(isInert(header())).toBe(false);
    expect(isInert(main())).toBe(false);
  });

  it("does not pull focus to the toggle when a nav link is followed", async () => {
    await openMenu();
    const link = panelLinks().find((a) => a.getAttribute("href") === "/medications")!;
    link.focus();
    // jsdom cannot navigate; stop it trying. Svelte's delegated onclick,
    // which is what closes the menu, still runs.
    link.addEventListener("click", (e) => e.preventDefault());

    link.click();
    await settle();

    expect(dialog()).toBeNull();
    // SvelteKit resets focus once the new page renders; the menu must not
    // have claimed it first.
    expect(document.activeElement).not.toBe(toggle());
  });

  it("closes after a navigation the Sidebar's own handlers miss, without taking focus", async () => {
    await openMenu();
    // The brand link carries no onclick, so following it used to leave the
    // menu open over the next page. The router's afterNavigate is the backstop.
    expect(dialog()).not.toBeNull();
    // Where SvelteKit's own focus reset has left things by the time its
    // afterNavigate callbacks run.
    document.body.focus();

    for (const fn of nav.afterNavigate) fn();
    await settle();

    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(toggle());
  });

  it("closes when the viewport reaches the desktop breakpoint, lifting inert", async () => {
    await openMenu();
    const desktop = media.find((m) => m.query === "(min-width: 48rem)");
    expect(desktop, "no listener on Tailwind's md breakpoint").toBeDefined();

    for (const fn of desktop!.listeners) fn({ matches: true });
    await settle();

    expect(dialog()).toBeNull();
    // The desktop layout sits inside the same subtree; left inert it would
    // be unreachable by mouse and keyboard alike.
    expect(isInert(main())).toBe(false);
    expect(document.activeElement).not.toBe(toggle());
  });

  it("ignores Escape while the menu is closed", async () => {
    const pageLink = target.querySelector<HTMLAnchorElement>('[data-id="page-link"]')!;
    pageLink.focus();

    const event = press("Escape");
    await settle();

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(pageLink);
  });
});
