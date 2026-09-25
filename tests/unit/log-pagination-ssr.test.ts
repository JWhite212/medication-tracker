// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. Same
// reason as tests/unit/appearance-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";

// Mocked ONCE, with an object the tests repoint between renders. Re-mocking
// per case reloads svelte's server internals, whose SSR context is
// module-level state (see tests/unit/error-page-ssr.test.ts).
const pageState = { url: new URL("https://medtracker.test/log") };
vi.mock("$app/state", () => ({ page: pageState }));

// Each dose row's delete form imports `enhance` and the toast store; neither
// is reachable on the server and neither is what these assertions are about.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: LogPage } = await import("../../src/routes/(app)/log/+page.svelte");

/**
 * The dose log's pagination has to page through the result set the user is
 * looking at, and a filtered view has to offer a way back out.
 *
 * Previous/Next were a bare `?page=N`. A relative URL made only of a query
 * replaces the current query rather than merging into it, so page 2 of a
 * filtered history was page 2 of every dose, and the filter bar reset with
 * it. The filtered empty state told the user to "try clearing one or more
 * filters" and gave them nothing to press.
 */

const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "dark",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

// Contributed by the (app) layout load. The page never reads it, but
// svelte-check types the fixture against the merged PageData.
const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

type Status = "any" | "taken" | "skipped" | "missed";

type Filters = {
  medication: string | null;
  from: string | null;
  to: string | null;
  status: Status;
  withSideEffects: boolean;
  q: string;
};

const NO_FILTERS: Filters = {
  medication: null,
  from: null,
  to: null,
  status: "any",
  withSideEffects: false,
  q: "",
};

const DOSE = {
  id: "d1",
  userId: "u1",
  medicationId: "m1",
  quantity: 1,
  takenAt: new Date("2026-04-10T08:00:00Z"),
  loggedAt: new Date("2026-04-10T08:00:00Z"),
  updatedAt: new Date("2026-04-10T08:00:00Z"),
  notes: null,
  sideEffects: null,
  status: "taken" as const,
  medication: {
    name: "Ibuprofen",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    colour: "#ffffff",
    colourSecondary: null,
    pattern: "solid",
  },
};

/**
 * Render the page as it would load at `pathAndQuery`. `filters` is what the
 * server load would have parsed out of that same query; the two are passed
 * separately because the page reads the filters from `data` and the URL from
 * `page.url`, and in production they always agree.
 */
function renderAt(
  pathAndQuery: string,
  {
    page = 1,
    hasMore = false,
    filters = NO_FILTERS,
    doses = [DOSE],
  }: { page?: number; hasMore?: boolean; filters?: Filters; doses?: (typeof DOSE)[] } = {},
): string {
  pageState.url = new URL(pathAndQuery, "https://medtracker.test");
  return render(LogPage, {
    props: {
      data: {
        user,
        preferences,
        doses,
        medications: [{ id: "m1", name: "Ibuprofen", colour: "#ffffff" }],
        page,
        hasMore,
        filters,
        timezone: "UTC",
      },
    },
  }).body;
}

/** The opening tag of the first `<a>` whose attributes match `attr`. */
function anchorWith(html: string, attr: RegExp): string | undefined {
  return html.match(new RegExp(`<a\\b[^>]*${attr.source}[^>]*>`))?.[0];
}

/** An anchor's href, unescaped and resolved the way the browser would. */
function resolvedHref(tag: string | undefined): URL {
  const raw = tag?.match(/href="([^"]*)"/)?.[1];
  expect(raw, "anchor has no href").toBeDefined();
  return new URL(raw!.replaceAll("&amp;", "&"), pageState.url);
}

/** The GET filter form, from its opening tag to its close. */
function filterForm(html: string): string {
  const start = html.search(/<form\b[^>]*method="GET"/);
  expect(start, "no GET filter form rendered").toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</form>", start) + "</form>".length);
}

