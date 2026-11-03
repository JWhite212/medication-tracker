// /settings/dashboard after a press: one request in flight at a time, focus
// handed to the moved section's button once the reload lands, and a failure
// told through actionErrorMessage with the page left as the server last
// confirmed it. The SSR half (what each control posts) is in
// settings-dashboard-ssr.test.ts.
//
// The `.svelte.test.ts` name is load-bearing: it lets this file use `$state`
// for the props the router replaces after `invalidateAll()`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import { actionErrorMessage } from "../../src/lib/utils/form-errors";
import type { DashboardSectionId } from "../../src/lib/dashboard/layout";
import type { UserPreferences } from "../../src/lib/types";
import { preferencesFixture } from "./helpers/preferences-fixture";

type Pending = { formData: FormData; finish: (result: ActionResult) => Promise<void> };

const h = vi.hoisted(() => ({
  pending: [] as Pending[],
  fetch: vi.fn(),
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

// SvelteKit's enhance reduced to its contract: the SubmitFunction runs on
// submit with a working cancel(); only an uncancelled submit sends (here, a
// call to the stubbed fetch), and the callback it returned runs when the test
// calls finish(result). FormData includes the submitter, as kit's does.
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    const onSubmit = async (e: SubmitEvent) => {
      e.preventDefault();
      const formData = new FormData(form, e.submitter);
      const action = new URL(
        form.getAttribute("action") ?? "",
        "https://medtracker.test/settings/dashboard",
      );
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
      h.fetch(action.href, { method: "POST", body: formData });
      h.pending.push({
        formData,
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
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$app/state", () => ({
  page: { url: new URL("https://medtracker.test/settings/dashboard") },
}));
vi.mock("$lib/components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import Page from "../../src/routes/(app)/settings/dashboard/+page.svelte";

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const dataWith = (
  order: DashboardSectionId[] | null,
  overrides: Partial<UserPreferences> = {},
) => ({
  user,
  preferences: {
    ...preferencesFixture,
    dashboardSectionOrder: order,
    ...overrides,
  } as UserPreferences,
  variant: "scheduled" as const,
});

let app: ReturnType<typeof mount> | undefined;
let props: { data: ReturnType<typeof dataWith>; form: unknown };

function mountPage(order: DashboardSectionId[] | null = null): HTMLElement {
  const target = document.body.appendChild(document.createElement("div"));
  const state = $state({ data: dataWith(order), form: null as unknown });
  props = state;
  app = mount(Page as unknown as Component<typeof props>, { target, props });
  flushSync();
  return target;
}

/** The server confirms whatever order was posted, as the real reload would show it. */
function reloadTo(order: DashboardSectionId[]) {
  h.invalidateAll.mockImplementationOnce(async () => {
    props.data = dataWith(order);
    flushSync();
  });
}

const sectionOrder = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLLIElement>("li[data-section]")].map((li) => li.dataset.section);

const status = (root: HTMLElement) =>
  (root.querySelector('[role="status"]')!.textContent ?? "").replace(/\u200b/g, "");

const press = (root: HTMLElement, id: string) => {
  const button = root.querySelector<HTMLButtonElement>(`#${id}`)!;
  button.focus();
  button.click();
  return button;
};

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  h.pending.length = 0;
  h.fetch.mockReset();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockImplementation(async () => {});
  h.showToast.mockReset();
  document.body.innerHTML = "";
});

describe("/settings/dashboard after a move", () => {
  it("↑ on the second row posts once, then focuses that section's ↓ (Review Focus 2)", async () => {
    const root = mountPage();
    press(root, "settings-move-later-up");
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.pending[0].formData.get("dashboardSectionOrder")).toBe("later,done,quickLog,refills");

    reloadTo(["later", "done", "quickLog", "refills"]);
    await h.pending[0].finish({
      type: "success",
      status: 200,
      data: { success: true, key: "dashboardSectionOrder" },
    });
    flushSync();

    expect(h.invalidateAll).toHaveBeenCalledTimes(1);
    expect(sectionOrder(root)).toEqual(["later", "done", "quickLog", "refills"]);
    expect(root.querySelector("#settings-move-later-up")!.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(document.activeElement?.id).toBe("settings-move-later-down");
    expect(document.activeElement?.id).not.toBe("settings-move-later-up");
  });

  it("keeps focus on the pressed direction while it is still live", async () => {
    const root = mountPage();
    press(root, "settings-move-quickLog-up");
    await settle();
    reloadTo(["done", "quickLog", "later", "refills"]);
    await h.pending[0].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    expect(document.activeElement?.id).toBe("settings-move-quickLog-up");
  });

  it("announces the new position", async () => {
    const root = mountPage();
    press(root, "settings-move-later-up");
    await settle();
    reloadTo(["later", "done", "quickLog", "refills"]);
    await h.pending[0].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    expect(status(root)).toBe("Later today moved to position 1 of 4");
  });

  it("alternates a trailing zero-width space so a repeated announcement still fires", async () => {
    const root = mountPage();
    const raw = () => root.querySelector('[role="status"]')!.textContent ?? "";
    press(root, "settings-move-later-down");
    await settle();
    reloadTo(["done", "quickLog", "later", "refills"]);
    await h.pending[0].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    const first = raw();

    press(root, "settings-move-later-up");
    await settle();
    reloadTo(["done", "later", "quickLog", "refills"]);
    await h.pending[1].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    const second = raw();

    expect(first.replace(/\u200b/g, "")).toBe("Later today moved to position 3 of 4");
    expect(second.replace(/\u200b/g, "")).toBe("Later today moved to position 2 of 4");
    expect([first, second].filter((t) => t.endsWith("\u200b"))).toHaveLength(1);
  });

  it("cancels a second press while the first is in flight: one fetch (Review Focus 4)", async () => {
    const root = mountPage();
    press(root, "settings-move-later-up");
    await settle();
    // Every control is inert while the save is in flight.
    for (const b of root.querySelectorAll<HTMLButtonElement>("form button")) {
      expect(b.getAttribute("aria-disabled"), b.id || b.textContent!).toBe("true");
      expect(b.disabled).toBe(false);
    }
    press(root, "settings-move-quickLog-up");
    press(root, "settings-move-later-up");
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.pending).toHaveLength(1);

    reloadTo(["later", "done", "quickLog", "refills"]);
    await h.pending[0].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    // Released once the save settles: the next press sends.
    press(root, "settings-move-quickLog-up");
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it("on a 400 toasts actionErrorMessage(result) and leaves the order as confirmed", async () => {
    const root = mountPage();
    press(root, "settings-move-later-up");
    await settle();
    const result: ActionResult = {
      type: "failure",
      status: 400,
      data: {
        key: "dashboardSectionOrder",
        errors: { dashboardSectionOrder: ["That order isn't one this page can save."] },
      },
    };
    await h.pending[0].finish(result);
    flushSync();
    expect(h.showToast).toHaveBeenCalledWith(actionErrorMessage(result), "error");
    expect(h.showToast).toHaveBeenCalledWith("That order isn't one this page can save.", "error");
    expect(h.invalidateAll).not.toHaveBeenCalled();
    expect(sectionOrder(root)).toEqual(["done", "later", "quickLog", "refills"]);
    // And the page is usable again.
    for (const b of root.querySelectorAll<HTMLButtonElement>("#settings-move-later-up")) {
      expect(b.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("on a 429 toasts the server's saveError sentence, not the generic fallback", async () => {
    const root = mountPage();
    press(root, "settings-move-later-up");
    await settle();
    await h.pending[0].finish({
      type: "failure",
      status: 429,
      data: {
        key: "dashboardSectionOrder",
        saveError: "Too many changes. Try again in 12 seconds.",
        retryAfterMs: 12_000,
      },
    });
    flushSync();
    expect(h.showToast).toHaveBeenCalledWith("Too many changes. Try again in 12 seconds.", "error");
    expect(h.invalidateAll).not.toHaveBeenCalled();
  });

  it("announces a visibility change", async () => {
    const root = mountPage();
    const toggle = root.querySelector<HTMLButtonElement>(
      'li[data-section="refills"] button[aria-pressed]',
    )!;
    toggle.click();
    await settle();
    expect(h.pending[0].formData.get("dashboardShowRefills")).toBe("off");
    h.invalidateAll.mockImplementationOnce(async () => {
      props.data = dataWith(null, { dashboardShowRefills: false });
      flushSync();
    });
    await h.pending[0].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    expect(status(root)).toBe("Refills hidden");
  });
  it("words a second toggle of the same section from the reloaded state, not the first render's", async () => {
    const root = mountPage();
    const toggle = () =>
      root.querySelector<HTMLButtonElement>('li[data-section="refills"] button[aria-pressed]')!;
    toggle().click();
    await settle();
    h.invalidateAll.mockImplementationOnce(async () => {
      props.data = dataWith(null, { dashboardShowRefills: false });
      flushSync();
    });
    await h.pending[0].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    expect(status(root)).toBe("Refills hidden");

    toggle().click();
    await settle();
    expect(h.pending[1].formData.get("dashboardShowRefills")).toBe("on");
    h.invalidateAll.mockImplementationOnce(async () => {
      props.data = dataWith(null);
      flushSync();
    });
    await h.pending[1].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    expect(status(root)).toBe("Refills shown");
  });
});

describe("/settings/dashboard after an option press", () => {
  it("announces the reloaded Later choice, then the Done choice", async () => {
    const root = mountPage();
    const option = (group: string, name: string) =>
      root.querySelector<HTMLButtonElement>(
        `fieldset[data-option-group="${group}"] button[name="${name}"][value="all"], fieldset[data-option-group="${group}"] button[name="${name}"][value="clock"]`,
      )!;

    option("dashboardLaterMode", "dashboardLaterMode").click();
    await settle();
    expect(h.pending[0].formData.get("dashboardLaterMode")).toBe("all");
    h.invalidateAll.mockImplementationOnce(async () => {
      props.data = dataWith(null, { dashboardLaterMode: "all" });
      flushSync();
    });
    await h.pending[0].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    expect(status(root)).toBe("Later today: whole day");

    option("dashboardDoneTime", "dashboardDoneTime").click();
    await settle();
    expect(h.pending[1].formData.get("dashboardDoneTime")).toBe("clock");
    h.invalidateAll.mockImplementationOnce(async () => {
      props.data = dataWith(null, { dashboardLaterMode: "all", dashboardDoneTime: "clock" });
      flushSync();
    });
    await h.pending[1].finish({ type: "success", status: 200, data: { success: true } });
    flushSync();
    expect(status(root)).toBe("Done today: time only");
  });
});

describe("/settings/dashboard after Reset", () => {
  it("parks focus on the h1 once the reload removes the Reset button (Review Important 1)", async () => {
    const root = mountPage(["refills", "done", "later", "quickLog"]);
    const reset = root.querySelector<HTMLButtonElement>(
      'form[action="?/resetDashboardLayout"] button',
    )!;
    reset.focus();
    reset.click();
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(1);

    h.invalidateAll.mockImplementationOnce(async () => {
      props.data = dataWith(null);
      flushSync();
    });
    await h.pending[0].finish({
      type: "success",
      status: 200,
      data: { success: true, key: "resetDashboardLayout" },
    });
    flushSync();

    // The button went with the customised state.
    expect(root.querySelector('form[action="?/resetDashboardLayout"]')).toBeNull();
    expect(reset.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(root.querySelector("h1"));
    expect(status(root)).toBe("Dashboard layout reset to default");
  });
});

describe("/settings/dashboard after a preset press", () => {
  it("posts the id, announces '<Label> applied' from the reloaded data and keeps focus on the toggle", async () => {
    const root = mountPage();
    const focused = root.querySelector<HTMLButtonElement>(
      'button[name="preset"][value="focused"]',
    )!;
    focused.focus();
    focused.click();
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.pending[0].formData.get("preset")).toBe("focused");

    h.invalidateAll.mockImplementationOnce(async () => {
      props.data = dataWith(null, { dashboardShowLater: false, dashboardDoneTime: "since" });
      flushSync();
    });
    await h.pending[0].finish({
      type: "success",
      status: 200,
      data: { success: true, key: "applyPreset" },
    });
    flushSync();

    expect(status(root)).toBe("Focused applied");
    expect(focused.isConnected).toBe(true);
    expect(document.activeElement).toBe(focused);
    expect(focused.getAttribute("aria-pressed")).toBe("true");
  });
});
