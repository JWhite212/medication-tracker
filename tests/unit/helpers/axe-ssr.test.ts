import { describe, expect, it } from "vitest";
import { withoutComments } from "./axe-ssr";

describe("withoutComments", () => {
  it("removes Svelte's hydration markers around a snippet", () => {
    expect(withoutComments("<a href='/'><!---->Clear filters<!----></a>")).toBe(
      "<a href='/'>Clear filters</a>",
    );
  });

  it("leaves no comment opener that one pass would have joined back together", () => {
    // Removing the inner `<!---->` in one pass rejoins `<!` and `-- -->` into a
    // fresh comment, so a single replace returns "<!-- -->".
    expect(withoutComments("<!<!---->-- -->x")).toBe("x");
  });
});
