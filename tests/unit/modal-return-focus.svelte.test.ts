// Where Modal sends focus when it closes. It returns focus to the control
// that opened it, but that control can be gone by then: the dashboard's edit
// dialog stays open over a refused Remove (another device had already removed
// the dose), the refusal's reload drops the Done row whose Edit opened it, and
// Escape then focused a DISCONNECTED button, which leaves focus on <body>. The
// /log dialog has the same shape after a Save refused for the same reason.
// Mounted for real (jsdom, client svelte); a `.svelte.test.ts` so `open` is a
// `$state` the test can close.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte";
import Modal from "$lib/components/ui/Modal.svelte";

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

const body = createRawSnippet(() => ({ render: () => `<button type="button">Save</button>` }));

const spyOnFocus = () => vi.spyOn(HTMLElement.prototype, "focus");
/** Every focus() call on `el`, by its arguments. jsdom ignores preventScroll, so only the argument says. */
function focusCallsOn(spy: ReturnType<typeof spyOnFocus>, el: Element): unknown[][] {
  return spy.mock.calls.filter((_, i) => spy.mock.contexts[i] === el);
}

beforeEach(() => {
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Let the dialog's own focus move (a tick after it opens) land. */
async function settle() {
  flushSync();
  for (let i = 0; i < 3; i++) await tick();
  flushSync();
}

/**
 * A page with an h1, the control that opens the dialog, and the dialog,
 * opened from that control. Closing it is what Escape, Cancel and a
 * successful write's onSuccess all do: set `open` to false.
 */
async function openFrom(returnFocus?: () => HTMLElement | null) {
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  heading.textContent = "Dose History";
  const opener = document.createElement("button");
  opener.textContent = "Edit";
  target.append(heading, opener);

  const props = $state({
    open: false,
    onclose: () => {
      props.open = false;
    },
    title: "Edit dose",
    children: body,
    returnFocus,
  });
  app = mount(Modal, { target, props });
  flushSync();

  opener.focus();
  props.open = true;
  await settle();
  const dialog = target.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog, "the dialog should be open").not.toBeNull();
  expect(dialog!.contains(document.activeElement), "focus should be in the dialog").toBe(true);

  return {
    heading,
    opener,
    async close() {
      props.open = false;
      await settle();
    },
    async pressEscape() {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle();
    },
  };
}

describe("Modal, on close", () => {
  it("returns focus to the control that opened it while that control is still there, exactly as before", async () => {
    const returnFocus = vi.fn(() => null);
    const { opener, close } = await openFrom(returnFocus);
    const focus = spyOnFocus();

    await close();

    expect(document.activeElement).toBe(opener);
    expect(focusCallsOn(focus, opener)).toEqual([[]]);
    expect(returnFocus).not.toHaveBeenCalled();
  });

  it("with the opener gone, Escape sends focus to the caller's returnFocus, with a plain focus()", async () => {
    const done = document.createElement("h2");
    done.tabIndex = -1;
    target.append(done);
    const { opener, pressEscape } = await openFrom(() => done);
    // The refusal's reload dropped the row the dialog was opened from.
    opener.remove();
    const focus = spyOnFocus();

    await pressEscape();

    expect(target.querySelector('[role="dialog"]'), "Escape should close it").toBeNull();
    expect(document.activeElement).toBe(done);
    expect(focusCallsOn(focus, done)).toEqual([[]]);
  });

  it("with the opener gone and no returnFocus, focus parks on the page's h1 without scrolling", async () => {
    const { heading, opener, close } = await openFrom();
    opener.remove();
    const focus = spyOnFocus();

    await close();

    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);
    expect(focusCallsOn(focus, heading)).toEqual([[{ preventScroll: true }]]);
  });

  it("with the opener gone and returnFocus finding nothing, the page's h1 is still the last resort", async () => {
    const { heading, opener, close } = await openFrom(() => null);
    opener.remove();
    const focus = spyOnFocus();

    await close();

    expect(document.activeElement).toBe(heading);
    expect(focusCallsOn(focus, heading)).toEqual([[{ preventScroll: true }]]);
  });
});
