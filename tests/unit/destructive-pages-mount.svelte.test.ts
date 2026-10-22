// The three pages that hold a deletion nothing can undo, mounted for real
// (jsdom, client svelte) so the dialog can be opened. Each dialog renders
// inside the form it submits, and that form sits outside every GlassCard:
// `backdrop-blur-xl` would otherwise become the containing block for
// Modal's fixed scrim. `use:enhance` is replaced by a recorder, keyed by the
// form's action, so a test can drive the submit callback by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount, type Component } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";
import { accessibleName } from "./helpers/dom-names";

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
import ImportPage from "../../src/routes/(app)/settings/data/import/+page.svelte";

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

const PASSWORD = { kind: "password" } as const;
const RECENT = { kind: "recentSignIn", recent: true, providers: ["google"] } as const;
const STALE = { kind: "recentSignIn", recent: false, providers: ["google", "github"] } as const;

/** The "Sign in again" links on the page, as [text, href]. */
const signInLinks = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/auth/callback/"]')].map((a) => [
    a.textContent!.trim(),
    a.getAttribute("href"),
  ]);

const PRIVACY = {
  user,
  preferences,
  confirmation: PASSWORD,
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

/**
 * The button named exactly `text`, optionally under `within`. By accessible
 * name, not raw text: a Button with a pending state keeps its pending label
 * in the DOM, aria-hidden, so its textContent carries both.
 */
function button(text: string, within = "body"): HTMLButtonElement {
  const found = [...q(within).querySelectorAll("button")].find((b) => accessibleName(b) === text);
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
    expect(dialog.querySelector('input[name="password"]')).not.toBeNull(); // a password account
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

describe("an account with no password whose sign-in is not recent", () => {
  it("offers Privacy's two dialogs a sign-in that comes back to Privacy", async () => {
    mountPage(PrivacyPage, { ...PRIVACY, confirmation: STALE });
    for (const opener of ["Delete dose history", "Delete archived medications"]) {
      clickButton(opener);
      await settle();
      expect(signInLinks()).toEqual([
        ["Sign in again with Google", "/auth/callback/google?returnTo=%2Fsettings%2Fprivacy"],
        ["Sign in again with GitHub", "/auth/callback/github?returnTo=%2Fsettings%2Fprivacy"],
      ]);
      button("Cancel", '[role="dialog"]').click();
      await settle();
    }
  });

  it("offers the account dialog a sign-in that comes back to Data", async () => {
    mountPage(DataPage, {
      user,
      preferences,
      counts: { medications: 6, doses: 1204 },
      confirmation: STALE,
    });
    clickButton("Delete My Account");
    await settle();
    expect(signInLinks().map(([, href]) => href)).toEqual([
      "/auth/callback/google?returnTo=%2Fsettings%2Fdata",
      "/auth/callback/github?returnTo=%2Fsettings%2Fdata",
    ]);
  });
});

describe("data page", () => {
  const DATA = { user, preferences, counts: { medications: 6, doses: 1204 }, confirmation: RECENT };

  it("opens the account dialog with its counted summary, asking a recently signed-in passwordless account for the word alone", async () => {
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
    mountPage(DataPage, { ...DATA, confirmation: PASSWORD });
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

describe("import page", () => {
  const IMPORT = {
    user,
    preferences,
    medications: [],
    confirmation: PASSWORD,
    maxBytes: 5_242_880,
    timezone: "UTC",
  };
  const REPLACE_PREVIEW = {
    format: "json",
    mode: "replace",
    summary: {
      medicationsCreated: 2,
      medicationsReused: 0,
      dosesCreated: 10,
      dosesSkipped: 0,
      inventoryEventsCreated: 0,
      medicationsDeleted: 6,
      dosesDeleted: 1204,
    },
    warnings: [],
    unmatchedNames: [],
    createdNames: [],
    reusedNames: [],
    empty: false,
  };
  const IMPORTED = {
    medicationsCreated: 2,
    medicationsReused: 0,
    dosesCreated: 10,
    dosesSkipped: 0,
    inventoryEventsCreated: 0,
    medicationsDeleted: 6,
    dosesDeleted: 1204,
  };

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  function fillReady(word: string, password: string) {
    type(q('input[name="confirmWord"]'), word);
    type(q('input[name="password"]'), password);
  }

  /** The page's one submit callback (its form has no action), started as a submit would start it. */
  function startSubmit() {
    return h.submits.get("(none)")!({} as never) as (o: unknown) => Promise<void>;
  }

  beforeEach(async () => {
    mountPage(ImportPage, IMPORT, { preview: REPLACE_PREVIEW });
    q<HTMLInputElement>('input[value="replace"]').click();
    await settle();
  });

  it("swaps Import for a secondary 'Replace all data' that opens the dialog with the preview's counts", async () => {
    expect(
      [...document.querySelectorAll("button")].some((b) => accessibleName(b) === "Import"),
    ).toBe(false);
    const entry = button("Replace all data");
    expect([entry.getAttribute("type"), entry.disabled]).toEqual(["button", false]);
    expect(entry.classList).toContain("border-border-strong");
    entry.click();
    await settle();
    const dialog = q('[role="dialog"]');
    expect(dialog.getAttribute("aria-label")).toBe("Replace all your data?");
    expect(dialog.textContent).toContain(
      "This deletes 6 medications and 1,204 doses, with their schedules and inventory history, then imports the file.",
    );
    expect(
      q<HTMLInputElement>('input[name="confirmWord"]')
        .labels![0].textContent!.replace(/\s+/g, " ")
        .trim(),
    ).toBe("Type REPLACE to confirm");
  });

  it("puts the dialog's submit first in the form, posting to ?/commit, outside every GlassCard", async () => {
    button("Replace all data").click();
    await settle();
    const form = q("form");
    const danger = button("Replace all data", '[role="dialog"]');
    expect(form.querySelector('button[type="submit"]')).toBe(danger); // the default button: Enter submits the dialog
    expect(danger.getAttribute("formaction")).toBe("?/commit");
    expect(danger.closest(".backdrop-blur-xl")).toBeNull();
    // The scrim is `fixed inset-0`; as a direct child of a space-y-* parent it
    // would take a margin-block-end that shortens it, leaving page uncovered.
    const scrim = q('[role="dialog"]').parentElement!;
    expect(scrim.classList).toContain("fixed");
    expect(scrim.parentElement!.className).not.toMatch(/\bspace-y-/);
  });

  it("keeps a refused replace in the dialog", async () => {
    button("Replace all data").click();
    await settle();
    fillReady("REPLACE", "wrong");
    const after = startSubmit();
    const update = vi.fn();
    await after({
      result: { type: "failure", status: 400, data: { error: "Incorrect password." } },
      update,
    });
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(q('[role="dialog"] [role="alert"]').textContent).toContain("Incorrect password.");
    expect(q<HTMLInputElement>('[role="dialog"] input[name="password"]').value).toBe("");
    // The page's own buttons are usable again: a refusal is not a submit in flight.
    expect(button("Preview again").disabled).toBe(false);
  });

  it("after a successful replace, announces it and parks focus on the page heading", async () => {
    button("Replace all data").click();
    await settle();
    fillReady("REPLACE", "hunter2");
    const after = startSubmit();
    await after({
      result: { type: "success", status: 200, data: { imported: IMPORTED, importId: "i1" } },
      update: async () => {
        props.form = { imported: IMPORTED, importId: "i1" };
        flushSync();
      },
    });
    await settle();
    expect(q("#import-outcome").textContent).toContain("Import complete");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(q("h1"));
  });
});

describe("import page, for an account with no password", () => {
  const importData = (confirmation: unknown) => ({
    user,
    preferences,
    medications: [],
    confirmation,
    maxBytes: 5_242_880,
    timezone: "UTC",
  });
  const choose = async (mode: "merge" | "replace") => {
    q<HTMLInputElement>(`input[value="${mode}"]`).click();
    await settle();
  };

  it("says to sign in again as soon as Replace is chosen, before any file or preview", async () => {
    mountPage(ImportPage, importData(STALE));
    expect(signInLinks()).toEqual([]);

    await choose("replace");
    expect(signInLinks()).toEqual([
      ["Sign in again with Google", "/auth/callback/google?returnTo=%2Fsettings%2Fdata%2Fimport"],
      ["Sign in again with GitHub", "/auth/callback/github?returnTo=%2Fsettings%2Fdata%2Fimport"],
    ]);
    // Announced: the prompt arrives inside a status region that was already there.
    expect(
      document.querySelector('a[href^="/auth/callback/google"]')!.closest('[role="status"]'),
    ).not.toBeNull();

    await choose("merge");
    expect(signInLinks()).toEqual([]);
  });

  it("says nothing extra when the sign-in is recent", async () => {
    mountPage(ImportPage, importData(RECENT));
    await choose("replace");
    expect(signInLinks()).toEqual([]);
  });

  it("tells the dialog to warn that the file must be chosen again", async () => {
    mountPage(ImportPage, importData(STALE), {
      preview: {
        format: "json",
        mode: "replace",
        summary: {
          medicationsCreated: 0,
          medicationsReused: 0,
          dosesCreated: 0,
          dosesSkipped: 0,
          inventoryEventsCreated: 0,
          medicationsDeleted: 1,
          dosesDeleted: 1,
        },
        warnings: [],
        unmatchedNames: [],
        createdNames: [],
        reusedNames: [],
        empty: false,
      },
    });
    await choose("replace");
    clickButton("Replace all data");
    await settle();
    expect(q('[role="dialog"]').textContent).toContain("You'll need to choose the file again.");
  });
});
