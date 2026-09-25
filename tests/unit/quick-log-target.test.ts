import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findQuickLogForm } from "$lib/utils/quick-log";

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

  it("submits through findQuickLogForm, never by the logDose action alone", () => {
    expect(src).toContain("findQuickLogForm(");
    expect(src).not.toContain(`form[action="?/logDose"]`);
  });

  it("describes 1–9 as logging now, by chip position", () => {
    expect(src).toContain("Log a medication now, by its position in the chip list");
  });
});
