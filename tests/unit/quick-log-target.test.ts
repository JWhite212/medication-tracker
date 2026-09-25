import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import { findQuickLogForm } from "$lib/utils/quick-log";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

import KeyboardShortcuts from "$lib/components/KeyboardShortcuts.svelte";

function logForm(attrs: string, medicationId: string, extra = ""): string {
  return (
    `<form method="POST" action="?/logDose" ${attrs}>` +
    `<input type="hidden" name="medicationId" value="${medicationId}" />${extra}` +
    `<button type="submit">x</button></form>`
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findQuickLogForm", () => {
  it("returns the chip even when a Due card's logDose forms for the same medication come first", () => {
    // Due cards render before the chips, and "Took it at" records a PAST
    // instant. A number key must never submit it.
    document.body.innerHTML =
      logForm(
        'data-testid="took-it-at"',
        "m1",
        '<input type="hidden" name="takenAt" value="2026-04-16T08:00:00.000Z" />',
      ) +
      logForm(
        'data-testid="log-now"',
        "m1",
        '<input type="hidden" name="forSlot" value="2026-04-16T12:00:00.000Z" />',
      ) +
      logForm('data-quick-log data-testid="chip-m2"', "m2") +
      logForm('data-quick-log data-testid="chip-m1"', "m1");
    expect(findQuickLogForm(document, "m1")?.dataset.testid).toBe("chip-m1");
  });

  it("returns null when the medication has no chip, whatever other logDose forms exist", () => {
    document.body.innerHTML = logForm('data-testid="took-it-at"', "m1");
    expect(findQuickLogForm(document, "m1")).toBeNull();
  });

  it("never returns another medication's chip", () => {
    document.body.innerHTML = logForm("data-quick-log", "m2");
    expect(findQuickLogForm(document, "m1")).toBeNull();
  });
});

describe("KeyboardShortcuts", () => {
  // cwd, not import.meta.url: this file runs under jsdom, where
  // import.meta.url is not a file: URL.
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/components/KeyboardShortcuts.svelte"),
    "utf8",
  ).replace(/\s+/g, " ");

  let destroy: (() => void) | null = null;

  afterEach(() => {
    destroy?.();
    destroy = null;
    vi.restoreAllMocks();
  });

  it("'1' requests submit of the first medication's chip — never a Due card's form, never a native submit", () => {
    // A Due card's "Took it at" is a ?/logDose form for the same medication
    // and comes first in the page. requestSubmit() runs the chip's enhance,
    // so the key goes through the write lock and the stale guard; submit()
    // would post natively and skip both.
    document.body.innerHTML =
      logForm(
        'data-testid="took-it-at"',
        "m1",
        '<input type="hidden" name="takenAt" value="2026-04-16T08:00:00.000Z" />',
      ) +
      logForm('data-quick-log data-testid="chip-m1"', "m1") +
      logForm('data-quick-log data-testid="chip-m2"', "m2");
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(KeyboardShortcuts, {
      target,
      props: {
        medications: [
          { id: "m1", name: "A" },
          { id: "m2", name: "B" },
        ],
      },
    });
    flushSync();
    destroy = () => unmount(component);

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true }),
    );

    expect(requestSubmit).toHaveBeenCalledOnce();
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.dataset.testid).toBe("chip-m1");
    expect(submit).not.toHaveBeenCalled();
  });

  it("describes 1–9 as logging now, by chip position", () => {
    expect(src).toContain("Log a medication now, by its position in the chip list");
  });
});
