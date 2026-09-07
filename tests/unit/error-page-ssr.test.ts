// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. Same
// reason as tests/unit/appearance-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import { writable } from "svelte/store";

// Mocked ONCE, with a writable the tests move between renders. Re-mocking per
// case (vi.resetModules + a fresh dynamic import) reloads svelte's server
// internals, whose SSR context is module-level state — the renderer then
// crashes in `push_element` before reaching any assertion.
const pageState = writable<Record<string, unknown>>({});
vi.mock("$app/stores", () => ({ page: pageState }));

const { default: RootError } = await import("../../src/routes/+error.svelte");
const { default: AppError } = await import("../../src/routes/(app)/+error.svelte");

/**
 * The correlation reference has to actually reach the page.
 *
 * `handleError` minting an id is only half a seam — if the error page never
 * renders it, support still has nothing to quote and the id exists purely for
 * the logs. Both boundaries are checked, because the authenticated one is a
 * separate file from the root one and the two have drifted before.
 */

type ErrorPage = typeof RootError;

function renderWith(Page: ErrorPage, state: Record<string, unknown>): string {
  pageState.set(state);
  return render(Page).body;
}

describe.each([
  ["the root error page", RootError],
  ["the (app) error page", AppError],
])("%s", (_label, Page) => {
  it("shows the reference for an unexpected failure", () => {
    const html = renderWith(Page, {
      status: 500,
      error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
    });

    expect(html).toContain("a3f10c9e");
    expect(html).toContain("Reference");
    expect(html).toContain("Something went wrong on our end.");
  });

  it("shows NO reference for a 404, which never reaches handleError", () => {
    // An `error(404, …)` is expected and bypasses the hook, so there is no id
    // to show and the block must not render an empty one.
    const html = renderWith(Page, { status: 404, error: { message: "Not found" } });

    expect(html).not.toContain("Reference");
    expect(html).toContain("Page not found");
  });

  it("renders without an error object at all", () => {
    const html = renderWith(Page, { status: 500, error: null });

    expect(html).toContain("An unexpected error occurred.");
    expect(html).not.toContain("Reference");
  });

  it("renders the id as selectable code, not prose", () => {
    // It gets read down a phone line or copied out of a screenshot.
    const html = renderWith(Page, {
      status: 500,
      error: { message: "Something went wrong on our end.", errorId: "deadbeef" },
    });

    expect(html).toMatch(/<code[^>]*>\s*deadbeef\s*<\/code>/);
  });
});
