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
});
