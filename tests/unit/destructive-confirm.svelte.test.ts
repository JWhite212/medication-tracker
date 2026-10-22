// DestructiveConfirm: the one dialog for the four deletions nothing can
// undo. Mounted for real (jsdom, client svelte) INTO the <form> it submits,
// which is the component's rule; a `.svelte.test.ts` so the props are a
// `$state` the test can change. The server's checkDestructiveGuard is the
// real gate (destructive-guard.test.ts); this file pins the explanation and
// the controls.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import DestructiveConfirm from "$lib/components/ui/DestructiveConfirm.svelte";
import { collectFocusable } from "$lib/utils/focus-trap";
import { withoutComments } from "./helpers/axe-ssr";
import {
  RECENT_SIGN_IN_MESSAGE,
  type DestructiveConfirmation,
} from "$lib/utils/destructive-confirm";

type Props = {
  title: string;
  summary: string;
  word: "DELETE" | "REPLACE";
  confirmation: DestructiveConfirmation;
  returnTo: "/settings/privacy" | "/settings/data" | "/settings/data/import";
  signInNote?: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  open: boolean;
  onclose: () => void;
  formaction?: string;
};

let form: HTMLFormElement;
let opener: HTMLButtonElement;
let props: Props;
let onsubmit: ReturnType<typeof vi.fn<(e: Event) => void>>;
let app: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  opener = document.body.appendChild(document.createElement("button"));
  opener.type = "button";
  opener.textContent = "Delete dose history";
  form = document.body.appendChild(document.createElement("form"));
  onsubmit = vi.fn((e: Event) => e.preventDefault());
  form.addEventListener("submit", onsubmit);

  const state = $state<Props>({
    title: "Delete dose history?",
    summary: "This deletes 1,204 doses for 6 medications.",
    word: "DELETE",
    confirmation: { kind: "password" },
    returnTo: "/settings/privacy",
    signInNote: undefined,
    confirmLabel: "Delete dose history",
    pending: false,
    error: null,
    open: false,
    onclose: vi.fn(() => (props.open = false)),
    formaction: undefined,
  });
  props = state;
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = "";
});

async function settle() {
  flushSync();
  for (let i = 0; i < 3; i++) await tick();
  flushSync();
}

function mountClosed() {
  app ??= mount(DestructiveConfirm, { target: form, props });
  flushSync();
}

/** Focus the opener (outside the form), open the dialog, and let Modal move focus in. */
async function openFrom(from: HTMLElement) {
  mountClosed();
  from.focus();
  props.open = true;
  await settle();
}

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent!.includes(text));
  if (!found) throw new Error(`no button with text "${text}"`);
  return found;
}

const danger = () => buttonByText(form, props.confirmLabel);

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function fillReady(word: string = props.word, password = "hunter2") {
  type(q('input[name="confirmWord"]'), word);
  if (props.confirmation.kind === "password") type(q('input[name="password"]'), password);
}

it("says what goes, with the server's counts, and that it can't be undone", async () => {
  await openFrom(opener);
  const dialog = q('[role="dialog"]');
  expect(dialog.getAttribute("aria-label")).toBe("Delete dose history?");
  expect(dialog.querySelector("h2")!.textContent).toBe("Delete dose history?");
  expect(dialog.textContent).toContain("This deletes 1,204 doses for 6 medications.");
  expect(dialog.textContent).toContain("This can't be undone.");
});

it("names its inputs confirmWord and password, labelled, with the right autocomplete", async () => {
  await openFrom(opener);
  const word = q<HTMLInputElement>('input[name="confirmWord"]');
  expect([
    word.type,
    word.getAttribute("autocomplete"),
    word.getAttribute("autocapitalize"),
  ]).toEqual(["text", "off", "characters"]);
  expect(word.labels![0].textContent!.replace(/\s+/g, " ").trim()).toBe("Type DELETE to confirm");
  const pw = q<HTMLInputElement>('input[name="password"]');
  expect([pw.type, pw.getAttribute("autocomplete")]).toEqual(["password", "current-password"]);
  expect(pw.labels![0].textContent!.trim()).toBe("Your password");
});

/** An account with no password, signed in recently: the word is all it needs. */
const RECENT_NO_PASSWORD: DestructiveConfirmation = {
  kind: "recentSignIn",
  recent: true,
  providers: ["google"],
};
const STALE_NO_PASSWORD: DestructiveConfirmation = {
  kind: "recentSignIn",
  recent: false,
  providers: ["google", "github"],
};

const signInLinks = () =>
  [...form.querySelectorAll<HTMLAnchorElement>('a[href^="/auth/callback/"]')].map((a) => [
    a.textContent!.trim(),
    a.getAttribute("href"),
  ]);

