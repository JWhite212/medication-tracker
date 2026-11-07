// The toast stack is `fixed bottom-4` in the corner of the viewport, and the
// dashboard's edit toolbar is sticky at the bottom of <main>. Nothing kept them
// apart: an Undo offer, which lasts up to ten minutes, sat on top of the
// toolbar's Done and More options, so a keyboard user tabbing to Done focused
// a control the toast hid (WCAG 2.2 2.4.11) and a tap there hit the toast.
// app.css lifts the stack by the toolbar's own scroll reserve while a toolbar
// exists. This test holds that lift to the reserve at every breakpoint, to the
// stack's own resting gap, and to the DOM the selector has to reach: Toast is
// a sibling of <main>, so a `main:has(...)` rule would match nothing.
// Whether a real browser lays it out that way needs a browser; jsdom lays
// nothing out.
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";

vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));

import Toast from "$lib/components/ui/Toast.svelte";
import EditToolbar from "../../src/lib/components/dashboard/EditToolbar.svelte";
import { doseWriteContext } from "./helpers/dashboard-context";

const css = readFileSync(resolve(__dirname, "../../src/app.css"), "utf8");
const toastSource = readFileSync(
  resolve(__dirname, "../../src/lib/components/ui/Toast.svelte"),
  "utf8",
);

const BREAKPOINTS = { md: "48rem", lg: "64rem" } as const;

const SELECTOR = "body:has([data-edit-toolbar]) [data-toast-stack]";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const RESERVE = String.raw`main:has\(\[data-edit-toolbar\]\)\s*\{\s*scroll-padding-bottom:\s*calc\(\s*([\d.]+)rem\s*\+\s*([\d.]+)rem\s*\+\s*env\(safe-area-inset-bottom\)\s*\);?\s*\}`;
const LIFT = String.raw`${esc(SELECTOR)}\s*\{\s*bottom:\s*calc\(\s*([\d.]+)rem\s*\+\s*([\d.]+)rem\s*\+\s*env\(safe-area-inset-bottom\)\s*\+\s*([\d.]+)rem\s*\);?\s*\}`;

type Terms = number[] | null;

/** Each rule's rem terms, unwrapped and inside each breakpoint's media query. */
function terms(rule: string): { base: Terms; md: Terms; lg: Terms; baseIndex: number } {
  const read = (m: RegExpMatchArray | null) => (m ? m.slice(1).map(Number) : null);
  const base = css.match(new RegExp(rule));
  const media = (min: string) => {
    const m = css.match(
      new RegExp(String.raw`@media\s*\(min-width:\s*${min}\)\s*\{\s*(${rule})\s*\}`),
    );
    return m ? read(m[1].match(new RegExp(rule))) : null;
  };
  return {
    base: read(base),
    md: media(BREAKPOINTS.md),
    lg: media(BREAKPOINTS.lg),
    baseIndex: base?.index ?? -1,
  };
}

/** Brace depth at an offset, so a rule moved inside @layer (which loses to the utility) fails. */
function depthAt(index: number) {
  let depth = 0;
  for (const ch of css.slice(0, index).replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

/** The stack's resting bottom offset in rem, off its own bottom-N class. */
function restingGap() {
  const tag = toastSource.match(/<div\s+bind:this=\{stack\}\s+class="([^"]*)"/);
  const cls = tag ? tag[1].split(/\s+/).find((c) => /^bottom-\d+$/.test(c)) : undefined;
  return cls ? Number(cls.split("-")[1]) / 4 : null;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** A fresh container on <body>, removed (with what was mounted in it) after the test. */
function container(mountIn: (target: HTMLElement) => () => void) {
  const target = document.body.appendChild(document.createElement("div"));
  const stop = mountIn(target);
  flushSync();
  cleanups.push(() => {
    stop();
    target.remove();
  });
  return target;
}

describe("the toast stack clears the edit toolbar", () => {
  it("app.css lifts [data-toast-stack] while a toolbar exists, at every breakpoint, unlayered", () => {
    const lift = terms(LIFT);
    expect(lift.base, `${SELECTOR} { bottom: calc(…) }`).not.toBeNull();
    expect(lift.md, "@media (min-width: 48rem) override").not.toBeNull();
    expect(lift.lg, "@media (min-width: 64rem) override").not.toBeNull();
    // Tailwind's bottom-4 lives in @layer utilities; only an unlayered rule
    // beats it whatever the specificity.
    expect(depthAt(lift.baseIndex)).toBe(0);
  });

  it("the lift at each breakpoint is the toolbar's scroll reserve plus the stack's resting gap", () => {
    const lift = terms(LIFT);
    const reserve = terms(RESERVE);
    const gap = restingGap();
    expect(gap, "Toast's stack keeps a bottom-N class").not.toBeNull();
    for (const bp of ["base", "md", "lg"] as const) {
      expect(reserve[bp], `scroll reserve at ${bp}`).not.toBeNull();
      // [bar height, main's bottom padding] then the gap above the bar.
      expect(lift[bp], `lift at ${bp}`).toEqual([...reserve[bp]!, gap]);
    }
  });

  it("the selector reaches the mounted stack while a toolbar exists, and only then", () => {
    const toast = container((target) => {
      const app = mount(Toast, { target, context: doseWriteContext() });
      return () => unmount(app);
    });
    const stack = toast.querySelector<HTMLElement>("[data-toast-stack]");
    expect(stack, "Toast renders [data-toast-stack]").not.toBeNull();
    expect(stack!.matches(SELECTOR)).toBe(false);

    const toolbar = container((target) => {
      const app = mount(EditToolbar, {
        target,
        props: { active: "standard", onpreset: () => {}, ondone: () => {}, onmore: () => {} },
      });
      return () => unmount(app);
    });
    expect(toolbar.querySelector("[data-edit-toolbar]")).not.toBeNull();
    // Toast and the toolbar are siblings, not ancestor and descendant, as in
    // the (app) layout, where Toast sits outside <main>.
    expect(stack!.matches(SELECTOR)).toBe(true);
  });
});
