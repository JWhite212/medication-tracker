// reloadAfterWrite is how every dose write refreshes the page (spec Section
// 3). It never calls enhance's update(). It waits out a client-side
// navigation already in flight, because an invalidateAll issued mid-navigation
// aborts it. After a failure the network may have caused, it waits until
// /api/health answers. Then it runs exactly one invalidateAll.
//
// The $app/state mock has the real `navigating` shape: every field null while
// idle, and `complete` a promise that rejects when the navigation is aborted
// and never settles when it unloads the document.
//
// Every test that starts waitForServer() lets it finish. A loop left pending
// keeps its `online` and `visibilitychange` listeners, and a later test's
// event would wake it against that test's fetch mock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  invalidateAll: vi.fn(async () => {}),
  navigating: {
    from: null as { url: URL } | null,
    to: null as { url: URL } | null,
    type: null as string | null,
    willUnload: null as boolean | null,
    delta: null as number | null,
    complete: null as Promise<void> | null,
  },
  updated: { current: false, check: async () => false },
}));

vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$app/state", () => ({ navigating: h.navigating, updated: h.updated }));

import {
  HEALTH_PROBE_BACKOFF_MS,
  reloadAfterWrite,
  reloadDocumentIfUpdated,
  waitForServer,
} from "$lib/components/dose-writes/reload-after-write";

/** Enough of a Response for the probe, which reads only `ok`. */
function response(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function makeFetch() {
  return vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => response(200));
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A client-side link navigation, as $app/state reports it while it runs. */
function startNavigation(complete: Promise<void>, willUnload = false) {
  Object.assign(h.navigating, {
    from: { url: new URL("http://localhost/dashboard") },
    to: { url: new URL("http://localhost/log") },
    type: "link",
    willUnload,
    complete,
  });
}

const flush = () => vi.advanceTimersByTimeAsync(0);

let fetchMock: ReturnType<typeof makeFetch>;

beforeEach(() => {
  vi.useFakeTimers();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  Object.assign(h.navigating, {
    from: null,
    to: null,
    type: null,
    willUnload: null,
    delta: null,
    complete: null,
  });
  h.updated.current = false;
  fetchMock = makeFetch();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("reloadAfterWrite", () => {
  it("with nothing in flight and the device online, reloads once, at once, without probing", async () => {
    await reloadAfterWrite();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for a client-side navigation in flight, because invalidateAll would abort it", async () => {
    const nav = deferred();
    startNavigation(nav.promise);
    const done = reloadAfterWrite();
    await flush();
    expect(h.invalidateAll).not.toHaveBeenCalled();

    nav.resolve();
    await done;
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("treats an aborted navigation as settled, not as an error", async () => {
    const nav = deferred();
    startNavigation(nav.promise);
    const done = reloadAfterWrite();
    nav.reject(new Error("navigation aborted"));
    await expect(done).resolves.toBeUndefined();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("does not wait on a navigation that unloads the document, whose promise never settles", async () => {
    startNavigation(new Promise<void>(() => {}), true);
    void reloadAfterWrite();
    await flush();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("offline: holds the reload until the online event, then probes and reloads once", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const done = reloadAfterWrite();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.invalidateAll).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", { onLine: true });
    window.dispatchEvent(new Event("online"));
    await done;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/health", { cache: "no-store" });
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("after a network failure while online, probes /api/health on the backoff and reloads after the first ok", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // t = 0
      .mockResolvedValueOnce(response(503)) // t = 2s
      .mockResolvedValueOnce(response(503)); // t = 6s; ok from t = 14s
    const done = reloadAfterWrite({ waitForServer: true });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(h.invalidateAll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("re-checks for a navigation the user started while it waited for the server", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const done = reloadAfterWrite({ waitForServer: true });
    await flush();

    const nav = deferred();
    startNavigation(nav.promise);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(h.invalidateAll).not.toHaveBeenCalled();

    nav.resolve();
    await done;
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("does not reject when the load itself throws: the next write is re-checked on the server", async () => {
    h.invalidateAll.mockRejectedValueOnce(new Error("load failed"));
    await expect(reloadAfterWrite()).resolves.toBeUndefined();
  });
});

describe("waitForServer", () => {
  it("counts the service worker's synthetic 503 as unreachable", async () => {
    fetchMock.mockResolvedValueOnce(response(503));
    let reached = false;
    const done = waitForServer().then(() => {
      reached = true;
    });
    await flush();
    expect(reached).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(reached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off 2s, 4s, 8s, 16s, then every 30s", async () => {
    expect(HEALTH_PROBE_BACKOFF_MS).toEqual([2_000, 4_000, 8_000, 16_000, 30_000]);
    fetchMock.mockResolvedValue(response(503));
    const done = waitForServer();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (const [i, gap] of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000].entries()) {
      await vi.advanceTimersByTimeAsync(gap - 1);
      expect(fetchMock, `probe ${i + 2} came early`).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock, `probe ${i + 2} is late`).toHaveBeenCalledTimes(i + 2);
    }

    // End the loop, or its listeners outlive this test.
    fetchMock.mockResolvedValue(response(200));
    window.dispatchEvent(new Event("online"));
    await done;
  });

  it("re-probes at once when the page becomes visible, not when it is hidden, and leaves no timer behind", async () => {
    fetchMock.mockResolvedValueOnce(response(503));
    const done = waitForServer();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Back to jsdom's own getter, which reads "visible".
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await done;
    // The 2s backoff timer was cleared when the event woke the loop, not left to fire.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-probes at once on the online event, even though navigator.onLine never went false", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const done = waitForServer();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await done;
  });
});

describe("reloadDocumentIfUpdated", () => {
  it("does nothing, and says so, while this tab runs the current deploy", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    expect(reloadDocumentIfUpdated()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the document once polling has seen a new deploy", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    h.updated.current = true;
    expect(reloadDocumentIfUpdated()).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