describe("dose log pagination", () => {
  const FILTERED: Filters = {
    medication: "m1",
    from: "2026-04-01",
    to: "2026-04-15",
    status: "skipped",
    withSideEffects: true,
    q: "felt dizzy",
  };
  const FILTERED_QUERY =
    "medication=m1&status=skipped&from=2026-04-01&to=2026-04-15&q=felt+dizzy&withSideEffects=1";

  it("keeps every filter on Next and only moves the page", () => {
    const html = renderAt(`/log?${FILTERED_QUERY}&page=2`, {
      page: 2,
      hasMore: true,
      filters: FILTERED,
    });
    const next = resolvedHref(anchorWith(html, /rel="next"/));

    expect(next.pathname).toBe("/log");
    expect(next.searchParams.get("medication")).toBe("m1");
    expect(next.searchParams.get("status")).toBe("skipped");
    expect(next.searchParams.get("from")).toBe("2026-04-01");
    expect(next.searchParams.get("to")).toBe("2026-04-15");
    expect(next.searchParams.get("q")).toBe("felt dizzy");
    expect(next.searchParams.get("withSideEffects")).toBe("1");
    expect(next.searchParams.getAll("page")).toEqual(["3"]);
  });

  it("keeps every filter on Previous, and drops the page param back to page 1", () => {
    const html = renderAt(`/log?${FILTERED_QUERY}&page=2`, {
      page: 2,
      hasMore: true,
      filters: FILTERED,
    });
    const prev = resolvedHref(anchorWith(html, /rel="prev"/));

    expect(prev.pathname).toBe("/log");
    expect(prev.searchParams.get("medication")).toBe("m1");
    expect(prev.searchParams.get("status")).toBe("skipped");
    expect(prev.searchParams.get("q")).toBe("felt dizzy");
    expect(prev.searchParams.has("page")).toBe(false);
  });

  it("keeps a search term with URL metacharacters intact across pages", () => {
    const q = "50% & rising + nausea";
    const html = renderAt(`/log?${new URLSearchParams({ q })}`, {
      hasMore: true,
      filters: { ...NO_FILTERS, q },
    });

    expect(resolvedHref(anchorWith(html, /rel="next"/)).searchParams.get("q")).toBe(q);
  });

  it("gives both links the control boundary, not the decorative hairline", () => {
    // They are interactive controls; `glass-border` is 1.33:1 and cannot
    // meet WCAG 1.4.11's 3:1 for a control's resting boundary.
    const html = renderAt(`/log?page=2`, { page: 2, hasMore: true });

    for (const rel of ["prev", "next"]) {
      const tag = anchorWith(html, new RegExp(`rel="${rel}"`));
      expect(tag, `no rel="${rel}" link`).toBeDefined();
      expect(tag).toContain("border-border-strong");
      expect(tag).not.toContain("border-glass-border");
    }
  });

  it("keeps the landmark and the links' accessible names", () => {
    const html = renderAt(`/log?page=2`, { page: 2, hasMore: true });

    expect(html).toContain('aria-label="Dose history pagination"');
    expect(anchorWith(html, /rel="prev"/)).toContain('aria-label="Go to previous page"');
    expect(anchorWith(html, /rel="next"/)).toContain('aria-label="Go to next page"');
  });
});

describe("the filter form resets pagination", () => {
  it("carries no page control, so submitting a filter starts again from page 1", () => {
    // A GET form's submission builds its query from its own controls and
    // nothing else, which is the whole mechanism: a filter change on page 5
    // of a larger result set must not keep you on page 5 of a smaller one.
    // A hidden `page` input added "for consistency" would quietly undo it.
    const form = filterForm(renderAt(`/log?status=taken&page=5`, { page: 5 }));

    expect(form).not.toMatch(/name="page"/);
  });
});

describe("Clear filters", () => {
  const ACTIVE: Array<[string, string, Partial<Filters>]> = [
    ["a medication", "medication=m1", { medication: "m1" }],
    ["a status", "status=missed", { status: "missed" }],
    ["a from date", "from=2026-04-01", { from: "2026-04-01" }],
    ["a to date", "to=2026-04-15", { to: "2026-04-15" }],
    ["the side-effects toggle", "withSideEffects=1", { withSideEffects: true }],
    ["a search", "q=dizzy", { q: "dizzy" }],
  ];

  it.each(ACTIVE)("is offered in the filter bar when %s is active", (_label, query, active) => {
    const form = filterForm(renderAt(`/log?${query}`, { filters: { ...NO_FILTERS, ...active } }));

    expect(form, "no Clear filters link in the filter bar").toMatch(
      /<a\b[^>]*href="\/log"[^>]*>\s*Clear filters\s*<\/a>/,
    );
  });

  it("is not offered when nothing is filtered", () => {
    // Pins the other half of "only when active". The page decides from
    // `data.filters`, so what is pinned here is that its defaults (including
    // `status: "any"`, which filters nothing) count as no filter, and that
    // being past page 1 is not a filter either. Reading `?status=any` into
    // that default is the server load's job, not this component's.
    for (const query of ["", "?page=2"]) {
      const html = renderAt(`/log${query}`, { page: query === "?page=2" ? 2 : 1 });
      expect(html, `offered for "${query}"`).not.toContain("Clear filters");
    }
  });

  it("is the filtered empty state's action", () => {
    const html = renderAt(`/log?q=zzz-no-match-zzz`, {
      doses: [],
      filters: { ...NO_FILTERS, q: "zzz-no-match-zzz" },
    });

    // Scoped to what follows the form so the filter bar's own link cannot
    // satisfy the assertion.
    const afterForm = html.slice(html.indexOf("</form>"));
    expect(afterForm).toContain("No doses match these filters");
    expect(afterForm).toMatch(/<a\b[^>]*href="\/log"[^>]*>\s*Clear filters\s*<\/a>/);
  });

  it("leaves the first-run empty state's action alone", () => {
    const html = renderAt(`/log`, { doses: [] });

    expect(html).toContain("No dose history yet");
    expect(html).toMatch(/<a\b[^>]*href="\/dashboard"[^>]*>\s*Log a dose\s*<\/a>/);
    expect(html).not.toContain("Clear filters");
  });
});
