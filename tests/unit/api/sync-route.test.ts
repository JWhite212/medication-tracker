import { describe, it, expect, vi, beforeEach } from "vitest";

// Route-level wiring test: `requireApiUser` and `buildSyncResponse` are
// both fully covered elsewhere (Task 3, tests/unit/api/sync.test.ts) —
// this just proves the route resolves the bearer user, reads `since`
// and `epoch` off the query string, and returns buildSyncResponse's
// result as JSON.
const requireApiUser = vi.fn(async (_request: Request) => ({
  user: { id: "u1" },
  sessionId: "sess-1",
}));
vi.mock("$lib/server/api/auth", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
}));

const state = { rateLimit: { allowed: true, retryAfterMs: 0 } };
const rlCalls: Array<{ key: string; max: number | undefined; windowMs: number | undefined }> = [];
const checkRateLimit = vi.fn(async (key: string, max?: number, windowMs?: number) => {
  rlCalls.push({ key, max, windowMs });
  return state.rateLimit;
});
vi.mock("$lib/server/auth/rate-limit", () => ({
  checkRateLimit: (key: string, max?: number, windowMs?: number) =>
    checkRateLimit(key, max, windowMs),
}));

const buildSyncResponse = vi.fn(async (_userId: string, _since: string | null, _epoch: number) => ({
  epoch: 2,
  fullResync: false,
  serverTime: "2026-01-06T00:00:00.000Z",
  cursor: "2026-01-06T00:00:00.000Z",
  medications: [],
  doseLogs: [],
  inventoryEvents: [],
  auditLogs: [],
  tombstones: [],
  preferences: null,
  profile: null,
}));
vi.mock("$lib/server/api/sync", () => ({
  buildSyncResponse: (userId: string, since: string | null, epoch: number) =>
    buildSyncResponse(userId, since, epoch),
}));

const { GET } = await import("../../../src/routes/api/v1/sync/+server");

beforeEach(() => {
  requireApiUser.mockClear();
  buildSyncResponse.mockClear();
  checkRateLimit.mockClear();
  rlCalls.length = 0;
  state.rateLimit = { allowed: true, retryAfterMs: 0 };
});

describe("GET /api/v1/sync", () => {
  it("resolves the bearer user, threads since/epoch from the query string, and returns the sync response as JSON", async () => {
    const url = new URL("http://x/api/v1/sync?since=2026-01-03T00%3A00%3A00.000Z&epoch=2");
    const request = new Request(url, { headers: { authorization: "Bearer sess-1" } });

    const res = await GET({ request, url } as never);

    expect(requireApiUser).toHaveBeenCalledWith(request);
    expect(buildSyncResponse).toHaveBeenCalledWith("u1", "2026-01-03T00:00:00.000Z", 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ epoch: 2, fullResync: false });
  });

  it("defaults epoch to 0 and since to null when the query string omits them", async () => {
    const url = new URL("http://x/api/v1/sync");
    const request = new Request(url, { headers: { authorization: "Bearer sess-1" } });

    await GET({ request, url } as never);

    expect(buildSyncResponse).toHaveBeenCalledWith("u1", null, 0);
  });

  it("rejects a malformed since parameter with 400 without calling buildSyncResponse", async () => {
    const url = new URL("http://x/api/v1/sync?since=not-a-date");
    const request = new Request(url, { headers: { authorization: "Bearer sess-1" } });

    await expect(GET({ request, url } as never)).rejects.toMatchObject({ status: 400 });
    expect(buildSyncResponse).not.toHaveBeenCalled();
  });

  it("rate-limits per user: returns 429 with Retry-After and does not build the sync response", async () => {
    state.rateLimit = { allowed: false, retryAfterMs: 30_000 };
    const url = new URL("http://x/api/v1/sync");
    const request = new Request(url, { headers: { authorization: "Bearer sess-1" } });

    const res = await GET({ request, url } as never);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    await expect(res.json()).resolves.toEqual({ error: "rate_limited", retryAfterSeconds: 30 });
    expect(rlCalls[0]).toMatchObject({ key: "api-sync:u1", max: 120, windowMs: 60_000 });
    expect(buildSyncResponse).not.toHaveBeenCalled();
  });
});
