import { describe, it, expect, vi, beforeEach } from "vitest";

// Env is read at call time by isVapidConfigured(), so tests flip these
// between cases rather than re-importing the module.
const envState: Record<string, string | undefined> = {};
vi.mock("$env/dynamic/private", () => ({
  env: new Proxy({} as Record<string, string | undefined>, {
    get: (_target, key: string) => envState[key],
  }),
}));

// Rows handed to successive db.select(...) calls, in order.
const selectQueue: Array<unknown[]> = [];
let deleteCount = 0;

vi.mock("$lib/server/db", () => {
  const makeSelectChain = () => {
    const rows = selectQueue.shift() ?? [];
    const resolve = () => Promise.resolve(rows);
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = resolve;
    chain.then = (onFulfilled: (v: unknown) => unknown) => resolve().then(onFulfilled);
    return chain;
  };
  return {
    db: {
      select: makeSelectChain,
      delete: () => ({
        where: () => {
          deleteCount++;
          return Promise.resolve();
        },
      }),
    },
  };
});

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

const { sendTestPush, sendPushNotification, getPushHealth, describeTestPushResult } =
  await import("../../src/lib/server/push");
const { TEST_PUSH_TAG } = await import("../../src/lib/utils/push");

function subscription(id: string) {
  return {
    id,
    userId: "user-1",
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: "BNcRdreALRFX",
    auth: "tBHItJ",
  };
}

/** An error shaped like the web-push library's rejections. */
function pushError(statusCode: number, message = "push failed") {
  return Object.assign(new Error(message), { statusCode });
}

beforeEach(() => {
  selectQueue.length = 0;
  deleteCount = 0;
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined);
  envState.VAPID_PUBLIC_KEY = "test-public-key";
  envState.VAPID_PRIVATE_KEY = "test-private-key";
});

describe("sendTestPush", () => {
  it("tags the test distinctly so it cannot replace a pending reminder", async () => {
    selectQueue.push([subscription("sub-1")]);

    await sendTestPush("user-1");

    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(payload.tag).toBe(TEST_PUSH_TAG);
    // The service worker's default reminder tag — colliding with it
    // would silently overwrite a real reminder sitting in the tray.
    expect(payload.tag).not.toBe("medication-reminder");
  });

  it("reports no_subscriptions when the user has no registered devices", async () => {
    selectQueue.push([]);

    const result = await sendTestPush("user-1");

    expect(result).toEqual({
      ok: false,
      reason: "no_subscriptions",
      message: expect.any(String),
    });
  });
});

describe("sendPushNotification delivery counts", () => {
  it("reports how many devices were attempted alongside how many delivered", async () => {
    selectQueue.push([subscription("sub-1"), subscription("sub-2"), subscription("sub-3")]);
    sendNotification
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(pushError(500))
      .mockResolvedValueOnce(undefined);

    const result = await sendPushNotification("user-1", { title: "t", body: "b" });

    expect(result).toMatchObject({
      ok: true,
      deliveredCount: 2,
      attemptedCount: 3,
      prunedCount: 0,
    });
  });

  it("counts expired subscriptions it pruned", async () => {
    selectQueue.push([subscription("sub-1"), subscription("sub-2")]);
    sendNotification.mockRejectedValueOnce(pushError(410)).mockResolvedValueOnce(undefined);

    const result = await sendPushNotification("user-1", { title: "t", body: "b" });

    expect(result).toMatchObject({
      ok: true,
      deliveredCount: 1,
      attemptedCount: 2,
      prunedCount: 1,
    });
    expect(deleteCount).toBe(1);
  });

  it("still reports counts when every device failed", async () => {
    selectQueue.push([subscription("sub-1"), subscription("sub-2")]);
    sendNotification.mockRejectedValue(pushError(410));

    const result = await sendPushNotification("user-1", { title: "t", body: "b" });

    expect(result).toMatchObject({
      ok: false,
      reason: "all_failed",
      attemptedCount: 2,
      prunedCount: 2,
    });
  });
});

