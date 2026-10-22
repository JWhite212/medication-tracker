// The state behind DestructiveConfirm, and the order its submit applies a
// result in (D3): only a failure stays in the dialog; everything else is
// applied with update() first and the dialog closed only after.
import { it, expect, vi } from "vitest";
import type { ActionResult } from "@sveltejs/kit";
import {
  createDestructiveDialog,
  type DestructiveDialog,
} from "$lib/components/ui/destructive-dialog.svelte";

const FAILED = {
  type: "failure",
  status: 400,
  data: { error: "Incorrect password." },
} as ActionResult;
const DONE = {
  type: "success",
  status: 200,
  data: { wipeDosesOk: true, removed: 3 },
} as ActionResult;

function submitWith(
  d: DestructiveDialog,
  result: ActionResult,
  update: () => Promise<void> = vi.fn(async () => {}),
) {
  const after = d.submit({} as never) as (o: unknown) => Promise<void>;
  return { update, done: after({ result, update }) };
}

it("show opens with no error; close closes", async () => {
  const d = createDestructiveDialog();
  expect([d.open, d.pending, d.error]).toEqual([false, false, null]);
  d.show();
  expect([d.open, d.error]).toEqual([true, null]);
  d.close();
  expect(d.open).toBe(false);

  // A refusal's message does not survive into the next opening.
  d.show();
  await submitWith(d, FAILED).done;
  expect(d.error).toBe("Incorrect password.");
  d.close();
  d.show();
  expect([d.open, d.error]).toEqual([true, null]);
});

it("a submit marks it pending and clears the last error", async () => {
  const d = createDestructiveDialog();
  d.show();
  await submitWith(d, FAILED).done;
  expect([d.pending, d.error]).toEqual([false, "Incorrect password."]);
  d.begin();
  expect([d.pending, d.error]).toEqual([true, null]);

  // The submit function itself begins: pending before any result arrives.
  const e = createDestructiveDialog();
  e.show();
  await submitWith(e, FAILED).done;
  e.submit({} as never);
  expect([e.pending, e.error]).toEqual([true, null]);
});

it("keeps a failure in the dialog with the server's message, and does not apply it", async () => {
  const d = createDestructiveDialog();
  d.show();
  const { update, done } = submitWith(d, FAILED);
  await done;
  expect(update).not.toHaveBeenCalled();
  expect([d.open, d.pending, d.error]).toEqual([true, false, "Incorrect password."]);
});

it("gives a failure with no message a message", async () => {
  const d = createDestructiveDialog();
  d.show();
  const { update, done } = submitWith(d, { type: "failure", status: 400 } as ActionResult);
  await done;
  expect(update).not.toHaveBeenCalled();
  expect([d.open, d.pending, d.error]).toEqual([
    true,
    false,
    "Something went wrong — please try again.",
  ]);
});

it("applies a success before it closes, staying pending until the page has the result", async () => {
  const d = createDestructiveDialog();
  d.show();
  const update = vi.fn(async () => {
    expect([d.open, d.pending]).toEqual([true, true]);
  });
  await submitWith(d, DONE, update).done;
  expect(update).toHaveBeenCalledTimes(1);
  expect([d.open, d.pending]).toEqual([false, false]);
});

it("applies a redirect and an error result rather than holding them", async () => {
  for (const result of [
    { type: "redirect", status: 302, location: "/" },
    { type: "error", status: 500, error: { message: "x" } },
  ] as ActionResult[]) {
    const d = createDestructiveDialog();
    d.show();
    const update = vi.fn(async () => {
      expect([d.open, d.pending]).toEqual([true, true]);
    });
    await submitWith(d, result, update).done;
    expect(update, result.type).toHaveBeenCalledTimes(1);
    expect([d.open, d.pending, d.error], result.type).toEqual([false, false, null]);
  }
});

it("still settles when applying the result throws", async () => {
  const d = createDestructiveDialog();
  d.show();
  const update = vi.fn(async () => {
    throw new Error("navigation failed");
  });
  await expect(submitWith(d, DONE, update).done).rejects.toThrow("navigation failed");
  expect([d.open, d.pending]).toEqual([false, false]);
});
