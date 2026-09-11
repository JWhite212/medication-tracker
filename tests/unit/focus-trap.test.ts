// Default environment is jsdom (vite.config.ts), which is what we want here:
// element matching against a selector is plain DOM semantics and behaves the
// same in jsdom as in a browser. Focus MOVEMENT is not — that is why the
// component keeps no unit test and the pure parts were extracted instead.
import { describe, it, expect, afterEach } from "vitest";
import { collectFocusable, nextTrapIndex, trapTab } from "../../src/lib/utils/focus-trap";

function fixture(html: string): HTMLElement {
  const host = document.createElement("div");
  // A detached node is enough for matching, but compareDocumentPosition needs
  // both nodes in one tree — they are, since they share this host.
  host.innerHTML = html;
  return host;
}

function focusables(host: HTMLElement): string[] {
  return collectFocusable(host).map((el) => el.getAttribute("data-id") ?? el.tagName.toLowerCase());
}

describe("FOCUSABLE_SELECTOR", () => {
  it("ignores hidden inputs", () => {
    const host = fixture(`
      <input type="hidden" data-id="hidden" />
      <input type="text" data-id="text" />
    `);
    expect(focusables(host)).toEqual(["text"]);
  });

  it("ignores disabled controls of every kind", () => {
    const host = fixture(`
      <button disabled data-id="btn">x</button>
      <input type="text" disabled data-id="input" />
      <select disabled data-id="select"></select>
      <textarea disabled data-id="textarea"></textarea>
      <button data-id="ok">ok</button>
    `);
    expect(focusables(host)).toEqual(["ok"]);
  });

  // The exact shape of DoseEditForm: two hidden inputs are the first children,
  // so an unqualified `input` selector made them the focus target and
  // `.focus()` silently did nothing.
  it("picks a real control first in the dose-edit form's shape", () => {
    const host = fixture(`
      <input type="hidden" name="doseId" data-id="doseId" />
      <input type="hidden" name="originalTakenAt" data-id="originalTakenAt" />
      <input type="datetime-local" data-id="takenAt" />
      <button type="submit" data-id="save">Save</button>
    `);
    expect(focusables(host)[0]).toBe("takenAt");
  });

  // Guards the explicit sort in collectFocusable. jsdom's nwsapi returns a
  // selector LIST grouped by fragment, so unsorted this reads back as
  // "two,four,one,three" and the trap's first/last are both wrong — while the
  // same code is correct in a real browser. Without this the suite cannot tell
  // the two apart.
  it("returns document order across different element types", () => {
    const host = fixture(`
      <input type="text" data-id="one" />
      <button data-id="two">two</button>
      <input type="text" data-id="three" />
      <button data-id="four">four</button>
    `);
    expect(focusables(host)).toEqual(["one", "two", "three", "four"]);
  });

  // The delete-account dialog: its submit stays disabled until the confirmation
  // text matches, so it must not be the trap's last element in the meantime.
  it("ends on Cancel while the destructive submit is still disabled", () => {
    const host = fixture(`
      <input type="text" data-id="confirm" />
      <button type="submit" disabled data-id="delete">Delete Permanently</button>
      <button type="button" data-id="cancel">Cancel</button>
    `);
    const items = focusables(host);
    expect(items).not.toContain("delete");
    expect(items[items.length - 1]).toBe("cancel");
  });
});

describe("nextTrapIndex", () => {
  it("does nothing when there is nothing to focus", () => {
    expect(nextTrapIndex(0, -1, false)).toBeNull();
  });

  // Focus starts outside on every open. A trap that only handled the two edge
  // indices was inert for the dialog's whole lifetime.
  it("pulls focus in from outside, at the end Tab is heading for", () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });

  it("wraps at both ends", () => {
    expect(nextTrapIndex(3, 0, true)).toBe(2);
    expect(nextTrapIndex(3, 2, false)).toBe(0);
  });

  it("leaves the browser alone in the middle of the range", () => {
    expect(nextTrapIndex(3, 1, false)).toBeNull();
    expect(nextTrapIndex(3, 1, true)).toBeNull();
    expect(nextTrapIndex(3, 0, false)).toBeNull();
    expect(nextTrapIndex(3, 2, true)).toBeNull();
  });

  it("wraps a single-element trap onto itself", () => {
    expect(nextTrapIndex(1, 0, false)).toBe(0);
    expect(nextTrapIndex(1, 0, true)).toBe(0);
  });
});

describe("trapTab", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // Attached to the document because .focus() only takes effect on a node that
  // is in the tree — the detached fixtures above are enough for matching, but
  // not for focus.
  function attached(html: string): HTMLElement {
    const host = document.createElement("div");
    host.tabIndex = -1;
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  }

  const tabEvent = (shiftKey = false) =>
    new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true, bubbles: true });

  // An aria-modal dialog must never hand focus to the page behind it. With
  // nothing tabbable inside, nextTrapIndex has no index to return, so doing
  // nothing let Tab walk straight out of the dialog.
  it("holds focus on the container when nothing inside is tabbable", () => {
    const host = attached(`<p>nothing focusable</p><input type="hidden" />`);
    const event = tabEvent();

    trapTab(host, event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host);
  });

  it("wraps forward from the last control to the first", () => {
    const host = attached(`<button data-id="a">a</button><button data-id="b">b</button>`);
    host.querySelector<HTMLElement>('[data-id="b"]')!.focus();
    const event = tabEvent();

    trapTab(host, event);

    expect(event.defaultPrevented).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.id).toBe("a");
  });

  it("wraps backward from the first control to the last", () => {
    const host = attached(`<button data-id="a">a</button><button data-id="b">b</button>`);
    host.querySelector<HTMLElement>('[data-id="a"]')!.focus();
    const event = tabEvent(true);

    trapTab(host, event);

    expect(event.defaultPrevented).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.id).toBe("b");
  });

  it("pulls focus back in when it has escaped the container", () => {
    const host = attached(`<button data-id="a">a</button><button data-id="b">b</button>`);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const event = tabEvent();

    trapTab(host, event);

    expect(event.defaultPrevented).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.id).toBe("a");
  });

  it("lets the browser move focus in the middle of the range", () => {
    const host = attached(
      `<button data-id="a">a</button><button data-id="b">b</button><button data-id="c">c</button>`,
    );
    host.querySelector<HTMLElement>('[data-id="b"]')!.focus();
    const event = tabEvent();

    trapTab(host, event);

    expect(event.defaultPrevented).toBe(false);
  });
});
