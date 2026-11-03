// Edit mode's toolbar is sticky at the bottom of the (app) layout's scroll
// container, `main#main-content`, and nothing else reserved its height: a
// control scrolled into view by Tab could sit entirely under it (WCAG 2.2
// 2.4.11, Focus Not Obscured). The reserve is `scroll-padding-bottom` on
// that container while the toolbar exists, and it is only right if it is
// the toolbar's own minimum height (rem, so it scales with the text size like
// the h-11 controls inside it) plus main's bottom padding, because a sticky
// element sticks inside the padding box. This test holds the CSS reserve to
// both, at each breakpoint. Whether a real browser honours it — `:has()`,
// sticky, the safe area — needs a real-browser check; jsdom lays nothing out.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import EditToolbar from "../../src/lib/components/dashboard/EditToolbar.svelte";

const css = readFileSync(resolve(__dirname, "../../src/app.css"), "utf8");

const layout = readFileSync(resolve(__dirname, "../../src/routes/(app)/+layout.svelte"), "utf8");

/** Tailwind's md and lg breakpoints, which the layout's md:/lg: classes use. */
const BREAKPOINTS = { md: "48rem", lg: "64rem" } as const;

const RULE = String.raw`main:has\(\[data-edit-toolbar\]\)\s*\{\s*scroll-padding-bottom:\s*calc\(\s*([\d.]+)rem\s*\+\s*([\d.]+)rem\s*\+\s*env\(safe-area-inset-bottom\)\s*\);?\s*\}`;

/** Toolbar height and main's bottom padding, in rem, for each breakpoint. */
function reserve() {
  const read = (source: string) => {
    const m = source.match(new RegExp(RULE));
    return m ? { bar: Number(m[1]), padding: Number(m[2]) } : null;
  };
  const media = (min: string) => {
    const m = css.match(
      new RegExp(String.raw`@media\s*\(min-width:\s*${min}\)\s*\{\s*(${RULE})\s*\}`),
    );
    return m ? read(m[1]) : null;
  };
  return { base: read(css), md: media(BREAKPOINTS.md), lg: media(BREAKPOINTS.lg) };
}

/** main's bottom padding in rem, read off the layout's own p-N classes. */
function layoutPadding() {
  const main = layout.match(/<main id="main-content" class="([^"]*)"/);
  const classes = main ? main[1].split(/\s+/) : [];
  const rem = (prefix: string) => {
    const hit = classes.find((c) => new RegExp(`^${prefix}p-\\d+$`).test(c));
    return hit ? Number(hit.split("p-")[1]) / 4 : null;
  };
  return {
    base: rem(""),
    md: rem("md:"),
    lg: rem("lg:"),
    // A pb-* would override p-* at that breakpoint, and the reserve would
    // silently stop matching.
    overrides: classes.filter((c) => /(^|:)pb-/.test(c)),
  };
}

let teardown: (() => void) | undefined;
afterEach(() => teardown?.());

describe("the edit toolbar's scroll reserve", () => {
  it("app.css gives the scroll container scroll-padding-bottom while a toolbar exists, at every breakpoint", () => {
    const r = reserve();
    expect(r.base, "main:has([data-edit-toolbar]) { scroll-padding-bottom: … }").not.toBeNull();
    expect(r.md, "@media (min-width: 48rem) override").not.toBeNull();
    expect(r.lg, "@media (min-width: 64rem) override").not.toBeNull();
  });

  it("the layout's scroll container is the <main> the rule names", () => {
    expect(layout).toMatch(/<main id="main-content" class="[^"]*\boverflow-y-auto\b/);
  });

  it("the reserve at each breakpoint is the bar's height plus main's bottom padding", () => {
    const pad = layoutPadding();
    expect(pad.overrides, "a pb-* on <main> needs its own reserve").toEqual([]);
    const r = reserve();
    // A sticky element sticks inside the scroll container's padding box, so
    // its bottom sits main's padding above the scrollport edge, while
    // scroll-padding is measured from that edge.
    expect(r.base?.padding).toBe(pad.base);
    expect(r.md?.padding).toBe(pad.md);
    expect(r.lg?.padding).toBe(pad.lg);
  });

  it("the toolbar's bar has the minimum height the reserve names", () => {
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
    const r = reserve();
    expect(new Set([r.base?.bar, r.md?.bar, r.lg?.bar]).size).toBe(1);
    expect(heights).toEqual([`min-h-${r.base!.bar * 4}`]);
  });
});
