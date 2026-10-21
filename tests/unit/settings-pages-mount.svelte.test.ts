// The `.svelte.test.ts` name is load-bearing: vite-plugin-svelte compiles any
// module with a `.svelte.` infix, which is what lets this file use `$state`
// for the props the router replaces after every action. The SSR suite beside
// it (tests/unit/settings-pages-ssr.test.ts) sees only the first render; what
// happens after a submit settles (a failed sign-out, a push test waiting on
// its device) needs the client build of Svelte and a clock.
import { describe, it, expect, vi, afterEach } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import { alertTitled } from "./helpers/alert-dom";
import { buttonNamed } from "./helpers/dom-names";

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
  if (app) unmount(app);
  app = undefined;
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
