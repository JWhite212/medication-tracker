import { rateLimitSurface } from "./helpers/rate-limit";
import { describe, it, expect, beforeEach, vi } from "vitest";

const updatePreferences = vi.fn(async () => ({}) as never);
const getOrCreatePreferences = vi.fn(async () => ({ userId: "u1" }) as never);
const checkRateLimit = vi.fn(async () => ({ allowed: true, retryAfterMs: 0 }));
const getActiveMedications = vi.fn(async (): Promise<unknown[]> => []);
const getSchedulesForUser = vi.fn(async () => new Map<string, unknown[]>());

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/preferences", () => ({ updatePreferences, getOrCreatePreferences }));
vi.mock("$lib/server/auth/rate-limit", () => rateLimitSurface({ primitive: checkRateLimit }));
vi.mock("$lib/server/medications", () => ({ getActiveMedications }));
vi.mock("$lib/server/schedules", () => ({ getSchedulesForUser }));

const page = await import("../../src/routes/(app)/settings/dashboard/+page.server");
const { load } = page;
const actions = page.actions as Record<string, unknown>;
const appearance = await import("../../src/routes/(app)/settings/appearance/+page.server");

type Handler = (event: never) => Promise<unknown>;
const call = (handler: unknown, fields: Record<string, string>, user: unknown = { id: "u1" }) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return (handler as Handler)({
    request: new Request("http://x/settings/dashboard", { method: "POST", body }),
    locals: { user },
  } as never);
};

beforeEach(() => {
  updatePreferences.mockClear();
  checkRateLimit.mockClear();
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  getActiveMedications.mockReset();
  getActiveMedications.mockResolvedValue([]);
  getSchedulesForUser.mockReset();
  getSchedulesForUser.mockResolvedValue(new Map());
});

describe("the dashboard settings page's actions", () => {
  it("defines exactly the five layout actions and no default", () => {
    expect(Object.keys(actions).sort()).toEqual(
      [
        "dashboardSectionOrder",
        "dashboardShowLater",
        "dashboardShowQuickLog",
        "dashboardShowRefills",
        "resetDashboardLayout",
      ].sort(),
    );
    expect(actions).not.toHaveProperty("default");
  });

  it("saves a posted order as an array, with exactly its key", async () => {
    const result = await call(actions.dashboardSectionOrder, {
      dashboardSectionOrder: "refills,done,later",
    });
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith("u1", {
      dashboardSectionOrder: ["refills", "done", "later"],
    });
    expect(result).toMatchObject({ success: true, key: "dashboardSectionOrder" });
  });

  it('turns the literal "default" into null', async () => {
    await call(actions.dashboardSectionOrder, { dashboardSectionOrder: "default" });
    expect(updatePreferences).toHaveBeenCalledWith("u1", { dashboardSectionOrder: null });
  });

  for (const bad of ["done,done", "due", "done,banana", "header", ""]) {
    it(`400s the order ${JSON.stringify(bad)} without writing`, async () => {
      const result = await call(actions.dashboardSectionOrder, { dashboardSectionOrder: bad });
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 400, data: { key: "dashboardSectionOrder" } });
    });
  }

  it("400s an order longer than the door's string bound", async () => {
    const result = await call(actions.dashboardSectionOrder, {
      dashboardSectionOrder: "done,".repeat(40),
    });
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400 });
  });

  for (const key of ["dashboardShowLater", "dashboardShowQuickLog", "dashboardShowRefills"]) {
    describe(key, () => {
      it('maps "on" to true and "off" to false, with exactly its key', async () => {
        await call(actions[key], { [key]: "on" });
        expect(updatePreferences).toHaveBeenLastCalledWith("u1", { [key]: true });
        await call(actions[key], { [key]: "off" });
        expect(updatePreferences).toHaveBeenLastCalledWith("u1", { [key]: false });
        expect(updatePreferences).toHaveBeenCalledTimes(2);
      });

      for (const bad of ["true", "1", "", "ON"]) {
        it(`400s ${JSON.stringify(bad)}`, async () => {
          const result = await call(actions[key], { [key]: bad });
          expect(updatePreferences).not.toHaveBeenCalled();
          expect(result).toMatchObject({ status: 400, data: { key } });
        });
      }

      it("400s a missing field instead of writing false over the setting", async () => {
        const result = await call(actions[key], {});
        expect(updatePreferences).not.toHaveBeenCalled();
        expect(result).toMatchObject({ status: 400, data: { key } });
      });
    });
  }

  it("400s a mistyped field name (one required key, strict)", async () => {
    const result = await call(actions.dashboardShowLater, { dashboardShowLatr: "on" });
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400 });
  });

  it("400s a second field riding along with the first", async () => {
    const result = await call(actions.dashboardShowLater, {
      dashboardShowLater: "on",
      dashboardShowRefills: "off",
    });
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400 });
  });

  it("resets the layout in ONE write: order to null and every flag on", async () => {
    const result = await call(actions.resetDashboardLayout, {});
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith("u1", {
      dashboardSectionOrder: null,
      dashboardShowLater: true,
      dashboardShowQuickLog: true,
      dashboardShowRefills: true,
    });
    expect(result).toMatchObject({ success: true, key: "resetDashboardLayout" });
  });

  for (const name of [
    "dashboardSectionOrder",
    "dashboardShowLater",
    "dashboardShowQuickLog",
    "dashboardShowRefills",
    "resetDashboardLayout",
  ]) {
    it(`${name} rate-limits per account before writing, and the 429 says when`, async () => {
      checkRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 30_000 });
      const fields: Record<string, string> =
        name === "resetDashboardLayout"
          ? {}
          : { [name]: name === "dashboardSectionOrder" ? "default" : "on" };

      const result = await call(actions[name], fields);

      expect(checkRateLimit).toHaveBeenCalledWith(
        "dashboard-settings:u1",
        expect.any(Number),
        expect.any(Number),
      );
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 429,
        data: { key: name, saveError: expect.any(String), retryAfterMs: 30_000 },
      });
    });

    it(`${name} 401s an anonymous POST before spending any budget`, async () => {
      await expect(call(actions[name], {}, null)).rejects.toMatchObject({ status: 401 });
      expect(checkRateLimit).not.toHaveBeenCalled();
    });
  }
});

