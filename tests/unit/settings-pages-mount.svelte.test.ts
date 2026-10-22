// The `.svelte.test.ts` name is load-bearing: vite-plugin-svelte compiles any
// module with a `.svelte.` infix, which is what lets this file use `$state`
// for the props the router replaces after every action. The SSR suite beside
// it (tests/unit/settings-pages-ssr.test.ts) sees only the first render; what
// happens after a submit settles (a failed sign-out, a push test waiting on
// its device) needs the client build of Svelte and a clock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import { toneClass } from "../../src/lib/utils/status-tone";
import { TEST_PUSH_SHOWN_MESSAGE } from "../../src/lib/utils/push";
import { alertTitled, expectClasses } from "./helpers/alert-dom";
import { buttonNamed, textOf } from "./helpers/dom-names";

type Sent = { action: string; finish: (result: ActionResult) => Promise<void> };
const sent = vi.hoisted(() => [] as Sent[]);
const goto = vi.hoisted(() => vi.fn(async (_url: string) => {}));
vi.mock("$app/navigation", () => ({ goto }));
vi.mock("$lib/components/ui/Toast.svelte", () => ({ showToast: vi.fn() }));
// SvelteKit's enhance reduced to its two-phase contract
// (log-page-mount.svelte.test.ts): the SubmitFunction runs on submit (it is
// undefined for a bare use:enhance), and the callback it returns runs when
// the test calls finish(result). The submit function runs synchronously with
// the click, as it does for these pages' sync SubmitFunctions in a browser.
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit?: SubmitFunction) => {
    const onSubmit = (e: SubmitEvent) => {
      e.preventDefault();
      const formData = new FormData(form);
      const action = new URL(form.getAttribute("action") ?? "", "https://medtracker.test/settings");
      const callback = submit?.({
        action,
        formData,
        formElement: form,
        controller: new AbortController(),
        submitter: e.submitter,
        cancel: () => {},
      });
      sent.push({
        action: form.getAttribute("action") ?? "",
        finish: async (result) => {
          const run = await callback;
          if (typeof run === "function") {
            await run({ action, formData, formElement: form, result, update: async () => {} });
          }
        },
      });
    };
    form.addEventListener("submit", onSubmit);
    return { destroy: () => form.removeEventListener("submit", onSubmit) };
  },
}));

import Security from "../../src/routes/(app)/settings/security/+page.svelte";
import Notifications from "../../src/routes/(app)/settings/notifications/+page.svelte";

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
  exportFormat: "pdf",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

let app: ReturnType<typeof mount> | undefined;
let props: { data: unknown; form: unknown };

function mountPage(Page: unknown, data: unknown): HTMLElement {
  const target = document.body.appendChild(document.createElement("div"));
  const state = $state({ data, form: null as unknown });
  props = state;
  app = mount(Page as Component<{ data: unknown; form: unknown }>, { target, props });
  flushSync();
  return target;
}

afterEach(() => {
  vi.useRealTimers();
  // Unmount first: the notifications page's effect cleanup reads
  // navigator.serviceWorker, which the push describe defines.
  if (app) unmount(app);
  app = undefined;
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).PushManager;
  sent.length = 0;
  goto.mockClear();
  document.body.innerHTML = "";
});

describe("Sign Out", () => {
  const mountSecurity = () =>
    mountPage(Security, {
      user,
      preferences,
      sessions: [],
      currentSessionId: "s1",
      twoFactorEnabled: false,
    });

  it("shows a failed sign-out as an assertive Alert and stays on the page", async () => {
    const target = mountSecurity();
    buttonNamed(target, "Sign Out").click();
    await sent.at(-1)!.finish({
      type: "error",
      status: 500,
      error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
    });
    flushSync();
    const alert = alertTitled(target, "Something went wrong on our end. (reference a3f10c9e)");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(goto).not.toHaveBeenCalled();
  });

  it("says it could not sign out when the request never completed", async () => {
    const target = mountSecurity();
    buttonNamed(target, "Sign Out").click();
    await sent.at(-1)!.finish({ type: "error", error: new TypeError("Failed to fetch") });
    flushSync();
    expect(alertTitled(target, "Couldn't sign out — please try again.")).not.toBeNull();
  });

  it("clears an earlier failure on the next try and goes to /auth/login on success", async () => {
    const target = mountSecurity();
    buttonNamed(target, "Sign Out").click();
    await sent.at(-1)!.finish({ type: "error", error: new TypeError("Failed to fetch") });
    flushSync();
    buttonNamed(target, "Sign Out").click();
    flushSync();
    expect(alertTitled(target, "Couldn't sign out")).toBeNull();
    await sent.at(-1)!.finish({ type: "success", status: 200, data: { loggedOut: true } });
    expect(goto).toHaveBeenCalledWith("/auth/login");
  });
});

