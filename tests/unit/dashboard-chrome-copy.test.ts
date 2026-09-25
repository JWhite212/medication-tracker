// @vitest-environment node
//
// These assertions read source, because neither component can be rendered
// into the state that matters. `showToast` returns early unless `browser`, so
// SSR never renders a toast, and OnboardingWelcome's step 2 is reachable only
// by clicking. Normalising whitespace makes them indifferent to prettier's
// line wrapping.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8")
    .replace(/\s+/g, " ")
    .replace(/ >/g, ">");
}

describe("Toast", () => {
  it("gives Undo at least a 44px-tall target with side padding, like every other dose control", () => {
    const src = source("src/lib/components/ui/Toast.svelte");
    const start = src.indexOf("{#if toast.undoAction}");
    expect(start, "the Undo block moved: update this test").toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("{/if}", start));
    const classes = /class="([^"]*)"/.exec(block)?.[1].split(" ") ?? [];
    expect(classes).toEqual(expect.arrayContaining(["min-h-11", "px-3"]));
  });
});

describe("OnboardingWelcome step 2", () => {
  const src = source("src/lib/components/OnboardingWelcome.svelte");

  it("describes the dashboard the user will actually get", () => {
    expect(src).toContain(`Due</span> — one tap to log what's due`);
    expect(src).toContain(`Done today</span> — everything you've logged`);
    expect(src).toContain(`Refills</span> — know when to reorder`);
  });

  it("no longer names sections the rebuild removed", () => {
    expect(src).not.toContain("Quick Log");
    expect(src).not.toContain("Today's Timeline");
  });
});
