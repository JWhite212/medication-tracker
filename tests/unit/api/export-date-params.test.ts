import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";

/**
 * The `from`/`to` window at the two export doors — the clinician-facing
 * CSV/PDF report and the audit export.
 *
 * These params used to be `new Date(dateOnlyString)`, i.e. UTC midnight,
 * beside queries that group in the profile zone. `/log` got a dedicated
 * PGlite suite for the same defect; these two doors shipped the fix with no
 * witness at all, so reverting both left the whole suite green.
 *
 * Both handlers are driven directly with the heavy generators mocked, because
 * what is under test is the window arithmetic and the labels — not PDF bytes.
 */

const generateReport = vi.fn(async () => Buffer.from("pdf"));
const generateCsvReport = vi.fn(async () => "csv");
const getAuditLogForExport = vi.fn(async () => []);
const buildAuditCsv = vi.fn(() => "audit-csv");
const checkRateLimit = vi.fn(async () => ({ allowed: true, retryAfterMs: 0 }));

vi.mock("$lib/server/export-pdf", () => ({ generateReport }));
vi.mock("$lib/server/export-csv", () => ({ generateCsvReport }));
vi.mock("$lib/server/audit-export", () => ({ getAuditLogForExport, buildAuditCsv }));
vi.mock("$lib/server/auth/rate-limit", () => ({ checkRateLimit }));
vi.mock("$lib/server/preferences", () => ({
  getOrCreatePreferences: async () => ({
    exportFormat: "csv",
    timeFormat: "24h",
    dateFormat: "DD/MM/YYYY",
  }),
}));

const { GET: exportGet } = await import("../../../src/routes/api/export/+server");
const { GET: auditGet } = await import("../../../src/routes/api/audit/+server");

function callExport(query: string, timezone = "UTC") {
  return exportGet({
    locals: { user: { id: "u1", timezone, name: "Ada" } },
    url: new URL(`http://x/api/export?${query}`),
  } as never) as Promise<Response>;
}

function callAudit(query: string, timezone = "UTC") {
  return auditGet({
    locals: { user: { id: "u1", timezone } },
    url: new URL(`http://x/api/audit?${query}`),
  } as never) as Promise<Response>;
}

/** The `[from, to]` pair the CSV generator was handed. */
function csvWindow(): [Date, Date] {
  const call = generateCsvReport.mock.calls.at(-1) as unknown as [
    string,
    string,
    Date,
    Date,
    string,
  ];
  return [call[2], call[3]];
}

async function statusOf(promise: Promise<Response>): Promise<number> {
  try {
    return (await promise).status;
  } catch (thrown) {
    return (thrown as { status?: number }).status ?? 500;
  }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("a bare day param is a civil day in the user's timezone", () => {
  it("starts the window at local midnight, not UTC midnight", async () => {
    await callExport("from=2026-04-15&to=2026-04-16", "Europe/London");
    expect(csvWindow()[0].toISOString()).toBe("2026-04-14T23:00:00.000Z");
  });

  it("includes the whole `to` day — the bound is the next day's midnight", async () => {
    // Under the old UTC-midnight bound this window ended at 00:00Z on the
    // 16th, so a London user's report silently omitted the 16th entirely.
    await callExport("from=2026-04-15&to=2026-04-16", "Europe/London");
    expect(csvWindow()[1].toISOString()).toBe("2026-04-16T23:00:00.000Z");
  });

  it("a single-day export is a real one-day window", async () => {
    await callExport("from=2026-04-15&to=2026-04-15", "Europe/London");
    const [from, to] = csvWindow();
    expect(to.getTime() - from.getTime()).toBe(86_400_000);
  });

  it("spans a 25-hour civil day without clipping it", async () => {
    await callExport("from=2026-10-25&to=2026-10-25", "Europe/London");
    const [from, to] = csvWindow();
    expect(to.getTime() - from.getTime()).toBe(25 * 3_600_000);
  });

  it("the same request means different instants in different zones", async () => {
    await callExport("from=2026-04-15&to=2026-04-15", "Pacific/Auckland");
    const auckland = csvWindow()[0].toISOString();
    await callExport("from=2026-04-15&to=2026-04-15", "America/New_York");
    expect(csvWindow()[0].toISOString()).not.toBe(auckland);
  });
});

describe("the filename names the requested civil day", () => {
  it.each([
    ["Europe/London", "medtracker-report-2026-04-01.csv"],
    ["Pacific/Auckland", "medtracker-report-2026-04-01.csv"],
    ["America/New_York", "medtracker-report-2026-04-01.csv"],
  ])("%s", async (timezone, expected) => {
    // `fromDate.toISOString().split("T")[0]` read the day off the instant,
    // which for any user east of UTC is the day BEFORE the one requested.
    const response = await callExport("from=2026-04-01&to=2026-04-10", timezone);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${expected}"`);
  });

  it("the audit export names it the same way", async () => {
    const response = await callAudit("from=2026-04-01&to=2026-04-10", "Pacific/Auckland");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="medtracker-audit-2026-04-01.csv"',
    );
  });
});

describe("the one-year cap counts civil days, not milliseconds", () => {
  it("accepts a 366-day range", async () => {
    expect(await statusOf(callExport("from=2026-01-01&to=2027-01-01"))).toBe(200);
  });

  it("rejects a 368-day range", async () => {
    expect(await statusOf(callExport("from=2026-01-01&to=2027-01-04"))).toBe(400);
  });

  it.each(["UTC", "Europe/London", "America/New_York", "Pacific/Auckland", "Australia/Lord_Howe"])(
    "the same request has the same outcome in %s",
    async (timezone) => {
      // The guard used to compare an instant delta against a fixed
      // 366 x 86,400,000. A range straddling a transition is an hour longer
      // in milliseconds, so the identical request returned 200 in London and
      // 400 in New York — the cap depended on the caller's profile.
      expect(await statusOf(callExport("from=2026-03-09&to=2027-03-09", timezone))).toBe(200);
    },
  );

  it("the audit door has the same cap", async () => {
    expect(await statusOf(callAudit("from=2026-01-01&to=2027-01-01"))).toBe(200);
    expect(await statusOf(callAudit("from=2026-01-01&to=2027-01-04"))).toBe(400);
  });
});

describe("malformed and impossible dates are rejected, not normalised", () => {
  it.each(["from=garbage", "to=garbage", "from=2026-13-99", "from=2026-02-31", "to=2026-04-31"])(
    "%s is a 400",
    async (query) => {
      // A shape-only check would silently normalise 2026-02-31 into 3 March
      // and hand back a report for a window nobody asked for.
      expect(await statusOf(callExport(query))).toBe(400);
    },
  );

  it("an absent param falls back to the default window rather than erroring", async () => {
    expect(await statusOf(callExport(""))).toBe(200);
  });

  it("an inverted range is still rejected", async () => {
    expect(await statusOf(callExport("from=2026-04-20&to=2026-04-10"))).toBe(400);
  });
});
