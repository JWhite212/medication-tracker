import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Allow each test to swap the env value before importing the module.
const envState: { INTERACTIONS_ENABLED?: string } = {};
vi.mock("$env/dynamic/private", () => ({
  env: new Proxy(envState, {
    get(target, key: string) {
      return target[key as keyof typeof target];
    },
  }),
}));

// Stub the db so checkInteractions doesn't try to talk to Postgres.
const mockMedications: Array<{ name: string }> = [];
vi.mock("$lib/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => mockMedications,
      }),
    }),
  },
}));

const { isInteractionsEnabled, checkInteractions, __testing__ } =
  await import("../../src/lib/server/interactions");

beforeEach(() => {
  __testing__.clearCache();
  mockMedications.length = 0;
  delete envState.INTERACTIONS_ENABLED;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isInteractionsEnabled", () => {
  it("defaults to false when env is unset", () => {
    expect(isInteractionsEnabled()).toBe(false);
  });

  it("is false when env is 'false'", () => {
    envState.INTERACTIONS_ENABLED = "false";
    expect(isInteractionsEnabled()).toBe(false);
  });

  it("is true when env is 'true' (case-insensitive)", () => {
    envState.INTERACTIONS_ENABLED = "TRUE";
    expect(isInteractionsEnabled()).toBe(true);
  });

  it("treats anything other than 'true' as false", () => {
    envState.INTERACTIONS_ENABLED = "yes";
    expect(isInteractionsEnabled()).toBe(false);
  });
});

describe("checkInteractions", () => {
  it("returns [] when feature is disabled, even if fetch would respond", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await checkInteractions("u1", "Ibuprofen");
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] when user has no other medications", async () => {
    envState.INTERACTIONS_ENABLED = "true";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await checkInteractions("u1", "Ibuprofen");
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] gracefully when openFDA is unreachable (network error)", async () => {
    envState.INTERACTIONS_ENABLED = "true";
    mockMedications.push({ name: "Aspirin" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await checkInteractions("u1", "Ibuprofen");
    expect(result).toEqual([]);
  });

  it("returns [] gracefully when openFDA returns non-OK status", async () => {
    envState.INTERACTIONS_ENABLED = "true";
    mockMedications.push({ name: "Aspirin" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));

    const result = await checkInteractions("u1", "Ibuprofen");
    expect(result).toEqual([]);
  });

  it("flags an interaction when openFDA text mentions an existing medication", async () => {
    envState.INTERACTIONS_ENABLED = "true";
    mockMedications.push({ name: "Aspirin" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ drug_interactions: ["Concurrent use with aspirin may increase risk."] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await checkInteractions("u1", "Ibuprofen");
    expect(result).toEqual(["Ibuprofen may interact with Aspirin"]);
  });

  it("caches the openFDA response per drug name", async () => {
    envState.INTERACTIONS_ENABLED = "true";
    mockMedications.push({ name: "Aspirin" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [{ drug_interactions: ["aspirin"] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await checkInteractions("u1", "Ibuprofen");
    await checkInteractions("u1", "Ibuprofen");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
