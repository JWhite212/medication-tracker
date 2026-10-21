// The three pages that hold a deletion nothing can undo, mounted for real
// (jsdom, client svelte) so the dialog can be opened. Each dialog renders
// inside the form it submits, and that form sits outside every GlassCard:
// `backdrop-blur-xl` would otherwise become the containing block for
// Modal's fixed scrim. `use:enhance` is replaced by a recorder, keyed by the
// form's action, so a test can drive the submit callback by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount, type Component } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submits: new Map<string, SubmitFunction>(),
}));

vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form.getAttribute("action") ?? "(none)", submit);
    return { destroy() {} };
  },
}));

import PrivacyPage from "../../src/routes/(app)/settings/privacy/+page.svelte";
import DataPage from "../../src/routes/(app)/settings/data/+page.svelte";

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const preferences = { userId: "u1", exportFormat: "pdf" };

const PRIVACY = {
  user,
  preferences,
  hasPassword: true,
  counts: {
    activeMedications: 4,
    archivedMedications: 2,
    doseLogs: 1204,
    doseMedications: 6,
    archivedDoses: 340,
    sessions: 3,
    auditLogs: 9,
  },
};

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let props: { data: unknown; form: unknown };

beforeEach(() => {
  target = document.body.appendChild(document.createElement("div"));
  h.submits.clear();
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = "";
});

function mountPage(Page: unknown, data: unknown, form: unknown = null) {
  const state = $state({ data, form });
  props = state;
  app = mount(Page as Component<{ data: unknown; form: unknown }>, { target, props });
  flushSync();
}

async function settle() {
  flushSync();
  for (let i = 0; i < 3; i++) await tick();
  flushSync();
}

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

/** The button whose trimmed text is exactly `text`, optionally under `within`. */
function button(text: string, within = "body"): HTMLButtonElement {
  const found = [...q(within).querySelectorAll("button")].find(
    (b) => b.textContent!.trim() === text,
  );
  if (!found) throw new Error(`no button "${text}" in ${within}`);
  return found;
}

function clickButton(text: string) {
  button(text).click();
}

describe("privacy page", () => {
  it("opens the dose-history dialog inside its form, outside every GlassCard, with the counted summary", async () => {
    mountPage(PrivacyPage, PRIVACY);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    clickButton("Delete dose history");
    await settle();
    const dialog = q('[role="dialog"]');
    expect(dialog.getAttribute("aria-label")).toBe("Delete dose history?");
    expect(dialog.textContent).toContain("This deletes 1,204 doses for 6 medications.");
    expect(dialog.closest("form")!.getAttribute("action")).toBe("?/wipeDoseHistory");
    expect(dialog.closest(".backdrop-blur-xl")).toBeNull();
    expect(dialog.querySelector('input[name="password"]')).not.toBeNull(); // hasPassword: true
  });

  it("opens the archived dialog with its own summary", async () => {
    mountPage(PrivacyPage, PRIVACY);
    clickButton("Delete archived medications");
    await settle();
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs).toHaveLength(1);
    const dialog = dialogs[0];
    expect(dialog.getAttribute("aria-label")).toBe("Delete archived medications?");
    expect(dialog.textContent).toContain(
      "This deletes 2 archived medications and the 340 doses logged for them.",
    );
    expect(dialog.closest("form")!.getAttribute("action")).toBe("?/wipeArchivedMedications");
    expect(dialog.closest(".backdrop-blur-xl")).toBeNull();
  });

  it("keeps a refused wipe in the dialog with the server's words", async () => {
    mountPage(PrivacyPage, PRIVACY);
    clickButton("Delete dose history");
    await settle();
    const after = h.submits.get("?/wipeDoseHistory")!({} as never) as (o: unknown) => Promise<void>;
    const update = vi.fn();
    await after({
      result: { type: "failure", status: 400, data: { error: "Incorrect password." } },
      update,
    });
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(q('[role="dialog"] [role="alert"]').textContent).toContain("Incorrect password.");
  });
});

describe("data page", () => {
  const DATA = { user, preferences, counts: { medications: 6, doses: 1204 }, hasPassword: false };

  it("opens the account dialog with its counted summary, asking a passwordless account for the word alone", async () => {
    mountPage(DataPage, DATA);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    clickButton("Delete My Account");
    await settle();
    const dialog = q('[role="dialog"]');
    expect(dialog.getAttribute("aria-label")).toBe("Delete your account?");
    expect(dialog.textContent).toContain(
      "This deletes your account and settings, 6 medications and 1,204 doses.",
    );
    expect(dialog.closest("form")!.getAttribute("action")).toBe("?/deleteAccount");
    expect(dialog.querySelector('input[name="confirmWord"]')).not.toBeNull();
    expect(dialog.querySelector('input[name="password"]')).toBeNull();
    expect(dialog.closest(".backdrop-blur-xl")).toBeNull();
  });

  it("keeps a refused deletion in the dialog with the server's words", async () => {
    mountPage(DataPage, { ...DATA, hasPassword: true });
    clickButton("Delete My Account");
    await settle();
    expect(q('[role="dialog"] input[name="password"]')).not.toBeNull();
    const after = h.submits.get("?/deleteAccount")!({} as never) as (o: unknown) => Promise<void>;
    const update = vi.fn();
    await after({
      result: { type: "failure", status: 400, data: { error: "Incorrect password." } },
      update,
    });
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(q('[role="dialog"] [role="alert"]').textContent).toContain("Incorrect password.");
  });
});
