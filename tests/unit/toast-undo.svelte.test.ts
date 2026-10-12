// Toast, mounted for real (jsdom, client svelte). It is mounted once, in the
// (app) layout, and renders the ONE Undo offer the undo registry holds above
// its plain toasts. The registry's own rules (deadlines, replacing,
// withdrawing, what runUndo posts) are in undo-registry.test.ts; this file
// is about what a person sees and presses, and where their focus goes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { readable } from "svelte/store";

const h = vi.hoisted(() => ({
  reloadAfterWrite: vi.fn(async (_opts?: { waitForServer?: boolean }) => {}),
}));

// `showToast` and every registry mutator are no-ops unless `browser`.
vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  deserialize: (text: string) => JSON.parse(text),
  enhance: () => ({ destroy() {} }),
}));
// For the layout: it registers an afterNavigate callback, and Sidebar reads
// $page. SvelteKit's client runtime is not running here.
vi.mock("$app/navigation", () => ({ afterNavigate: () => {}, invalidateAll: async () => {} }));
vi.mock("$app/stores", () => ({
  page: readable({ url: new URL("http://localhost/dashboard") }),
}));
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { data: {} },
}));
// The reload is a seam here: a test makes it render what the server would.
vi.mock("$lib/components/dose-writes/reload-after-write", () => ({
  HEALTH_PROBE_BACKOFF_MS: [2_000, 4_000, 8_000, 16_000, 30_000],
  waitForServer: async () => {},
  reloadAfterWrite: (opts?: { waitForServer?: boolean }) => h.reloadAfterWrite(opts),
  reloadDocumentIfUpdated: () => false,
}));

import Toast, { clearToasts, showToast } from "$lib/components/ui/Toast.svelte";
import {
  RESTORED_TOAST,
  STILL_SAVING_TOAST,
  UNDO_OFFLINE_MESSAGE,
} from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
  type UndoOfferInput,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { doseWriteContext } from "./helpers/dashboard-context";

const { default: Layout } = await import("../../src/routes/(app)/+layout.svelte");

const REMOVAL: UndoOfferInput = {
  message: "Dose removed: Paracetamol 500mg at 8:00",
  doseId: "d1",
  kind: "restore",
  deletedAt: "2026-05-01T12:59:30.000Z",
  expiresInMs: 600_000,
  focusTarget: () => document.querySelector<HTMLElement>('[data-dose-id="d1"] [data-edit]'),
};

const RESTORED = { type: "success", status: 200, data: { success: true, doseId: "d1" } };

const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  h.reloadAfterWrite.mockReset();
  h.reloadAfterWrite.mockResolvedValue(undefined);
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  resetUndoRegistry();
  clearToasts();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function mountToast(lock: DoseWriteLock = createDoseWriteLock()) {
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(Toast, { target, context: doseWriteContext(lock) });
  flushSync();
  cleanups.push(() => {
    unmount(component);
    target.remove();
  });
  const stack = target.querySelector<HTMLElement>("[data-toast-stack]");
  if (!stack) throw new Error("Toast rendered no [data-toast-stack]");
  return { lock, stack };
}

function show(input: UndoOfferInput = REMOVAL) {
  offerUndo(input);
  flushSync();
}

function undoButton(stack: HTMLElement): HTMLButtonElement {
  const button = stack.querySelector<HTMLButtonElement>(
    "[data-undo-offer] button[aria-labelledby]",
  );
  if (!button) throw new Error("no Undo button in the toast stack");
  return button;
}

function dismissButton(stack: HTMLElement): HTMLButtonElement {
  const button = stack.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
  if (!button) throw new Error("no Dismiss button in the toast stack");
  return button;
}

