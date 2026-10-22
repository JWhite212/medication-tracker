// OnboardingWelcome mounted for real (jsdom, client svelte). Steps 1 and 2 are
// reachable only by clicking, which is why dashboard-chrome-copy.test.ts reads
// source for their copy and why their controls are pinned here, not in SSR.
import { describe, it, expect } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import OnboardingWelcome from "$lib/components/OnboardingWelcome.svelte";
import { expectClasses } from "./helpers/alert-dom";
import { buttonNamed, textOf } from "./helpers/dom-names";

describe("OnboardingWelcome, mounted", () => {
  it("walks the steps with a ghost Back and a primary Next, then a primary Get started link", () => {
    const target = document.body.appendChild(document.createElement("div"));
    const app = mount(OnboardingWelcome, { target });
    flushSync();
    buttonNamed(target, "Learn more first").click();
    flushSync();
    expectClasses(buttonNamed(target, "Back"), "h-11 text-text-secondary");
    const next = buttonNamed(target, "Next");
    expect(next.type).toBe("button");
    expectClasses(next, "h-11 bg-accent text-accent-fg");
    next.click();
    flushSync();
    const start = target.querySelector('a[href="/medications/new"]')!;
    expect(textOf(start)).toBe("Get started");
    expectClasses(start, "h-11 bg-accent text-accent-fg");
    expectClasses(buttonNamed(target, "Back"), "h-11 text-text-secondary");
    unmount(app);
    target.remove();
  });
});
