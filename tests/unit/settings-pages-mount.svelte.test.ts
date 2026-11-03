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

type Sent = { action: string; formData: FormData; finish: (result: ActionResult) => Promise<void> };
const sent = vi.hoisted(() => [] as Sent[]);
const goto = vi.hoisted(() => vi.fn(async (_url: string) => {}));
const invalidateAll = vi.hoisted(() => vi.fn(async () => {}));
const showToast = vi.hoisted(() => vi.fn());
const cancelled = vi.hoisted(() => ({ count: 0 }));
vi.mock("$app/navigation", () => ({ goto, invalidateAll, beforeNavigate: () => {} }));
vi.mock("$lib/components/ui/Toast.svelte", () => ({ showToast }));
// SvelteKit's enhance reduced to its two-phase contract
// (log-page-mount.svelte.test.ts): the SubmitFunction runs on submit (it is
// undefined for a bare use:enhance), and the callback it returns runs when
// the test calls finish(result). The submit function runs synchronously with
// the click, as it does for these pages' sync SubmitFunctions in a browser.
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit?: SubmitFunction) => {
    const onSubmit = (e: SubmitEvent) => {
      e.preventDefault();
      // The submitter's name/value ride along, as in kit's own enhance.
      const formData = new FormData(form, e.submitter);
      const action = new URL(form.getAttribute("action") ?? "", "https://medtracker.test/settings");
      let wasCancelled = false;
      const callback = submit?.({
        action,
        formData,
        formElement: form,
        controller: new AbortController(),
        submitter: e.submitter,
        cancel: () => {
          wasCancelled = true;
          cancelled.count++;
        },
      });
      // A cancelled submit sends nothing, so it is not "sent".
      if (wasCancelled) return;
      sent.push({
        action: form.getAttribute("action") ?? "",
        formData,
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
import Appearance from "../../src/routes/(app)/settings/appearance/+page.svelte";
import Notifications from "../../src/routes/(app)/settings/notifications/+page.svelte";
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

const preferences = {
  ...preferencesFixture,
  accentColor: "#6366f1",
  theme: "system",
  timeFormat: "24h",
  lowInventoryPushAlerts: true,
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
  invalidateAll.mockClear();
  showToast.mockClear();
  cancelled.count = 0;
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

describe("Appearance: show days instead of hours after", () => {
  const mountAppearance = () => mountPage(Appearance, { user, preferences });
  const preset = (target: HTMLElement, label: string) => buttonNamed(target, label);
  const timeSinceSends = () => sent.filter((s) => s.action === "?/timeSinceDaysFromHours");

  it("a press posts one request carrying the preset's hours", () => {
    const target = mountAppearance();
    preset(target, "3 days").click();
    expect(timeSinceSends()).toHaveLength(1);
    expect(timeSinceSends()[0].formData.get("timeSinceDaysFromHours")).toBe("72");
  });

  it("reloads on success and is usable again", async () => {
    const target = mountAppearance();
    preset(target, "3 days").click();
    await timeSinceSends()[0].finish({
      type: "success",
      status: 200,
      data: { success: true, key: "timeSinceDaysFromHours" },
    });
    flushSync();
    expect(invalidateAll).toHaveBeenCalledTimes(1);
    expect(preset(target, "1 week").getAttribute("aria-disabled")).toBeNull();
    preset(target, "1 week").click();
    expect(timeSinceSends()).toHaveLength(2);
  });

  it("announces the save in the page's one polite status region", async () => {
    const target = mountAppearance();
    const region = target.querySelector('p[role="status"].sr-only')!;
    expect(region.textContent).toBe("");
    preset(target, "3 days").click();
    await timeSinceSends()[0].finish({
      type: "success",
      status: 200,
      data: { success: true, key: "timeSinceDaysFromHours" },
    });
    flushSync();
    expect(target.querySelectorAll('p[role="status"].sr-only')).toHaveLength(1);
    expect(region.textContent?.replace("\u200b", "")).toBe(
      "Show days instead of hours after saved.",
    );
  });

  it("is inert while a save is in flight: aria-disabled, and a second press is cancelled", () => {
    const target = mountAppearance();
    preset(target, "3 days").click();
    flushSync();
    for (const label of ["1 day", "2 days (default)", "3 days", "1 week"]) {
      const b = preset(target, label);
      expect(b.getAttribute("aria-disabled"), label).toBe("true");
      expect(b.disabled, label).toBe(false);
    }
    preset(target, "1 week").click();
    expect(timeSinceSends()).toHaveLength(1);
    expect(cancelled.count).toBe(1);
  });

  it("toasts the 429's own sentence and does not reload", async () => {
    const target = mountAppearance();
    preset(target, "3 days").click();
    await timeSinceSends()[0].finish({
      type: "failure",
      status: 429,
      data: {
        key: "timeSinceDaysFromHours",
        saveError: "Too many changes. Try again in 30 seconds.",
        retryAfterMs: 30_000,
      },
    });
    flushSync();
    expect(showToast).toHaveBeenCalledWith("Too many changes. Try again in 30 seconds.", "error");
    expect(invalidateAll).not.toHaveBeenCalled();
    expect(preset(target, "1 week").getAttribute("aria-disabled")).toBeNull();
  });

  it("toasts a validation failure and leaves the pressed option as confirmed", async () => {
    const target = mountAppearance();
    preset(target, "3 days").click();
    await timeSinceSends()[0].finish({
      type: "failure",
      status: 400,
      data: { key: "timeSinceDaysFromHours", errors: { timeSinceDaysFromHours: ["Too long."] } },
    });
    flushSync();
    expect(showToast).toHaveBeenCalledWith("Too long.", "error");
    expect(preset(target, "2 days (default)").getAttribute("aria-pressed")).toBe("true");
    expect(preset(target, "3 days").getAttribute("aria-pressed")).toBe("false");
  });

  it("toasts a crash with its reference", async () => {
    const target = mountAppearance();
    preset(target, "3 days").click();
    await timeSinceSends()[0].finish({
      type: "error",
      status: 500,
      error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
    });
    flushSync();
    expect(showToast).toHaveBeenCalledWith(
      "Something went wrong on our end. (reference a3f10c9e)",
      "error",
    );
  });
});
