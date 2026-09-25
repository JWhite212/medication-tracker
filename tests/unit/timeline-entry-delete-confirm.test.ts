// Default environment (jsdom) on purpose: this mounts the real component and
// drives it, because the properties below are about focus and about which
// click submits, and SSR markup cannot show either. Programmatic focus()
// and document.activeElement behave in jsdom as they do in a browser; what
// jsdom cannot do is layout, so "the confirm never appears under the pointer"
// is not measured here. The double-click test checks that a second click on ×
// closes the group again, and that the group renders as a block of its own
// after ×'s line rather than inside it, which is what keeps it from under the
// pointer in a browser.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync, tick } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DoseLogWithMedication } from "$lib/types";

const hoisted = vi.hoisted(() => ({
  showToast: vi.fn(),
  /**
   * One entry per submit that reached `enhance`, awaiting its result. The
   * optional `update` stands in for SvelteKit's, which reloads the page data.
   */
  submissions: [] as Array<(result: ActionResult, update?: () => Promise<void>) => Promise<void>>,
}));

vi.mock("$components/ui/Toast.svelte", () => ({ showToast: hoisted.showToast }));

// Stands in for SvelteKit's `enhance` with the same two-phase contract: the
// submit function runs when the form submits, and the callback it returns
// runs when the test decides the server has answered.
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    const onSubmit = async (e: SubmitEvent) => {
      e.preventDefault();
      const formData = new FormData(form);
      const action = new URL(form.getAttribute("action") ?? "", "http://localhost/log");
      const callback = await submit({
        action,
        formData,
        formElement: form,
        controller: new AbortController(),
        submitter: e.submitter,
        cancel: () => {},
      });
      hoisted.submissions.push(async (result, update = async () => {}) => {
        if (typeof callback === "function") {
          await callback({ action, formData, formElement: form, result, update });
        }
      });
    };
    form.addEventListener("submit", onSubmit);
    return { destroy: () => form.removeEventListener("submit", onSubmit) };
  },
}));

const { default: TimelineEntry } = await import("../../src/lib/components/TimelineEntry.svelte");

const dose: DoseLogWithMedication = {
  id: "dose-1",
  userId: "user-1",
  medicationId: "med-1",
  quantity: 1,
  takenAt: new Date("2026-04-16T08:00:00Z"),
  loggedAt: new Date("2026-04-16T08:00:00Z"),
  updatedAt: new Date("2026-04-16T08:00:00Z"),
  notes: null,
  sideEffects: null,
  status: "taken",
  medication: {
    name: "Vitamin D",
    dosageAmount: "1000",
    dosageUnit: "IU",
    form: "tablet",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
  },
};

let component: ReturnType<typeof mount> | undefined;
const onedit = vi.fn();

beforeEach(() => {
  hoisted.showToast.mockClear();
  hoisted.submissions.length = 0;
  onedit.mockClear();
  component = mount(TimelineEntry, {
    target: document.body,
    props: { dose, timezone: "UTC", timeFormat: "24h", onedit },
  });
  flushSync();
});

afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

/** Let the component's own `await tick()` and the enhance mock's awaits finish. */
async function settle() {
  flushSync();
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
}

