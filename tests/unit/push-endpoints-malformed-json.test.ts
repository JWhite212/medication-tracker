import { describe, it, expect, vi, beforeEach } from "vitest";
import { isHttpError } from "@sveltejs/kit";
import { fakeDb } from "./helpers/fake-db";

// A malformed JSON body is the client's fault, so the push endpoints must
// answer 400 rather than let request.json()'s SyntaxError escape to
// handleError, which logs it as an unexpected server crash and returns 500.
// The /api/v1 doors already route through readJson for exactly this reason.

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
vi.mock("$lib/server/auth/rate-limit", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/server/auth/rate-limit")>()),
  enforceLimit: vi.fn(async () => ({ allowed: true })),
}));

const subscribe = await import("../../src/routes/api/push/subscribe/+server");
const unsubscribe = await import("../../src/routes/api/push/unsubscribe/+server");

function event(body: string) {
  return {
    request: new Request("http://localhost/api/push/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
    locals: { user: { id: "user-1" }, session: { id: "s" } },
  } as unknown as Parameters<typeof subscribe.POST>[0];
}

async function statusOf(run: () => Promise<Response> | Response): Promise<number | string> {
  try {
    return (await run()).status;
  } catch (e) {
    if (isHttpError(e)) return e.status;
    return `unhandled ${(e as Error)?.name}`;
  }
}

beforeEach(() => fakeDb.reset());

describe("push endpoints reject a malformed JSON body with 400", () => {
  it.each([
    ["subscribe", () => subscribe.POST(event("{not json"))],
    ["unsubscribe", () => unsubscribe.POST(event("{not json"))],
  ])("%s", async (_name, run) => {
    expect(await statusOf(run)).toBe(400);
    expect(fakeDb.attempted).toHaveLength(0);
  });
});
