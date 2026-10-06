import { describe, it, expect, vi, beforeEach } from "vitest";
import { actionErrorMessage } from "$lib/utils/form-errors";

/**
 * `restoreDoseAction` is a delete's Undo. Every page posts it to the absolute
 * `/dashboard?/restoreDose`. What `restoreDose` does to the database is proven
 * on PGlite in pg/dose-restore.test.ts, and the 401 guard in
 * app-action-auth-guard.test.ts. This file pins the door itself: the parse,
 * the token passed on, and the status and copy each outcome becomes.
 */

const restoreDose = vi.fn(async (..._args: unknown[]): Promise<string> => "restored");

// dose-actions.ts never reaches `db`. unusedDb THROWS on any access, so an
// accidental query fails loudly instead of returning [].
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/doses", () => ({
  restoreDose: (...args: unknown[]) => restoreDose(...args),
}));

const { restoreDoseAction, RESTORE_GONE_MESSAGE, RESTORE_LOGGED_SINCE_MESSAGE } =
  await import("../../src/lib/server/dose-actions");

const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } };
/** The `deletedAt` a delete's response carried, posted back exactly as sent. */
const TOKEN = "2026-04-16T08:05:00.000Z";

function formRequest(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x", { method: "POST", body: fd });
}

const restore = (fields: Record<string, string>) =>
  restoreDoseAction({ request: formRequest(fields), locals } as never);

/** What the client will toast. It reads every failure through actionErrorMessage. */
function toastFor(res: unknown): string {
  const { status, data } = res as { status: number; data: Record<string, unknown> };
  return actionErrorMessage({ type: "failure", status, data });
}

beforeEach(() => {
  restoreDose.mockReset();
  restoreDose.mockResolvedValue("restored");
});

describe("restoreDoseAction", () => {
  it("hands the posted token to restoreDose as an instant and answers success", async () => {
    const res = await restore({ doseId: "d1", deletedAt: TOKEN });

    expect(res).toEqual({ success: true, doseId: "d1" });
    expect(restoreDose).toHaveBeenCalledWith("u1", "d1", new Date(TOKEN));
  });

  it("answers success to already_restored, a retried Undo whose first attempt landed", async () => {
    restoreDose.mockResolvedValueOnce("already_restored");

    const res = await restore({ doseId: "d1", deletedAt: TOKEN });

    expect(res).toEqual({ success: true, doseId: "d1" });
  });

  it("answers 410 with the too-late copy when the dose is gone", async () => {
    restoreDose.mockResolvedValueOnce("gone");

    const res = await restore({ doseId: "d1", deletedAt: TOKEN });

    expect(res).toMatchObject({ status: 410 });
    expect(toastFor(res)).toBe("Too late to undo. Log it again if you need it.");
  });

  it("answers 409 with the newer-entry copy when the medication was logged since", async () => {
    restoreDose.mockResolvedValueOnce("logged_since");

    const res = await restore({ doseId: "d1", deletedAt: TOKEN });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("A newer entry exists for this medication, so Undo wasn't applied.");
  });

  it.each([
    ["no fields", {}],
    ["no deletedAt", { doseId: "d1" }],
    ["no doseId", { deletedAt: TOKEN }],
    ["an empty doseId", { doseId: "", deletedAt: TOKEN }],
    ["a deletedAt that is not an ISO instant", { doseId: "d1", deletedAt: "2026-04-16T08:05" }],
  ])("answers 400 to %s, restoring nothing", async (_label, fields) => {
    const res = await restore(fields as Record<string, string>);

    expect(res).toMatchObject({ status: 400, data: { error: "Invalid undo request" } });
    expect(restoreDose).not.toHaveBeenCalled();
  });

  it("exports the two refusals' copy exactly", () => {
    expect(RESTORE_GONE_MESSAGE).toBe("Too late to undo. Log it again if you need it.");
    expect(RESTORE_LOGGED_SINCE_MESSAGE).toBe(
      "A newer entry exists for this medication, so Undo wasn't applied.",
    );
  });
});