function byLabel(prefix: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label^="${prefix}"]`);
}
const deleteToggle = () => byLabel("Delete dose of Vitamin D at 8:00")!;
const confirmButton = () => byLabel("Confirm delete dose of");
const group = () => document.querySelector<HTMLElement>('[role="group"]');
const cancelButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find(
    (b) => b.textContent?.trim() === "Cancel",
  ) ?? null;

async function openConfirm() {
  deleteToggle().click();
  await settle();
}

describe("× opens a confirmation and never deletes on its own", () => {
  it("is not a submit button, so no single activation of it can delete", async () => {
    const x = deleteToggle();
    expect(x.type).toBe("button");
    expect(x.closest("form")).toBeNull();

    await openConfirm();
    expect(hoisted.submissions).toHaveLength(0);
    expect(group()).not.toBeNull();
    expect(x.getAttribute("aria-expanded")).toBe("true");
    expect(x.getAttribute("aria-controls")).toBe(group()!.id);
  });

  it("survives a double-click: the second click lands on × and closes it again", async () => {
    const x = deleteToggle();
    // The row's top-level block that holds ×: the line × sits on.
    const xLine = [...document.querySelector('[role="listitem"]')!.children].find((el) =>
      el.contains(x),
    )!;
    x.click();
    // Let the confirmation render between the two clicks, as it would in the
    // gap a real double-click leaves, so the second one meets it open.
    await settle();
    expect(confirmButton()).not.toBeNull();
    // Inside ×'s line the group would sit beside ×, and at some width wrap
    // to under it; as a block after that line it can only start below it.
    expect(xLine.contains(x)).toBe(true);
    expect(xLine.contains(group())).toBe(false);
    expect(xLine.compareDocumentPosition(group()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    x.click();
    x.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();

    expect(hoisted.submissions).toHaveLength(0);
    expect(group()).toBeNull();
    expect(x.getAttribute("aria-expanded")).toBe("false");
  });

  it("names the confirm after the dose, distinct from every × on the page", async () => {
    await openConfirm();
    const confirm = confirmButton();
    expect(confirm, "no confirm button").not.toBeNull();
    // e2e selects it with /^Confirm delete dose of …/ and the × with
    // "Delete dose", which Playwright matches as a case-insensitive
    // substring. So the × name must not change, and nothing else in the
    // group may contain "delete dose" as the × does.
    expect(confirm!.getAttribute("aria-label")).toBe("Confirm delete dose of Vitamin D at 8:00");
    expect(deleteToggle().getAttribute("aria-label")).toBe("Delete dose of Vitamin D at 8:00");
    expect(cancelButton()!.textContent!.toLowerCase()).not.toContain("delete dose");

    expect(confirm!.type).toBe("submit");
    const form = confirm!.closest("form")!;
    expect(form.getAttribute("action")).toBe("?/deleteDose");
    expect(new FormData(form).get("doseId")).toBe("dose-1");
  });

  it("keeps the controls shown while it asks, even where they otherwise hide until hover", async () => {
    const container = deleteToggle().parentElement!;
    expect(container.className).toMatch(/opacity-0/);
    await openConfirm();
    expect(container.className).not.toMatch(/opacity-0/);
  });
});

describe("keyboard", () => {
  it("moves focus into the group on open, onto Cancel rather than Delete", async () => {
    await openConfirm();
    expect(document.activeElement).toBe(cancelButton());
    expect(group()!.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and returns focus to ×", async () => {
    await openConfirm();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    expect(group()).toBeNull();
    expect(document.activeElement).toBe(deleteToggle());
  });

  it("closes on Cancel and returns focus to ×", async () => {
    await openConfirm();
    cancelButton()!.click();
    await settle();
    expect(group()).toBeNull();
    expect(document.activeElement).toBe(deleteToggle());
    expect(hoisted.submissions).toHaveLength(0);
  });
});

describe("clicks inside the controls do not reach the row", () => {
  // The row's own click opens the edit modal; opening it over the question
  // being asked would bury the confirmation.
  it("leaves the edit modal shut for ×, the gap beside it, the prompt, the gap and Cancel", async () => {
    await openConfirm();
    // The wrapper around ✎ and ×: a click on it is one in the gap between them.
    deleteToggle().parentElement!.click();
    group()!.querySelector("p")!.click();
    group()!.click();
    confirmButton()!.parentElement!.parentElement!.click();
    cancelButton()!.click();
    await settle();
    deleteToggle().click();
    await settle();
    expect(onedit).not.toHaveBeenCalled();

    // Guard the guard: the row itself still opens it.
    document.querySelector<HTMLElement>('[role="listitem"]')!.click();
    expect(onedit).toHaveBeenCalledTimes(1);
  });
});

describe("submitting", () => {
  it("puts the spinner and the disabled state on the confirm button while pending", async () => {
    await openConfirm();
    const confirm = confirmButton()!;
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await settle();

    expect(hoisted.submissions).toHaveLength(1);
    expect(confirm.disabled).toBe(true);
    expect(confirm.querySelector(".animate-spin")).not.toBeNull();
    // Nothing may close the form underneath an in-flight request.
    expect(cancelButton()!.disabled).toBe(true);
    expect(deleteToggle().disabled).toBe(true);
    confirm.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(group()).not.toBeNull();
  });

  it("dims its label only while disabled, never on hover", async () => {
    await openConfirm();
    // hover:opacity-90 faded the danger fill and its label together, below
    // 4.5:1 in dark mode. A disabled control is exempt from 1.4.3.
    const dimming = confirmButton()!
      .className.split(/\s+/)
      .filter((t) => /(^|:)opacity-\d+$/.test(t));
    expect(dimming.filter((t) => !t.startsWith("disabled:"))).toEqual([]);
  });

  it("toasts the unchanged success text e2e waits for", async () => {
    await openConfirm();
    confirmButton()!.click();
    await settle();
    await hoisted.submissions[0]({ type: "success", status: 200, data: { success: true } });
    await settle();
    expect(hoisted.showToast).toHaveBeenCalledWith("Dose removed", "success");
  });

  // actionErrorMessage is the only reader of a failed action. The old callback
  // hand-wrote its own string for `failure` and had no arm for `error` at all.
  const FAILURES: Array<[string, ActionResult, string]> = [
    [
      "a fail(404)",
      { type: "failure", status: 404, data: { error: "Dose not found" } },
      "Dose not found",
    ],
    [
      "an unexpected throw",
      { type: "error", status: 500, error: { message: "Internal Error", errorId: "abc123" } },
      "Internal Error (reference abc123)",
    ],
  ];

  for (const [name, result, message] of FAILURES) {
    it(`reports ${name} through actionErrorMessage and hands focus back to ×`, async () => {
      await openConfirm();
      confirmButton()!.click();
      await settle();
      await hoisted.submissions[0](result);
      await settle();

      expect(hoisted.showToast).toHaveBeenCalledWith(message, "error");
      expect(hoisted.showToast).not.toHaveBeenCalledWith("Dose removed", "success");
      expect(group()).toBeNull();
      expect(deleteToggle().disabled).toBe(false);
      expect(document.activeElement).toBe(deleteToggle());
    });
  }

  it("does not pull focus back if the user moved on before a slow failure", async () => {
    await openConfirm();
    confirmButton()!.click();
    await settle();

    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    await hoisted.submissions[0]({
      type: "failure",
      status: 404,
      data: { error: "Dose not found" },
    });
    await settle();

    expect(group()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("after a confirmed delete succeeds", () => {
  // The row leaves with the dose and takes the focused confirm button with it.
  // Left there, focus falls to <body> and a keyboard user starts again from
  // the top of the page.
  let rows: Array<ReturnType<typeof mount> | undefined> = [];

  function mountList(names: string[]) {
    if (component) unmount(component);
    component = undefined;
    document.body.innerHTML = "";
    const list = document.createElement("div");
    list.setAttribute("role", "list");
    document.body.append(list);
    rows = names.map((name, i) =>
      mount(TimelineEntry, {
        target: list,
        props: {
          dose: { ...dose, id: `dose-${i}`, medication: { ...dose.medication, name } },
          timezone: "UTC",
          timeFormat: "24h",
          onedit,
        },
      }),
    );
    flushSync();
  }

  /** Confirm the delete, then answer it and drop the row as the page's keyed each would. */
  async function deleteRow(name: string, index: number) {
    byLabel(`Delete dose of ${name} at`)!.click();
    await settle();
    byLabel(`Confirm delete dose of ${name} at`)!.click();
    await settle();
    await hoisted.submissions[0](
      { type: "success", status: 200, data: { success: true } },
      async () => {
        unmount(rows[index]!);
        rows[index] = undefined;
      },
    );
    await settle();
  }

  afterEach(() => {
    for (const r of rows) if (r) unmount(r);
    rows = [];
  });

  it("hands focus to the next row", async () => {
    mountList(["Alpha", "Bravo", "Charlie"]);
    await deleteRow("Bravo", 1);
    expect(byLabel("Delete dose of Bravo at")).toBeNull();
    expect(document.activeElement).toBe(byLabel("Edit dose of Charlie at"));
  });

  it("hands focus to the previous row when the last one goes", async () => {
    mountList(["Alpha", "Bravo"]);
    await deleteRow("Bravo", 1);
    expect(document.activeElement).toBe(byLabel("Edit dose of Alpha at"));
  });

  it("leaves focus where it fell when the list is left empty", async () => {
    mountList(["Alpha"]);
    await deleteRow("Alpha", 0);
    expect(byLabel("Delete dose of Alpha at")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
