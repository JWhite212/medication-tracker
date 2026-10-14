// @vitest-environment node
//
// `node` is load-bearing: under the suite's default jsdom, vite resolves
// `svelte` to its client entry and `render()` from `svelte/server` throws
// `effect_orphan` (same reason as tests/unit/error-page-ssr.test.ts). The
// reduced-motion mount test needs jsdom, which is why this is its own file.
//
// The walkthrough's accent is the accent a new account gets. The landing page
// renders `<WalkthroughVideo />` with no props, so the prop's default IS what
// every visitor sees, and the prerendered HTML is what they see first. The
// oracle is the Drizzle column default, not a literal: it moved once
// (#6366f1 to #4f46e5, 2026-09-06) and the video was left behind.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";
import { userPreferences } from "$lib/server/db/schema";
import WalkthroughVideo from "$lib/components/walkthrough/WalkthroughVideo.svelte";
import { ssrDocument } from "./helpers/axe-ssr";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** `a: b; c: d` as a map, splitting each declaration on its first colon only. */
function declarations(style: string): Map<string, string> {
  return new Map(
    style
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const colon = part.indexOf(":");
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()] as const;
      }),
  );
}

describe("the walkthrough's accent", () => {
  it("defaults to the accent column's default", () => {
    const accent = userPreferences.accentColor.default;
    // Not vacuous: the oracle is a real colour, not SQL or undefined.
    expect(accent).toMatch(/^#[0-9a-f]{6}$/i);

    // The same style attribute also carries --color-accent-fg, -ink and
    // -hover, so a substring match could be satisfied by the wrong one.
    const doc = ssrDocument(render(WalkthroughVideo).body);
    const themed = [...doc.querySelectorAll("[style]")].filter((el) =>
      declarations(el.getAttribute("style")!).has("--color-accent"),
    );
    expect(themed).toHaveLength(1);
    expect(declarations(themed[0].getAttribute("style")!).get("--color-accent")).toBe(accent);
  });

  it("is rendered by the landing page with no accent prop, so the default is what ships", () => {
    const page = readFileSync(join(repoRoot, "src/routes/+page.svelte"), "utf8");
    expect(page).toContain(
      'import WalkthroughVideo from "$lib/components/walkthrough/WalkthroughVideo.svelte";',
    );
    const tags = page.match(/<WalkthroughVideo\b[^>]*>/g) ?? [];
    expect(tags).toHaveLength(1);
    // Neither `accent=`, the `{accent}` shorthand, nor a spread that could carry one.
    expect(tags[0]).not.toMatch(/\baccent\b|\{\s*\.\.\./);
  });
});
