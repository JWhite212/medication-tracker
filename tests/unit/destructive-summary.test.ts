import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  accountDeletionSummary,
  archivedMedicationsSummary,
  doseHistorySummary,
  formatCount,
  replaceSummary,
} from "../../src/lib/utils/destructive-confirm";

/**
 * The words the confirmation dialog uses to say what a permanent deletion
 * takes with it. The counts are the server's; the sentences are decided once
 * here, so the dialog and the page's zero line cannot disagree.
 */

describe("doseHistorySummary", () => {
  it("names the doses and the medications they span", () => {
    expect(doseHistorySummary({ doses: 1204, medications: 6 })).toBe(
      "This deletes 1,204 doses for 6 medications.",
    );
    expect(doseHistorySummary({ doses: 1, medications: 1 })).toBe(
      "This deletes 1 dose for 1 medication.",
    );
    expect(doseHistorySummary({ doses: 0, medications: 0 })).toBe(
      "There is no dose history to delete.",
    );
  });
});

describe("archivedMedicationsSummary", () => {
  it("names the archived medications and the doses logged for them", () => {
    expect(archivedMedicationsSummary({ medications: 2, doses: 340 })).toBe(
      "This deletes 2 archived medications and the 340 doses logged for them.",
    );
    expect(archivedMedicationsSummary({ medications: 1, doses: 1 })).toBe(
      "This deletes 1 archived medication and the 1 dose logged for it.",
    );
    expect(archivedMedicationsSummary({ medications: 1, doses: 0 })).toBe(
      "This deletes 1 archived medication. No doses were logged for it.",
    );
    expect(archivedMedicationsSummary({ medications: 3, doses: 0 })).toBe(
      "This deletes 3 archived medications. No doses were logged for them.",
    );
    expect(archivedMedicationsSummary({ medications: 0, doses: 0 })).toBe(
      "There are no archived medications to delete.",
    );
  });
});

describe("accountDeletionSummary", () => {
  it("names the account, its settings, and what it holds", () => {
    expect(accountDeletionSummary({ medications: 6, doses: 1204 })).toBe(
      "This deletes your account and settings, 6 medications and 1,204 doses.",
    );
    expect(accountDeletionSummary({ medications: 1, doses: 1 })).toBe(
      "This deletes your account and settings, 1 medication and 1 dose.",
    );
  });
});

describe("replaceSummary", () => {
  it("names what goes before the file is imported", () => {
    expect(replaceSummary({ medications: 6, doses: 1204 })).toBe(
      "This deletes 6 medications and 1,204 doses, with their schedules and inventory history, then imports the file.",
    );
    expect(replaceSummary({ medications: 1, doses: 1 })).toBe(
      "This deletes 1 medication and 1 dose, with their schedules and inventory history, then imports the file.",
    );
    expect(replaceSummary({ medications: 0, doses: 0 })).toBe(
      "Your account has no medications, so nothing is deleted before the file is imported.",
    );
  });
});

it("groups thousands the en-GB way whatever the runtime locale", () => {
  expect(formatCount(0)).toBe("0");
  expect(formatCount(1204)).toBe("1,204");
  expect(formatCount(1_000_000)).toBe("1,000,000");
});

it("has no imports, because DestructiveConfirm and every page read it", () => {
  const src = readFileSync("src/lib/utils/destructive-confirm.ts", "utf8");
  expect(src).not.toMatch(/^\s*import\s/m);
});