/** The accessible name aria-labelledby gives: each referenced element's text, space-joined. */
function nameFromLabelledBy(el: Element): string {
  return (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .join(" ");
}

function stubFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function respondWith(result: unknown, status = 200): Response {
  return { status, text: async () => JSON.stringify(result) } as unknown as Response;
}

describe("Toast's Undo offer", () => {
  it("names Undo by its word and the message through aria-labelledby, adding nothing else to the live region", () => {
    const { stack } = mountToast();
    show();
    const undo = undoButton(stack);

    expect(stack.getAttribute("role")).toBe("status");
    expect(undo.textContent?.trim()).toBe("Undo");
    expect(undo.hasAttribute("aria-label")).toBe(false);
    expect(nameFromLabelledBy(undo)).toBe("Undo Dose removed: Paracetamol 500mg at 8:00");
    // Nothing is announced twice.
    expect(stack.querySelectorAll(".sr-only")).toHaveLength(0);
    expect(stack.textContent?.match(/Dose removed/g)).toHaveLength(1);
  });

  it("gives Undo and Dismiss 44px targets, like every other dose control", () => {
    const { stack } = mountToast();
    show();
    expect([...undoButton(stack).classList]).toEqual(expect.arrayContaining(["min-h-11", "px-3"]));
    expect([...dismissButton(stack).classList]).toEqual(expect.arrayContaining(["size-11"]));
  });

  it("shows one offer: a second replaces the first", () => {
    const { stack } = mountToast();
    show();
    show({ ...REMOVAL, doseId: "d2", message: "Dose removed: Ibuprofen 200mg at 9:00" });

    expect(stack.querySelectorAll("[data-undo-offer]")).toHaveLength(1);
    expect(stack.textContent).toContain("Ibuprofen");
    expect(stack.textContent).not.toContain("Paracetamol");
  });

  it("restores on a press, then puts focus on the restored row's ✎ — never on <body> — and says 'Dose restored'", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    h.reloadAfterWrite.mockImplementation(async () => {
      // What the reload renders: the restored row, with its ✎.
      const row = document.body.appendChild(document.createElement("div"));
      row.dataset.doseId = "d1";
      row.innerHTML = '<button type="button" data-edit>✎</button>';
    });
    const { stack } = mountToast();
    show();
    const undo = undoButton(stack);
    undo.focus();

    undo.click();

    await vi.waitFor(() => expect(stack.textContent).toContain(RESTORED_TOAST));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stack.querySelector("[data-undo-offer]")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-dose-id="d1"] [data-edit]'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("a double press sends one request, and says nothing about 'still saving'", async () => {
    let respond!: (response: Response) => void;
    const fetchMock = stubFetch(new Promise<Response>((r) => (respond = r)));
    const { stack } = mountToast();
    show();
    const undo = undoButton(stack);

    undo.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(undo.textContent?.trim()).toBe("Undoing…");
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    undo.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stack.textContent).not.toContain(STILL_SAVING_TOAST);

    respond(respondWith(RESTORED));
    await vi.waitFor(() => expect(currentUndo()).toBeNull());
  });

  it("an Undo pressed while another dose write is in flight sends nothing, says it is still saving, and keeps the offer", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    const lock = createDoseWriteLock();
    const { stack } = mountToast(lock);
    show();
    lock.acquire();

    undoButton(stack).click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stack.textContent).toContain(STILL_SAVING_TOAST);
    expect(stack.querySelector("[data-undo-offer]")).not.toBeNull();
  });

  it("two Undo presses refused during one write show one 'Still saving…' toast", async () => {
    stubFetch(respondWith(RESTORED));
    const lock = createDoseWriteLock();
    const { stack } = mountToast(lock);
    show();
    lock.acquire();

    undoButton(stack).click();
    await vi.advanceTimersByTimeAsync(0);
    undoButton(stack).click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect((stack.textContent ?? "").split(STILL_SAVING_TOAST).length - 1).toBe(1);
  });

  it("an Undo pressed offline sends nothing, keeps the offer, and says Undo will still be here", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const { stack } = mountToast();
    show();

    undoButton(stack).click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stack.querySelector("[data-undo-offer]")?.textContent).toContain(UNDO_OFFLINE_MESSAGE);
  });

  it("Dismiss removes the offer and sends nothing", () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    const { stack } = mountToast();
    show();

    dismissButton(stack).click();
    flushSync();

    expect(stack.querySelector("[data-undo-offer]")).toBeNull();
    expect(currentUndo()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a keyboard Dismiss puts focus back where it was before the stack, never on <body>", () => {
    const { stack } = mountToast();
    const search = document.body.appendChild(document.createElement("input"));
    show();
    search.focus();
    // Tab into the stack: focusin from outside remembers where focus came from.
    dismissButton(stack).focus();

    dismissButton(stack).click();
    flushSync();

    expect(stack.querySelector("[data-undo-offer]")).toBeNull();
    expect(document.activeElement).toBe(search);
  });

  it("plain toasts start dismissing again once the offer focus was on has gone, even with nowhere to hand focus", () => {
    // No h1 and nothing focused before the stack: focus falls to <body> with
    // the removed button, and no focusout fires for that.
    const { stack } = mountToast();
    showToast("Metformin 500mg logged at 13:00", "success");
    show();
    flushSync();
    undoButton(stack).focus(); // holds every plain toast open
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(stack.textContent).toContain("logged at 13:00");

    dismissButton(stack).focus();
    dismissButton(stack).click();
    flushSync();
    expect(document.activeElement).toBe(document.body);

    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(stack.textContent).not.toContain("logged at 13:00");
  });

  it("plain toasts start dismissing again once the offer focus was on reaches its deadline", () => {
    const { stack } = mountToast();
    showToast("Metformin 500mg logged at 13:00", "success");
    show({ ...REMOVAL, expiresInMs: 60_000 }); // deadline 30s away
    flushSync();
    undoButton(stack).focus();

    vi.advanceTimersByTime(30_000);
    flushSync();
    expect(stack.querySelector("[data-undo-offer]")).toBeNull();
    expect(stack.textContent).toContain("logged at 13:00");

    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(stack.textContent).not.toContain("logged at 13:00");
  });

  it("outlives the five seconds a plain toast gets", () => {
    const { stack } = mountToast();
    showToast("Metformin 500mg logged at 13:00", "success");
    show();

    vi.advanceTimersByTime(5_000);
    flushSync();

    expect(stack.textContent).not.toContain("logged at 13:00");
    expect(stack.querySelector("[data-undo-offer]")).not.toBeNull();
  });

  it("Review Focus #3: an Undo pressed after the page that offered it has gone holds the layout's lock, the one every page reads", async () => {
    let respond!: (response: Response) => void;
    stubFetch(new Promise<Response>((r) => (respond = r)));
    const lock = createDoseWriteLock();
    const { stack } = mountToast(lock);
    // Made by a control on a page the user has since left: nothing but the
    // registry refers to the offer now, and it carries no lock of its own.
    show();

    undoButton(stack).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(lock.active).toBe(true);
    expect(lock.acquire()).toBe(false); // the page now on screen cannot write

    respond(respondWith(RESTORED));
    await vi.waitFor(() => expect(currentUndo()).toBeNull());
    expect(lock.active).toBe(false);
  });
});

