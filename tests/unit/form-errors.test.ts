import { describe, it, expect } from "vitest";
import type { ActionResult } from "@sveltejs/kit";
import { actionErrorMessage } from "$lib/utils/form-errors";

/**
 * One reader for every failure shape the `(app)` actions produce.
 *
 * They produce four, plus the unexpected-throw case, and every call site that
 * wanted to show a failure had to know all five. Three of them knew none and
 * showed nothing at all — which is the defect this exists to make
 * unrepeatable.
 */

const FALLBACK = "Something went wrong — please try again.";

function failure(status: number, data?: Record<string, unknown>): ActionResult {
  return { type: "failure", status, data } as ActionResult;
}

describe("actionErrorMessage — the shapes the actions actually return", () => {
  it("reads a bare string error — fail(404, { error: 'Dose not found' })", () => {
    expect(actionErrorMessage(failure(404, { error: "Dose not found" }))).toBe("Dose not found");
  });

  it("reads a form-level message — fail(404, { errors: { form: [...] } })", () => {
    expect(actionErrorMessage(failure(404, { errors: { form: ["Medication not found"] } }))).toBe(
      "Medication not found",
    );
  });

  it("reads a field error when there is no form-level one", () => {
    // A zod failure names the field, and saying which field is wrong beats
    // "something went wrong".
    expect(actionErrorMessage(failure(400, { errors: { quantity: ["Too large"] } }))).toBe(
      "Too large",
    );
  });

  it("prefers the form-level message over a field one", () => {
    // `form` is declared SECOND on purpose. With it first, this assertion
    // passes whether the preference exists or not — object key order alone
    // would satisfy it — so the test would not notice the preference being
    // deleted. It is the mutation ledger that found that, not review.
    const result = failure(400, {
      errors: { quantity: ["Too large"], form: ["Medication not found"] },
    });
    expect(actionErrorMessage(result)).toBe("Medication not found");
  });

  it("falls back for fail(400) with no body at all", () => {
    // skipDose does exactly this.
    expect(actionErrorMessage(failure(400))).toBe(FALLBACK);
  });
});

describe("actionErrorMessage — an unexpected throw", () => {
  it("shows handleError's safe message and the reference the user can quote", () => {
    const result = {
      type: "error",
      error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
    } as ActionResult;

    expect(actionErrorMessage(result)).toBe(
      "Something went wrong on our end. (reference a3f10c9e)",
    );
  });

  it("omits the reference when there is none", () => {
    const result = { type: "error", error: { message: "Boom" } } as ActionResult;
    expect(actionErrorMessage(result)).toBe("Boom");
  });

  it("falls back when the error carries nothing renderable", () => {
    // A network failure reaches this arm with a raw Error, which has no
    // `message` property of the App.Error shape and must not be rendered raw.
    expect(actionErrorMessage({ type: "error", error: undefined } as ActionResult)).toBe(FALLBACK);
  });
});

describe("actionErrorMessage — hostile and degenerate input", () => {
  it.each([
    ["an empty string error", failure(400, { error: "" })],
    ["a non-string error", failure(400, { error: 42 })],
    ["an empty errors object", failure(400, { errors: {} })],
    ["an empty field array", failure(400, { errors: { form: [] } })],
    ["a non-array field", failure(400, { errors: { form: 42 } })],
    ["an array of non-strings", failure(400, { errors: { form: [null, 7] } })],
    ["a null data", failure(400, undefined)],
  ])("falls back for %s rather than rendering junk", (_label, result) => {
    expect(actionErrorMessage(result)).toBe(FALLBACK);
  });

  it("skips a blank entry and takes the first real one", () => {
    expect(actionErrorMessage(failure(400, { errors: { form: ["", "Real message"] } }))).toBe(
      "Real message",
    );
  });

  it("returns the fallback for a success, which callers should never pass", () => {
    expect(actionErrorMessage({ type: "success", status: 200 } as ActionResult)).toBe(FALLBACK);
  });

  it("takes a caller-supplied fallback", () => {
    expect(actionErrorMessage(failure(400), "Could not skip this dose.")).toBe(
      "Could not skip this dose.",
    );
  });
});
