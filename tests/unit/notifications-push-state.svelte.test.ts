// Settings → Notifications' push card, after the page has hydrated.
//
// N25: "active on this device" used to be judged from the browser's
// getSubscription() alone. A subscription the server no longer held (a
// rotated endpoint whose re-registration the service worker swallowed, then
// pruned on a 410) still read as active, with only Disable on offer, and the
// service worker's comment promised a re-registration nothing performed.
//
// N26: Enable and Disable left the server-derived delivery card stale (0
// devices and a disabled test button beside "active on this device"), and a
// rejected subscribe or fetch escaped the click handler with nothing shown.
//
// The `.svelte.test.ts` name lets this file use `$state` for the props the
// router replaces after a reload.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";
import { toneClass } from "../../src/lib/utils/status-tone";
import { alertTitled, expectClasses } from "./helpers/alert-dom";
import { buttonNamed, textOf } from "./helpers/dom-names";
import { preferencesFixture } from "./helpers/preferences-fixture";

const invalidateAll = vi.hoisted(() => vi.fn(async () => {}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock("$app/navigation", () => ({
  invalidateAll,
  goto: async () => {},
  beforeNavigate: () => {},
}));
vi.mock("$lib/components/ui/Toast.svelte", () => ({ showToast }));
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy: () => {} }) }));

import Notifications from "../../src/routes/(app)/settings/notifications/+page.svelte";

const ACTIVE = "Push notifications are active on this device.";
const UNCONFIRMED =
  "Couldn't confirm that this device is registered for push, so reminders may not arrive here.";
const OTHER_ACCOUNT =
  "This browser's push subscription belongs to another account, so your reminders won't arrive here.";
const FAILED = "Couldn't update push notifications on this device";

const notif = (deviceCount: number) => ({
  user: {
    id: "u1",
    email: "person@example.com",
    name: "Test Person",
    avatarUrl: null,
    timezone: "UTC",
    twoFactorEnabled: false,
    emailVerified: true,
  },
  preferences: { ...preferencesFixture, lowInventoryPushAlerts: true },
  vapidPublicKey: "BAAA",
  emailVerified: true,
  emailConfigured: true,
  pushHealth: {
    deviceCount,
    lastReminderAt: null,
    oldestRegisteredAt: null,
    vapidConfigured: true,
  },
  mutedMedications: [],
});

type FakeSub = {
  endpoint: string;
  toJSON: () => unknown;
  unsubscribe: () => Promise<boolean>;
};

// The browser's one subscription, or null; pushManager reads and writes it.
let current: FakeSub | null;
let subscribe: () => Promise<FakeSub>;
// What the server answers /api/push/subscribe and /api/push/unsubscribe with.
let status: number | "network";
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  if (status === "network") throw new TypeError("Failed to fetch");
  return { ok: status >= 200 && status < 300, status };
});

const makeSub = (endpoint = "https://push.test/rotated"): FakeSub => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: "test-p256dh", auth: "test-auth" } }),
  unsubscribe: vi.fn(async () => {
    current = null;
    return true;
  }),
});

let app: ReturnType<typeof mount> | undefined;
let props: { data: unknown; form: unknown };

function mountPage(data: unknown): HTMLElement {
  const target = document.body.appendChild(document.createElement("div"));
  const state = $state({ data, form: null as unknown });
  props = state;
  app = mount(Notifications as Component<{ data: unknown; form: unknown }>, { target, props });
  flushSync();
  return target;
}

const paragraph = (target: HTMLElement, text: string) =>
  [...target.querySelectorAll("p")].find((p) => textOf(p) === text);
const subscribeCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/push/subscribe");

beforeEach(() => {
  current = null;
  status = 200;
  subscribe = async () => (current = makeSub("https://push.test/new"));
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Notification", { requestPermission: async () => "granted" });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: { getSubscription: async () => current, subscribe: () => subscribe() },
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).PushManager;
  invalidateAll.mockClear();
  showToast.mockClear();
  document.body.innerHTML = "";
});

