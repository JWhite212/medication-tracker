import { describe, expect, it } from "vitest";
import { formatDosage } from "$lib/utils/dosage";

describe("formatDosage", () => {
  it.each([
    ["30", "mg", "30mg"],
    ["5000", "IU", "5000IU"],
    ["5", "mL", "5mL"],
    ["980", "mg", "980mg"],
    ["50", "mcg", "50mcg"],
    ["1", "%", "1%"],
  ])("writes the abbreviation %s%s straight after the number", (amount, unit, expected) => {
    expect(formatDosage(amount, unit)).toBe(expected);
  });

  // The screenshot that prompted this: a multivitamin read "1Serving".
  it.each([
    ["1", "Serving", "1 Serving"],
    ["2", "tablets", "2 tablets"],
    ["1", "puff", "1 puff"],
    ["10", "units", "10 units"],
  ])("spaces the word %s %s", (amount, unit, expected) => {
    expect(formatDosage(amount, unit)).toBe(expected);
  });

  it("trims the typed unit and leaves a blank one off", () => {
    expect(formatDosage("1", "  Serving ")).toBe("1 Serving");
    expect(formatDosage("1", "  ")).toBe("1");
  });
});
