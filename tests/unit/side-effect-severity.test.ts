import { describe, it, expect } from "vitest";
import { SEVERITY } from "$lib/utils/side-effect-severity";
import { toneOf } from "$lib/utils/status-tone";

describe("the side-effect severity table", () => {
  it("names each severity in a word, so the grade never rests on colour", () => {
    expect(Object.fromEntries(Object.entries(SEVERITY).map(([k, v]) => [k, v.word]))).toEqual({
      mild: "Mild",
      moderate: "Moderate",
      severe: "Severe",
    });
  });

  it("is neutral for mild and moderate and red only for severe", () => {
    expect(toneOf(SEVERITY.mild.status)).toBe("neutral");
    // Moderate used to be amber. Nothing about a moderate side effect asks
    // the user to act, so it is not "needs you".
    expect(toneOf(SEVERITY.moderate.status)).toBe("neutral");
    expect(toneOf(SEVERITY.severe.status)).toBe("wrong");
  });
});
