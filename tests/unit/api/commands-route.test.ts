import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("$lib/server/api/auth", () => ({
  requireApiUser: async () => ({ user: { id: "u1" } }),
}));

const runCommands = vi.fn(async (_userId: string, _commands: unknown[]) => []);
vi.mock("$lib/server/api/commands", () => ({
  runCommands: (userId: string, commands: unknown[]) => runCommands(userId, commands),
}));

const { POST } = await import("../../../src/routes/api/v1/commands/+server");

const call = (body: BodyInit) =>
  POST({
    request: new Request("http://x", { method: "POST", body }),
  } as never);

beforeEach(() => {
  runCommands.mockClear();
});

describe("POST /api/v1/commands (route)", () => {
  it("returns 400 (not 500) for a malformed JSON body", async () => {
    await expect(call("{not json")).rejects.toMatchObject({ status: 400 });
    expect(runCommands).not.toHaveBeenCalled();
  });

  it("returns 400 for a JSON body missing the commands field", async () => {
    await expect(call(JSON.stringify({ nope: true }))).rejects.toMatchObject({ status: 400 });
  });

  it("dispatches valid commands and returns the results", async () => {
    const res = await call(
      JSON.stringify({ commands: [{ id: "c1", type: "log_dose", payload: {} }] }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
    expect(runCommands).toHaveBeenCalledWith("u1", [{ id: "c1", type: "log_dose", payload: {} }]);
  });
});
