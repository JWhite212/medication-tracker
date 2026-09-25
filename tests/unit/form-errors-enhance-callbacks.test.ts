// Runs in the suite's default jsdom environment on purpose: these mount the
// components with svelte's CLIENT runtime, because what is under test is the
// `use:enhance` callback, which never runs on the server.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DoseLogWithMedication } from "$lib/types";

// Under jsdom the components are compiled for the client, but the bare
// `svelte` specifier is loaded as an external dependency under Node's
// conditions, which pick the package's SERVER entry: `mount` throws there and
// `tick` does nothing. This file points `svelte` at the client entry instead,
// for the test and for the components' own `import { tick } from "svelte"`
// alike. It is a relative path because the export map does not expose
// `src/index-client.js`; the specifier form (`svelte/src/...`) is refused, and
// a computed path is resolved differently and fails. If a later svelte moves
// the file, this is the line to update.
// @ts-expect-error The internal entry ships no declarations; the imports
// above are typed by the package's public `svelte` types, which describe it.
vi.mock("svelte", () => import("../../node_modules/svelte/src/index-client.js"));

// `enhance` is replaced by a recorder, so each test can hand the component's
// own callback exactly the ActionResult it wants and observe what the
// component does with it, including whether it lets SvelteKit's `update()`
// run at all.
const captured = vi.hoisted(() => ({ submit: undefined as SubmitFunction | undefined }));
vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    captured.submit = submit;
    return { destroy() {} };
  },
}));

const showToast = vi.hoisted(() => vi.fn());
vi.mock("$components/ui/Toast.svelte", () => ({ showToast }));

const { default: DoseEditForm } = await import("../../src/lib/components/DoseEditForm.svelte");
const { default: MedicationForm } = await import("../../src/lib/components/MedicationForm.svelte");

/**
 * Every failure a form action can produce has to reach the user.
 *
 * DoseEditForm handled `failure` only, and read `result.data.editErrors.form`
 * by hand, so a rejected date or quantity toasted "check the fields" without
 * saying which, and nothing was ever marked on the field itself. Both forms
 * passed an error result (an expired session, a crash) straight to
 * `update()`, which hands it to +error.svelte: the page is replaced, the
 * user's input with it, and nothing says the save did not happen.
 */

const CRASH = {
  type: "error",
  status: 500,
  error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
} as ActionResult;

function failure(status: number, data: Record<string, unknown>): ActionResult {
  return { type: "failure", status, data } as ActionResult;
}

let target: HTMLElement;
let component: Record<string, unknown> | undefined;

beforeEach(() => {
  captured.submit = undefined;
  showToast.mockReset();
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  target.remove();
});

/** Run the component's enhance callback with `result`; returns the `update` spy. */
async function submit(result: ActionResult) {
  const formElement = target.querySelector("form")!;
  const formData = new FormData(formElement);
  const action = new URL("http://localhost/log?/editDose");
  const update = vi.fn(async () => {});

  expect(captured.submit, "the form never registered use:enhance").toBeDefined();
  const after = await captured.submit!({
    action,
    formData,
    formElement,
    controller: new AbortController(),
    submitter: null,
    cancel: () => {},
  });
  if (typeof after === "function") {
    await after({ action, formData, formElement, result, update });
  }
  flushSync();
  await tick();
  return update;
}

