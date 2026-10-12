// After a write resolves a row: the same row if it survived the reload, else
// the next row that was below it, else (with precedingKeys) the nearest row
// that was above it, else the caller's fallback (the page's h1). Never
// another write button — a repeated Enter must not log a different
// medication. And focus moves only if it was lost.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  focusIfLost,
  focusTargetAfterResolve,
  isFocusLost,
  pageHeading,
} from "$lib/components/dose-writes/focus-after";
import { DASHBOARD_HEADING_ID, DONE_HEADING_ID } from "$lib/components/dashboard/dom-ids";

function renderCards(...keys: string[]) {
  document.body.innerHTML = keys
    .map((key) => `<li tabindex="-1" data-card-key="${key}"></li>`)
    .join("");
}

/** /log-shaped rows: each has a ✎ (`data-edit`) and a ×, and the × must never take focus. */
function renderDoseRows(...ids: string[]) {
  document.body.innerHTML = ids
    .map(
      (id) =>
        `<li data-dose-id="${id}"><button data-edit>Edit ${id}</button><button>Delete ${id}</button></li>`,
    )
    .join("");
}

const editOf = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-edit]");

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("focusTargetAfterResolve", () => {
  it("returns the same card when it survived the reload", () => {
    renderCards("earlier:m1", "today:m1", "today:m2");
    expect(focusTargetAfterResolve("today:m1", ["today:m2"])?.dataset.cardKey).toBe("today:m1");
  });

  it("otherwise returns the first card that was below it and still exists", () => {
    renderCards("earlier:m1", "today:m3");
    expect(focusTargetAfterResolve("today:m2", ["today:m9", "today:m3"])?.dataset.cardKey).toBe(
      "today:m3",
    );
  });

  it("never returns a card that was above it", () => {
    renderCards("earlier:m1");
    expect(focusTargetAfterResolve("today:m2", ["today:m3"])).toBeNull();
  });

  it("names the page's two fixed focus targets", () => {
    expect(DASHBOARD_HEADING_ID).toBe("dashboard-heading");
    expect(DONE_HEADING_ID).toBe("done-heading");
  });
});

describe("focusTargetAfterResolve with options", () => {
  it("finds dose rows by [data-dose-id] when asked, and by [data-card-key] by default", () => {
    document.body.innerHTML = `<li data-card-key="d2"></li><li data-dose-id="d2"></li>`;
    expect(focusTargetAfterResolve("d2", [], { attr: "doseId" })?.dataset.doseId).toBe("d2");
    expect(focusTargetAfterResolve("d2", [])?.dataset.cardKey).toBe("d2");
  });

  it("hands the found row to pick, so a /log row gives its ✎ and never its ×", () => {
    renderDoseRows("d1", "d3");
    const target = focusTargetAfterResolve("d2", ["d3"], { attr: "doseId", pick: editOf });
    expect(target?.textContent).toBe("Edit d3");
  });

  it("tries every following row before any preceding one, and the nearest preceding first", () => {
    const opts = { attr: "doseId" as const, precedingKeys: ["d2", "d1"], pick: editOf };
    renderDoseRows("d1", "d2", "d5");
    expect(focusTargetAfterResolve("d3", ["d4", "d5"], opts)?.textContent).toBe("Edit d5");
    renderDoseRows("d1", "d2");
    expect(focusTargetAfterResolve("d3", ["d4", "d5"], opts)?.textContent).toBe("Edit d2");
  });

  it("skips a row that pick finds nothing in, rather than stopping at it", () => {
    document.body.innerHTML = `<li data-dose-id="d4"></li><li data-dose-id="d5"><button data-edit>Edit d5</button></li>`;
    expect(
      focusTargetAfterResolve("d3", ["d4", "d5"], { attr: "doseId", pick: editOf })?.textContent,
    ).toBe("Edit d5");
  });

  it("returns null when nothing around it survived, leaving the fallback to the caller", () => {
    renderDoseRows("d9");
    expect(
      focusTargetAfterResolve("d3", ["d4"], { attr: "doseId", precedingKeys: ["d2"] }),
    ).toBeNull();
  });

  it("searches only within the root it is given", () => {
    document.body.innerHTML = `<ul id="a"><li data-card-key="k1"></li></ul><ul id="b"></ul>`;
    expect(focusTargetAfterResolve("k1", [], {}, document.getElementById("b")!)).toBeNull();
    expect(focusTargetAfterResolve("k1", [], {}, document.getElementById("a")!)).not.toBeNull();
  });
});