describe("the appearance page's time-since action", () => {
  it('saves "72" as the number 72, with exactly its key', async () => {
    const result = await call(appearance.actions.timeSinceDaysFromHours, {
      timeSinceDaysFromHours: "72",
    });
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith("u1", { timeSinceDaysFromHours: 72 });
    expect(result).toMatchObject({ success: true, key: "timeSinceDaysFromHours" });
  });

  it("accepts both ends of the domain, not only the presets", async () => {
    for (const ok of ["24", "60", "168"]) {
      await call(appearance.actions.timeSinceDaysFromHours, { timeSinceDaysFromHours: ok });
      expect(updatePreferences).toHaveBeenLastCalledWith("u1", {
        timeSinceDaysFromHours: Number(ok),
      });
    }
  });

  for (const bad of ["23", "169", "4.5", "", "0", "-48", "1e2", "0048"]) {
    it(`400s ${JSON.stringify(bad)}`, async () => {
      const result = await call(appearance.actions.timeSinceDaysFromHours, {
        timeSinceDaysFromHours: bad,
      });
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 400, data: { key: "timeSinceDaysFromHours" } });
    });
  }

  it("spends the appearance budget, and the 429 carries saveError and retryAfterMs", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 12_000 });
    const result = await call(appearance.actions.timeSinceDaysFromHours, {
      timeSinceDaysFromHours: "72",
    });
    expect(checkRateLimit).toHaveBeenCalledWith(
      "appearance:u1",
      expect.any(Number),
      expect.any(Number),
    );
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 429,
      data: { key: "timeSinceDaysFromHours", saveError: expect.any(String), retryAfterMs: 12_000 },
    });
  });

  it("401s an anonymous POST", async () => {
    await expect(
      call(appearance.actions.timeSinceDaysFromHours, { timeSinceDaysFromHours: "72" }, null),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("the dashboard settings page's load", () => {
  const schedule = (medicationId: string, scheduleKind: string) => ({
    id: `${medicationId}-${scheduleKind}`,
    medicationId,
    scheduleKind,
  });

  async function runLoad() {
    return (await (load as (e: never) => Promise<unknown>)({
      locals: { user: { id: "u1" } },
    } as never)) as { preferences: unknown; variant: string };
  }

  it("reads only the signed-in user's active medications and schedules", async () => {
    await runLoad();
    expect(getActiveMedications).toHaveBeenCalledWith("u1");
    expect(getSchedulesForUser).toHaveBeenCalledWith("u1");
    expect(getOrCreatePreferences).toHaveBeenCalledWith("u1");
  });

  it('is "as-needed-only" for an account whose medications are all as-needed', async () => {
    getActiveMedications.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    getSchedulesForUser.mockResolvedValue(
      new Map([
        ["m1", [schedule("m1", "prn")]],
        ["m2", [schedule("m2", "prn")]],
      ]),
    );
    const data = await runLoad();
    expect(data).toMatchObject({ preferences: { userId: "u1" }, variant: "as-needed-only" });
  });

  it('is "scheduled" once one medication has a fixed time', async () => {
    getActiveMedications.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    getSchedulesForUser.mockResolvedValue(
      new Map([
        ["m1", [schedule("m1", "prn")]],
        ["m2", [schedule("m2", "fixed_time")]],
      ]),
    );
    expect((await runLoad()).variant).toBe("scheduled");
  });
});