describe("this device's registration is the server's answer (N25)", () => {
  it("re-posts the browser's existing subscription on load, and only a 2xx makes it active", async () => {
    current = makeSub();
    const target = mountPage(notif(0));
    await vi.waitFor(() => expect(paragraph(target, ACTIVE)).toBeDefined());
    expect(subscribeCalls()).toHaveLength(1);
    const [, init] = subscribeCalls()[0];
    expect(init?.method).toBe("POST");
    // The frozen wire shape: exactly what the browser's subscription serialises to.
    expect(JSON.parse(String(init?.body))).toEqual(current!.toJSON());
    // A re-registration changes server data, so the delivery card reloads.
    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalledTimes(1));
  });

  it.each([401, 429, 500, "network"] as const)(
    "does not claim the device is active when the server answers %s",
    async (answer) => {
      status = answer;
      current = makeSub();
      const target = mountPage(notif(0));
      await vi.waitFor(() => expect(alertTitled(target, UNCONFIRMED)).not.toBeNull());
      expect(paragraph(target, ACTIVE)).toBeUndefined();
      expectClasses(alertTitled(target, UNCONFIRMED)!, toneClass("needs-you", "alert"));
      // Disable still removes the browser's subscription, so it stays on offer.
      buttonNamed(target, "Disable");
      expect(invalidateAll).not.toHaveBeenCalled();
    },
  );

  it("says the subscription belongs to another account on a 409", async () => {
    status = 409;
    current = makeSub();
    const target = mountPage(notif(1));
    await vi.waitFor(() => expect(alertTitled(target, OTHER_ACCOUNT)).not.toBeNull());
    expect(paragraph(target, ACTIVE)).toBeUndefined();
  });

  it("posts nothing when the browser holds no subscription", async () => {
    const target = mountPage(notif(0));
    await vi.waitFor(() => buttonNamed(target, "Enable"));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(paragraph(target, ACTIVE)).toBeUndefined();
  });

  it("checks once per visit: the reload it triggers does not start another check", async () => {
    current = makeSub();
    const target = mountPage(notif(0));
    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalledTimes(1));
    // What invalidateAll delivers: a fresh payload with the same VAPID key.
    props.data = notif(1);
    flushSync();
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeCalls()).toHaveLength(1);
    expect(paragraph(target, ACTIVE)).toBeDefined();
  });
});

describe("the toggle refreshes the delivery card and never fails silently (N26)", () => {
  it("reloads the page data after Enable", async () => {
    const target = mountPage(notif(0));
    const enable = await vi.waitFor(() => buttonNamed(target, "Enable"));
    enable.click();
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Push notifications enabled", "success"),
    );
    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalledTimes(1));
    expect(paragraph(target, ACTIVE)).toBeDefined();
  });

  it("reloads the page data after Disable", async () => {
    current = makeSub();
    const target = mountPage(notif(1));
    // The load-time check re-registers and reloads once; Disable reloads again.
    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalledTimes(1));
    buttonNamed(target, "Disable").click();
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Push notifications disabled", "success"),
    );
    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalledTimes(2));
    expect(paragraph(target, ACTIVE)).toBeUndefined();
  });

  it.each([
    [
      "the push service rejects the subscription",
      () => {
        subscribe = async () => {
          throw new DOMException("Registration failed - push service error", "AbortError");
        };
      },
    ],
    [
      "the permission prompt itself throws",
      () => {
        vi.stubGlobal("Notification", {
          requestPermission: async () => {
            throw new Error("blocked");
          },
        });
      },
    ],
  ])("toasts when %s, and the click handler does not reject", async (_name, arrange) => {
    arrange();
    const target = mountPage(notif(0));
    const enable = await vi.waitFor(() => buttonNamed(target, "Enable"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      enable.click();
      await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(FAILED, "error"));
      await vi.waitFor(() =>
        expect(buttonNamed(target, "Enable").getAttribute("aria-busy")).not.toBe("true"),
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(invalidateAll).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("toasts when the browser's own unsubscribe fails, and still reloads the server-side change", async () => {
    current = makeSub();
    current.unsubscribe = vi.fn(async () => {
      throw new DOMException("unsubscribe failed", "InvalidStateError");
    });
    const target = mountPage(notif(1));
    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalledTimes(1));
    buttonNamed(target, "Disable").click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(FAILED, "error"));
    // The server row was deleted before the browser step failed, so the card
    // reloads; the subscription the user turned off is not re-posted.
    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalledTimes(2));
    expect(subscribeCalls()).toHaveLength(1);
    expect(paragraph(target, ACTIVE)).toBeUndefined();
  });

  it("keeps unsaved checkbox edits when the page data reloads with the same stored values", () => {
    const target = mountPage(notif(0));
    const box = target.querySelector<HTMLInputElement>('input[name="overdueEmailReminders"]')!;
    const before = box.checked;
    box.click();
    flushSync();
    expect(box.checked).toBe(!before);
    // What invalidateAll delivers: a fresh payload, same stored preferences.
    props.data = notif(1);
    flushSync();
    expect(box.checked).toBe(!before);
  });
});