describe("isFocusLost", () => {
  it("is true on <body>", () => {
    document.body.innerHTML = `<button>Other</button>`;
    expect(document.activeElement).toBe(document.body);
    expect(isFocusLost()).toBe(true);
  });

  it("is false on a control still in the page", () => {
    document.body.innerHTML = `<button>Other</button>`;
    document.querySelector("button")!.focus();
    expect(isFocusLost()).toBe(false);
  });

  it("is true inside the toast stack, whose Undo offer is about to go away", () => {
    document.body.innerHTML = `<div data-toast-stack><button>Undo</button></div>`;
    document.querySelector("button")!.focus();
    expect(isFocusLost()).toBe(true);
  });

  it("is true once a reload has removed the focused control", () => {
    document.body.innerHTML = `<button>Log now</button>`;
    const button = document.querySelector("button")!;
    button.focus();
    button.remove();
    expect(isFocusLost()).toBe(true);
  });
});

describe("focusIfLost", () => {
  it("leaves focus where the user put it", () => {
    document.body.innerHTML = `<button id="kept">Kept</button><button id="target">Target</button>`;
    document.getElementById("kept")!.focus();
    focusIfLost(() => document.getElementById("target"));
    expect(document.activeElement?.id).toBe("kept");
  });

  it("otherwise focuses the first candidate that is still in the document", () => {
    document.body.innerHTML = `<button id="target">Target</button>`;
    const detached = document.createElement("button");
    focusIfLost(
      () => null,
      () => detached,
      () => document.getElementById("target"),
    );
    expect(document.activeElement?.id).toBe("target");
  });
});

/**
 * The page heading is where focus parks when nothing nearer to what the user
 * was doing survives, and parking must not scroll: a mouse user's Dismiss, or
 * a kept Undo expiring ten minutes later, threw a long /log back to its top.
 * Every other candidate is a return to where the user was, and a plain
 * focus() is what scrolls it into view. jsdom ignores preventScroll, so the
 * argument is read off a spy.
 */
describe("the page heading as the last resort", () => {
  const spyOnFocus = () => vi.spyOn(HTMLElement.prototype, "focus");
  /** Every focus() call on `el`, by its arguments. */
  function focusCallsOn(spy: ReturnType<typeof spyOnFocus>, el: Element): unknown[][] {
    return spy.mock.calls.filter((_, i) => spy.mock.contexts[i] === el);
  }

  it("pageHeading is the page's h1, and null on a page with none", () => {
    document.body.innerHTML = `<h2>Done</h2>`;
    expect(pageHeading()).toBeNull();
    document.body.innerHTML = `<h2>Done</h2><h1 tabindex="-1">Dose History</h1>`;
    expect(pageHeading()?.textContent).toBe("Dose History");
  });

  it("focusIfLost focuses the heading without scrolling, and any other candidate with a plain focus()", () => {
    document.body.innerHTML = `<h1 tabindex="-1">Today</h1><h2 id="done" tabindex="-1">Done</h2>`;
    const spy = spyOnFocus();
    const heading = pageHeading()!;
    const done = document.getElementById("done")!;

    focusIfLost(() => null, pageHeading);
    expect(document.activeElement).toBe(heading);
    expect(focusCallsOn(spy, heading)).toEqual([[{ preventScroll: true }]]);

    heading.blur();
    focusIfLost(() => done, pageHeading);
    expect(document.activeElement).toBe(done);
    expect(focusCallsOn(spy, done)).toEqual([[]]);
  });

  it("parks the heading without scrolling however a candidate reached it, so a caller's own fallback cannot scroll it", () => {
    // DueCard's and /log's focusAfter end at the page heading themselves.
    document.body.innerHTML = `<h1 id="dashboard-heading" tabindex="-1">Today</h1>`;
    const spy = spyOnFocus();
    const heading = document.getElementById("dashboard-heading")!;

    focusIfLost(() => document.getElementById("dashboard-heading"));

    expect(document.activeElement).toBe(heading);
    expect(focusCallsOn(spy, heading)).toEqual([[{ preventScroll: true }]]);
  });
});
