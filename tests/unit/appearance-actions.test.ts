import { describe, it, expect, beforeEach, vi } from "vitest";

const updatePreferences = vi.fn(async () => ({}) as never);
const checkRateLimit = vi.fn(async () => ({ allowed: true, retryAfterMs: 0 }));

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/preferences", () => ({
  updatePreferences,
  getOrCreatePreferences: vi.fn(async () => ({ userId: "u1" }) as never),
}));
vi.mock("$lib/server/auth/rate-limit", () => ({ checkRateLimit }));

const { actions } = await import("../../src/routes/(app)/settings/appearance/+page.server");

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return { request: new Request("http://x/settings/appearance", { method: "POST", body }) };
}

const locals = { user: { id: "u1" } };

beforeEach(() => {
  updatePreferences.mockClear();
  checkRateLimit.mockClear();
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("the appearance page's named actions", () => {
  it("defines one action per registry key and no default", async () => {
    expect(Object.keys(actions).sort()).toEqual(
      ["accentColor", "dateFormat", "reducedMotion", "timeFormat", "uiDensity"].sort(),
    );
    // SvelteKit throws if `default` coexists with any named action.
    expect(actions).not.toHaveProperty("default");
  });

  it("saves the single field it was posted", async () => {
    const result = await actions.uiDensity({ ...post({ uiDensity: "compact" }), locals } as never);

    expect(updatePreferences).toHaveBeenCalledWith("u1", { uiDensity: "compact" });
    expect(result).toMatchObject({ success: true, key: "uiDensity" });
  });

  it("400s on a mistyped field name instead of writing nothing and reporting success", async () => {
    const result = await actions.uiDensity({
      ...post({ uiDensty: "compact" }),
      locals,
    } as never);

    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400, data: { key: "uiDensity" } });
  });

  it("400s on a value outside the option list", async () => {
    const result = await actions.uiDensity({ ...post({ uiDensity: "roomy" }), locals } as never);

    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 400, data: { key: "uiDensity" } });
  });

  it("maps the checkbox pair to a boolean", async () => {
    await actions.reducedMotion({ ...post({ reducedMotion: "on" }), locals } as never);
    expect(updatePreferences).toHaveBeenCalledWith("u1", { reducedMotion: true });

    updatePreferences.mockClear();
    await actions.reducedMotion({ ...post({ reducedMotion: "off" }), locals } as never);
    expect(updatePreferences).toHaveBeenCalledWith("u1", { reducedMotion: false });
  });

  it("rate-limits per user before writing", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 30_000 });

    const result = await actions.uiDensity({ ...post({ uiDensity: "compact" }), locals } as never);

    expect(checkRateLimit).toHaveBeenCalledWith(
      "appearance:u1",
      expect.any(Number),
      expect.any(Number),
    );
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 429,
      data: { key: "uiDensity", saveError: expect.any(String), retryAfterMs: 30_000 },
    });
    expect((result as { data: { saveError: string } }).data.saveError.length).toBeGreaterThan(0);
  });

  it("401s an anonymous POST instead of 500ing on locals.user!", async () => {
    // Form actions run BEFORE layout load functions, so the (app) auth
    // guard has not executed here.
    await expect(
      actions.uiDensity({ ...post({ uiDensity: "compact" }), locals: {} } as never),
    ).rejects.toMatchObject({ status: 401 });
  });
});
