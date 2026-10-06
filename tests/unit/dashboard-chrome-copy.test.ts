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
  it("gives the Undo offer's Undo and Dismiss at least a 44px target, like every other dose control", () => {
    const src = source("src/lib/components/ui/Toast.svelte");
    // Each piece starts just after "<button", so its first class="…" is that
    // button's own: attributes come before children.
    const buttons = src.split("<button").slice(1);
    const undo = buttons.find((piece) => piece.includes("aria-labelledby="));
    const dismiss = buttons.find((piece) => piece.includes('aria-label="Dismiss"'));
    expect(undo, "the Undo button moved: update this test").toBeDefined();
    expect(dismiss, "the Dismiss button moved: update this test").toBeDefined();
    const classes = (piece: string) => /class="([^"]*)"/.exec(piece)?.[1].split(" ") ?? [];
    expect(classes(undo!)).toEqual(expect.arrayContaining(["min-h-11", "px-3"]));
    expect(classes(dismiss!)).toEqual(expect.arrayContaining(["size-11"]));
  });

  it("has no per-toast Undo any more: the one offer lives in the undo registry", () => {
    expect(source("src/lib/components/ui/Toast.svelte")).not.toContain("undoAction");
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