describe("Toast's plain toasts", () => {
  const countOf = (stack: HTMLElement, text: string) =>
    (stack.textContent ?? "").split(text).length - 1;

  it("two refused taps during one write show one 'Still saving…' toast", () => {
    const { stack } = mountToast();
    const count = () => countOf(stack, STILL_SAVING_TOAST);

    // What createDoseWrite, or an Undo press, does for each tap refused while
    // another dose write is in flight.
    showToast(STILL_SAVING_TOAST, "error", { coalesce: true });
    flushSync();
    vi.advanceTimersByTime(4_000);
    showToast(STILL_SAVING_TOAST, "error", { coalesce: true });
    flushSync();

    expect(count()).toBe(1);
    // The second tap restarted its five seconds: still up 8s after the first.
    vi.advanceTimersByTime(4_000);
    flushSync();
    expect(count()).toBe(1);
    vi.advanceTimersByTime(1_000);
    flushSync();
    expect(count()).toBe(0);
  });

  it("stacks a genuine repeat: two identical toasts that did not ask to coalesce both show", () => {
    // A second "Undone", or a second "Dose not found", is news: a polite live
    // region announces a new node, never a timer restarted on an old one.
    const { stack } = mountToast();
    showToast("Dose not found", "error");
    flushSync();
    showToast("Dose not found", "error");
    flushSync();

    expect(countOf(stack, "Dose not found")).toBe(2);
  });

  it("with the pointer held over the stack, a coalesced repeat does not start a timer under it", () => {
    const { stack } = mountToast();
    showToast(STILL_SAVING_TOAST, "error", { coalesce: true });
    flushSync();
    stack.dispatchEvent(new MouseEvent("mouseenter"));

    showToast(STILL_SAVING_TOAST, "error", { coalesce: true });
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(countOf(stack, STILL_SAVING_TOAST)).toBe(1);

    stack.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(countOf(stack, STILL_SAVING_TOAST)).toBe(0);
  });

  it("a toast that arrives while focus holds the stack waits until it is released", () => {
    const { stack } = mountToast();
    show();
    undoButton(stack).focus();

    showToast("Ibuprofen 200mg logged at 9:00", "success");
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(stack.textContent).toContain("logged at 9:00");

    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(stack.textContent).not.toContain("logged at 9:00");
  });
});

