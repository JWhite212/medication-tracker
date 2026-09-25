import { describe, it, expect } from "vitest";
import { hrefForPage } from "$lib/utils/search-params";

/**
 * Pagination has to move through the SAME result set.
 *
 * The dose log's Previous/Next links were a bare `?page=N`, and a relative
 * URL consisting only of a query replaces the current query outright. So
 * page 2 of "Ibuprofen, skipped, notes matching 'nausea'" was page 2 of every
 * dose the user had ever logged, and the filter bar, which renders from the
 * loaded URL, reset to match. Nothing errored; the list was simply wrong.
 */

const ORIGIN = "https://medtracker.test";

function at(pathAndQuery: string): URL {
  return new URL(pathAndQuery, ORIGIN);
}

/** Resolve an href the way the browser will, against the page it sits on. */
function follow(from: URL, href: string): URL {
  return new URL(href, from);
}

describe("hrefForPage", () => {
  it("keeps every filter parameter and sets only the page", () => {
    const url = at("/log?medication=m1&status=skipped&from=2026-04-01&to=2026-04-15");
    const next = follow(url, hrefForPage(url, 2));

    expect(next.pathname).toBe("/log");
    expect(next.searchParams.get("medication")).toBe("m1");
    expect(next.searchParams.get("status")).toBe("skipped");
    expect(next.searchParams.get("from")).toBe("2026-04-01");
    expect(next.searchParams.get("to")).toBe("2026-04-15");
    expect(next.searchParams.get("page")).toBe("2");
  });

  it("carries parameters it has never heard of", () => {
    // It must not be a whitelist of today's filters: a filter added to the
    // form later would otherwise be dropped by pagination all over again.
    const url = at("/log?withSideEffects=1&someFutureFilter=x&page=3");
    const prev = follow(url, hrefForPage(url, 2));

    expect(prev.searchParams.get("withSideEffects")).toBe("1");
    expect(prev.searchParams.get("someFutureFilter")).toBe("x");
  });

  it("replaces the page rather than appending a second one", () => {
    // `append` would leave `page=4&page=5`, and the server reads the FIRST.
    const url = at("/log?status=taken&page=4");
    const next = follow(url, hrefForPage(url, 5));

    expect(next.searchParams.getAll("page")).toEqual(["5"]);
  });

  it("collapses duplicated page params into one", () => {
    const url = at("/log?page=2&status=taken&page=9");
    const next = follow(url, hrefForPage(url, 3));

    expect(next.searchParams.getAll("page")).toEqual(["3"]);
    expect(next.searchParams.get("status")).toBe("taken");
  });

  it("drops the page param entirely for page 1", () => {
    // The server defaults an absent page to 1, and this is the URL the
    // filter form itself produces, so both routes back to the first page
    // land on one URL instead of two.
    const url = at("/log?status=taken&page=2");
    expect(hrefForPage(url, 1)).toBe("/log?status=taken");
  });

  it("returns the bare path, not a dangling '?', when page 1 leaves nothing", () => {
    const url = at("/log?page=2");
    expect(hrefForPage(url, 1)).toBe("/log");
  });

  it("treats anything below 1 as page 1", () => {
    const url = at("/log?q=abc&page=1");
    expect(hrefForPage(url, 0)).toBe("/log?q=abc");
  });

  it("keeps repeated non-page params, in order", () => {
    const url = at("/log?tag=a&tag=b&page=2");
    const next = follow(url, hrefForPage(url, 3));

    expect(next.searchParams.getAll("tag")).toEqual(["a", "b"]);
  });

  it("round-trips a search term containing spaces and URL metacharacters", () => {
    // Every one of these characters means something in a query string. If
    // the helper concatenated rather than encoded, `&` would split the term
    // into a second parameter, `+` would decode as a space, `#` would start a
    // fragment and `%` would be read as the start of an escape.
    const q = "took 2 & felt ok, 50% better? #night +water =done";
    const url = at(`/log?${new URLSearchParams({ q, status: "taken" })}`);
    const next = follow(url, hrefForPage(url, 2));

    expect(next.searchParams.get("q")).toBe(q);
    expect(next.searchParams.get("status")).toBe("taken");
    expect(next.searchParams.get("page")).toBe("2");
    expect(next.hash).toBe("");
  });

  it("round-trips non-ASCII search text", () => {
    const q = "paracétamol ½ comprimé 朝";
    const url = at(`/log?${new URLSearchParams({ q })}`);

    expect(follow(url, hrefForPage(url, 4)).searchParams.get("q")).toBe(q);
  });

  it("does not mutate the URL it was given", () => {
    // `page.url` belongs to the router. Editing its searchParams in place
    // would rewrite the current page's URL object under everything else
    // that reads it.
    const url = at("/log?status=taken&page=2");
    hrefForPage(url, 5);
    hrefForPage(url, 1);

    expect(url.search).toBe("?status=taken&page=2");
  });

  it("drops the fragment and the origin", () => {
    const url = at("/log?status=taken#top");
    expect(hrefForPage(url, 2)).toBe("/log?status=taken&page=2");
  });
});
