// The undo registry: the ONE Undo offer, held as module state like Toast's
// list so it outlives the page that made it, and runUndo, which carries out
// a press of it. Rendering and pressing it through Toast is in
// toast-undo.svelte.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  reloadAfterWrite: vi.fn(async (_opts?: { waitForServer?: boolean }) => {}),
}));

// Every mutator is a no-op during SSR. These tests are the browser.
vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({ deserialize: (text: string) => JSON.parse(text) }));
// reload-after-write.test.ts covers the reload itself. Here it is a seam:
// what runUndo asks of it, and when.
vi.mock("$lib/components/dose-writes/reload-after-write", () => ({
  HEALTH_PROBE_BACKOFF_MS: [2_000, 4_000, 8_000, 16_000, 30_000],
  waitForServer: async () => {},
  reloadAfterWrite: (opts?: { waitForServer?: boolean }) => h.reloadAfterWrite(opts),
  reloadDocumentIfUpdated: () => false,
}));

import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import {
  DELETE_ACTION,
  RESTORE_ACTION,
  RESTORED_TOAST,
  UNDO_NETWORK_MESSAGE,
  UNDO_OFFLINE_MESSAGE,
  UNDONE_TOAST,
} from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  clearUndo,
  currentUndo,
  dismissUndo,
  offerUndo,
  rememberFocusBeforeStack,
  resetUndoRegistry,
  runUndo,
  withdrawUndoFor,
  type UndoOfferInput,
} from "$lib/components/dose-writes/undo-registry.svelte";

const NOW = new Date("2026-05-01T13:00:00.000Z");

/** A create's offer: its Undo deletes the dose just logged. */
const CREATE: UndoOfferInput = {
  message: "Metformin 500mg logged at 13:00",
  doseId: "d-new",
  kind: "delete",
  focusTarget: () => null,
};

/** A delete's offer: its Undo restores the dose, keyed on the server's deletedAt. */
const REMOVAL: UndoOfferInput = {
  message: "Dose removed: Paracetamol 500mg at 8:00",
  doseId: "d1",
  kind: "restore",
  deletedAt: "2026-05-01T12:59:30.000Z",
  expiresInMs: 600_000,
  focusTarget: () => null,
};

/** RESTORE_GONE_MESSAGE in src/lib/server/dose-actions.ts (server-only, so not imported). */
const GONE = "Too late to undo. Log it again if you need it.";

const RESTORED = { type: "success", status: 200, data: { success: true, doseId: "d1" } };
const DELETED = { type: "success", status: 200, data: { success: true, doseId: "d-new" } };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** What fetch resolves with for an action's JSON response. */
function respondWith(result: unknown, status = 200): Response {
  return { status, text: async () => JSON.stringify(result) } as unknown as Response;
}

function stubFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  h.reloadAfterWrite.mockReset();
  h.reloadAfterWrite.mockResolvedValue(undefined);
});

