// @vitest-environment node
//
// `node` is load-bearing for the reason tests/unit/appearance-page-ssr.test.ts
// gives: under jsdom vite resolves `svelte` to its client entry and `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs.
//
// The two shared first-run surfaces, server-rendered: EmptyState's action and
// OnboardingWelcome's first step are Button links of the standard 44px height.
// The later steps of the walk-through are reachable only by clicking, so they
// are pinned in onboarding-welcome.svelte.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import EmptyState from "../../src/lib/components/EmptyState.svelte";
import OnboardingWelcome from "../../src/lib/components/OnboardingWelcome.svelte";
import { expectClasses } from "./helpers/alert-dom";
import { expectAxeClean, ssrDocument, withoutComments } from "./helpers/axe-ssr";
import { buttonNamed, textOf } from "./helpers/dom-names";

describe("EmptyState", () => {
  it("renders its action as a 44px primary Button link whose text is the label", () => {
    const html = withoutComments(
      render(EmptyState, {
        props: {
          title: "No doses match these filters",
          action: { href: "/log", label: "Clear filters" },
        },
      }).body,
    );
    expect(html).toMatch(/<a\b[^>]*href="\/log"[^>]*>\s*Clear filters\s*<\/a>/);
    expect(html).not.toContain("<button");
    expectClasses(
      ssrDocument(html).querySelector('a[href="/log"]')!,
      "h-11 bg-accent text-accent-fg",
    );
  });
  it("renders no action without one", () => {
    expect(
      ssrDocument(render(EmptyState, { props: { title: "Nothing" } }).body).querySelector(
        "a, button",
      ),
    ).toBeNull();
  });
});

describe("OnboardingWelcome (first step, as SSR draws it)", () => {
  const doc = () => ssrDocument(render(OnboardingWelcome).body);
  it("draws its two first-step actions as 44px Buttons", () => {
    const add = doc().querySelector('a[href="/medications/new"]')!;
    expect(textOf(add)).toBe("Add your first medication");
    expectClasses(add, "h-11 bg-accent text-accent-fg");
    const more = buttonNamed(doc(), "Learn more first");
    expect(more.type).toBe("button");
    expectClasses(more, "h-11 text-text-secondary");
  });
  it("leaves the step dots bespoke", () => {
    const dots = doc().querySelectorAll('button[aria-label^="Go to step"]');
    expect(dots).toHaveLength(3);
    for (const dot of dots) expectClasses(dot, "h-6 min-w-6");
  });
  it("passes axe", async () => {
    await expectAxeClean(doc(), ["button-name", "link-name", "nested-interactive"]);
  });
});