describe("DoseEditForm", () => {
  const dose: DoseLogWithMedication = {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    takenAt: new Date("2026-05-01T09:00:00.000Z"),
    loggedAt: new Date("2026-05-01T09:00:00.000Z"),
    notes: null,
    sideEffects: null,
    status: "taken",
    updatedAt: new Date("2026-05-01T09:00:00.000Z"),
    medication: {
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
  };

  let onclose: Mock<() => void>;

  beforeEach(() => {
    onclose = vi.fn();
    component = mount(DoseEditForm, { target, props: { dose, timezone: "UTC", onclose } });
    flushSync();
  });

  const field = (id: string) => target.querySelector<HTMLElement>(`#${id}`)!;

  it("puts each rejected field's message beside it, tied to the control", async () => {
    await submit(
      failure(400, {
        editErrors: {
          takenAt: ["Enter a valid date and time"],
          quantity: ["Number must be less than or equal to 10"],
        },
      }),
    );

    for (const [id, message] of [
      ["takenAt", "Enter a valid date and time"],
      ["quantity", "Number must be less than or equal to 10"],
    ]) {
      expect(field(id).getAttribute("aria-invalid")).toBe("true");
      expect(field(id).getAttribute("aria-describedby")).toBe(`${id}-error`);
      expect(field(`${id}-error`).textContent?.trim()).toBe(message);
      expect(field(`${id}-error`).getAttribute("role")).toBe("alert");
    }
    // The field that passed stays unmarked.
    expect(field("notes").hasAttribute("aria-invalid")).toBe(false);
    expect(field("notes").hasAttribute("aria-describedby")).toBe(false);

    // The toast says which problem, not "check the fields".
    expect(showToast).toHaveBeenCalledWith("Enter a valid date and time", "error");
    expect(onclose).not.toHaveBeenCalled();
  });

  it("still toasts the form-level message for a dose deleted in another tab", async () => {
    const update = await submit(failure(404, { editErrors: { form: ["Dose no longer exists"] } }));

    expect(showToast).toHaveBeenCalledWith("Dose no longer exists", "error");
    expect(target.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(update).toHaveBeenCalledOnce();
  });

  it("answers a crash in place, with the reference, and keeps the edit open", async () => {
    const update = await submit(CRASH);

    expect(showToast).toHaveBeenCalledWith(
      "Something went wrong on our end. (reference a3f10c9e)",
      "error",
    );
    // `update()` would replace the page with +error.svelte and discard the edit.
    expect(update).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();
    expect(target.querySelector("form")).not.toBeNull();
  });

  it("answers an expired session the same way", async () => {
    const update = await submit({
      type: "error",
      status: 401,
      error: { message: "Unauthorized" },
    } as ActionResult);

    expect(showToast).toHaveBeenCalledWith("Unauthorized", "error");
    expect(update).not.toHaveBeenCalled();
  });

  it("clears the previous attempt's field messages once a save succeeds", async () => {
    await submit(failure(400, { editErrors: { quantity: ["Too big"] } }));
    expect(field("quantity").getAttribute("aria-invalid")).toBe("true");

    const update = await submit({ type: "success", status: 200, data: { success: true } });

    expect(field("quantity").hasAttribute("aria-invalid")).toBe(false);
    expect(target.querySelector("#quantity-error")).toBeNull();
    expect(showToast).toHaveBeenLastCalledWith("Dose updated", "success");
    expect(onclose).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });
});

describe("MedicationForm", () => {
  beforeEach(() => {
    component = mount(MedicationForm, { target, props: {} });
    flushSync();
  });

  it("shows a crash's message and reference in the form, focused, instead of leaving the page", async () => {
    const update = await submit(CRASH);

    const alert = target.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent?.trim()).toBe(
      "Something went wrong on our end. (reference a3f10c9e)",
    );
    expect(document.activeElement).toBe(alert);
    expect(update).not.toHaveBeenCalled();
    // Still the form, with its button re-enabled for a retry.
    expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it("drops that message again on the next submit, whatever it returns", async () => {
    await submit(CRASH);
    expect(target.textContent).toContain("reference a3f10c9e");

    const update = await submit(failure(400, { errors: { name: ["Name is required"] } }));

    expect(target.textContent).not.toContain("reference a3f10c9e");
    // A failure still goes through `update()`, which is how the page hands the
    // field errors back down as the `errors` prop.
    expect(update).toHaveBeenCalledOnce();
  });
});
