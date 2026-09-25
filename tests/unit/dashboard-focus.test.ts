// After a Due row resolves: the same card's <li> if it survived the reload,
// else the next card that was below it, else (the caller's fallback) the h1.
// Never another write button — a repeated Enter must not log a different
// medication.
import { describe, it, expect, afterEach } from "vitest";
import { focusTargetAfterResolve } from "$lib/components/dashboard/focus-after";
import { DASHBOARD_HEADING_ID, DONE_HEADING_ID } from "$lib/components/dashboard/dom-ids";

function renderCards(...keys: string[]) {
  document.body.innerHTML = keys
    .map((key) => `<li tabindex="-1" data-card-key="${key}"></li>`)
    .join("");
}

afterEach(() => {
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
