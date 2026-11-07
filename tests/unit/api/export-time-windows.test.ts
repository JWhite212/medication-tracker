import { rateLimitSurface } from "../helpers/rate-limit";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The civil-day labels at the web export doors: the default window of
 * `/api/export`, the zone the audit CSV's rows are written in, and the
 * backup filename's date. The generators are mocked (the audit builder is
 * the real one) because what is under test is which bounds and which zone
 * each door hands on.
 */

const generateReport = vi.fn(async () => Buffer.from("pdf"));
const generateCsvReport = vi.fn(async () => "csv");
const getAuditLogForExport = vi.fn(async () => [
  {
    createdAt: new Date("2026-05-03T21:00:00Z"),
    entityType: "medication",
    entityId: "med-A",
    action: "update",
    changes: null,
  },
]);
const buildFullExport = vi.fn(async () => ({ ok: true }));
const checkRateLimit = vi.fn(async () => ({ allowed: true, retryAfterMs: 0 }));

vi.mock("$lib/server/export-pdf", () => ({ generateReport }));
vi.mock("$lib/server/export-csv", () => ({ generateCsvReport }));
vi.mock("$lib/server/audit-export", async () => ({
  getAuditLogForExport,
  buildAuditCsv: (await import("../../../src/lib/server/audit-csv")).buildAuditCsv,
}));
vi.mock("$lib/server/api/export", () => ({ buildFullExport }));
vi.mock("$lib/server/auth/rate-limit", () => rateLimitSurface({ primitive: checkRateLimit }));
vi.mock("$lib/server/preferences", () => ({
  getOrCreatePreferences: async () => ({
    exportFormat: "pdf",
    timeFormat: "24h",
    dateFormat: "DD/MM/YYYY",
  }),
}));

const { GET: exportGet } = await import("../../../src/routes/api/export/+server");
const { GET: auditGet } = await import("../../../src/routes/api/audit/+server");
const { GET: fullGet } = await import("../../../src/routes/api/export/full/+server");

const user = (timezone: string) => ({ id: "u1", timezone, name: "Ada" });

function call(handler: unknown, path: string, timezone: string) {
  return (handler as (event: never) => Promise<Response>)({
    locals: { user: user(timezone) },
    url: new URL(`http://x${path}`),
  } as never) as Promise<Response>;
}

/** The `[from, to]` a generator was handed, as ISO strings. */
function windowOf(mock: typeof generateReport | typeof generateCsvReport): [string, string] {
  const args = mock.mock.calls.at(-1) as unknown as [string, string, Date, Date];
  return [args[2].toISOString(), args[3].toISOString()];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/api/export with no from/to: the last 30 civil days", () => {
  it("bounds the PDF by local midnights, ending at today's", async () => {
    // 14:37 on 6 Nov in London (GMT by then, so also 14:37Z).
    vi.setSystemTime(new Date("2026-11-06T14:37:00Z"));
    await call(exportGet, "/api/export?format=pdf", "Europe/London");
    // 7 Oct 00:00 BST is 6 Oct 23:00Z; 6 Nov 00:00 GMT is 00:00Z. The old
    // rolling window started at 2026-10-07T14:37Z, so its first labelled day
    // was missing its morning.
    expect(windowOf(generateReport)).toEqual([
      "2026-10-06T23:00:00.000Z",
      "2026-11-06T00:00:00.000Z",
    ]);
  });

  it("starts the CSV at local midnight and still includes today", async () => {
    vi.setSystemTime(new Date("2026-11-06T14:37:00Z"));
    const res = await call(exportGet, "/api/export?format=csv", "Pacific/Auckland");
    // Auckland: 7 Nov 03:37 local. 30 days back is 8 Oct, NZDT (+13).
    expect(windowOf(generateCsvReport)).toEqual([
      "2026-10-07T11:00:00.000Z",
      "2026-11-06T14:37:00.000Z",
    ]);
    expect(res.headers.get("Content-Disposition")).toContain("medtracker-report-2026-10-08.csv");
  });

  it("an explicit from with no to still ends now", async () => {
    vi.setSystemTime(new Date("2026-11-06T14:37:00Z"));
    const res = await call(exportGet, "/api/export?format=pdf&from=2026-11-06", "Europe/London");
    expect(res.status).toBe(200);
    expect(windowOf(generateReport)).toEqual([
      "2026-11-06T00:00:00.000Z",
      "2026-11-06T14:37:00.000Z",
    ]);
  });
});

describe("/api/audit writes its rows in the account's zone", () => {
  it("an Auckland 09:00 edit on 4 May is dated 4 May, in the file named for 4 May", async () => {
    vi.setSystemTime(new Date("2026-05-10T00:00:00Z"));
    const res = await call(
      auditGet,
      "/api/audit?from=2026-05-04&to=2026-05-04",
      "Pacific/Auckland",
    );
    expect(res.headers.get("Content-Disposition")).toContain("medtracker-audit-2026-05-04.csv");
    expect((await res.text()).split("\r\n")[1]).toBe(
      "2026-05-04,09:00:00,medication,med-A,update,",
    );
  });
});

describe("/api/export/full names the backup for the user's civil date", () => {
  it("09:00 on 7 Nov in Auckland is the 7th, not the UTC 6th", async () => {
    vi.setSystemTime(new Date("2026-11-06T20:00:00Z"));
    const res = await call(fullGet, "/api/export/full", "Pacific/Auckland");
    expect(res.headers.get("Content-Disposition")).toContain("medtracker-backup-2026-11-07.json");
  });
});
