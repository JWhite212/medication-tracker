import { describe, it, expect, vi, beforeEach } from "vitest";

// The reorder action must not answer `success` for a move that did not
// happen: the client reads `result.type === "success"` as "moved" and
// announces "<name> moved to position <findIndex + 1> of N" — which, for a
// medication archived or deleted in another tab, reads "position 0".

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/inventory", () => ({ getRefillForecast: vi.fn() }));

const getActiveMedications = vi.fn();
const swapSortOrder = vi.fn();
vi.mock("$lib/server/medications", () => ({
  getActiveMedications: (...a: unknown[]) => getActiveMedications(...a),
  getMedicationsWithStats: vi.fn(),
  getArchivedMedications: vi.fn(),
  swapSortOrder: (...a: unknown[]) => swapSortOrder(...a),
}));

const { actions } = await import("../../src/routes/(app)/medications/+page.server");

function call(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const request = new Request("http://localhost/medications?/reorder", { method: "POST", body });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (actions.reorder as any)({ request, locals: { user: { id: "u1" } } });
}

/** A SvelteKit ActionFailure (what `fail(...)` returns); `undefined` is success. */
function isFailure(result: unknown): result is { status: number } {
  return (
    typeof result === "object" &&
    result !== null &&
    typeof (result as { status?: unknown }).status === "number" &&
    (result as { status: number }).status >= 400
  );
}

describe("medications ?/reorder refuses a move that did not happen", () => {
  beforeEach(() => {
    getActiveMedications.mockReset();
    swapSortOrder.mockReset();
    getActiveMedications.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    swapSortOrder.mockResolvedValue(true);
  });

  it("a stale id (archived/deleted in another tab) is a failure, not success", async () => {
    const result = await call({ medicationId: "gone", direction: "up" });
    expect(swapSortOrder).not.toHaveBeenCalled();
    expect(isFailure(result)).toBe(true);
  });

  it("moving the first medication up is a failure", async () => {
    const result = await call({ medicationId: "a", direction: "up" });
    expect(swapSortOrder).not.toHaveBeenCalled();
    expect(isFailure(result)).toBe(true);
  });

  it("an unknown direction is rejected rather than treated as down", async () => {
    const result = await call({ medicationId: "a", direction: "sideways" });
    expect(swapSortOrder).not.toHaveBeenCalled();
    expect(isFailure(result)).toBe(true);
  });

  it("a missing field is a failure", async () => {
    const result = await call({ medicationId: "a" });
    expect(isFailure(result)).toBe(true);
  });

  it("a move the database refuses (a row gone mid-request) is a failure", async () => {
    swapSortOrder.mockResolvedValue(false);
    const result = await call({ medicationId: "b", direction: "up" });
    expect(isFailure(result)).toBe(true);
  });

  it("a real move still succeeds and swaps", async () => {
    const result = await call({ medicationId: "b", direction: "up" });
    expect(swapSortOrder).toHaveBeenCalledWith("u1", "b", "a");
    expect(isFailure(result)).toBe(false);
  });
});