it("asks an account with no password for the word alone, when its sign-in is recent", async () => {
  props.confirmation = RECENT_NO_PASSWORD;
  await openFrom(opener);
  expect(form.querySelector('input[name="password"]')).toBeNull();
  type(q('input[name="confirmWord"]'), "DELETE");
  expect(danger().getAttribute("aria-disabled")).not.toBe("true");
});

it("keeps its one danger button aria-disabled, not disabled, until the word and the password are in", async () => {
  await openFrom(opener);
  expect(form.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  expect(danger().classList).toContain("bg-danger");
  expect(danger().disabled).toBe(false);
  expect(danger().getAttribute("aria-disabled")).toBe("true");
  type(q('input[name="confirmWord"]'), "DELETE");
  expect(danger().getAttribute("aria-disabled")).toBe("true"); // password still empty
  type(q('input[name="password"]'), "hunter2");
  expect(danger().getAttribute("aria-disabled")).not.toBe("true");
});

it("matches the word case-sensitively after trimming, as the server does", async () => {
  props.confirmation = RECENT_NO_PASSWORD;
  await openFrom(opener);
  type(q('input[name="confirmWord"]'), "delete");
  expect(danger().getAttribute("aria-disabled")).toBe("true");
  type(q('input[name="confirmWord"]'), "  DELETE ");
  expect(danger().getAttribute("aria-disabled")).not.toBe("true");
});

it("submits nothing while not ready, and submits once with itself as submitter when ready", async () => {
  await openFrom(opener);
  danger().click();
  expect(onsubmit).not.toHaveBeenCalled();
  // Both fields filled, so `required` is satisfied and only the button's own
  // guard stands between a wrong word and a submit.
  type(q('input[name="confirmWord"]'), "delete");
  type(q('input[name="password"]'), "hunter2");
  danger().click();
  expect(onsubmit).not.toHaveBeenCalled();
  type(q('input[name="confirmWord"]'), "DELETE");
  danger().click();
  expect(onsubmit).toHaveBeenCalledTimes(1);
  expect((onsubmit.mock.calls[0][0] as SubmitEvent).submitter).toBe(danger());
});

it("closes from Cancel and from Escape without submitting", async () => {
  await openFrom(opener);
  const cancel = buttonByText(form, "Cancel");
  expect(cancel.getAttribute("type")).toBe("button");
  cancel.click();
  await settle();
  expect(props.onclose).toHaveBeenCalledTimes(1);
  expect(form.querySelector('[role="dialog"]')).toBeNull();
  await openFrom(opener);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(props.onclose).toHaveBeenCalledTimes(2);
  expect(onsubmit).not.toHaveBeenCalled();
});

it("moves focus to the word field on open and back to the opener on close", async () => {
  await openFrom(opener);
  expect(document.activeElement).toBe(q('input[name="confirmWord"]'));
  props.open = false;
  await settle();
  expect(document.activeElement).toBe(opener);
});

it("lets Tab reach the word, the password, Cancel and the not-ready danger button, in that order", async () => {
  await openFrom(opener);
  // The list Modal's Tab trap cycles through; aria-disabled keeps the danger button in it.
  expect(
    collectFocusable(q('[role="dialog"]')).map(
      (el) => el.getAttribute("name") ?? el.getAttribute("type"),
    ),
  ).toEqual(["confirmWord", "password", "button", "submit"]);
  expect(danger().getAttribute("aria-disabled")).toBe("true");
});

it("shows an error as a wrong-tone Alert inside the dialog, and clears the password", async () => {
  await openFrom(opener);
  type(q('input[name="password"]'), "wrong");
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
  props.error = "Incorrect password.";
  await settle();
  const alert = q('[role="dialog"] [role="alert"]');
  expect(alert.textContent).toContain("Incorrect password.");
  expect(q<HTMLInputElement>('input[name="password"]').value).toBe("");
});

it("while pending, shows the pending label, submits nothing, and will not close", async () => {
  await openFrom(opener);
  fillReady();
  props.pending = true;
  await settle();
  expect(danger().getAttribute("aria-busy")).toBe("true");
  expect(danger().textContent).toContain("Deleting…");
  danger().click();
  buttonByText(form, "Cancel").click();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(onsubmit).not.toHaveBeenCalled();
  expect(props.onclose).not.toHaveBeenCalled();
  expect(form.querySelector('[role="dialog"]')).not.toBeNull();
});

it("says Replacing… for REPLACE", async () => {
  props.word = "REPLACE";
  props.title = "Replace all your data?";
  props.confirmLabel = "Replace all data";
  await openFrom(opener);
  expect(
    q<HTMLInputElement>('input[name="confirmWord"]')
      .labels![0].textContent!.replace(/\s+/g, " ")
      .trim(),
  ).toBe("Type REPLACE to confirm");
  fillReady();
  expect(danger().getAttribute("aria-disabled")).not.toBe("true");
  props.pending = true;
  await settle();
  expect(danger().textContent).toContain("Replacing…");
  expect(danger().textContent).not.toContain("Deleting…");
});

it("starts empty each time it opens", async () => {
  await openFrom(opener);
  fillReady();
  props.open = false;
  await settle();
  await openFrom(opener);
  expect(q<HTMLInputElement>('input[name="confirmWord"]').value).toBe("");
  expect(q<HTMLInputElement>('input[name="password"]').value).toBe("");
  expect(danger().getAttribute("aria-disabled")).toBe("true");
});

it("passes formaction to its submit", async () => {
  props.formaction = "?/commit";
  await openFrom(opener);
  expect(danger().getAttribute("formaction")).toBe("?/commit");
});

it("renders nothing of its own while closed", () => {
  mountClosed();
  expect(withoutComments(form.innerHTML).trim()).toBe("");
});

describe("an account with no password whose sign-in is not recent", () => {
  it("shows the sign-in prompt with one link per provider, back to this page, and no password field", async () => {
    props.confirmation = STALE_NO_PASSWORD;
    await openFrom(opener);
    expect(form.textContent).toContain(RECENT_SIGN_IN_MESSAGE);
    expect(signInLinks()).toEqual([
      ["Sign in again with Google", "/auth/callback/google?returnTo=%2Fsettings%2Fprivacy"],
      ["Sign in again with GitHub", "/auth/callback/github?returnTo=%2Fsettings%2Fprivacy"],
    ]);
    expect(form.querySelector('input[name="password"]')).toBeNull();
    // The word field stays, so they can see what they will type when they return.
    type(q('input[name="confirmWord"]'), "DELETE");
    expect(danger().getAttribute("aria-disabled")).toBe("true");
  });

  it("swaps a sign-in refusal for the sign-in prompt, never a red alert beside it", async () => {
    props.confirmation = RECENT_NO_PASSWORD;
    await openFrom(opener);
    type(q('input[name="confirmWord"]'), "DELETE");
    expect(danger().getAttribute("aria-disabled")).not.toBe("true");
    expect(signInLinks()).toEqual([]);

    // Loaded at 9:59, submitted at 10:01: the server's refusal is the only news.
    props.error = RECENT_SIGN_IN_MESSAGE;
    await settle();

    expect(form.querySelector('[role="alert"]')).toBeNull();
    expect(signInLinks()).toEqual([
      ["Sign in again with Google", "/auth/callback/google?returnTo=%2Fsettings%2Fprivacy"],
    ]);
    expect(danger().getAttribute("aria-disabled")).toBe("true");
  });

  it("announces the sign-in prompt through a status region that was there before it", async () => {
    props.confirmation = RECENT_NO_PASSWORD;
    await openFrom(opener);
    const region = q('[role="dialog"] [role="status"]');
    expect(region.textContent!.trim()).toBe("");

    props.error = RECENT_SIGN_IN_MESSAGE;
    await settle();

    expect(q('[role="dialog"] [role="status"]')).toBe(region);
    expect(region.textContent).toContain(RECENT_SIGN_IN_MESSAGE);
    expect(region.querySelector('a[href^="/auth/callback/google"]')).not.toBeNull();
  });

  it("keeps any other refusal as a red alert", async () => {
    props.confirmation = STALE_NO_PASSWORD;
    props.error = "Too many attempts. Try again in 5 minutes.";
    await openFrom(opener);
    expect(q('[role="alert"]').textContent).toContain("Too many attempts");
    expect(signInLinks()).toHaveLength(2);
  });

  it("explains Forgot password, and never only 'sign out', when no provider can sign in again", async () => {
    props.confirmation = { kind: "recentSignIn", recent: false, providers: [] };
    await openFrom(opener);
    expect(signInLinks()).toEqual([]);
    const prompt = q('[role="dialog"] [role="status"]').textContent!.replace(/\s+/g, " ");
    expect(prompt).toContain("this account has no way to sign in again here");
    expect(prompt).toContain("Forgot password");
    expect(danger().getAttribute("aria-disabled")).toBe("true");
  });

  it("adds the page's note to the prompt", async () => {
    props.confirmation = STALE_NO_PASSWORD;
    props.returnTo = "/settings/data/import";
    props.signInNote = "You'll need to choose the file again.";
    await openFrom(opener);
    expect(q('[role="dialog"] [role="status"]').textContent).toContain(
      "You'll need to choose the file again.",
    );
    expect(signInLinks()[0][1]).toBe("/auth/callback/google?returnTo=%2Fsettings%2Fdata%2Fimport");
  });
});