describe("getPushHealth", () => {
  it("reports device registrations and when reminders last ran for the user", async () => {
    const oldest = new Date("2026-01-04T09:00:00Z");
    const lastReminder = new Date("2026-08-10T07:30:00Z");
    selectQueue.push([{ deviceCount: 2, oldestRegisteredAt: oldest }]);
    selectQueue.push([{ lastReminderAt: lastReminder }]);

    const health = await getPushHealth("user-1");

    expect(health).toEqual({
      vapidConfigured: true,
      deviceCount: 2,
      oldestRegisteredAt: oldest,
      lastReminderAt: lastReminder,
    });
  });

  it("reports zero devices and no reminder history for a fresh account", async () => {
    selectQueue.push([{ deviceCount: 0, oldestRegisteredAt: null }]);
    selectQueue.push([{ lastReminderAt: null }]);

    const health = await getPushHealth("user-1");

    expect(health).toMatchObject({
      deviceCount: 0,
      oldestRegisteredAt: null,
      lastReminderAt: null,
    });
  });

  it("flags the deployment as unconfigured when VAPID keys are missing", async () => {
    delete envState.VAPID_PRIVATE_KEY;
    selectQueue.push([{ deviceCount: 1, oldestRegisteredAt: new Date("2026-01-04T09:00:00Z") }]);
    selectQueue.push([{ lastReminderAt: null }]);

    const health = await getPushHealth("user-1");

    expect(health.vapidConfigured).toBe(false);
  });
});

describe("describeTestPushResult", () => {
  it("names how many devices took delivery when only some did", () => {
    const { ok, message } = describeTestPushResult({
      ok: true,
      deliveredCount: 2,
      attemptedCount: 3,
      prunedCount: 0,
    });

    expect(ok).toBe(true);
    expect(message).toMatch(/2 of 3/);
  });

  it("pluralises the noun that is actually plural when several expired", () => {
    const { message } = describeTestPushResult({
      ok: true,
      deliveredCount: 1,
      attemptedCount: 3,
      prunedCount: 2,
    });

    expect(message).toContain("2 expired device registrations");
    expect(message).not.toContain("devices registrations");
  });

  it("mentions registrations it removed as expired", () => {
    const { message } = describeTestPushResult({
      ok: true,
      deliveredCount: 1,
      attemptedCount: 2,
      prunedCount: 1,
    });

    expect(message).toMatch(/expired/i);
  });

  it("tells the user to enable push when no device is registered", () => {
    const { ok, message } = describeTestPushResult({
      ok: false,
      reason: "no_subscriptions",
      message: "User has no active push subscriptions.",
    });

    expect(ok).toBe(false);
    expect(message).toMatch(/enable push/i);
  });

  it("says push is unavailable on this deployment when VAPID is unset", () => {
    const { ok, message } = describeTestPushResult({
      ok: false,
      reason: "not_configured",
      message: "VAPID keys are not set.",
    });

    expect(ok).toBe(false);
    expect(message).toMatch(/not configured/i);
  });

  it("never leaks endpoints or raw push-service errors to the user", () => {
    const { ok, message } = describeTestPushResult({
      ok: false,
      reason: "all_failed",
      message: "https://fcm.googleapis.com/fcm/send/secret-token rejected: bad encryption header",
      attemptedCount: 2,
      prunedCount: 2,
    });

    expect(ok).toBe(false);
    expect(message).not.toMatch(/fcm\.googleapis\.com/);
    expect(message).not.toMatch(/secret-token/);
    expect(message).not.toMatch(/bad encryption header/);
    // Still has to be useful: the user needs to know how many devices
    // were tried before it gave up.
    expect(message).toMatch(/2/);
  });
});

describe("TEST_PUSH_TAG", () => {
  // The literal, not the constant. Installed service workers compare
  // against the value compiled into them at build time, so changing this
  // string silently breaks the render-confirmation hop on every device
  // that has not picked up the new worker yet.
  it("is the exact string already deployed to installed service workers", () => {
    expect(TEST_PUSH_TAG).toBe("medtracker-test");
  });
});
