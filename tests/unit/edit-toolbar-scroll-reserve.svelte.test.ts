// Edit mode's toolbar is sticky at the bottom of the (app) layout's scroll
// container, `main#main-content`, and nothing else reserved its height: a
// control scrolled into view by Tab could sit entirely under it (WCAG 2.2
// 2.4.11, Focus Not Obscured). The reserve is `scroll-padding-bottom` on
// that container while the toolbar exists, and it is only right if it is
// the toolbar's own height. So the bar's height is fixed (rem, so it scales
// with the text size like the h-11 controls inside it), and this test holds
// the CSS reserve to it. Whether a real browser honours it — `:has()`,
// sticky, the safe area — needs a real-browser check; jsdom lays nothing out.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import EditToolbar from "../../src/lib/components/dashboard/EditToolbar.svelte";

const css = readFileSync(resolve(__dirname, "../../src/app.css"), "utf8");

/** The one rule that reserves the toolbar's height, and its rem value. */
function reserve() {
  const match = css.match(
    /main:has\(\[data-edit-toolbar\]\)\s*\{\s*scroll-padding-bottom:\s*calc\(\s*([\d.]+)rem\s*\+\s*env\(safe-area-inset-bottom\)\s*\);?\s*\}/,
  );
  return match ? Number(match[1]) : null;
}

let teardown: (() => void) | undefined;
afterEach(() => teardown?.());

describe("the edit toolbar's scroll reserve", () => {
  it("app.css gives the scroll container scroll-padding-bottom while a toolbar exists", () => {
    expect(reserve(), "main:has([data-edit-toolbar]) { scroll-padding-bottom: … }").not.toBeNull();
  });

  it("the layout's scroll container is the <main> the rule names", () => {
    const layout = readFileSync(
      resolve(__dirname, "../../src/routes/(app)/+layout.svelte"),
      "utf8",
    );
    expect(layout).toMatch(/<main id="main-content" class="[^"]*\boverflow-y-auto\b/);
  });

  it("the toolbar's bar has the fixed height the reserve names", () => {
    const target = document.body.appendChild(document.createElement("div"));
    const app = mount(EditToolbar, {
      target,
      props: { active: "standard", onpreset: () => {}, ondone: () => {}, onmore: () => {} },
    });
    teardown = () => {
      unmount(app);
      target.remove();
    };
    flushSync();
    const bar = target.querySelector<HTMLElement>("[data-edit-toolbar] > div")!;
    const heights = [...bar.classList].filter((c) => /^(min-)?h-/.test(c));
    expect(heights).toEqual([`min-h-${reserve()! * 4}`]);
  });
});
