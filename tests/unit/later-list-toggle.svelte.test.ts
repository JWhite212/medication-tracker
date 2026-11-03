// Covers: Later's disclosure in a browser-like DOM — that "Show N more"
// reveals every slot in time order with a divider at each group, flips
// aria-expanded and its own label, and folds back. SSR (later-list-ssr.test.ts)
// can only see the first render.
import { describe, it, expect, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import LaterList from "../../src/lib/components/dashboard/LaterList.svelte";
import type { LaterRow } from "$lib/types";

const teardown: Array<() => void> = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

const row = (key: string, hhmm: string): LaterRow => ({
  key,
  medicationId: key,
  name: `Med ${key}`,
  dosageAmount: "10",
  dosageUnit: "mg",
  colour: "#10b981",
  colourSecondary: null,
  pattern: "solid",
  expectedTime: `2026-05-01T${hhmm}:00.000Z`,
});

function mountList(rows: LaterRow[]) {
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(LaterList, {
    target,
    props: {
      rows,
      serverNow: new Date("2026-05-01T07:00:00.000Z"),
      todayStart: new Date("2026-05-01T00:00:00.000Z"),
      timezone: "UTC",
      timeFormat: "24h",
    },
  });
  teardown.push(() => {
    unmount(component);
    target.remove();
  });
  return target;
}

describe("LaterList disclosure", () => {
  it("expands to every slot and folds back to the first group", () => {
    const target = mountList([
      row("a", "08:55"),
      row("b", "09:00"),
      row("c", "11:00"),
      row("d", "13:05"),
      row("e", "13:06"),
    ]);
    const button = target.querySelector("button")!;
    const times = () =>
      [...target.querySelectorAll("li")].map((li) => li.textContent!.trim().split(/\s+/)[0]);

    expect(times()).toEqual(["8:55", "9:00"]);
    expect(button.textContent!.trim()).toBe("Show 3 more");

    button.click();
    flushSync();
    expect(times()).toEqual(["8:55", "9:00", "11:00", "13:05", "13:06"]);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.textContent!.trim()).toBe("Show fewer");
    const starts = [...target.querySelectorAll("li[data-later-group-start]")].map(
      (li) => li.textContent!.trim().split(/\s+/)[0],
    );
    expect(starts).toEqual(["8:55", "11:00", "13:05"]);
    // A divider above every group but the first.
    const bordered = [...target.querySelectorAll("li")].filter((li) =>
      li.classList.contains("border-t"),
    );
    expect(bordered.map((li) => li.textContent!.trim().split(/\s+/)[0])).toEqual([
      "11:00",
      "13:05",
    ]);

    button.click();
    flushSync();
    expect(times()).toEqual(["8:55", "9:00"]);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // Focus stays on the button through both presses: it never unmounts.
    expect(target.contains(button)).toBe(true);
  });
});

describe("LaterList disclosure across a reload", () => {
  // At a slot boundary the dashboard reloads itself; the slots that came due
  // move to Due and Later can shrink to one group, which removes the toggle.
  it("parks focus on the page heading when a reload removes the focused toggle, then starts collapsed", async () => {
    const heading = document.body.appendChild(document.createElement("h1"));
    heading.tabIndex = -1;
    heading.textContent = "Today";
    teardown.push(() => heading.remove());

    const props = $state({
      rows: [row("a", "12:00"), row("b", "12:05"), row("c", "18:00")],
      serverNow: new Date("2026-05-01T11:59:00.000Z"),
      todayStart: new Date("2026-05-01T00:00:00.000Z"),
      timezone: "UTC",
      timeFormat: "24h" as const,
    });
    const target = document.body.appendChild(document.createElement("div"));
    const component = mount(LaterList, { target, props });
    teardown.push(() => {
      unmount(component);
      target.remove();
    });

    const button = target.querySelector("button")!;
    button.focus();
    button.click();
    flushSync();
    expect(document.activeElement).toBe(button);
    expect(button.textContent!.trim()).toBe("Show fewer");

    // 12:00 reload: A and B are Due now, Later is one group.
    props.rows = [row("c", "18:00")];
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(target.querySelector("button")).toBeNull();
    expect(document.activeElement).toBe(heading);

    // Later grows back to two groups: it comes back folded.
    props.rows = [row("c", "18:00"), row("d", "21:00")];
    flushSync();
    const again = target.querySelector("button")!;
    expect(again.textContent!.trim()).toBe("Show 1 more");
    expect(again.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves focus alone when the toggle that disappears did not hold it", async () => {
    const elsewhere = document.body.appendChild(document.createElement("button"));
    teardown.push(() => elsewhere.remove());
    const props = $state({
      rows: [row("a", "12:00"), row("c", "18:00")],
      serverNow: new Date("2026-05-01T11:59:00.000Z"),
      todayStart: new Date("2026-05-01T00:00:00.000Z"),
      timezone: "UTC",
      timeFormat: "24h" as const,
    });
    const target = document.body.appendChild(document.createElement("div"));
    const component = mount(LaterList, { target, props });
    teardown.push(() => {
      unmount(component);
      target.remove();
    });
    elsewhere.focus();
    props.rows = [row("c", "18:00")];
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(elsewhere);
  });
});
