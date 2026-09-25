import { describe, it, expect } from "vitest";
import type { ActionResult } from "@sveltejs/kit";
import {
  actionErrorMessage,
  actionFieldErrors,
  ariaDescribedBy,
  NO_RESPONSE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  unsavedErrorMessage,
} from "$lib/utils/form-errors";

/**
 * The additions that let a form put each failure beside its own control.
 *
 * `editErrors` is the dose-edit action's name for the ordinary keyed shape
 * (`/log` and `/dashboard` both return it). The reader did not know it, so
 * DoseEditForm opened `result.data` by hand to find `editErrors.form`, which
 * is exactly the call-site knowledge `actionErrorMessage` exists to remove;
 * and because it only knew `form`, a rejected date or quantity toasted
 * "check the fields" without saying which one.
 */

function failure(status: number, data?: Record<string, unknown>): ActionResult {
  return { type: "failure", status, data } as ActionResult;
}

describe("actionErrorMessage: the dose-edit action's `editErrors` bag", () => {
  it("reads its form-level message, fail(404, { editErrors: { form: [...] } })", () => {
    expect(
      actionErrorMessage(failure(404, { editErrors: { form: ["Dose no longer exists"] } })),
    ).toBe("Dose no longer exists");
  });

  it("reads a field error when there is no form-level one", () => {
    expect(
      actionErrorMessage(
        failure(400, { editErrors: { takenAt: ["Enter a valid date and time"] } }),
      ),
    ).toBe("Enter a valid date and time");
  });

  it("prefers a form-level message in either bag over a field message in the other", () => {
    // The field bag is declared first so key order alone cannot satisfy it.
    const result = failure(400, {
      errors: { quantity: ["Too large"] },
      editErrors: { form: ["Dose no longer exists"] },
    });
    expect(actionErrorMessage(result)).toBe("Dose no longer exists");
  });

  it("still falls back for an empty bag rather than rendering junk", () => {
    expect(actionErrorMessage(failure(400, { editErrors: {} }), "fallback")).toBe("fallback");
    expect(actionErrorMessage(failure(400, { editErrors: "nope" }), "fallback")).toBe("fallback");
  });
});

describe("actionFieldErrors: every keyed message, first per field", () => {
  it("reads the common `errors` bag", () => {
    const result = failure(400, {
      errors: { name: ["Name is required"], email: ["Invalid email address", "second"] },
    });
    expect(actionFieldErrors(result)).toEqual({
      name: "Name is required",
      email: "Invalid email address",
    });
  });

  it("reads the dose-edit action's `editErrors` bag", () => {
    const result = failure(400, {
      editErrors: { takenAt: ["Enter a valid date and time"], quantity: ["Too big"] },
    });
    expect(actionFieldErrors(result)).toEqual({
      takenAt: "Enter a valid date and time",
      quantity: "Too big",
    });
  });

  it("keeps the `form` key, because on the medication form it is a real field", () => {
    // MedicationCategoryFields renders `errors.form` beside the dosage-form
    // select. Dropping the key here would silently lose that message; a
    // caller with no `form` control simply does not render it.
    expect(actionFieldErrors(failure(400, { errors: { form: ["Pick a form"] } }))).toEqual({
      form: "Pick a form",
    });
  });

  it("skips blank and non-string entries, and fields with nothing to say", () => {
    const result = failure(400, {
      errors: { name: ["", "Real message"], email: [], quantity: [null, 7], notes: 42 },
    });
    expect(actionFieldErrors(result)).toEqual({ name: "Real message" });
  });

  it("ignores the bare-string `error` shape, which names no field", () => {
    expect(actionFieldErrors(failure(404, { error: "Dose not found" }))).toEqual({});
  });

  it.each([
    ["a success", { type: "success", status: 200, data: { errors: { name: ["x"] } } }],
    ["an unexpected throw", { type: "error", error: { message: "Boom" } }],
    ["a redirect", { type: "redirect", status: 303, location: "/" }],
    ["a failure with no body", { type: "failure", status: 400 }],
  ])("returns nothing for %s", (_label, result) => {
    // An empty object, not undefined: callers assign it straight into state
    // so a later success or crash clears the previous attempt's messages.
    expect(actionFieldErrors(result as ActionResult)).toEqual({});
  });
});

describe("ariaDescribedBy: only ids whose message is rendered", () => {
  it("joins the ids that are present, in order", () => {
    expect(ariaDescribedBy("email-error", "form-error")).toBe("email-error form-error");
  });

  it("drops the absent ones", () => {
    expect(ariaDescribedBy(undefined, "form-error", false, null, "")).toBe("form-error");
  });

  it("returns undefined rather than an empty string when nothing is rendered", () => {
    // `aria-describedby=""` is still emitted as an attribute; undefined is
    // what makes Svelte omit it.
    expect(ariaDescribedBy()).toBeUndefined();
    expect(ariaDescribedBy(undefined, false, "")).toBeUndefined();
  });
});

describe("unsavedErrorMessage: an error result a form answers in place", () => {
  // DoseEditForm and MedicationForm keep the edit open on an error result
  // rather than letting `update()` replace the page, so this message is all
  // the user has to go on. "Unauthorized" and "Failed to fetch" are what the
  // server and the browser said; neither says whether the edit was saved.

  it("names an expired session, and a way back that keeps the edit", () => {
    const result = { type: "error", status: 401, error: { message: "Unauthorized" } };
    expect(unsavedErrorMessage(result as ActionResult)).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("names a request that got no answer, which `enhance` reports with no status", () => {
    // What `enhance` builds from the `fetch` rejection: the browser's own
    // error object, and no `status` because there was no response.
    const result = { type: "error", error: new TypeError("Failed to fetch") };
    expect(unsavedErrorMessage(result as ActionResult)).toBe(NO_RESPONSE_MESSAGE);
  });

  it("leaves a crash to actionErrorMessage, so its reference survives", () => {
    const result = {
      type: "error",
      status: 500,
      error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
    };
    expect(unsavedErrorMessage(result as ActionResult)).toBe(
      "Something went wrong on our end. (reference a3f10c9e)",
    );
  });

  it("leaves every failure to actionErrorMessage, fallback included", () => {
    expect(
      unsavedErrorMessage(failure(404, { editErrors: { form: ["Dose no longer exists"] } })),
    ).toBe("Dose no longer exists");
    // A 401 FAILURE is a value an action chose to return, not the session
    // guard's thrown error, so it is read like any other failure.
    expect(unsavedErrorMessage(failure(401, { error: "Incorrect password" }))).toBe(
      "Incorrect password",
    );
    expect(unsavedErrorMessage(failure(400), "fallback")).toBe("fallback");
  });
});
