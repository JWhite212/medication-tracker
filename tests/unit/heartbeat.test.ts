import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutated per-test. The module reads env.HEARTBEAT_URL at call time, so
// a shared mutable object is enough — no getter indirection needed.
const envState: Record<string, string | undefined> = {};
vi.mock("$env/dynamic/private", () => ({ env: envState }));

const { pingHeartbeat, HEARTBEAT_TIMEOUT_MS, MIN_PING_BUDGET_MS } =
  await import("$lib/server/heartbeat");

const VALID = "https://hc-ping.com/0e5f9c2a-0000-4000-8000-000000000000";

function okResponse() {
  return new Response("OK", { status: 200 });
}

beforeEach(() => {
  delete envState.HEARTBEAT_URL;
  vi.restoreAllMocks();
  // Nothing in this suite should reach real console output.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("when HEARTBEAT_URL is not configured", () => {
  // The important half of this behaviour is the *absence* of a request.
  // A preview deployment or a local cron run that pinged production's
  // switch would hold it green and mask a real outage — the monitoring
  // equivalent of disabling the alarm you just installed.
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("reports disabled and sends nothing when %s", async (_label, value) => {
    if (value !== undefined) envState.HEARTBEAT_URL = value;
    const fetchImpl = vi.fn();

    const result = await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual({ status: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("when HEARTBEAT_URL is unusable", () => {
  it.each([
    ["not a URL at all", "not-a-url"],
    ["a bare host", "hc-ping.com/abc"],
  ])("reports invalid-url and sends nothing for %s", async (_label, value) => {
    envState.HEARTBEAT_URL = value;
    const fetchImpl = vi.fn();

    const result = await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.status).toBe("invalid-url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to ping over plaintext http", async () => {
    // The ping URL is the credential on every provider offering this,
    // so sending it in clear would leak the ability to forge heartbeats.
    envState.HEARTBEAT_URL = "http://hc-ping.com/abc";
    const fetchImpl = vi.fn();

    const result = await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual({ status: "invalid-url", reason: "not-https" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("when the ping succeeds", () => {
  beforeEach(() => {
    envState.HEARTBEAT_URL = VALID;
  });

  it("reports sent", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const result = await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ status: "sent" });
  });

  it("issues a GET to the configured URL", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(VALID);
    expect(init.method).toBe("GET");
  });

  it("bounds the request with an abort signal", async () => {
    // The reminder loop is sequential and shares one function budget, so
    // an unbounded monitoring call could park medication reminders
    // behind it. Asserting the signal exists is what stops someone
    // "simplifying" the timeout away.
    const fetchImpl = vi.fn(async () => okResponse());
    await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(HEARTBEAT_TIMEOUT_MS).toBeLessThanOrEqual(4000);
  });
});

describe("when the ping fails", () => {
  beforeEach(() => {
    envState.HEARTBEAT_URL = VALID;
  });

  // The single most important property in this file. Everything above
  // this line in the cron handler has already done the real work by the
  // time the heartbeat runs; letting a monitoring failure propagate
  // would turn a healthy tick into a 500 and, on the next run, into a
  // genuine reminder outage caused entirely by the monitoring.
  it("swallows a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const result = await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ status: "failed", reason: "http-500" });
  });

  it("swallows a transport error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const result = await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ status: "failed", reason: "TypeError" });
  });

  it("swallows a timeout abort", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });
    const result = await pingHeartbeat({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ status: "failed", reason: "TimeoutError" });
  });

  it.each([
    ["a thrown string", () => Promise.reject("boom")],
    ["a rejected null", () => Promise.reject(null)],
  ])("never rejects, even on %s", async (_label, impl) => {
    const result = await pingHeartbeat({ fetchImpl: impl as unknown as typeof fetch });
    expect(result.status).toBe("failed");
  });
});

describe("when the caller is sharing a function budget", () => {
  beforeEach(() => {
    envState.HEARTBEAT_URL = VALID;
  });

  /** Rejects with the abort reason instead of resolving, so the request's own bound ends it. */
  function fetchThatOnlyEndsOnAbort() {
    return vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
  }

  it.each([
    ["below the floor", MIN_PING_BUDGET_MS - 1],
    ["zero", 0],
    ["already overspent", -5000],
  ])("skips without sending when the budget is %s", async (_label, budgetMs) => {
    // Skipping still produces no ping and therefore still alerts, which
    // is correct — a tick this close to its ceiling is unhealthy. What
    // it avoids is *also* overrunning maxDuration and recording a tick
    // that sent every reminder as a failed request.
    const fetchImpl = vi.fn();

    const result = await pingHeartbeat({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budgetMs,
    });

    expect(result).toEqual({ status: "skipped", reason: "insufficient-budget" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends normally when the budget is ample", async () => {
    const fetchImpl = vi.fn(async () => okResponse());

    const result = await pingHeartbeat({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budgetMs: 30_000,
    });

    expect(result).toEqual({ status: "sent" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("bounds the request by the budget when that is tighter than the timeout", async () => {
    // Real elapsed time rather than fake timers: AbortSignal.timeout is
    // driven by the runtime's own timer, and faking all timers is what
    // stalls it. A budget of 300ms must end the request in roughly that,
    // not in HEARTBEAT_TIMEOUT_MS — otherwise the guard is decorative.
    const fetchImpl = fetchThatOnlyEndsOnAbort();
    const startedAt = Date.now();

    const result = await pingHeartbeat({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budgetMs: 300,
    });

    const elapsed = Date.now() - startedAt;
    expect(result.status).toBe("failed");
    expect(elapsed).toBeLessThan(HEARTBEAT_TIMEOUT_MS);
  });
});
