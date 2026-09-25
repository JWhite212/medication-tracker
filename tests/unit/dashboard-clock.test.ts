// All dashboard client time is server-relative. A device clock that is
// minutes fast must neither reload the page early (in a loop, since every
// reload hands back a nextRefreshAt the device already thinks has passed)
// nor refuse taps near a boundary.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDashboardClock, skewFrom } from "$lib/components/dashboard/dashboard-clock";

const MIN = 60_000;

describe("skewFrom", () => {
  it("is server minus device: a device 10 minutes fast gives minus 10 minutes", () => {
    expect(skewFrom("2026-05-01T12:00:00.000Z", Date.parse("2026-05-01T12:10:00.000Z"))).toBe(
      -10 * MIN,
    );
  });

  it("reads the device clock when none is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T11:59:30.000Z"));
    try {
      expect(skewFrom("2026-05-01T12:00:00.000Z")).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createDashboardClock", () => {
  // The device reads 12:10 while the server's payload says 12:00.
  const FIRST = { now: "2026-05-01T12:00:00.000Z", nextRefreshAt: "2026-05-01T12:30:00.000Z" };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:10:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells the time on the server's clock, not the device's", () => {
    const clock = createDashboardClock(vi.fn(async () => {}));
    clock.sync(FIRST);
    expect(clock.serverNow().toISOString()).toBe("2026-05-01T12:00:00.000Z");
    expect(clock.nextRefreshAt().toISOString()).toBe(FIRST.nextRefreshAt);
    vi.advanceTimersByTime(5 * MIN);
    expect(clock.serverNow().toISOString()).toBe("2026-05-01T12:05:00.000Z");
    clock.dispose();
  });

  it("with a device clock 10 minutes fast, reloads once per nextRefreshAt and never early", async () => {
    const invalidate = vi.fn(async () => {});
    const clock = createDashboardClock(invalidate);
    clock.sync(FIRST);

    // Device 12:35, server 12:25. Comparing the payload with raw Date.now()
    // would reload here — and again after every reload.
    vi.advanceTimersByTime(25 * MIN);
    clock.onVisible();
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * MIN - 1);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // Until a new payload lands, nothing fires again for the same nextRefreshAt.
    clock.onVisible();
    // Async: lets the first reload's promise settle, as it would in a browser,
    // so the next payload's refresh is not coalesced into it.
    await vi.advanceTimersByTimeAsync(MIN);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // The reload lands: device 12:41, server 12:31. Next refresh 13:00 server time.
    clock.sync({ now: "2026-05-01T12:31:00.000Z", nextRefreshAt: "2026-05-01T13:00:00.000Z" });
    vi.advanceTimersByTime(29 * MIN - 1);
    clock.onVisible();
    expect(invalidate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    clock.dispose();
  });

  it("re-arms instead of giving up when the device clock is stepped back under the timer", () => {
    const invalidate = vi.fn(async () => {});
    const clock = createDashboardClock(invalidate);
    clock.sync(FIRST); // timer due in 30 minutes

    // NTP steps the device back five minutes; the pending timer is unaffected.
    vi.setSystemTime(new Date("2026-05-01T12:05:00.000Z"));
    vi.advanceTimersByTime(30 * MIN); // fires at device 12:35 = server 12:25: not yet
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * MIN);
    expect(invalidate).toHaveBeenCalledTimes(1);
    clock.dispose();
  });

  it("coalesces overlapping refreshes into one reload", async () => {
    let finish!: () => void;
    const invalidate = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const clock = createDashboardClock(invalidate);

    const first = clock.refresh();
    const second = clock.refresh();
    expect(invalidate).toHaveBeenCalledTimes(1);

    finish();
    await Promise.all([first, second]);
    void clock.refresh();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("stops its timer on dispose", () => {
    const invalidate = vi.fn(async () => {});
    const clock = createDashboardClock(invalidate);
    clock.sync(FIRST);
    clock.dispose();
    vi.advanceTimersByTime(60 * MIN);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