describe("push card and test confirmation", () => {
  let subscription: { endpoint: string } | null = null;
  const notif = () => ({
    user,
    preferences,
    vapidPublicKey: "BAAA",
    emailVerified: true,
    emailConfigured: true,
    pushHealth: {
      deviceCount: 1,
      lastReminderAt: null,
      oldestRegisteredAt: null,
      vapidConfigured: true,
    },
    mutedMedications: [],
  });
  const mountNotifications = () => mountPage(Notifications, notif());

  beforeEach(() => {
    subscription = null;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
  });

  it("draws Disable as a secondary Button and the active state in neutral words", async () => {
    subscription = { endpoint: "https://push.test/1" };
    const target = mountNotifications();
    const disable = await vi.waitFor(() => buttonNamed(target, "Disable"));
    expectClasses(disable, "h-9 border-border-strong text-text-primary");
    const active = [...target.querySelectorAll("p")].find(
      (p) => textOf(p) === "Push notifications are active on this device.",
    )!;
    expectClasses(active, toneClass("neutral", "text"));
  });

  it("draws Enable as the primary Button", async () => {
    subscription = null;
    expectClasses(
      await vi.waitFor(() => buttonNamed(mountNotifications(), "Enable")),
      "h-9 bg-accent text-accent-fg",
    );
  });

  it("shows Sending… while a test is in flight, then asks for action when the device never confirms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    subscription = { endpoint: "https://push.test/1" };
    const target = mountNotifications();
    await vi.waitFor(() => buttonNamed(target, "Disable"));
    const send = buttonNamed(target, "Send test notification");
    send.click();
    flushSync();
    expect(send.getAttribute("aria-busy")).toBe("true");
    expect(send.disabled).toBe(true);
    props.form = { testOk: true, testMessage: "Sent to 1 device." };
    await sent.at(-1)!.finish({ type: "success", status: 200, data: props.form as never });
    flushSync();
    const ok = alertTitled(target, "Sent to 1 device.")!;
    expect(textOf(ok)).toContain("Waiting for this device to confirm it displayed…");
    vi.advanceTimersByTime(10_000);
    flushSync();
    const late = alertTitled(target, "This device didn't confirm it displayed the notification.")!;
    expect(late.getAttribute("role")).toBeNull();
    expectClasses(late, toneClass("needs-you", "alert"));
    expect(late.closest('[role="status"]'), "announced politely by the test region").not.toBeNull();
  });

  it("says the device confirmed it once the service worker reports the test displayed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    subscription = { endpoint: "https://push.test/1" };
    const target = mountNotifications();
    await vi.waitFor(() => buttonNamed(target, "Disable"));
    buttonNamed(target, "Send test notification").click();
    flushSync();
    props.form = { testOk: true, testMessage: "Sent to 1 device." };
    await sent.at(-1)!.finish({ type: "success", status: 200, data: props.form as never });
    flushSync();
    // The page's listener, as the service worker would reach it.
    const listen = vi.mocked(navigator.serviceWorker.addEventListener);
    const onMessage = listen.mock.calls.find(([type]) => type === "message")![1] as EventListener;
    onMessage(new MessageEvent("message", { data: { type: TEST_PUSH_SHOWN_MESSAGE } }));
    flushSync();
    const ok = alertTitled(target, "Sent to 1 device.")!;
    expect(textOf(ok)).toContain("Confirmed displayed on this device.");
    expect(textOf(ok)).not.toContain("Waiting for this device");
    expectClasses(ok, toneClass("happened", "alert"));
    // The confirmation cancels the timeout, so the needs-you Alert never comes.
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(
      alertTitled(target, "This device didn't confirm it displayed the notification."),
    ).toBeNull();
  });
});