afterEach(() => {
  resetUndoRegistry();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("offerUndo and an offer's lifetime", () => {
  it("a create's offer lasts the whole undo window, idle and with no note", () => {
    offerUndo(CREATE);
    const offer = currentUndo();
    expect(offer).toMatchObject({ ...CREATE, running: false, note: null });
    expect(typeof offer?.id).toBe("string");
    expect(offer!.deadline - Date.now()).toBe(DOSE_UNDO_WINDOW_MS);
  });

  it("a delete's offer ends 30s before the server's window closes, so a late press is not refused in flight", () => {
    offerUndo(REMOVAL);
    expect(currentUndo()!.deadline - Date.now()).toBe(600_000 - 30_000);
    offerUndo({ ...REMOVAL, expiresInMs: undefined });
    expect(currentUndo()!.deadline - Date.now()).toBe(DOSE_UNDO_WINDOW_MS - 30_000);
  });

  it("counts a deadline from when the response arrived, not from when the offer is made", () => {
    // The caller offers only after its reload has rendered, which took 5s here.
    const respondedAt = Date.now();
    vi.advanceTimersByTime(5_000);

    offerUndo({ ...CREATE, respondedAt });
    expect(currentUndo()!.deadline).toBe(respondedAt + DOSE_UNDO_WINDOW_MS);

    offerUndo({ ...REMOVAL, respondedAt });
    expect(currentUndo()!.deadline).toBe(respondedAt + 600_000 - 30_000);
    // And it clears then: 5s sooner than an offer timed from the call would.
    vi.advanceTimersByTime(600_000 - 30_000 - 5_000 - 1);
    expect(currentUndo()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(currentUndo()).toBeNull();
  });

  it("clears itself at its deadline, and not a millisecond before", () => {
    offerUndo(CREATE);
    vi.advanceTimersByTime(DOSE_UNDO_WINDOW_MS - 1);
    expect(currentUndo()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(currentUndo()).toBeNull();
  });

  it("holds one offer: a second replaces the first", () => {
    offerUndo(CREATE);
    const first = currentUndo()!.id;
    offerUndo(REMOVAL);
    expect(currentUndo()?.doseId).toBe("d1");
    expect(currentUndo()?.id).not.toBe(first);
  });

  it("withdrawUndoFor clears only an offer naming that dose", () => {
    offerUndo(REMOVAL);
    withdrawUndoFor("d2");
    expect(currentUndo()?.doseId).toBe("d1");
    withdrawUndoFor("d1");
    expect(currentUndo()).toBeNull();
  });

  it("clearUndo and dismissUndo each clear an idle offer", () => {
    offerUndo(CREATE);
    clearUndo();
    expect(currentUndo()).toBeNull();
    offerUndo(CREATE);
    dismissUndo();
    expect(currentUndo()).toBeNull();
  });

  it("a running offer is never replaced, cleared, withdrawn or dismissed, and its deadline waits for it", async () => {
    const response = deferred<Response>();
    stubFetch(response.promise);
    offerUndo({ ...REMOVAL, expiresInMs: 31_000 }); // its deadline is 1s away
    const run = runUndo(createDoseWriteLock());
    await flushMicrotasks();
    const running = currentUndo()!;
    expect(running.running).toBe(true);

    offerUndo(CREATE);
    clearUndo();
    dismissUndo();
    withdrawUndoFor("d1");
    vi.advanceTimersByTime(5_000); // well past its deadline
    expect(currentUndo()?.id).toBe(running.id);

    response.resolve(respondWith(RESTORED));
    await expect(run).resolves.toEqual({
      kind: "settled",
      message: RESTORED_TOAST,
      type: "success",
    });
    expect(currentUndo()).toBeNull();
  });

  it("resetUndoRegistry clears everything, a running offer included, and stops the deadline timer", async () => {
    const response = deferred<Response>();
    stubFetch(response.promise);
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();
    const run = runUndo(lock);
    await flushMicrotasks();
    expect(currentUndo()?.running).toBe(true);

    resetUndoRegistry();
    expect(currentUndo()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // The request still settles: it neither resurrects the offer nor keeps the lock.
    response.resolve(respondWith(RESTORED));
    await run;
    expect(currentUndo()).toBeNull();
    expect(lock.active).toBe(false);
  });
});

describe("runUndo", () => {
  it("a create's Undo posts doseId and forUndo=1 to the absolute deleteDose action, reloads, and settles as 'Undone'", async () => {
    const fetchMock = stubFetch(respondWith(DELETED));
    offerUndo(CREATE);

    const outcome = await runUndo(createDoseWriteLock());

    expect(outcome).toEqual({ kind: "settled", message: UNDONE_TOAST, type: "success" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DELETE_ACTION);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    const body = init?.body as FormData;
    expect(body.get("doseId")).toBe("d-new");
    expect(body.get("forUndo")).toBe("1");
    expect(h.reloadAfterWrite).toHaveBeenCalledOnce();
    expect(h.reloadAfterWrite.mock.calls[0][0]).toBeUndefined();
    expect(currentUndo()).toBeNull();
  });

  it("a delete's Undo posts doseId and deletedAt to the absolute restoreDose action and settles as 'Dose restored'", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    offerUndo(REMOVAL);

    const outcome = await runUndo(createDoseWriteLock());

    expect(outcome).toEqual({ kind: "settled", message: RESTORED_TOAST, type: "success" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESTORE_ACTION);
    const body = init?.body as FormData;
    expect(body.get("doseId")).toBe("d1");
    expect(body.get("deletedAt")).toBe("2026-05-01T12:59:30.000Z");
    expect(body.get("forUndo")).toBeNull();
  });

  it("a refusal from the server (410, too late) reloads and settles with the server's own words", async () => {
    stubFetch(respondWith({ type: "failure", status: 410, data: { error: GONE } }, 410));
    offerUndo(REMOVAL);

    const outcome = await runUndo(createDoseWriteLock());

    expect(outcome).toEqual({ kind: "settled", message: GONE, type: "error" });
    expect(h.reloadAfterWrite).toHaveBeenCalledOnce();
    expect(currentUndo()).toBeNull();
  });

  it("an error with a status below 500 (an expired session) settles with its message", async () => {
    stubFetch(respondWith({ type: "error", error: { message: "Unauthorized" } }, 401));
    offerUndo(REMOVAL);

    const outcome = await runUndo(createDoseWriteLock());

    expect(outcome).toEqual({ kind: "settled", message: "Unauthorized", type: "error" });
    expect(currentUndo()).toBeNull();
  });

  it("a 5xx keeps the offer, idle and retryable, with the error as its note", async () => {
    stubFetch(
      respondWith(
        {
          type: "error",
          error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
        },
        500,
      ),
    );
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();

    const outcome = await runUndo(lock);

    const note = "Something went wrong on our end. (reference a3f10c9e)";
    expect(outcome).toEqual({ kind: "kept", note });
    expect(currentUndo()).toMatchObject({ doseId: "d1", running: false, note });
    expect(h.reloadAfterWrite).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
  });

  it("a request that never completes says the undo may not have gone through, keeps the lock until the server answers, then keeps the offer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      }),
    );
    const reload = deferred();
    h.reloadAfterWrite.mockImplementation(() => reload.promise);
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();

    const run = runUndo(lock);
    await flushMicrotasks();

    expect(h.reloadAfterWrite).toHaveBeenCalledWith({ waitForServer: true });
    expect(currentUndo()).toMatchObject({ running: true, note: UNDO_NETWORK_MESSAGE });
    expect(lock.active).toBe(true);

    reload.resolve();
    await expect(run).resolves.toEqual({ kind: "kept", note: UNDO_NETWORK_MESSAGE });
    expect(currentUndo()).toMatchObject({
      doseId: "d1",
      running: false,
      note: UNDO_NETWORK_MESSAGE,
    });
    expect(lock.active).toBe(false);
  });

  it("an offer whose deadline passed while its request was lost is dropped once the request gives up, with the note as the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      }),
    );
    const reload = deferred();
    h.reloadAfterWrite.mockImplementation(() => reload.promise);
    offerUndo({ ...REMOVAL, expiresInMs: 31_000 }); // its deadline is 1s away

    const run = runUndo(createDoseWriteLock());
    await flushMicrotasks();
    vi.advanceTimersByTime(2_000);
    reload.resolve();

    await expect(run).resolves.toEqual({
      kind: "settled",
      message: UNDO_NETWORK_MESSAGE,
      type: "error",
    });
    expect(currentUndo()).toBeNull();
  });

  it("offline, nothing is sent, no lock is taken, and the offer says Undo will still be here", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    offerUndo(REMOVAL);
    setOnline(false);
    const lock = createDoseWriteLock();

    const outcome = await runUndo(lock);

    expect(outcome).toEqual({ kind: "kept", note: UNDO_OFFLINE_MESSAGE });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lock.busy).toBe(false);
    expect(currentUndo()).toMatchObject({
      doseId: "d1",
      running: false,
      note: UNDO_OFFLINE_MESSAGE,
    });
  });

  it("is refused, sending nothing, while another dose write holds the lock", async () => {
    const fetchMock = stubFetch(respondWith(RESTORED));
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();
    lock.acquire();

    const outcome = await runUndo(lock);

    expect(outcome).toEqual({ kind: "refused" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(currentUndo()).toMatchObject({ doseId: "d1", running: false, note: null });
  });

  it("is refused with no offer to run", async () => {
    await expect(runUndo(createDoseWriteLock())).resolves.toEqual({ kind: "refused" });
  });

  it("holds the lock through the request and the reload — even over a running cooldown — then cools down afresh", async () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release();
    // The create being undone is still cooling down, with 50ms of it left.
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS - 50);
    expect(lock.busy).toBe(true);

    const response = deferred<Response>();
    stubFetch(response.promise);
    const reload = deferred();
    h.reloadAfterWrite.mockImplementation(() => reload.promise);
    offerUndo(CREATE);
    const run = runUndo(lock);

    // Past where the earlier cooldown would have ended: hold() took it over.
    await vi.advanceTimersByTimeAsync(100);
    expect(lock.busy).toBe(true);

    response.resolve(respondWith(DELETED));
    await flushMicrotasks();
    expect(lock.busy).toBe(true); // the reload is still pending

    reload.resolve();
    await run;
    expect(lock.busy).toBe(true); // now cooling down, from this moment
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 1);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
  });

  it("lets go of the lock and the running flag even when the reload throws", async () => {
    stubFetch(respondWith(RESTORED));
    h.reloadAfterWrite.mockRejectedValueOnce(new Error("reload blew up"));
    offerUndo(REMOVAL);
    const lock = createDoseWriteLock();

    await expect(runUndo(lock)).rejects.toThrow("reload blew up");

    expect(lock.active).toBe(false);
    expect(currentUndo()?.running).toBe(false);
  });
});

