// OnboardingWelcome is the whole dashboard for an account with no active
// medications, so it owns two focus duties the rest of the (app) pages meet
// with their own h1 (tests/unit/page-heading-owner.test.ts):
//
// - The page has exactly one h1, with tabindex="-1", so `pageHeading()` — the
//   last resort for focus after an Undo offer that survived navigation —
//   finds something it can focus. It used to render only h2s.
// - Learn more first, Next and Back sit inside the step they replace, so
//   pressing one removes the focused button. Focus used to drop to <body>;
//   it now parks on the new step's h1, and only when it was lost.
import { describe, it, expect, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import OnboardingWelcome from "$lib/components/OnboardingWelcome.svelte";
import { pageHeading } from "$lib/components/dose-writes/focus-after";
import { buttonNamed, textOf } from "./helpers/dom-names";

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
  for (const app of mounted.splice(0)) unmount(app);
  document.body.replaceChildren();
});

function mountWelcome() {
  const target = document.body.appendChild(document.createElement("div"));
  mounted.push(mount(OnboardingWelcome, { target }));
  flushSync();
  return target;
}

/** Focus a control and press it the way a keyboard user does. */
async function press(button: HTMLButtonElement) {
  button.focus();
  expect(document.activeElement).toBe(button);
  button.click();
  flushSync();
  await tick();
}

function onlyH1(target: HTMLElement): HTMLElement {
  const h1s = [...target.querySelectorAll<HTMLElement>("h1")];
  expect(h1s).toHaveLength(1);
  expect(h1s[0].getAttribute("tabindex")).toBe("-1");
  return h1s[0];
}

describe("OnboardingWelcome focus", () => {
  it("renders exactly one focusable h1 on every step, and pageHeading() finds it", async () => {
    const target = mountWelcome();
    expect(textOf(onlyH1(target))).toBe("Welcome to MedTracker");
    expect(pageHeading()).toBe(onlyH1(target));
    await press(buttonNamed(target, "Learn more first"));
    expect(textOf(onlyH1(target))).toBe("Two ways to track");
    await press(buttonNamed(target, "Next"));
    expect(textOf(onlyH1(target))).toBe("Your dashboard at a glance");
    expect(pageHeading()).toBe(onlyH1(target));
  });

  it("moves focus to the new step's h1 when the pressed button goes with its step", async () => {
    const target = mountWelcome();

    await press(buttonNamed(target, "Learn more first"));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(onlyH1(target));
    expect(textOf(document.activeElement!)).toBe("Two ways to track");

    await press(buttonNamed(target, "Next"));
    expect(document.activeElement).toBe(onlyH1(target));
    expect(textOf(document.activeElement!)).toBe("Your dashboard at a glance");

    await press(buttonNamed(target, "Back"));
    expect(document.activeElement).toBe(onlyH1(target));
    expect(textOf(document.activeElement!)).toBe("Two ways to track");

    await press(buttonNamed(target, "Back"));
    expect(document.activeElement).toBe(onlyH1(target));
    expect(textOf(document.activeElement!)).toBe("Welcome to MedTracker");
  });

  it("leaves focus on a step dot, which persists, instead of pulling it to the heading", async () => {
    const target = mountWelcome();
    const dot = target.querySelector<HTMLButtonElement>('button[aria-label="Go to step 3"]')!;
    await press(dot);
    expect(textOf(onlyH1(target))).toBe("Your dashboard at a glance");
    expect(document.activeElement).toBe(dot);
  });

  it("moves nothing when nothing was focused at the press (Safari focuses no button it taps)", async () => {
    const target = mountWelcome();
    buttonNamed(target, "Learn more first").click();
    flushSync();
    await tick();
    expect(textOf(onlyH1(target))).toBe("Two ways to track");
    expect(document.activeElement).toBe(document.body);
  });
});