describe("the (app) layout", () => {
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

  function mountLayout() {
    const target = document.body.appendChild(document.createElement("div"));
    const children = createRawSnippet(() => ({ render: () => `<p>The page</p>` }));
    const app = mount(Layout, { target, props: { data: { user, preferences }, children } });
    flushSync();
    return {
      target,
      destroy() {
        unmount(app);
        target.remove();
      },
    };
  }

  it("Review Focus #3: clears the Undo offer and every plain toast when it unmounts, so the next sign-in on this device sees neither", () => {
    const first = mountLayout();
    offerUndo({ ...REMOVAL, message: "Dose removed: Sertraline 50mg at 8:00" });
    showToast("Sertraline 50mg logged at 8:00", "success");
    flushSync();
    expect(first.target.querySelector("[data-undo-offer]")?.textContent).toContain("Sertraline");
    expect(first.target.textContent).toContain("Sertraline 50mg logged at 8:00");

    // Signing out leaves (app); signing in again mounts a new layout.
    first.destroy();
    const second = mountLayout();
    cleanups.push(() => second.destroy());

    expect(currentUndo()).toBeNull();
    expect(second.target.querySelector("[data-undo-offer]")).toBeNull();
    expect(second.target.querySelector("[data-toast-stack]")?.textContent?.trim()).toBe("");
  });

  it("an Undo still in flight at sign-out shows nothing in the next session when it lands", async () => {
    let respond!: (response: Response) => void;
    stubFetch(new Promise<Response>((r) => (respond = r)));
    const first = mountLayout();
    offerUndo({ ...REMOVAL, message: "Dose removed: Sertraline 50mg at 8:00" });
    flushSync();
    const undo = first.target.querySelector<HTMLButtonElement>(
      "[data-undo-offer] button[aria-labelledby]",
    )!;
    undo.click();
    await vi.advanceTimersByTimeAsync(0);

    first.destroy();
    const second = mountLayout();
    cleanups.push(() => second.destroy());
    respond(respondWith(RESTORED));
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(h.reloadAfterWrite).not.toHaveBeenCalled();
    expect(currentUndo()).toBeNull();
    expect(second.target.querySelector("[data-toast-stack]")?.textContent?.trim()).toBe("");
  });
});