describe("runUndo — where focus goes", () => {
  beforeEach(() => {
    stubFetch(respondWith(RESTORED));
  });

  it("when focus was lost, to the offer's target", async () => {
    const edit = document.body.appendChild(document.createElement("button"));
    offerUndo({ ...REMOVAL, focusTarget: () => edit });
    await runUndo(createDoseWriteLock());
    expect(document.activeElement).toBe(edit);
  });

  it("with no target, back to where focus was before it entered the toast stack", async () => {
    const search = document.body.appendChild(document.createElement("input"));
    rememberFocusBeforeStack(search);
    offerUndo(REMOVAL);
    await runUndo(createDoseWriteLock());
    expect(document.activeElement).toBe(search);
  });

  it("with neither, to the page's h1", async () => {
    const heading = document.body.appendChild(document.createElement("h1"));
    heading.tabIndex = -1;
    offerUndo(REMOVAL);
    await runUndo(createDoseWriteLock());
    expect(document.activeElement).toBe(heading);
  });

  it("leaves focus that is somewhere real where it is", async () => {
    const edit = document.body.appendChild(document.createElement("button"));
    const search = document.body.appendChild(document.createElement("input"));
    search.focus();
    offerUndo({ ...REMOVAL, focusTarget: () => edit });
    await runUndo(createDoseWriteLock());
    expect(document.activeElement).toBe(search);
  });
});
