import { rateLimitSurface } from "./helpers/rate-limit";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { dashboardSettingsFieldSchemas } from "../../src/lib/utils/validation";
import { PRESETS, PRESET_IDS } from "../../src/lib/dashboard/presets";

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
  it("defines exactly the eight dashboard actions and no default", () => {
    expect(Object.keys(actions).sort()).toEqual(
      [
        "dashboardSectionOrder",
        "dashboardShowLater",
        "dashboardShowQuickLog",
        "dashboardShowRefills",
        "dashboardLaterMode",
        "dashboardDoneTime",
        "resetDashboardLayout",
        "applyPreset",
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

  // The 128-character bound guards `split()` against a huge post. Every
  // over-long order also fails the id domain, so the action's status cannot
  // see the bound: it is asserted on the door's schema, as the STRING's
  // too_big issue (the array's own max(4) reports too_big with origin "array").
  describe("the door's 128-character string bound", () => {
    const door = dashboardSettingsFieldSchemas.dashboardSectionOrder;
    const stringTooBig = (value: string) => {
      const parsed = door.safeParse({ dashboardSectionOrder: value });
      expect(parsed.success).toBe(false);
      return (parsed.error?.issues ?? []).filter(
        (issue) =>
          issue.code === "too_big" &&
          (issue as { origin?: string }).origin === "string" &&
          issue.path.join(".") === "dashboardSectionOrder",
      );
    };
    // Valid ids, comma-separated, padded to an exact length with one more id.
    const ofLength = (n: number) => {
      const body = "done,later,quickLog,refills,".repeat(5);
      return (body + "x".repeat(n)).slice(0, n);
    };

    it("rejects 129 characters as too_big on the string", () => {
      expect(ofLength(129)).toHaveLength(129);
      const issues = stringTooBig(ofLength(129));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ maximum: 128 });
    });

    it("does not reject 128 characters for length", () => {
      expect(ofLength(128)).toHaveLength(128);
      expect(stringTooBig(ofLength(128))).toEqual([]);
    });

    it("still 400s an over-long post at the action without writing", async () => {
      const result = await call(actions.dashboardSectionOrder, {
        dashboardSectionOrder: ofLength(129),
      });
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 400 });
    });
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

  describe("the Phase 2 enum actions", () => {
    const enums = {
      dashboardLaterMode: { ok: ["next", "all"], bad: ["off", "next3", "", "ALL"] },
      dashboardDoneTime: { ok: ["both", "since", "clock"], bad: ["relative", "", "BOTH"] },
    } as const;
    for (const [key, { ok, bad }] of Object.entries(enums)) {
      for (const value of ok) {
        it(`${key} saves ${JSON.stringify(value)} with exactly its key`, async () => {
          const result = await call(actions[key], { [key]: value });
          expect(updatePreferences).toHaveBeenCalledTimes(1);
          expect(updatePreferences).toHaveBeenCalledWith("u1", { [key]: value });
          expect(result).toMatchObject({ success: true, key });
        });
      }
      for (const value of bad) {
        it(`${key} 400s ${JSON.stringify(value)} without writing`, async () => {
          const result = await call(actions[key], { [key]: value });
          expect(updatePreferences).not.toHaveBeenCalled();
          expect(result).toMatchObject({ status: 400, data: { key } });
        });
      }
      it(`${key} 400s a missing field and a second field riding along`, async () => {
        expect(await call(actions[key], {})).toMatchObject({ status: 400 });
        const other = key === "dashboardLaterMode" ? "dashboardDoneTime" : "dashboardLaterMode";
        expect(await call(actions[key], { [key]: ok[0], [other]: "both" })).toMatchObject({
          status: 400,
        });
        expect(updatePreferences).not.toHaveBeenCalled();
      });
    }
  });

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

  it("resets the layout in ONE write: exactly PRESETS.standard.patch", async () => {
    const result = await call(actions.resetDashboardLayout, {});
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith("u1", PRESETS.standard.patch);
    expect(result).toMatchObject({ success: true, key: "resetDashboardLayout" });
  });

  describe("applyPreset", () => {
    for (const id of PRESET_IDS) {
      it(`${id} writes the full patch in one call`, async () => {
        const result = await call(actions.applyPreset, { preset: id });
        expect(updatePreferences).toHaveBeenCalledTimes(1);
        expect(updatePreferences).toHaveBeenCalledWith("u1", PRESETS[id].patch);
        expect(result).toMatchObject({ success: true, key: "applyPreset" });
      });
    }

    it("400s an unknown id, a missing id and an extra key without writing", async () => {
      for (const fields of [
        { preset: "everything" },
        { preset: "" },
        { preset: "Standard" },
        {},
        { preset: "focused", dashboardShowLater: "off" },
      ]) {
        const result = await call(actions.applyPreset, fields as Record<string, string>);
        expect(result, JSON.stringify(fields)).toMatchObject({
          status: 400,
          data: { key: "applyPreset" },
        });
      }
      expect(updatePreferences).not.toHaveBeenCalled();
    });

    it("passes a 429 through without writing", async () => {
      checkRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 9_000 });
      const result = await call(actions.applyPreset, { preset: "focused" });
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 429,
        data: { key: "applyPreset", saveError: expect.any(String), retryAfterMs: 9_000 },
      });
    });
  });

  for (const name of [
    "dashboardSectionOrder",
    "dashboardShowLater",
    "dashboardShowQuickLog",
    "dashboardShowRefills",
    "dashboardLaterMode",
    "dashboardDoneTime",
    "resetDashboardLayout",
    "applyPreset",
  ]) {
    it(`${name} rate-limits per account before writing, and the 429 says when`, async () => {
      checkRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 30_000 });
      const fields: Record<string, string> =
        name === "resetDashboardLayout"
          ? {}
          : name === "applyPreset"
            ? { preset: "focused" }
            : {
                [name]:
                  name === "dashboardSectionOrder"
                    ? "default"
                    : name === "dashboardLaterMode"
                      ? "all"
                      : name === "dashboardDoneTime"
                        ? "both"
                        : "on",
              };

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
